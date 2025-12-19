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

// Helper to check if user is admin
function isAdmin(req: Request): boolean {
  return req.user?.role === 'admin';
}

// Helper to build WHERE clause for user filtering (admin bypasses)
function buildUserFilter(req: Request, paramIndex: number = 1): { clause: string; params: any[] } {
  if (isAdmin(req)) {
    // Admin can see all files - no user_id filter
    return { clause: '', params: [] };
  }
  // Regular users can only see their own files
  return { clause: ` AND user_id = $${paramIndex}`, params: [req.user!.userId] };
}

// Helper to check if file exists and user has access (belongs to user or user is admin)
async function checkFileAccess(pool: any, fileId: string, req: Request): Promise<FileRow | null> {
  if (isAdmin(req)) {
    // Admin can access any file
    const result = await pool.query('SELECT * FROM files WHERE id = $1', [fileId]);
    return result.rows.length > 0 ? (result.rows[0] as FileRow) : null;
  }
  // Regular users can only access their own files
  const result = await pool.query('SELECT * FROM files WHERE id = $1 AND user_id = $2', [fileId, req.user!.userId]);
  return result.rows.length > 0 ? (result.rows[0] as FileRow) : null;
}

// Get files (list files in a folder)
export async function getFiles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user?.userId) {
      res.status(401).json({ error: { message: 'Authentication required', statusCode: 401 } });
      return;
    }

    const parentId = req.query.parentId as string | undefined;
    const pool = getPool();
    
    // Build user filter (admin bypasses)
    const userFilter = buildUserFilter(req, 1);
    let query = 'SELECT * FROM files WHERE 1=1' + userFilter.clause;
    const params: any[] = [...userFilter.params];
    
    if (parentId) {
      query += ` AND parent_id = $${params.length + 1}`;
      params.push(parentId);
    } else {
      query += ' AND parent_id IS NULL';
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
    if (!req.user?.userId) {
      res.status(401).json({ error: { message: 'Authentication required', statusCode: 401 } });
      return;
    }

    const { id } = req.params;
    const pool = getPool();
    
    // Build user filter (admin bypasses)
    const userFilter = buildUserFilter(req, 2);
    const query = `SELECT * FROM files WHERE id = $1${userFilter.clause}`;
    const params: any[] = [id, ...userFilter.params];
    
    const result = await pool.query(query, params);
    
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
    if (!req.user?.userId) {
      res.status(401).json({ error: { message: 'Authentication required', statusCode: 401 } });
      return;
    }

    const files = req.files as Express.Multer.File[];
    const parentId = req.body.parentId || null;
    
    if (!files || files.length === 0) {
      res.status(400).json({ error: { message: 'No files uploaded', statusCode: 400 } });
      return;
    }
    
    const pool = getPool();
    const baseUrl = getBaseUrl(req);
    const userId = req.user.userId;
    const uploadedFiles: File[] = [];
    
    // Verify parent folder exists and user has access (if parentId is provided)
    if (parentId) {
      const parentFile = await checkFileAccess(pool, parentId, req);
      if (!parentFile) {
        res.status(404).json({ error: { message: 'Parent folder not found', statusCode: 404 } });
        return;
      }
    }
    
    for (const file of files) {
      const fileId = await pool.query(
        'INSERT INTO files (name, type, parent_id, user_id, size, mime_type, extension, file_path, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()) RETURNING *',
        [
          file.originalname,
          'file',
          parentId || null,
          userId,
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
    if (!req.user?.userId) {
      res.status(401).json({ error: { message: 'Authentication required', statusCode: 401 } });
      return;
    }

    const { name, parentId }: CreateFolderRequest = req.body;
    
    if (!name || name.trim() === '') {
      res.status(400).json({ error: { message: 'Folder name is required', statusCode: 400 } });
      return;
    }
    
    const pool = getPool();
    const userId = req.user.userId;
    
    // Check if parent exists and user has access (if parentId is provided)
    if (parentId) {
      const parentFile = await checkFileAccess(pool, parentId, req);
      if (!parentFile) {
        res.status(404).json({ error: { message: 'Parent folder not found', statusCode: 404 } });
        return;
      }
      if (parentFile.type !== 'folder') {
        res.status(400).json({ error: { message: 'Parent must be a folder', statusCode: 400 } });
        return;
      }
    }
    
    const result = await pool.query(
      'INSERT INTO files (name, type, parent_id, user_id, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING *',
      [name.trim(), 'folder', parentId || null, userId]
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
    if (!req.user?.userId) {
      res.status(401).json({ error: { message: 'Authentication required', statusCode: 401 } });
      return;
    }

    const { id } = req.params;
    const { name }: RenameRequest = req.body;
    
    if (!name || name.trim() === '') {
      res.status(400).json({ error: { message: 'Name is required', statusCode: 400 } });
      return;
    }
    
    const pool = getPool();
    const userId = req.user.userId;
    
    // Check if file exists and user has access
    const targetFile = await checkFileAccess(pool, id, req);
    if (!targetFile) {
      res.status(404).json({ error: { message: 'File not found', statusCode: 404 } });
      return;
    }
    
    // Build update query (admin can update any file, regular users only their own)
    const userFilter = isAdmin(req) ? '' : ` AND user_id = $3`;
    const updateParams: any[] = isAdmin(req) ? [name.trim(), id] : [name.trim(), id, userId];
    
    const result = await pool.query(
      `UPDATE files SET name = $1, updated_at = NOW() WHERE id = $2${userFilter} RETURNING *`,
      updateParams
    );
    
    const baseUrl = getBaseUrl(req);
    const updatedFile = rowToFile(result.rows[0] as FileRow, baseUrl);
    
    res.json({ data: updatedFile });
  } catch (error) {
    next(error);
  }
}

// Move file/folder
export async function moveFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user?.userId) {
      res.status(401).json({ error: { message: 'Authentication required', statusCode: 401 } });
      return;
    }

    const { id } = req.params;
    const { destinationId }: MoveRequest = req.body;
    const pool = getPool();
    const userId = req.user.userId;
    
    // Check if file exists and user has access
    const file = await checkFileAccess(pool, id, req);
    if (!file) {
      res.status(404).json({ error: { message: 'File not found', statusCode: 404 } });
      return;
    }
    
    // Prevent moving folder into itself or its descendant
    if (destinationId && file.type === 'folder') {
      const isDescendant = await checkIfDescendant(pool, destinationId, id, req.user!.userId, isAdmin(req));
      if (isDescendant) {
        res.status(400).json({ error: { message: 'Cannot move folder into its own descendant', statusCode: 400 } });
        return;
      }
    }
    
    // Check if destination exists and user has access (if provided)
    if (destinationId) {
      const destFile = await checkFileAccess(pool, destinationId, req);
      if (!destFile) {
        res.status(404).json({ error: { message: 'Destination folder not found', statusCode: 404 } });
        return;
      }
      if (destFile.type !== 'folder') {
        res.status(400).json({ error: { message: 'Destination must be a folder', statusCode: 400 } });
        return;
      }
    }
    
    // Build update query (admin can update any file, regular users only their own)
    const userFilter = isAdmin(req) ? '' : ` AND user_id = $3`;
    const updateParams: any[] = isAdmin(req) ? [destinationId || null, id] : [destinationId || null, id, userId];
    
    const result = await pool.query(
      `UPDATE files SET parent_id = $1, updated_at = NOW() WHERE id = $2${userFilter} RETURNING *`,
      updateParams
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
    if (!req.user?.userId) {
      res.status(401).json({ error: { message: 'Authentication required', statusCode: 401 } });
      return;
    }

    const { id } = req.params;
    const { destinationId }: CopyRequest = req.body;
    const pool = getPool();
    const userId = req.user.userId;
    
    if (!destinationId) {
      res.status(400).json({ error: { message: 'Destination ID is required', statusCode: 400 } });
      return;
    }
    
    // Check if file exists and user has access
    const originalFile = await checkFileAccess(pool, id, req);
    if (!originalFile) {
      res.status(404).json({ error: { message: 'File not found', statusCode: 404 } });
      return;
    }
    
    // Check if destination exists and user has access
    const destFile = await checkFileAccess(pool, destinationId, req);
    if (!destFile) {
      res.status(404).json({ error: { message: 'Destination folder not found', statusCode: 404 } });
      return;
    }
    if (destFile.type !== 'folder') {
      res.status(400).json({ error: { message: 'Destination must be a folder', statusCode: 400 } });
      return;
    }
    
    // Copy file or folder recursively (copies belong to the user performing the operation)
    const copiedFile = await copyFileRecursive(pool, originalFile, destinationId, userId);
    
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
    if (!req.user?.userId) {
      res.status(401).json({ error: { message: 'Authentication required', statusCode: 401 } });
      return;
    }

    const { id } = req.params;
    const pool = getPool();
    const userId = req.user.userId;
    
    // Get file info and verify user has access
    const file = await checkFileAccess(pool, id, req);
    if (!file) {
      res.status(404).json({ error: { message: 'File not found', statusCode: 404 } });
      return;
    }
    
    // Delete recursively (admin can delete any file, regular users only their own)
    await deleteFileRecursive(pool, file, isAdmin(req));
    
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

// Download file
export async function downloadFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user?.userId) {
      res.status(401).json({ error: { message: 'Authentication required', statusCode: 401 } });
      return;
    }

    const { id } = req.params;
    const pool = getPool();
    
    // Check if file exists and user has access
    const file = await checkFileAccess(pool, id, req);
    if (!file) {
      res.status(404).json({ error: { message: 'File not found', statusCode: 404 } });
      return;
    }
    
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
async function checkIfDescendant(pool: any, folderId: string, ancestorId: string, userId: string, isAdminUser: boolean): Promise<boolean> {
  if (folderId === ancestorId) {
    return true;
  }
  
  // Admin can check across all files, regular users only their own
  const query = isAdminUser 
    ? 'SELECT parent_id FROM files WHERE id = $1'
    : 'SELECT parent_id FROM files WHERE id = $1 AND user_id = $2';
  const params = isAdminUser ? [folderId] : [folderId, userId];
  
  const result = await pool.query(query, params);
  if (result.rows.length === 0 || !result.rows[0].parent_id) {
    return false;
  }
  
  if (result.rows[0].parent_id === ancestorId) {
    return true;
  }
  
  return checkIfDescendant(pool, result.rows[0].parent_id, ancestorId, userId, isAdminUser);
}

// Helper: Copy file/folder recursively
async function copyFileRecursive(pool: any, file: FileRow, destinationId: string, userId: string): Promise<FileRow> {
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
      'INSERT INTO files (name, type, parent_id, user_id, size, mime_type, extension, file_path, thumbnail_path, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW()) RETURNING *',
      [
        `${file.name} (copy)`,
        'file',
        destinationId,
        userId,
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
      'INSERT INTO files (name, type, parent_id, user_id, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING *',
      [`${file.name} (copy)`, 'folder', destinationId, userId]
    );
    
    const newFolder = folderResult.rows[0] as FileRow;
    
    // Copy children (only those belonging to the same user)
    const childrenResult = await pool.query('SELECT * FROM files WHERE parent_id = $1 AND user_id = $2', [file.id, userId]);
    for (const child of childrenResult.rows) {
      await copyFileRecursive(pool, child as FileRow, newFolder.id, userId);
    }
    
    return newFolder;
  }
}

// Helper: Delete file/folder recursively
async function deleteFileRecursive(pool: any, file: FileRow, isAdminUser: boolean): Promise<void> {
  if (file.type === 'file') {
    // Delete file from filesystem
    if (file.file_path) {
      await deleteFile(file.file_path);
    }
    if (file.thumbnail_path) {
      await deleteFile(file.thumbnail_path);
    }
  } else {
    // Delete children first (admin deletes all children, regular users only their own)
    const childrenQuery = isAdminUser
      ? 'SELECT * FROM files WHERE parent_id = $1'
      : 'SELECT * FROM files WHERE parent_id = $1 AND user_id = $2';
    const childrenParams = isAdminUser ? [file.id] : [file.id, file.user_id];
    const childrenResult = await pool.query(childrenQuery, childrenParams);
    for (const child of childrenResult.rows) {
      await deleteFileRecursive(pool, child as FileRow, isAdminUser);
    }
  }
  
  // Delete database record (admin can delete any file, regular users only their own)
  const deleteQuery = isAdminUser
    ? 'DELETE FROM files WHERE id = $1'
    : 'DELETE FROM files WHERE id = $1 AND user_id = $2';
  const deleteParams = isAdminUser ? [file.id] : [file.id, file.user_id];
  await pool.query(deleteQuery, deleteParams);
}

