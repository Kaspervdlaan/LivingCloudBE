import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/auth';
import { getPool } from '../config/database';

// Extend Express Request to include user info
declare module 'express-serve-static-core' {
  interface Request {
    user?: {
      userId: string;
      email: string;
      role: 'user' | 'admin';
    };
  }
}

/**
 * Authentication middleware to verify JWT token
 */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: { message: 'No token provided', statusCode: 401 } });
      return;
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    const payload = verifyToken(token);
    
    if (!payload) {
      res.status(401).json({ error: { message: 'Invalid or expired token', statusCode: 401 } });
      return;
    }

    // Fetch user role from database
    const pool = getPool();
    const userResult = await pool.query(
      'SELECT role FROM users WHERE id = $1',
      [payload.userId]
    );
    
    if (userResult.rows.length === 0) {
      res.status(401).json({ error: { message: 'User not found', statusCode: 401 } });
      return;
    }

    const role = userResult.rows[0].role as 'user' | 'admin';

    // Attach user info to request
    req.user = {
      userId: payload.userId,
      email: payload.email,
      role: role,
    };

    next();
  } catch (error) {
    res.status(401).json({ error: { message: 'Authentication failed', statusCode: 401 } });
  }
}

/**
 * Optional authentication middleware (doesn't fail if no token)
 */
export async function optionalAuthenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = verifyToken(token);
      
      if (payload) {
        // Fetch user role from database
        const pool = getPool();
        const userResult = await pool.query(
          'SELECT role FROM users WHERE id = $1',
          [payload.userId]
        );
        
        if (userResult.rows.length > 0) {
          const role = userResult.rows[0].role as 'user' | 'admin';
          req.user = {
            userId: payload.userId,
            email: payload.email,
            role: role,
          };
        }
      }
    }
    
    next();
  } catch (error) {
    next();
  }
}

