import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initializeDatabase } from './config/database';
import filesRoutes from './routes/filesRoutes';
import { createFolder } from './controllers/filesController';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { ensureDirectoryExists } from './utils/fileUtils';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.API_PORT || 3001;

// CORS configuration
app.use(
  cors({
    origin: ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:5174'], // Vite dev server ports
    credentials: true,
  })
);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/files', filesRoutes);
app.post('/api/folders', createFolder); // Separate route for folder creation

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Initialize storage directories
async function initializeStorage() {
  const uploadDir = process.env.UPLOAD_DIR || './storage/uploads';
  const thumbnailDir = process.env.THUMBNAIL_DIR || './storage/thumbnails';
  
  await ensureDirectoryExists(uploadDir);
  await ensureDirectoryExists(thumbnailDir);
  console.log('Storage directories initialized');
}

// Start server
async function startServer() {
  try {
    // Initialize storage directories
    await initializeStorage();
    
    // Initialize database
    await initializeDatabase();
    
    // Start listening
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/health`);
      console.log(`API base: http://localhost:${PORT}/api`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

