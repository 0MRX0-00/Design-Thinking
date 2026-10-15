import { Incident } from '../models/Incident.js';
import { Responder } from '../models/Responder.js';
import { Notification } from '../models/Notification.js';
import { AuditLog } from '../models/AuditLog.js';
import { StudentSafetyStatus } from '../models/StudentSafetyStatus.js';
import { EmergencyContact } from '../models/EmergencyContact.js';
import { FalseAlarmRecord } from '../models/FalseAlarmRecord.js';
import { getIO } from '../sockets/socketHandler.js';
import { checkCampusGeofence } from '../utils/geofence.js';

export const createIncident = async (req, res, next) => {
  try {
    // 1. Enforce False Alarm Restriction Check
    const safetyStatus = await StudentSafetyStatus.findOne({ studentId: req.user._id });
    if (safetyStatus && safetyStatus.sosAccessStatus === 'restricted') {
      const contacts = await EmergencyContact.find().sort({ priority: 1, name: 1 }).limit(5);
      return res.status(403).json({
        success: false,
        restricted: true,
        message: 'Your emergency SOS-submission privileges have been restricted due to confirmed false alarms under campus safety governance policy.',
        restrictionReason: safetyStatus.restrictionReason || 'Exceeded maximum permitted intentional false alarms.',
        restrictedAt: safetyStatus.restrictedAt,
        alternativeEmergencyContacts: contacts.length > 0 ? contacts : [
          { name: 'Campus Security Control Room', phone: '04294-226555', role: 'Main Dispatch' },
          { name: 'Chief Security Officer', phone: '+91 98422 44556', role: 'Security HQ' },
          { name: 'Campus Medical & Health Center', phone: '04294-226500', role: 'Emergency Care' },
          { name: 'Perundurai Police Station', phone: '100 / 04294-220033', role: 'Police Dispatch' }
        ]
      });
    }

    const {
      category,
      description = '',
      severity = 'high',
      campusLocation = 'Main Campus Quad',
      locationDetails = '',
      requirements = [],
      peopleInvolved = '1 person',
      silentAlert = false,
      latitude,
      longitude,
      accuracy
    } = req.body;

    if (!category) {
      return res.status(400).json({
        success: false,
        message: 'Incident category is required.'
      });
    }

    const validCategories = [
      'Medical emergency',
      'Harassment or personal safety concern',
      'Theft',
      'Accident',
      'Suspicious activity',
      'Fire',
      'Other'
    ];

    if (!validCategories.includes(category)) {
      return res.status(400).json({
        success: false,
        message: `Invalid category. Must be one of: ${validCategories.join(', ')}`
      });
    }

    // Validate coordinates if provided
    let parsedLat = null;
    let parsedLng = null;
    let parsedAcc = null;

    if (latitude !== undefined && latitude !== null && latitude !== '') {
      parsedLat = parseFloat(latitude);
      if (isNaN(parsedLat) || parsedLat < -90 || parsedLat > 90) {
        return res.status(400).json({
          success: false,
          message: 'Invalid latitude. Must be a number between -90 and 90.'
        });
      }
    }

    if (longitude !== undefined && longitude !== null && longitude !== '') {
      parsedLng = parseFloat(longitude);
      if (isNaN(parsedLng) || parsedLng < -180 || parsedLng > 180) {
        return res.status(400).json({
          success: false,
          message: 'Invalid longitude. Must be a number between -180 and 180.'
        });
      }
    }

    if (accuracy !== undefined && accuracy !== null && accuracy !== '') {
      parsedAcc = parseFloat(accuracy);
    }

    // Geofence Validation: Ensure incident is within KEC Campus Boundary
    if (parsedLat !== null && parsedLng !== null && req.body.isDemoSimulated !== true) {
      const geoCheck = checkCampusGeofence(parsedLat, parsedLng);
      if (!geoCheck.inside) {
        const kmOutside = (geoCheck.distanceMeters / 1000).toFixed(1);
        return res.status(403).json({
          success: false,
          code: 'OUT_OF_CAMPUS_BOUNDARY',
          message: `SOS Alert Rejected: Your device is located ~${kmOutside} km outside the authorized Kongu Engineering College boundary. CampusShield emergency response is strictly limited to campus grounds.`,
          distanceMeters: geoCheck.distanceMeters,
          allowedRadiusMeters: geoCheck.allowedRadius,
          offCampusHelplines: [
            { name: 'National Emergency Helpline', phone: '112', role: 'Police / Fire / Medical' },
            { name: "National Women's Safety Helpline", phone: '1091', role: '24/7 Safety Cell' },
            { name: 'Perundurai Local Police Station', phone: '04294-220233', role: 'Local Jurisdiction Dispatch' }
          ]
        });
      }
    }

    const incidentId = await Incident.generateIncidentId();

    const incident = await Incident.create({
      incidentId,
      reporter: req.user._id,
      category,
      description: description.trim(),
      requirements: Array.isArray(requirements) ? requirements : (requirements ? [requirements] : []),
      locationDetails: (locationDetails || '').trim(),
      peopleInvolved: peopleInvolved || '1 person',
      silentAlert: Boolean(silentAlert),
      severity: ['low', 'medium', 'high', 'critical'].includes(severity) ? severity : 'high',
      status: 'Submitted',
      location: {
        latitude: parsedLat,
        longitude: parsedLng,
        accuracy: parsedAcc,
        campusLocation: campusLocation.trim() || 'Kongu Campus Zone'
      },
      reportedAt: new Date(),
      statusHistory: [
        {
          status: 'Submitted',
          changedBy: req.user._id,
          note: 'Emergency alert submitted by reporter.',
          timestamp: new Date()
        }
      ]
    });

    // Populate reporter
    await incident.populate('reporter', 'name email phone identifier department role');

    // Create confirmation notification for reporter
    await Notification.create({
      recipient: req.user._id,
      incident: incident._id,
      type: 'incident_submitted',
      title: 'Emergency Alert Submitted',
      message: `Your emergency alert [${incident.incidentId}] has been logged and campus security has been alerted.`
    });

    // Audit log
    await AuditLog.logAction({
      actor: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'INCIDENT_CREATED',
      entityType: 'Incident',
      entityId: incident.incidentId,
      metadata: {
        category: incident.category,
        severity: incident.severity,
        campusLocation: incident.location.campusLocation
      },
      ipAddress: req.ip
    });

    // Socket.IO real-time emission to security & admin rooms
    const io = getIO();
    if (io) {
      io.to('role:security').to('role:admin').emit('incident:created', incident);
      io.to(`user:${req.user._id}`).emit('notification:new', {
        title: 'Emergency Alert Submitted',
        message: `Your emergency alert [${incident.incidentId}] is being reviewed.`
      });
    }

    res.status(201).json({
      success: true,
      message: 'Emergency incident reported successfully.',
      incident
    });
  } catch (error) {
    next(error);
  }
};

