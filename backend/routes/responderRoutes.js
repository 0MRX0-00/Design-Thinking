import { Router } from 'express';
import {
  getResponders,
  getResponderById,
  updateResponderStatus
} from '../controllers/responderController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

router.get('/', authenticate, getResponders);
router.get('/:id', authenticate, getResponderById);
router.patch('/:id/status', authenticate, authorize('security', 'admin'), updateResponderStatus);

export default router;
