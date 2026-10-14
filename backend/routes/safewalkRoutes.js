import { Router } from 'express';
import {
  startSafeWalk,
  endSafeWalk,
  getMySafeWalkSessions,
  triggerSafeWalkEmergency
} from '../controllers/safewalkController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.post('/start', authenticate, startSafeWalk);
router.patch('/:id/end', authenticate, endSafeWalk);
router.get('/my', authenticate, getMySafeWalkSessions);
router.post('/:id/emergency', authenticate, triggerSafeWalkEmergency);

export default router;
