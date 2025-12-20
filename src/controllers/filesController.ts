import { Request, Response, NextFunction } from 'express';
import { getPool } from '../config/database';
import { File, FileRow, rowToFile, CreateFolderRequest, RenameRequest, MoveRequest, CopyRequest } from '../models/File';
import { deleteFile, copyFile as copyFileToPath, getFileExtension, ensureDirectoryExists, validateFilePath, sanitizeFileName } from '../utils/fileUtils';
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

// Helper to check if file exists and user has access (belongs to user, is shared with user, or user is admin)
async function checkFileAccess(pool: any, fileId: string, req: Request): Promise<FileRow | null> {
  if (isAdmin(req)) {
    // Admin can access any file (including deleted ones)
    const result = await pool.query('SELECT * FROM files WHERE id = $1', [fileId]);
    return result.rows.length > 0 ? (result.rows[0] as FileRow) : null;
  }
  
  const userId = req.user!.userId;
  
  // Check if user owns the file, if it's directly shared, or if it's inside a shared folder
  const result = await pool.query(
    `WITH RECURSIVE accessible_folders AS (
       -- Base case: folders owned by user or directly shared with user
       SELECT id, parent_id
       FROM files
       WHERE deleted = FALSE
       AND type = 'folder'
       AND (
         user_id = $2
         OR EXISTS (
           SELECT 1 FROM file_shares fs
           WHERE fs.file_id = files.id
           AND fs.shared_with_user_id = $2
         )
       )
       
       UNION
       
       -- Recursive case: all descendant folders of accessible folders
       SELECT f.id, f.parent_id
       FROM files f
       INNER JOIN accessible_folders af ON f.parent_id = af.id
       WHERE f.deleted = FALSE
       AND f.type = 'folder'
     )
     SELECT f.* FROM files f
     LEFT JOIN file_shares fs ON f.id = fs.file_id AND fs.shared_with_user_id = $2
     WHERE f.id = $1 
     AND f.deleted = FALSE
     AND (
       f.user_id = $2 
       OR fs.id IS NOT NULL
       OR EXISTS (
         SELECT 1 FROM accessible_folders af
         WHERE af.id = f.parent_id
       )
     )`,
    [fileId, userId]
  );
  
  return result.rows.length > 0 ? (result.rows[0] as FileRow) : null;
}

// Helper to check if user has write access to a file (owner, shared with write permission, or admin)
async function checkWriteAccess(pool: any, fileId: string, req: Request): Promise<boolean> {
  if (isAdmin(req)) {
    return true;
  }
  
  const userId = req.user!.userId;
  
  // Check if user owns the file or has write permission via share
  const result = await pool.query(
    `SELECT f.id FROM files f
     LEFT JOIN file_shares fs ON f.id = fs.file_id AND fs.shared_with_user_id = $2
     WHERE f.id = $1 
     AND f.deleted = FALSE
     AND (f.user_id = $2 OR (fs.id IS NOT NULL AND fs.permission = 'write'))`,
    [fileId, userId]
  );
  
  return result.rows.length > 0;
}

