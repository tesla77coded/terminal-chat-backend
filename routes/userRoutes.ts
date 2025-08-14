import { Router } from "express";
import {
  registerUser,
  loginUser,
  searchUserByUsername,
  uploadPublicKey,
  getPublicKey,
  getMe,
} from '../controllers/userController';
import { protect, admin } from '../middleware/authMiddleware'

const router = Router();

// user registration route
router.post('/register', registerUser);

// user login route
router.post('/login', loginUser);

// protected route to search users
router.get('/search', protect, searchUserByUsername);
router.get('/me', protect, getMe);

// public key management
router.post('/publickey', protect, uploadPublicKey);
router.get('/:userId/publickey', protect, getPublicKey);


export default router;
