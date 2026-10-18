import { Router } from 'express';
import {
  createIncident,
  getIncidents,
  getMyIncidents,
  getIncidentById,
  getEmergencyCheck,
  updateIncidentStatus,
  assignResponder,
  updateIncidentLocation,
  addIncidentNote
} from '../controllers/incidentController.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { emergencyLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Emergency check for background service monitoring (no strict token required)
router.get('/emergency-check', getEmergencyCheck);

// Student/all roles incident reporting
router.post('/', authenticate, emergencyLimiter, createIncident);
router.get('/', authenticate, getIncidents);
router.get('/my', authenticate, getMyIncidents);
router.get('/:id', authenticate, getIncidentById);

// Status and responder assignment (Security & Admin, or specific reporter rules handled inside controller)
router.patch('/:id/status', authenticate, updateIncidentStatus);
router.patch('/:id/assign', authenticate, authorize('security', 'admin'), assignResponder);
router.patch('/:id/location', authenticate, updateIncidentLocation);
router.post('/:id/notes', authenticate, authorize('security', 'admin'), addIncidentNote);

export default router;
