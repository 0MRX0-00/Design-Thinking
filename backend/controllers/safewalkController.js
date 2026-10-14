import { SafeWalkSession } from '../models/SafeWalkSession.js';
import { Incident } from '../models/Incident.js';
import { Notification } from '../models/Notification.js';
import { AuditLog } from '../models/AuditLog.js';
import { getIO } from '../sockets/socketHandler.js';

export const startSafeWalk = async (req, res, next) => {
  try {
    const { startLocation, destination, notes = '' } = req.body;

    if (!startLocation || !destination) {
      return res.status(400).json({
        success: false,
        message: 'Start location and destination are required for Safe Walk.'
      });
    }

    // Cancel any existing active session for this user
    await SafeWalkSession.updateMany(
      { user: req.user._id, status: 'active' },
      { $set: { status: 'cancelled', endedAt: new Date() } }
    );

    const session = await SafeWalkSession.create({
      user: req.user._id,
      userName: req.user.name,
      startLocation: startLocation.trim(),
      destination: destination.trim(),
      notes: notes.trim(),
      status: 'active',
      startedAt: new Date()
    });

    res.status(201).json({
      success: true,
      message: 'Campus Safe Walk session started.',
      session
    });
  } catch (error) {
    next(error);
  }
};

export const endSafeWalk = async (req, res, next) => {
  try {
    const { id } = req.params;
    const session = await SafeWalkSession.findOne({ _id: id, user: req.user._id });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Safe Walk session not found.'
      });
    }

    session.status = 'completed';
    session.endedAt = new Date();
    await session.save();

    res.json({
      success: true,
      message: 'Safe Walk session completed safely.',
      session
    });
  } catch (error) {
    next(error);
  }
};

export const getMySafeWalkSessions = async (req, res, next) => {
  try {
    const sessions = await SafeWalkSession.find({ user: req.user._id })
      .sort({ startedAt: -1 })
      .limit(10);

    const activeSession = sessions.find((s) => s.status === 'active') || null;

    res.json({
      success: true,
      activeSession,
      sessions
    });
  } catch (error) {
    next(error);
  }
};

export const triggerSafeWalkEmergency = async (req, res, next) => {
  try {
    const { id } = req.params;
    const session = await SafeWalkSession.findOne({ _id: id, user: req.user._id });

    if (session) {
      session.status = 'emergency_triggered';
      await session.save();
    }

    const incidentId = await Incident.generateIncidentId();
    const incident = await Incident.create({
      incidentId,
      reporter: req.user._id,
      category: 'Harassment or personal safety concern',
      description: `Emergency triggered during Campus Safe Walk from ${session ? session.startLocation : 'Campus'} to ${session ? session.destination : 'Campus'}.`,
      severity: 'critical',
      status: 'Submitted',
      location: {
        campusLocation: session ? `${session.startLocation} -> ${session.destination}` : 'Campus Walkway'
      },
      reportedAt: new Date(),
      statusHistory: [
        {
          status: 'Submitted',
          changedBy: req.user._id,
          note: 'Safe Walk emergency shortcut triggered.',
          timestamp: new Date()
        }
      ]
    });

    await incident.populate('reporter', 'name email phone identifier department role');

    await Notification.create({
      recipient: req.user._id,
      incident: incident._id,
      type: 'incident_submitted',
      title: 'Safe Walk SOS Triggered',
      message: `Emergency SOS [${incident.incidentId}] has been dispatched to security.`
    });

    await AuditLog.logAction({
      actor: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'SAFE_WALK_EMERGENCY_TRIGGERED',
      entityType: 'Incident',
      entityId: incident.incidentId,
      metadata: { sessionId: id },
      ipAddress: req.ip
    });

    const io = getIO();
    if (io) {
      io.to('role:security').to('role:admin').emit('incident:created', incident);
    }

    res.status(201).json({
      success: true,
      message: 'Emergency SOS activated from Safe Walk session.',
      incident
    });
  } catch (error) {
    next(error);
  }
};
