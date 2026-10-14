import { Router } from 'express';
import {
  getUsers,
  updateUserRole,
  updateUserStatus,
  getAuditLogs,
  getEmergencyContacts,
  createEmergencyContact,
  deleteEmergencyContact
} from '../controllers/adminController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

// User management (Admin only)
router.get('/users', authenticate, authorize('admin'), getUsers);
router.patch('/users/:id/role', authenticate, authorize('admin'), updateUserRole);
router.patch('/users/:id/status', authenticate, authorize('admin'), updateUserStatus);

// Audit logs (Admin only)
router.get('/audit-logs', authenticate, authorize('admin'), getAuditLogs);

// Emergency contacts
router.get('/contacts', authenticate, getEmergencyContacts);
router.post('/contacts', authenticate, authorize('admin'), createEmergencyContact);
router.delete('/contacts/:id', authenticate, authorize('admin'), deleteEmergencyContact);

export default router;
