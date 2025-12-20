import { Request, Response, NextFunction } from 'express';
import { getPool } from '../config/database';
import { User, UserRow, rowToUser } from '../models/User';
import { RegisterRequest, LoginRequest, AuthResponse } from '../types/auth';
import { hashPassword, comparePassword, generateToken } from '../utils/auth';
import { body, validationResult } from 'express-validator';
import passport from 'passport';
import { Strategy as GoogleStrategy, Profile } from 'passport-google-oauth20';

// Configure Google OAuth Strategy
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3001/api/auth/google/callback';

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL,
      },
      async (accessToken: string, refreshToken: string, profile: Profile, done: (error: any, user?: any) => void) => {
        try {
          const pool = getPool();
          const email = (profile.emails && profile.emails[0]) ? profile.emails[0].value : undefined;
          
          if (!email) {
            return done(new Error('No email found in Google profile'));
          }

          // Check if user exists with this Google ID
          let userResult = await pool.query('SELECT * FROM users WHERE google_id = $1', [profile.id]);
          
          if (userResult.rows.length > 0) {
            // User exists, return it
            return done(null, rowToUser(userResult.rows[0] as UserRow));
          }

          // Check if user exists with this email
          userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
          
          if (userResult.rows.length > 0) {
            // User exists but doesn't have Google ID, update it
            await pool.query(
              'UPDATE users SET google_id = $1, avatar_url = $2 WHERE email = $3',
              [profile.id, profile.photos?.[0]?.value || null, email]
            );
            const updatedUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
            return done(null, rowToUser(updatedUser.rows[0] as UserRow));
          }

          // Create new user
          const newUserResult = await pool.query(
            'INSERT INTO users (email, name, google_id, avatar_url) VALUES ($1, $2, $3, $4) RETURNING *',
            [email, profile.displayName, profile.id, profile.photos?.[0]?.value || null]
          );
          
          return done(null, rowToUser(newUserResult.rows[0] as UserRow));
        } catch (error) {
          return done(error);
        }
      }
    )
  );
}

// Validation rules
export const registerValidation = [
  body('email').isEmail().normalizeEmail(),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .custom((value) => {
      // Optional: Recommend complexity but don't require it
      // Password should be at least 8 characters (already checked above)
      // Optionally check for complexity (recommended but not enforced)
      const hasComplexity = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(value);
      if (!hasComplexity) {
        // Warn but don't fail - complexity is recommended, not required
        console.warn('Password does not meet complexity recommendations (uppercase, lowercase, number)');
      }
      return true;
    }),
  body('name').trim().isLength({ min: 1 }).withMessage('Name is required'),
];

export const loginValidation = [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
];

/**
 * Register a new user
 */
export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: { message: errors.array()[0].msg, statusCode: 400 } });
      return;
    }

    const { email, password, name }: RegisterRequest = req.body;
    const pool = getPool();

    // Check if user already exists
    const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      res.status(409).json({ error: { message: 'User with this email already exists', statusCode: 409 } });
      return;
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING *',
      [email, passwordHash, name]
    );

    const user = rowToUser(result.rows[0] as UserRow);
    const token = generateToken(user.id, user.email);

    const response: AuthResponse = { user, token };
    res.status(201).json({ data: response });
  } catch (error) {
    next(error);
  }
}

/**
 * Login user
 */
export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: { message: errors.array()[0].msg, statusCode: 400 } });
      return;
    }

    const { email, password }: LoginRequest = req.body;
    const pool = getPool();

    // Find user by email
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    if (result.rows.length === 0) {
      res.status(401).json({ error: { message: 'Invalid email or password', statusCode: 401 } });
      return;
    }

    const userRow = result.rows[0] as UserRow;

    // Check if user has a password (not OAuth-only user)
    if (!userRow.password_hash) {
      res.status(401).json({ error: { message: 'Please sign in with Google', statusCode: 401 } });
      return;
    }

    // Verify password
    const isValidPassword = await comparePassword(password, userRow.password_hash);
    
    if (!isValidPassword) {
      res.status(401).json({ error: { message: 'Invalid email or password', statusCode: 401 } });
      return;
    }

    const user = rowToUser(userRow);
    const token = generateToken(user.id, user.email);

    const response: AuthResponse = { user, token };
    res.json({ data: response });
  } catch (error) {
    next(error);
  }
}

