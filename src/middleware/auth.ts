import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/auth';

// Extend Express Request to include user info
declare module 'express-serve-static-core' {
  interface Request {
    user?: {
      userId: string;
      email: string;
    };
  }
}

/**
 * Authentication middleware to verify JWT token
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
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

    // Attach user info to request
    req.user = {
      userId: payload.userId,
      email: payload.email,
    };

    next();
  } catch (error) {
    res.status(401).json({ error: { message: 'Authentication failed', statusCode: 401 } });
  }
}

/**
 * Optional authentication middleware (doesn't fail if no token)
 */
export function optionalAuthenticate(req: Request, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = verifyToken(token);
      
      if (payload) {
        req.user = {
          userId: payload.userId,
          email: payload.email,
        };
      }
    }
    
    next();
  } catch (error) {
    next();
  }
}

