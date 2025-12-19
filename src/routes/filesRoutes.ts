import { Router } from 'express';
import {
  getFiles,
  getFileById,
  uploadFiles,
  createFolder,
  renameFile,
  moveFile,
  copyFile,
  deleteFileById,
  downloadFile,
} from '../controllers/filesController';
import { upload } from '../middleware/upload';

const router = Router();

// Get files (list)
router.get('/', getFiles);

// Get file by ID
router.get('/:id', getFileById);

// Upload files
router.post('/upload', upload.array('files', 100), uploadFiles);

// Create folder
router.post('/folders', createFolder);

// Rename file/folder
router.patch('/:id/rename', renameFile);

// Move file/folder
router.patch('/:id/move', moveFile);

// Copy file/folder
router.post('/:id/copy', copyFile);

// Delete file/folder
router.delete('/:id', deleteFileById);

// Download file
router.get('/:id/download', downloadFile);

export default router;

