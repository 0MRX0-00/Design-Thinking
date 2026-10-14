import { Router } from 'express';
import {
  getDisciplinaryCases,
  getMyDisciplinaryCases,
  getDisciplinaryCaseById,
  createDisciplinaryCase,
  updateDisciplinaryCase,
  submitStudentResponse
} from '../controllers/disciplinaryController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

// Student representation
router.get('/my', authenticate, getMyDisciplinaryCases);
router.post('/:id/appeal', authenticate, submitStudentResponse);

// Admin & Security case access
router.get('/', authenticate, authorize('admin', 'security'), getDisciplinaryCases);
router.get('/:id', authenticate, getDisciplinaryCaseById);

// Admin-only case creation and lifecycle updates
router.post('/', authenticate, authorize('admin'), createDisciplinaryCase);
router.patch('/:id', authenticate, authorize('admin'), updateDisciplinaryCase);

export default router;
