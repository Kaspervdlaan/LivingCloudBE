import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';

const SALT_ROUNDS = 10;

// JWT_SECRET must be set in production - fail fast if missing
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  // Only allow default in development
  console.warn('⚠️  WARNING: JWT_SECRET not set, using default. This is insecure for production!');
}

const JWT_SECRET_FINAL = JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export interface TokenPayload {
  userId: string;
  email: string;
}

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Compare a password with a hash
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generate a JWT token for a user
 */
export function generateToken(userId: string, email: string): string {
  if (!JWT_SECRET_FINAL) {
    throw new Error('JWT_SECRET is not configured');
  }
  const payload: TokenPayload = { userId, email };
  return jwt.sign(payload, JWT_SECRET_FINAL, { expiresIn: JWT_EXPIRES_IN } as SignOptions);
}

/**
 * Verify a JWT token and return the payload
 */
export function verifyToken(token: string): TokenPayload | null {
  if (!JWT_SECRET_FINAL) {
    return null;
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET_FINAL) as TokenPayload;
    return decoded;
  } catch (error) {
    return null;
  }
}