// Get files (list files in a folder)
export async function getFiles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user?.userId) {
      res.status(401).json({ error: { message: 'Authentication required', statusCode: 401 } });
      return;
    }

    const parentId = req.query.parentId as string | undefined;
    const userId = req.query.userId as string | undefined; // For admin to view specific user's files
    const pool = getPool();
    
    // Build query to include owned files and shared files
    let query = '';
    let params: any[] = [];
    let paramIndex = 1;
    
    if (isAdmin(req)) {
      // Admin sees all files
      query = 'SELECT DISTINCT f.* FROM files f WHERE 1=1';
      if (userId) {
        query += ` AND f.user_id = $${paramIndex}`;
        params.push(userId);
        paramIndex++;
      }
      if (parentId) {
        query += ` AND f.parent_id = $${paramIndex}`;
        params.push(parentId);
        paramIndex++;
      } else {
        query += ' AND f.parent_id IS NULL';
      }
    } else {
      // Regular users see their own files, files shared with them, and files inside shared folders
      const userId = req.user.userId;
      params.push(userId);
      paramIndex++;
      
      if (parentId) {
        // When viewing a specific folder, check if that folder is accessible (owned or shared)
        // If accessible, show all files in it
        query = `SELECT DISTINCT f.* FROM files f
                 WHERE f.deleted = FALSE
                 AND f.parent_id = $${paramIndex}
                 AND EXISTS (
                   SELECT 1 FROM files parent
                   LEFT JOIN file_shares fs ON parent.id = fs.file_id AND fs.shared_with_user_id = $${paramIndex - 1}
                   WHERE parent.id = $${paramIndex}
                   AND parent.deleted = FALSE
                   AND (parent.user_id = $${paramIndex - 1} OR fs.id IS NOT NULL)
                 )`;
        params.push(parentId);
        paramIndex++;
      } else {
        // Root level: show owned files, directly shared files, and files in shared folders
        query = `WITH RECURSIVE accessible_folders AS (
                   -- Base case: folders owned by user or directly shared with user
                   SELECT id, parent_id
                   FROM files
                   WHERE deleted = FALSE
                   AND type = 'folder'
                   AND (
                     user_id = $${paramIndex - 1}
                     OR EXISTS (
                       SELECT 1 FROM file_shares fs
                       WHERE fs.file_id = files.id
                       AND fs.shared_with_user_id = $${paramIndex - 1}
                     )
                   )
                   
                   UNION
                   
                   -- Recursive case: all descendant folders of accessible folders
                   SELECT f.id, f.parent_id
                   FROM files f
                   INNER JOIN accessible_folders af ON f.parent_id = af.id
                   WHERE f.deleted = FALSE
                   AND f.type = 'folder'
                 )
                 SELECT DISTINCT f.* FROM files f
                 WHERE f.deleted = FALSE
                 AND f.parent_id IS NULL
                 AND (
                   -- Owned by user
                   f.user_id = $${paramIndex - 1}
                   -- Or directly shared
                   OR EXISTS (
                     SELECT 1 FROM file_shares fs
                     WHERE fs.file_id = f.id
                     AND fs.shared_with_user_id = $${paramIndex - 1}
                   )
                   -- Or inside an accessible folder (shared or owned)
                   OR EXISTS (
                     SELECT 1 FROM accessible_folders af
                     WHERE af.id = f.parent_id
                   )
                 )`;
      }
    }
    
    query += ' ORDER BY f.type DESC, f.created_at ASC';
    
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
    let query = `SELECT * FROM files WHERE id = $1${userFilter.clause}`;
    const params: any[] = [id, ...userFilter.params];
    
    // Regular users can't see deleted files, admins can see all
    if (!isAdmin(req)) {
      query += ' AND deleted = FALSE';
    }
    
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
    
    // Sanitize folder name to prevent path traversal and other issues
    const sanitizedName = sanitizeFileName(name.trim());
    
    if (!sanitizedName || sanitizedName.length === 0) {
      res.status(400).json({ error: { message: 'Invalid folder name', statusCode: 400 } });
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
      [sanitizedName, 'folder', parentId || null, userId]
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
    
    // Sanitize file/folder name to prevent path traversal and other issues
    const sanitizedName = sanitizeFileName(name.trim());
    
    if (!sanitizedName || sanitizedName.length === 0) {
      res.status(400).json({ error: { message: 'Invalid name', statusCode: 400 } });
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
    const updateParams: any[] = isAdmin(req) ? [sanitizedName, id] : [sanitizedName, id, userId];
    
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
    const isAdminUser = isAdmin(req);
    
    // Get file info and verify user has access
    const file = await checkFileAccess(pool, id, req);
    if (!file) {
      res.status(404).json({ error: { message: 'File not found', statusCode: 404 } });
      return;
    }
    
    if (isAdminUser) {
      // Admin: Hard delete (permanently delete)
      await deleteFileRecursive(pool, file, true);
    } else {
      // Regular user: Soft delete (set deleted = true)
      await softDeleteFileRecursive(pool, file, userId);
    }
    
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
    
    // Validate file path is within allowed directory (prevent path traversal)
    if (!validateFilePath(file.file_path, uploadDir)) {
      res.status(403).json({ error: { message: 'Invalid file path', statusCode: 403 } });
      return;
    }
    
    // Check if file exists on filesystem
    try {
      await fs.access(file.file_path);
    } catch {
      res.status(404).json({ error: { message: 'File not found on filesystem', statusCode: 404 } });
      return;
    }
    
    // Set CORS headers explicitly for file downloads
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
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
  
  // Admin can check across all files (including deleted), regular users only their own non-deleted files
  const query = isAdminUser 
    ? 'SELECT parent_id FROM files WHERE id = $1'
    : 'SELECT parent_id FROM files WHERE id = $1 AND user_id = $2 AND deleted = FALSE';
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
    
    // Copy children (only those belonging to the same user and not deleted)
    const childrenResult = await pool.query('SELECT * FROM files WHERE parent_id = $1 AND user_id = $2 AND deleted = FALSE', [file.id, userId]);
    for (const child of childrenResult.rows) {
      await copyFileRecursive(pool, child as FileRow, newFolder.id, userId);
    }
    
    return newFolder;
  }
}

