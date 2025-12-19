import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * Ensure directory exists, create if it doesn't
 */
export async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

/**
 * Get file extension from filename
 */
export function getFileExtension(filename: string): string | undefined {
  const ext = path.extname(filename).toLowerCase();
  return ext ? ext.substring(1) : undefined;
}

/**
 * Generate a unique filename using UUID
 */
export function generateUniqueFilename(originalName: string): string {
  const ext = path.extname(originalName);
  return `${uuidv4()}${ext}`;
}

/**
 * Delete a file from filesystem
 */
export async function deleteFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error: any) {
    // Ignore if file doesn't exist
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Check if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy a file
 */
export async function copyFile(sourcePath: string, destPath: string): Promise<void> {
  await fs.copyFile(sourcePath, destPath);
}

/**
 * Get file size
 */
export async function getFileSize(filePath: string): Promise<number> {
  const stats = await fs.stat(filePath);
  return stats.size;
}

/**
 * Validate that a file path is within the allowed directory (prevents path traversal)
 */
export function validateFilePath(filePath: string, allowedDir: string): boolean {
  try {
    const resolvedPath = path.resolve(filePath);
    const resolvedDir = path.resolve(allowedDir);
    
    // Check if the resolved path starts with the resolved directory
    return resolvedPath.startsWith(resolvedDir + path.sep) || resolvedPath === resolvedDir;
  } catch {
    return false;
  }
}

/**
 * Sanitize file/folder name to prevent path traversal and other issues
 */
export function sanitizeFileName(fileName: string): string {
  // Remove or replace dangerous characters
  let sanitized = fileName
    .replace(/[<>:"|?*\x00-\x1F]/g, '') // Remove illegal characters
    .replace(/\.\./g, '') // Remove path traversal attempts
    .replace(/^\.+/, '') // Remove leading dots
    .trim();
  
  // Ensure name is not empty
  if (!sanitized || sanitized.length === 0) {
    sanitized = 'unnamed';
  }
  
  // Limit length to prevent issues
  const maxLength = 255;
  if (sanitized.length > maxLength) {
    const ext = path.extname(sanitized);
    const nameWithoutExt = sanitized.slice(0, maxLength - ext.length);
    sanitized = nameWithoutExt + ext;
  }
  
  return sanitized;
}