export const getIncidents = async (req, res, next) => {
  try {
    const { status, severity, category, responder, search, page = 1, limit = 50 } = req.query;

    const query = {};

    // Security & Admin can see all incidents.
    // Regular students/faculty can only see their own incidents.
    if (req.user.role === 'student' || req.user.role === 'faculty') {
      query.reporter = req.user._id;
    }

    if (status) query.status = status;
    if (severity) query.severity = severity;
    if (category) query.category = category;
    if (responder) query.assignedResponder = responder;

    if (search) {
      query.$or = [
        { incidentId: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { 'location.campusLocation': { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await Incident.countDocuments(query);

    const incidents = await Incident.find(query)
      .populate('reporter', 'name email phone identifier department role')
      .populate({
        path: 'assignedResponder',
        populate: { path: 'user', select: 'name email phone' }
      })
      .sort({ reportedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    res.json({
      success: true,
      count: incidents.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      incidents
    });
  } catch (error) {
    next(error);
  }
};

export const getMyIncidents = async (req, res, next) => {
  try {
    const incidents = await Incident.find({ reporter: req.user._id })
      .populate({
        path: 'assignedResponder',
        populate: { path: 'user', select: 'name phone' }
      })
      .sort({ reportedAt: -1 });

    res.json({
      success: true,
      count: incidents.length,
      incidents
    });
  } catch (error) {
    next(error);
  }
};

export const getIncidentById = async (req, res, next) => {
  try {
    const { id } = req.params;

    let incident;
    if (id.startsWith('CS-')) {
      incident = await Incident.findOne({ incidentId: id });
    } else {
      incident = await Incident.findById(id);
    }

    if (!incident) {
      return res.status(404).json({
        success: false,
        message: `Incident not found with identifier: ${id}`
      });
    }

    // Role check: reporter or privileged security/admin
    const isReporter = String(incident.reporter) === String(req.user._id);
    const isPrivileged = req.user.role === 'security' || req.user.role === 'admin';

    if (!isReporter && !isPrivileged) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You are not authorized to view this incident dossier.'
      });
    }

    await incident.populate('reporter', 'name email phone identifier department role');
    await incident.populate({
      path: 'assignedResponder',
      populate: { path: 'user', select: 'name email phone' }
    });

    const falseAlarmRecord = await FalseAlarmRecord.findOne({ incidentId: incident.incidentId })
      .populate('verifiedBy', 'name email role identifier');

    res.json({
      success: true,
      incident,
      falseAlarmRecord: falseAlarmRecord || null
    });
  } catch (error) {
    next(error);
  }
};

export const updateIncidentStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, note = '', resolutionNotes = '' } = req.body;

    const validStatuses = ['Submitted', 'Acknowledged', 'Assigned', 'Dispatched', 'On Scene', 'Resolved', 'Cancelled'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    let incident;
    if (id.startsWith('CS-')) {
      incident = await Incident.findOne({ incidentId: id });
    } else {
      incident = await Incident.findById(id);
    }

    if (!incident) {
      return res.status(404).json({
        success: false,
        message: `Incident not found: ${id}`
      });
    }

    // Cancellation check: reporter can cancel only if still 'Submitted'
    const isReporter = String(incident.reporter) === String(req.user._id);
    const isPrivileged = req.user.role === 'security' || req.user.role === 'admin';

    if (!isPrivileged) {
      if (status === 'Cancelled' && isReporter && incident.status === 'Submitted') {
        // permitted reporter cancellation
      } else {
        return res.status(403).json({
          success: false,
          message: 'Only security personnel or administrators can update incident status.'
        });
      }
    }

    const previousStatus = incident.status;
    incident.status = status;

    const now = new Date();
    if (status === 'Acknowledged' && !incident.acknowledgedAt) {
      incident.acknowledgedAt = now;
    } else if (status === 'Dispatched' && !incident.dispatchedAt) {
      incident.dispatchedAt = now;
    } else if (status === 'On Scene' && !incident.arrivedAt) {
      incident.arrivedAt = now;
    } else if (status === 'Resolved') {
      incident.resolvedAt = now;
      incident.resolvedBy = req.user._id;
      if (resolutionNotes) {
        incident.resolutionNotes = resolutionNotes;
      }
    }

    incident.statusHistory.push({
      status,
      changedBy: req.user._id,
      note: note || `Status updated from ${previousStatus} to ${status}.`,
      timestamp: now
    });

    await incident.save();

    await incident.populate('reporter', 'name email phone identifier department role');
    await incident.populate({
      path: 'assignedResponder',
      populate: { path: 'user', select: 'name email phone' }
    });

    // Notify Reporter of status update
    await Notification.create({
      recipient: incident.reporter._id,
      incident: incident._id,
      type: status === 'Resolved' ? 'incident_resolved' : 'incident_acknowledged',
      title: `Incident Status Update: ${status}`,
      message: `Your incident [${incident.incidentId}] is now marked as ${status}. ${note || ''}`
    });

    // Audit log
    await AuditLog.logAction({
      actor: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'INCIDENT_STATUS_CHANGE',
      entityType: 'Incident',
      entityId: incident.incidentId,
      metadata: { previousStatus, newStatus: status, note },
      ipAddress: req.ip
    });

    // Real-time notification
    const io = getIO();
    if (io) {
      io.to('role:security').to('role:admin').emit('incident:updated', incident);
      io.to(`user:${incident.reporter._id}`).emit('incident:updated', incident);
      io.to(`user:${incident.reporter._id}`).emit('notification:new', {
        title: `Incident Status Update: ${status}`,
        message: `Your incident [${incident.incidentId}] is now marked as ${status}.`
      });
    }

    res.json({
      success: true,
      message: `Incident status updated to ${status}.`,
      incident
    });
  } catch (error) {
    next(error);
  }
};

export const assignResponder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { responderId, dispatchImmediately = true, note = '' } = req.body;

    if (!responderId) {
      return res.status(400).json({
        success: false,
        message: 'Responder ID is required for assignment.'
      });
    }

    let incident;
    if (id.startsWith('CS-')) {
      incident = await Incident.findOne({ incidentId: id });
    } else {
      incident = await Incident.findById(id);
    }

    if (!incident) {
      return res.status(404).json({
        success: false,
        message: 'Incident not found.'
      });
    }

    const responder = await Responder.findById(responderId).populate('user', 'name phone email');
    if (!responder) {
      return res.status(404).json({
        success: false,
        message: 'Specified responder unit not found.'
      });
    }

    incident.assignedResponder = responder._id;
    const newStatus = dispatchImmediately ? 'Dispatched' : 'Assigned';
    const previousStatus = incident.status;
    incident.status = newStatus;

    const now = new Date();
    if (!incident.acknowledgedAt) {
      incident.acknowledgedAt = now;
    }
    if (dispatchImmediately) {
      incident.dispatchedAt = now;
    }

    incident.statusHistory.push({
      status: newStatus,
      changedBy: req.user._id,
      note: note || `Assigned to ${responder.callSign} (${responder.badgeNumber}).`,
      timestamp: now
    });

    await incident.save();

    // Update responder availability status
    responder.availabilityStatus = 'dispatched';
    responder.activeIncidentCount = (responder.activeIncidentCount || 0) + 1;
    await responder.save();

    await incident.populate('reporter', 'name email phone identifier department role');
    await incident.populate({
      path: 'assignedResponder',
      populate: { path: 'user', select: 'name email phone' }
    });

    // Notify Reporter
    await Notification.create({
      recipient: incident.reporter._id,
      incident: incident._id,
      type: 'responder_assigned',
      title: 'Responder Dispatched',
      message: `Unit ${responder.callSign} (${responder.team}) has been dispatched to your location.`
    });

    // Notify Responder
    if (responder.user && responder.user._id) {
      await Notification.create({
        recipient: responder.user._id,
        incident: incident._id,
        type: 'security_dispatched',
        title: 'Emergency Dispatch Assignment',
        message: `You are assigned to incident [${incident.incidentId}] at ${incident.location.campusLocation}.`
      });
    }

    // Audit log
    await AuditLog.logAction({
      actor: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'RESPONDER_ASSIGNED',
      entityType: 'Incident',
      entityId: incident.incidentId,
      metadata: {
        responderId: responder._id,
        callSign: responder.callSign,
        badgeNumber: responder.badgeNumber
      },
      ipAddress: req.ip
    });

    const io = getIO();
    if (io) {
      io.to('role:security').to('role:admin').emit('incident:updated', incident);
      io.to('role:security').to('role:admin').emit('responder:status_changed', responder);
      io.to(`user:${incident.reporter._id}`).emit('incident:updated', incident);
      io.to(`user:${incident.reporter._id}`).emit('notification:new', {
        title: 'Responder Dispatched',
        message: `Unit ${responder.callSign} has been dispatched to your location.`
      });
    }

    res.json({
      success: true,
      message: `Responder ${responder.callSign} successfully assigned.`,
      incident,
      responder
    });
  } catch (error) {
    next(error);
  }
};