// Helper: Soft delete file/folder recursively (set deleted = true)
async function softDeleteFileRecursive(pool: any, file: FileRow, userId: string): Promise<void> {
  if (file.type === 'folder') {
    // Soft delete children first (only user's own files)
    const childrenResult = await pool.query(
      'SELECT * FROM files WHERE parent_id = $1 AND user_id = $2 AND deleted = FALSE',
      [file.id, userId]
    );
    for (const child of childrenResult.rows) {
      await softDeleteFileRecursive(pool, child as FileRow, userId);
    }
  }
  
  // Set deleted = true (only user's own files)
  await pool.query(
    'UPDATE files SET deleted = TRUE, updated_at = NOW() WHERE id = $1 AND user_id = $2',
    [file.id, userId]
  );
}

// Helper: Hard delete file/folder recursively (permanently delete - admin only)
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
    // Delete children first (admin deletes all children)
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

// Share a folder with a user
export async function shareFolder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user?.userId) {
      res.status(401).json({ error: { message: 'Authentication required', statusCode: 401 } });
      return;
    }

    const { id } = req.params;
    const { userId: sharedWithUserId, permission = 'read' } = req.body;
    
    if (!sharedWithUserId) {
      res.status(400).json({ error: { message: 'User ID is required', statusCode: 400 } });
      return;
    }
    
    if (permission !== 'read' && permission !== 'write') {
      res.status(400).json({ error: { message: 'Permission must be "read" or "write"', statusCode: 400 } });
      return;
    }
    
    const pool = getPool();
    const sharedByUserId = req.user.userId;
    
    // Check if file exists and user owns it (or is admin)
    const file = await checkFileAccess(pool, id, req);
    if (!file) {
      res.status(404).json({ error: { message: 'File not found', statusCode: 404 } });
      return;
    }
    
    // Only folders can be shared
    if (file.type !== 'folder') {
      res.status(400).json({ error: { message: 'Only folders can be shared', statusCode: 400 } });
      return;
    }
    
    // User must own the folder (or be admin) to share it
    if (!isAdmin(req) && file.user_id !== sharedByUserId) {
      res.status(403).json({ error: { message: 'You can only share folders you own', statusCode: 403 } });
      return;
    }
    
    // Can't share with yourself
    if (sharedWithUserId === sharedByUserId) {
      res.status(400).json({ error: { message: 'Cannot share folder with yourself', statusCode: 400 } });
      return;
    }
    
    // Check if user exists
    const userResult = await pool.query('SELECT id FROM users WHERE id = $1', [sharedWithUserId]);
    if (userResult.rows.length === 0) {
      res.status(404).json({ error: { message: 'User not found', statusCode: 404 } });
      return;
    }
    
    // Create or update share (UPSERT)
    const shareResult = await pool.query(
      `INSERT INTO file_shares (file_id, shared_by_user_id, shared_with_user_id, permission, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (file_id, shared_with_user_id)
       DO UPDATE SET permission = $4, updated_at = NOW()
       RETURNING *`,
      [id, sharedByUserId, sharedWithUserId, permission]
    );
    
    res.status(201).json({ data: shareResult.rows[0] });
  } catch (error) {
    next(error);
  }
}

