import { Router } from 'express';
import {
  getDashboardSummary,
  getRecentIncidents,
  getIncidentTrends
} from '../controllers/dashboardController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

router.get('/summary', authenticate, authorize('security', 'admin'), getDashboardSummary);
router.get('/recent-incidents', authenticate, authorize('security', 'admin'), getRecentIncidents);
router.get('/incident-trends', authenticate, authorize('security', 'admin'), getIncidentTrends);

export default router;