/**
 * Initiate Google OAuth flow
 */
export function googleAuth(req: Request, res: Response, next: NextFunction): void {
  passport.authenticate('google', {
    scope: ['profile', 'email'],
  })(req, res, next);
}

/**
 * Handle Google OAuth callback
 */
export async function googleCallback(req: Request, res: Response, next: NextFunction): Promise<void> {
  passport.authenticate('google', { session: false }, async (err: any, user: User) => {
    if (err) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?error=oauth_failed`);
    }

    if (!user) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?error=oauth_failed`);
    }

    try {
      const token = generateToken(user.id, user.email);
      // Set token in HTTP-only cookie for security (prevents XSS attacks)
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const isProduction = process.env.NODE_ENV === 'production';
      
      res.cookie('auth-token', token, {
        httpOnly: true, // Prevents JavaScript access (XSS protection)
        secure: isProduction, // Only send over HTTPS in production
        sameSite: 'lax', // CSRF protection
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days (matches JWT_EXPIRES_IN default)
        path: '/',
      });
      
      // Also include token in URL for frontend to store in localStorage
      // The frontend will extract it and store it, then remove it from URL
      res.redirect(`${frontendUrl}/auth/callback?token=${encodeURIComponent(token)}`);
    } catch (error) {
      res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?error=token_generation_failed`);
    }
  })(req, res, next);
}

/**
 * Get current authenticated user
 */
export async function getCurrentUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: { message: 'Not authenticated', statusCode: 401 } });
      return;
    }

    const pool = getPool();
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.userId]);
    
    if (result.rows.length === 0) {
      res.status(404).json({ error: { message: 'User not found', statusCode: 404 } });
      return;
    }

    const user = rowToUser(result.rows[0] as UserRow);
    res.json({ data: user });
  } catch (error) {
    next(error);
  }
}

/**
 * Get all users (admin only)
 */
export async function getAllUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: { message: 'Not authenticated', statusCode: 401 } });
      return;
    }

    // Only admins can access this endpoint
    if (req.user.role !== 'admin') {
      res.status(403).json({ error: { message: 'Forbidden: Admin access required', statusCode: 403 } });
      return;
    }

    const pool = getPool();
    const result = await pool.query('SELECT * FROM users ORDER BY name ASC, email ASC');
    
    const users = result.rows.map((row: UserRow) => rowToUser(row));
    res.json({ data: users });
  } catch (error) {
    next(error);
  }
}

/**
 * Delete a user (admin only)
 */
export async function deleteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: { message: 'Not authenticated', statusCode: 401 } });
      return;
    }

    // Only admins can access this endpoint
    if (req.user.role !== 'admin') {
      res.status(403).json({ error: { message: 'Forbidden: Admin access required', statusCode: 403 } });
      return;
    }

    const { id } = req.params;
    const pool = getPool();

    // Prevent admin from deleting themselves
    if (id === req.user.userId) {
      res.status(400).json({ error: { message: 'Cannot delete your own account', statusCode: 400 } });
      return;
    }

    // Check if user exists
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (userResult.rows.length === 0) {
      res.status(404).json({ error: { message: 'User not found', statusCode: 404 } });
      return;
    }

    // Get all files owned by this user to delete from filesystem
    const filesResult = await pool.query(
      'SELECT file_path, thumbnail_path FROM files WHERE user_id = $1',
      [id]
    );

    // Delete physical files from filesystem
    const { deleteFile } = await import('../utils/fileUtils');
    const uploadDir = process.env.UPLOAD_DIR || './storage/uploads';
    const thumbnailDir = process.env.THUMBNAIL_DIR || './storage/thumbnails';
    
    for (const file of filesResult.rows) {
      if (file.file_path) {
        try {
          await deleteFile(file.file_path);
        } catch (err) {
          console.error(`Failed to delete file ${file.file_path}:`, err);
          // Continue with deletion even if file deletion fails
        }
      }
      if (file.thumbnail_path) {
        try {
          await deleteFile(file.thumbnail_path);
        } catch (err) {
          console.error(`Failed to delete thumbnail ${file.thumbnail_path}:`, err);
          // Continue with deletion even if thumbnail deletion fails
        }
      }
    }
    
    // Delete the user (this will cascade delete files from database)
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

