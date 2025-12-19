import { Request, Response, NextFunction } from 'express';
import { getPool } from '../config/database';
import { File, FileRow, rowToFile, CreateFolderRequest, RenameRequest, MoveRequest, CopyRequest } from '../models/File';
import { deleteFile, copyFile as copyFileToPath, getFileExtension, ensureDirectoryExists } from '../utils/fileUtils';
import * as path from 'path';
import * as fs from 'fs/promises';

const uploadDir = process.env.UPLOAD_DIR || './storage/uploads';
const thumbnailDir = process.env.THUMBNAIL_DIR || './storage/thumbnails';

// Helper to get base URL for file URLs
function getBaseUrl(req: Request): string {
  const protocol = req.protocol;
  const host = req.get('host');
  return `${protocol}://${host}`;
}

// Get files (list files in a folder)
export async function getFiles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parentId = req.query.parentId as string | undefined;
    const pool = getPool();
    
    let query = 'SELECT * FROM files WHERE';
    const params: any[] = [];
    
    if (parentId) {
      query += ' parent_id = $1';
      params.push(parentId);
    } else {
      query += ' parent_id IS NULL';
    }
    
    query += ' ORDER BY type DESC, created_at ASC';
    
    const result = await pool.query(query, params);
    const baseUrl = getBaseUrl(req);
    const files: File[] = result.rows.map((row: FileRow) => rowToFile(row, baseUrl));
    
    res.json({ data: files });
  } catch (error) {
    next(error);
  }
}

// Get file by ID
export async function getFileById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const pool = getPool();
    
    const result = await pool.query('SELECT * FROM files WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      res.status(404).json({ error: { message: 'File not found', statusCode: 404 } });
      return;
    }
    
    const baseUrl = getBaseUrl(req);
    const file = rowToFile(result.rows[0] as FileRow, baseUrl);
    
    res.json({ data: file });
  } catch (error) {
    next(error);
  }
}

// Upload files
export async function uploadFiles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const files = req.files as Express.Multer.File[];
    const parentId = req.body.parentId || null;
    
    if (!files || files.length === 0) {
      res.status(400).json({ error: { message: 'No files uploaded', statusCode: 400 } });
      return;
    }
    
    const pool = getPool();
    const baseUrl = getBaseUrl(req);
    const uploadedFiles: File[] = [];
    
    for (const file of files) {
      const fileId = await pool.query(
        'INSERT INTO files (name, type, parent_id, size, mime_type, extension, file_path, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) RETURNING *',
        [
          file.originalname,
          'file',
          parentId || null,
          file.size,
          file.mimetype,
          getFileExtension(file.originalname),
          file.path,
        ]
      );
      
      const fileRow = fileId.rows[0] as FileRow;
      uploadedFiles.push(rowToFile(fileRow, baseUrl));
    }
    
    res.status(201).json({ data: uploadedFiles });
  } catch (error) {
    next(error);
  }
}

// Create folder
export async function createFolder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, parentId }: CreateFolderRequest = req.body;
    
    if (!name || name.trim() === '') {
      res.status(400).json({ error: { message: 'Folder name is required', statusCode: 400 } });
      return;
    }
    
    const pool = getPool();
    
    // Check if parent exists (if parentId is provided)
    if (parentId) {
      const parentCheck = await pool.query('SELECT * FROM files WHERE id = $1', [parentId]);
      if (parentCheck.rows.length === 0) {
        res.status(404).json({ error: { message: 'Parent folder not found', statusCode: 404 } });
        return;
      }
      if (parentCheck.rows[0].type !== 'folder') {
        res.status(400).json({ error: { message: 'Parent must be a folder', statusCode: 400 } });
        return;
      }
    }
    
    const result = await pool.query(
      'INSERT INTO files (name, type, parent_id, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) RETURNING *',
      [name.trim(), 'folder', parentId || null]
    );
    
    const baseUrl = getBaseUrl(req);
    const folder = rowToFile(result.rows[0] as FileRow, baseUrl);
    
    res.status(201).json({ data: folder });
  } catch (error) {
    next(error);
  }
}

