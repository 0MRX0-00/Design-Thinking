import { Router } from 'express';
import { register, login, logout, getMe, updateMe, forgotPassword, resetPassword } from '../controllers/authController.js';
import { authenticate, optionalAuthenticate } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPassword);
router.post('/logout', optionalAuthenticate, logout);
router.get('/me', authenticate, getMe);
router.patch('/me', authenticate, updateMe);

export default router;
