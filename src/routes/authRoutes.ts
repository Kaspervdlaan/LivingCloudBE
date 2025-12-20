import { Router } from 'express';
import {
  register,
  login,
  googleAuth,
  googleCallback,
  getCurrentUser,
  getAllUsers,
  getUsersForSharing,
  deleteUser,
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

// Get all users (admin only)
router.get('/users', authenticate, getAllUsers);

// Get users for sharing (available to all authenticated users)
router.get('/users/sharing', authenticate, getUsersForSharing);

// Delete user (admin only)
router.delete('/users/:id', authenticate, deleteUser);

export default router;