// Rename file/folder
export async function renameFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { name }: RenameRequest = req.body;
    
    if (!name || name.trim() === '') {
      res.status(400).json({ error: { message: 'Name is required', statusCode: 400 } });
      return;
    }
    
    const pool = getPool();
    
    // Check if file exists
    const checkResult = await pool.query('SELECT * FROM files WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      res.status(404).json({ error: { message: 'File not found', statusCode: 404 } });
      return;
    }
    
    const result = await pool.query(
      'UPDATE files SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [name.trim(), id]
    );
    
    const baseUrl = getBaseUrl(req);
    const file = rowToFile(result.rows[0] as FileRow, baseUrl);
    
    res.json({ data: file });
  } catch (error) {
    next(error);
  }
}

// Move file/folder
export async function moveFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { destinationId }: MoveRequest = req.body;
    const pool = getPool();
    
    // Check if file exists
    const fileResult = await pool.query('SELECT * FROM files WHERE id = $1', [id]);
    if (fileResult.rows.length === 0) {
      res.status(404).json({ error: { message: 'File not found', statusCode: 404 } });
      return;
    }
    
    const file = fileResult.rows[0] as FileRow;
    
    // Prevent moving folder into itself or its descendant
    if (destinationId && file.type === 'folder') {
      const isDescendant = await checkIfDescendant(pool, destinationId, id);
      if (isDescendant) {
        res.status(400).json({ error: { message: 'Cannot move folder into its own descendant', statusCode: 400 } });
        return;
      }
    }
    
    // Check if destination exists (if provided)
    if (destinationId) {
      const destResult = await pool.query('SELECT * FROM files WHERE id = $1', [destinationId]);
      if (destResult.rows.length === 0) {
        res.status(404).json({ error: { message: 'Destination folder not found', statusCode: 404 } });
        return;
      }
      if (destResult.rows[0].type !== 'folder') {
        res.status(400).json({ error: { message: 'Destination must be a folder', statusCode: 400 } });
        return;
      }
    }
    
    const result = await pool.query(
      'UPDATE files SET parent_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [destinationId || null, id]
    );
    
    const baseUrl = getBaseUrl(req);
    const updatedFile = rowToFile(result.rows[0] as FileRow, baseUrl);
    
    res.json({ data: updatedFile });
  } catch (error) {
    next(error);
  }
}

// Copy file/folder
export async function copyFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { destinationId }: CopyRequest = req.body;
    const pool = getPool();
    
    if (!destinationId) {
      res.status(400).json({ error: { message: 'Destination ID is required', statusCode: 400 } });
      return;
    }
    
    // Check if file exists
    const fileResult = await pool.query('SELECT * FROM files WHERE id = $1', [id]);
    if (fileResult.rows.length === 0) {
      res.status(404).json({ error: { message: 'File not found', statusCode: 404 } });
      return;
    }
    
    const originalFile = fileResult.rows[0] as FileRow;
    
    // Check if destination exists
    const destResult = await pool.query('SELECT * FROM files WHERE id = $1', [destinationId]);
    if (destResult.rows.length === 0) {
      res.status(404).json({ error: { message: 'Destination folder not found', statusCode: 404 } });
      return;
    }
    if (destResult.rows[0].type !== 'folder') {
      res.status(400).json({ error: { message: 'Destination must be a folder', statusCode: 400 } });
      return;
    }
    
    // Copy file or folder recursively
    const copiedFile = await copyFileRecursive(pool, originalFile, destinationId);
    
    const baseUrl = getBaseUrl(req);
    const file = rowToFile(copiedFile, baseUrl);
    
    res.status(201).json({ data: file });
  } catch (error) {
    next(error);
  }
}

