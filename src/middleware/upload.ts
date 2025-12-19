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

// Blocked file extensions (executables and potentially dangerous files)
const BLOCKED_EXTENSIONS = [
  'exe', 'bat', 'cmd', 'com', 'pif', 'scr', 'vbs', 'js', 'jar', 'app', 'deb', 'pkg', 'rpm',
  'sh', 'bash', 'zsh', 'csh', 'ksh', 'ps1', 'psm1', 'psd1', 'msi', 'dmg', 'apk', 'run',
  'bin', 'pl', 'py', 'rb', 'php', 'asp', 'aspx', 'jsp', 'cgi', 'sh'
];

// Blocked MIME types
const BLOCKED_MIME_TYPES = [
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-executable',
  'application/x-sharedlib',
  'application/x-elf',
  'application/x-shellscript',
  'text/x-shellscript',
  'application/x-sh',
  'application/x-python',
  'application/x-ruby',
  'application/x-perl',
  'application/x-php'
];

// File filter - block executable and potentially dangerous files
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Check MIME type
  if (file.mimetype && BLOCKED_MIME_TYPES.includes(file.mimetype)) {
    cb(new Error(`File type ${file.mimetype} is not allowed`));
    return;
  }
  
  // Check file extension
  const extension = file.originalname.split('.').pop()?.toLowerCase();
  if (extension && BLOCKED_EXTENSIONS.includes(extension)) {
    cb(new Error(`File extension .${extension} is not allowed`));
    return;
  }
  
  cb(null, true);
};

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
});

