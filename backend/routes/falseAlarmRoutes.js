import { Router } from 'express';
import {
  verifyIncidentFalseAlarm,
  getMyFalseAlarmHistory,
  getMySafetyStatus,
  getAllFalseAlarmRecords,
  getStudentFalseAlarmProfile,
  restoreStudentSosAccess,
  addAdminNoteToStudent,
  getFalseAlarmStats,
  getThresholdConfig,
  updateThresholdConfig,
  exportFalseAlarmData,
  getStudentSafetyOverview
} from '../controllers/falseAlarmController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

// Student routes
router.get('/my', authenticate, getMyFalseAlarmHistory);
router.get('/status/me', authenticate, getMySafetyStatus);

// Security & Admin classification & verification
router.post('/verify', authenticate, authorize('security', 'admin'), verifyIncidentFalseAlarm);
router.get('/stats', authenticate, authorize('security', 'admin'), getFalseAlarmStats);
router.get('/students', authenticate, authorize('security', 'admin'), getStudentSafetyOverview);
router.get('/student/:studentId', authenticate, authorize('security', 'admin'), getStudentFalseAlarmProfile);
router.get('/', authenticate, authorize('security', 'admin'), getAllFalseAlarmRecords);

// Admin-only Governance routes
router.get('/config', authenticate, authorize('admin'), getThresholdConfig);
router.patch('/config', authenticate, authorize('admin'), updateThresholdConfig);
router.get('/export', authenticate, authorize('admin'), exportFalseAlarmData);
router.post('/restore-sos/:studentId', authenticate, authorize('admin'), restoreStudentSosAccess);
router.post('/notes/:studentId', authenticate, authorize('admin'), addAdminNoteToStudent);

export default router;