// Unshare a folder with a user
export async function unshareFolder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user?.userId) {
      res.status(401).json({ error: { message: 'Authentication required', statusCode: 401 } });
      return;
    }

    const { id, userId: sharedWithUserId } = req.params;
    const pool = getPool();
    const sharedByUserId = req.user.userId;
    
    // Check if file exists and user owns it (or is admin)
    const file = await checkFileAccess(pool, id, req);
    if (!file) {
      res.status(404).json({ error: { message: 'File not found', statusCode: 404 } });
      return;
    }
    
    // User must own the folder (or be admin) to unshare it
    if (!isAdmin(req) && file.user_id !== sharedByUserId) {
      res.status(403).json({ error: { message: 'You can only unshare folders you own', statusCode: 403 } });
      return;
    }
    
    // Delete the share
    const result = await pool.query(
      'DELETE FROM file_shares WHERE file_id = $1 AND shared_with_user_id = $2 RETURNING *',
      [id, sharedWithUserId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ error: { message: 'Share not found', statusCode: 404 } });
      return;
    }
    
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

// Get list of users a folder is shared with
export async function getFolderShares(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user?.userId) {
      res.status(401).json({ error: { message: 'Authentication required', statusCode: 401 } });
      return;
    }

    const { id } = req.params;
    const pool = getPool();
    const userId = req.user.userId;
    
    // Check if file exists and user owns it (or is admin)
    const file = await checkFileAccess(pool, id, req);
    if (!file) {
      res.status(404).json({ error: { message: 'File not found', statusCode: 404 } });
      return;
    }
    
    // User must own the folder (or be admin) to see shares
    if (!isAdmin(req) && file.user_id !== userId) {
      res.status(403).json({ error: { message: 'You can only view shares for folders you own', statusCode: 403 } });
      return;
    }
    
    // Get all shares for this folder with user info
    const result = await pool.query(
      `SELECT fs.*, u.id as user_id, u.email, u.name, u.avatar_url
       FROM file_shares fs
       JOIN users u ON fs.shared_with_user_id = u.id
       WHERE fs.file_id = $1
       ORDER BY fs.created_at ASC`,
      [id]
    );
    
    res.json({ data: result.rows });
  } catch (error) {
    next(error);
  }
}

// Get folders shared with current user
export async function getSharedFolders(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user?.userId) {
      res.status(401).json({ error: { message: 'Authentication required', statusCode: 401 } });
      return;
    }

    const pool = getPool();
    const userId = req.user.userId;
    
    // Get all folders shared with this user
    const result = await pool.query(
      `SELECT DISTINCT f.*, fs.permission, u.id as owner_id, u.email as owner_email, u.name as owner_name
       FROM files f
       JOIN file_shares fs ON f.id = fs.file_id
       JOIN users u ON f.user_id = u.id
       WHERE fs.shared_with_user_id = $1
       AND f.deleted = FALSE
       AND f.type = 'folder'
       ORDER BY f.created_at DESC`,
      [userId]
    );
    
    const baseUrl = getBaseUrl(req);
    const files: File[] = result.rows.map((row: any) => {
      const file = rowToFile(row as FileRow, baseUrl);
      // Add share metadata
      (file as any).sharePermission = row.permission;
      (file as any).owner = {
        id: row.owner_id,
        email: row.owner_email,
        name: row.owner_name,
      };
      return file;
    });
    
    res.json({ data: files });
  } catch (error) {
    next(error);
  }
}

