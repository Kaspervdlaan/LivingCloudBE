import multer from 'multer';
import * as path from 'path';
import { generateUniqueFilename, ensureDirectoryExists } from '../utils/fileUtils';

const uploadDir = process.env.UPLOAD_DIR || './storage/uploads';

// Ensure upload directory exists
ensureDirectoryExists(uploadDir).catch(console.error);

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await ensureDirectoryExists(uploadDir);
      cb(null, uploadDir);
    } catch (error) {
      cb(error as Error, uploadDir);
    }
  },
  filename: (req, file, cb) => {
    // Use UUID to generate unique filename
    const uniqueName = generateUniqueFilename(file.originalname);
    cb(null, uniqueName);
  },
});

// File filter - accept all files
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  cb(null, true);
};

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
});