// Delete file/folder (recursive)
export async function deleteFileById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const pool = getPool();
    
    // Get file info
    const fileResult = await pool.query('SELECT * FROM files WHERE id = $1', [id]);
    if (fileResult.rows.length === 0) {
      res.status(404).json({ error: { message: 'File not found', statusCode: 404 } });
      return;
    }
    
    const file = fileResult.rows[0] as FileRow;
    
    // Delete recursively (database CASCADE will handle children)
    await deleteFileRecursive(pool, file);
    
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

// Download file
export async function downloadFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const pool = getPool();
    
    const result = await pool.query('SELECT * FROM files WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: { message: 'File not found', statusCode: 404 } });
      return;
    }
    
    const file = result.rows[0] as FileRow;
    
    if (file.type !== 'file' || !file.file_path) {
      res.status(400).json({ error: { message: 'Not a file or file path not found', statusCode: 400 } });
      return;
    }
    
    // Check if file exists on filesystem
    try {
      await fs.access(file.file_path);
    } catch {
      res.status(404).json({ error: { message: 'File not found on filesystem', statusCode: 404 } });
      return;
    }
    
    res.download(file.file_path, file.name);
  } catch (error) {
    next(error);
  }
}

// Helper: Check if a folder is a descendant of another
async function checkIfDescendant(pool: any, folderId: string, ancestorId: string): Promise<boolean> {
  if (folderId === ancestorId) {
    return true;
  }
  
  const result = await pool.query('SELECT parent_id FROM files WHERE id = $1', [folderId]);
  if (result.rows.length === 0 || !result.rows[0].parent_id) {
    return false;
  }
  
  if (result.rows[0].parent_id === ancestorId) {
    return true;
  }
  
  return checkIfDescendant(pool, result.rows[0].parent_id, ancestorId);
}

// Helper: Copy file/folder recursively
async function copyFileRecursive(pool: any, file: FileRow, destinationId: string): Promise<FileRow> {
  if (file.type === 'file') {
    // Copy file on filesystem
    let newFilePath: string | null = null;
    if (file.file_path) {
      const newFileName = path.basename(file.file_path);
      newFilePath = path.join(uploadDir, newFileName);
      await copyFileToPath(file.file_path, newFilePath);
    }
    
    // Create database record
    const result = await pool.query(
      'INSERT INTO files (name, type, parent_id, size, mime_type, extension, file_path, thumbnail_path, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()) RETURNING *',
      [
        `${file.name} (copy)`,
        'file',
        destinationId,
        file.size,
        file.mime_type,
        file.extension,
        newFilePath,
        file.thumbnail_path,
      ]
    );
    
    return result.rows[0] as FileRow;
  } else {
    // Create folder
    const folderResult = await pool.query(
      'INSERT INTO files (name, type, parent_id, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) RETURNING *',
      [`${file.name} (copy)`, 'folder', destinationId]
    );
    
    const newFolder = folderResult.rows[0] as FileRow;
    
    // Copy children
    const childrenResult = await pool.query('SELECT * FROM files WHERE parent_id = $1', [file.id]);
    for (const child of childrenResult.rows) {
      await copyFileRecursive(pool, child as FileRow, newFolder.id);
    }
    
    return newFolder;
  }
}

// Helper: Delete file/folder recursively
async function deleteFileRecursive(pool: any, file: FileRow): Promise<void> {
  if (file.type === 'file') {
    // Delete file from filesystem
    if (file.file_path) {
      await deleteFile(file.file_path);
    }
    if (file.thumbnail_path) {
      await deleteFile(file.thumbnail_path);
    }
  } else {
    // Delete children first
    const childrenResult = await pool.query('SELECT * FROM files WHERE parent_id = $1', [file.id]);
    for (const child of childrenResult.rows) {
      await deleteFileRecursive(pool, child as FileRow);
    }
  }
  
  // Delete database record (CASCADE will handle children, but we already deleted them)
  await pool.query('DELETE FROM files WHERE id = $1', [file.id]);
}

