import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import passport from 'passport';
import { initializeDatabase } from './config/database';
import filesRoutes from './routes/filesRoutes';
import authRoutes from './routes/authRoutes';
import { createFolder } from './controllers/filesController';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { ensureDirectoryExists } from './utils/fileUtils';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.API_PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

// Security headers middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false, // Allow embedding for OAuth flows
}));

// CORS configuration
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
  : isProduction
  ? ['https://livingcloud.netlify.app']
  : [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://localhost:5174',
    ];

// Validate CORS origins in production
if (isProduction && !process.env.CORS_ORIGINS) {
  console.warn('⚠️  WARNING: CORS_ORIGINS not set in production. Using default origin.');
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);

// Rate limiting for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each IP to 50 requests per windowMs (allows for retries and multiple devices)
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins against the limit
});

// Rate limiting for file operations
const fileLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // Limit each IP to 100 requests per minute
  message: 'Too many file operations, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Body parsing middleware
app.use(express.json({ limit: '10mb' })); // Limit JSON payload size
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parser middleware (needed for OAuth token cookies)
app.use(cookieParser());

// Initialize Passport
app.use(passport.initialize());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes with rate limiting
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/files', fileLimiter, filesRoutes);
// Note: /api/files/folders route is handled by filesRoutes with authentication

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