export const updateIncidentLocation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { latitude, longitude, accuracy, campusLocation } = req.body;

    let incident;
    if (id.startsWith('CS-')) {
      incident = await Incident.findOne({ incidentId: id });
    } else {
      incident = await Incident.findById(id);
    }

    if (!incident) {
      return res.status(404).json({
        success: false,
        message: 'Incident not found.'
      });
    }

    const isReporter = String(incident.reporter) === String(req.user._id);
    const isPrivileged = req.user.role === 'security' || req.user.role === 'admin';

    if (!isReporter && !isPrivileged) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized to update this incident location.'
      });
    }

    if (latitude !== undefined) incident.location.latitude = parseFloat(latitude);
    if (longitude !== undefined) incident.location.longitude = parseFloat(longitude);
    if (accuracy !== undefined) incident.location.accuracy = parseFloat(accuracy);
    if (campusLocation) incident.location.campusLocation = campusLocation.trim();

    await incident.save();

    const io = getIO();
    if (io) {
      io.to('role:security').to('role:admin').emit('incident:updated', incident);
      io.to(`user:${incident.reporter}`).emit('incident:updated', incident);
    }

    res.json({
      success: true,
      message: 'Location updated successfully.',
      location: incident.location
    });
  } catch (error) {
    next(error);
  }
};

export const addIncidentNote = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Note text cannot be empty.'
      });
    }

    let incident;
    if (id.startsWith('CS-')) {
      incident = await Incident.findOne({ incidentId: id });
    } else {
      incident = await Incident.findById(id);
    }

    if (!incident) {
      return res.status(404).json({
        success: false,
        message: 'Incident not found.'
      });
    }

    const newNote = {
      author: req.user._id,
      authorName: req.user.name,
      text: text.trim(),
      createdAt: new Date()
    };

    incident.notes.push(newNote);
    await incident.save();

    // Audit log
    await AuditLog.logAction({
      actor: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'INCIDENT_NOTE_ADDED',
      entityType: 'Incident',
      entityId: incident.incidentId,
      metadata: { text: text.trim() },
      ipAddress: req.ip
    });

    const io = getIO();
    if (io) {
      io.to('role:security').to('role:admin').emit('incident:updated', incident);
    }

    res.status(201).json({
      success: true,
      message: 'Note added to incident dispatch dossier.',
      notes: incident.notes
    });
  } catch (error) {
    next(error);
  }
};
