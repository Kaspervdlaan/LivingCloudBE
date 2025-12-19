import { Router } from 'express';
import {
  register,
  login,
  googleAuth,
  googleCallback,
  getCurrentUser,
  registerValidation,
  loginValidation,
} from '../controllers/authController';
import { authenticate } from '../middleware/auth';

const router = Router();

// Register new user
router.post('/register', registerValidation, register);

// Login user
router.post('/login', loginValidation, login);

// Google OAuth
router.get('/google', googleAuth);
router.get('/google/callback', googleCallback);

// Get current user (protected)
router.get('/me', authenticate, getCurrentUser);

export default router;

