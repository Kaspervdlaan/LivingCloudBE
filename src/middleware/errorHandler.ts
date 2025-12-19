import { Request, Response, NextFunction } from 'express';

export interface ApiError extends Error {
  statusCode?: number;
  status?: number;
}

export function errorHandler(
  err: ApiError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const statusCode = err.statusCode || err.status || 500;
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  // Never expose stack traces in production
  const message = isDevelopment 
    ? (err.message || 'Internal Server Error')
    : statusCode === 500 
      ? 'Internal Server Error' 
      : (err.message || 'An error occurred');

  // Log full error details server-side
  console.error('Error:', {
    statusCode,
    message: err.message || 'Internal Server Error',
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  res.status(statusCode).json({
    error: {
      message,
      statusCode,
      // Only include stack trace in development
      ...(isDevelopment && err.stack && { stack: err.stack }),
    },
  });
}

export function notFoundHandler(req: Request, res: Response, next: NextFunction): void {
  res.status(404).json({
    error: {
      message: `Route ${req.method} ${req.path} not found`,
      statusCode: 404,
    },
  });
}

