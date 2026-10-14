import { Router } from 'express';
import {
  getMyNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllRead
} from '../controllers/notificationController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.get('/', authenticate, getMyNotifications);
router.get('/unread-count', authenticate, getUnreadCount);
router.patch('/read-all', authenticate, markAllRead);
router.patch('/:id/read', authenticate, markNotificationRead);

export default router;
