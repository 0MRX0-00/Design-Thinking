import { FalseAlarmRecord } from '../models/FalseAlarmRecord.js';
import { StudentSafetyStatus } from '../models/StudentSafetyStatus.js';
import { DisciplinaryCase } from '../models/DisciplinaryCase.js';
import { SystemSetting } from '../models/SystemSetting.js';
import { Incident } from '../models/Incident.js';
import { User } from '../models/User.js';
import { Notification } from '../models/Notification.js';
import { AuditLog } from '../models/AuditLog.js';
import { EmergencyContact } from '../models/EmergencyContact.js';
import { getIO } from '../sockets/socketHandler.js';

/**
 * Re-evaluates a student's false alarm threshold and applies warnings or restrictions.
 */
export const evaluateStudentThreshold = async (studentId, options = {}) => {
  const threshold = await SystemSetting.getSetting('falseAlarmThreshold', 3);

  // Count verified intentional false alarms
  const confirmedCount = await FalseAlarmRecord.countDocuments({
    studentId,
    classification: 'False Alarm — Intentional',
    verificationStatus: 'verified'
  });

  let safetyStatus = await StudentSafetyStatus.findOne({ studentId });
  if (!safetyStatus) {
    safetyStatus = new StudentSafetyStatus({ studentId });
  }

  const previousCount = safetyStatus.confirmedIntentionalFalseAlarmCount;
  const previousLevel = safetyStatus.warningLevel;
  const previousSosStatus = safetyStatus.sosAccessStatus;

  safetyStatus.confirmedIntentionalFalseAlarmCount = confirmedCount;

  const student = await User.findById(studentId);
  const studentName = student ? student.name : 'Student';
  const studentEmail = student ? student.email : '';
  const io = getIO();

  let newlyCreatedCase = null;

  // Threshold Rules:
  // 0 - 1 confirmed: No automatic penalty
  // 2 confirmed: Formal warning
  // 3 confirmed: Final warning and flag for review
  // > 3 confirmed (4 or more): Disable SOS privileges and mandatory disciplinary case
  if (confirmedCount <= 1) {
    safetyStatus.warningLevel = 'none';
    if (safetyStatus.sosAccessStatus === 'restricted' && !safetyStatus.restoredAt) {
      // If count dropped below restriction threshold, keep or activate
    }
  } else if (confirmedCount === 2) {
    safetyStatus.warningLevel = 'warning_level_1';

    // Send formal warning notification if not already sent
    if (previousLevel !== 'warning_level_1' && previousLevel !== 'final_warning' && previousLevel !== 'restricted') {
      const warningNotif = await Notification.create({
        recipient: studentId,
        type: 'false_alarm_warning',
        title: '⚠️ Formal Warning: Intentional False Alarm Misuse',
        message: `You have accumulated 2 confirmed intentional false alarms. Campus emergency SOS triggers are strictly reserved for genuine life safety incidents. Reaching more than 3 confirmed intentional false alarms will result in automated suspension of your SOS alert privileges and referral to the Disciplinary Committee.`
      });

      await AuditLog.logAction({
        actor: options.actorId || null,
        actorName: options.actorName || 'System Automation',
        actorRole: options.actorRole || 'system',
        action: 'FALSE_ALARM_WARNING_ISSUED',
        entityType: 'User',
        entityId: studentId,
        metadata: { level: 'warning_level_1', confirmedCount, threshold },
        ipAddress: options.ipAddress || ''
      });

      if (io) {
        io.to(`user:${studentId}`).emit('notification:new', warningNotif);
      }
    }
  } else if (confirmedCount === 3) {
    safetyStatus.warningLevel = 'final_warning';

    // Send final warning notification
    if (previousLevel !== 'final_warning' && previousLevel !== 'restricted') {
      const finalNotif = await Notification.create({
        recipient: studentId,
        type: 'false_alarm_warning',
        title: '🚨 FINAL WARNING: SOS Privilege at Critical Risk',
        message: `You have accumulated 3 confirmed intentional false alarms. Your account has been flagged for administrative review. Any further verified false alarm will result in IMMEDIATE termination of your SOS-submission privileges and mandatory disciplinary hearing.`
      });

      await AuditLog.logAction({
        actor: options.actorId || null,
        actorName: options.actorName || 'System Automation',
        actorRole: options.actorRole || 'system',
        action: 'FALSE_ALARM_FINAL_WARNING_ISSUED',
        entityType: 'User',
        entityId: studentId,
        metadata: { level: 'final_warning', confirmedCount, threshold },
        ipAddress: options.ipAddress || ''
      });

      if (io) {
        io.to(`user:${studentId}`).emit('notification:new', finalNotif);
      }
    }
  } else if (confirmedCount > threshold) {
    // 4 or more: Automated suspension
    safetyStatus.warningLevel = 'restricted';
    safetyStatus.sosAccessStatus = 'restricted';
    safetyStatus.restrictionReason =
      options.reason ||
      `Exceeded maximum permitted intentional false alarms (threshold of ${threshold} exceeded with ${confirmedCount} confirmed cases). SOS privileges automatically restricted.`;

    if (!safetyStatus.restrictedAt) {
      safetyStatus.restrictedAt = new Date();
    }

    // Link or create mandatory disciplinary committee case
    const openCase = await DisciplinaryCase.findOne({
      studentId,
      caseStatus: { $ne: 'Resolved' }
    });

    const linkedRecords = await FalseAlarmRecord.find({
      studentId,
      classification: 'False Alarm — Intentional',
      verificationStatus: 'verified'
    });

    const incidentIds = linkedRecords.map((r) => r.incidentId);
    const recordIds = linkedRecords.map((r) => r._id);

    if (!openCase) {
      const caseId = await DisciplinaryCase.generateCaseId();
      newlyCreatedCase = await DisciplinaryCase.create({
        caseId,
        studentId,
        linkedIncidentIds: incidentIds,
        linkedFalseAlarmRecordIds: recordIds,
        caseStatus: 'Case Created',
        committeeNotes: `Automated disciplinary case generated: student ${studentName} accumulated ${confirmedCount} verified intentional false alarms.`
      });

      // Notify Student
      const restNotif = await Notification.create({
        recipient: studentId,
        type: 'false_alarm_restricted',
        title: '🛑 SOS Alert Privileges Suspended — Disciplinary Review Initiated',
        message: `Your SOS-submission privileges have been automatically disabled due to accumulating ${confirmedCount} confirmed intentional false alarms. Disciplinary case [${newlyCreatedCase.caseId}] has been opened. Campus security emergency phone lines remain accessible in your portal.`
      });

      // Notify Security & Admin Rooms
      await AuditLog.logAction({
        actor: options.actorId || null,
        actorName: options.actorName || 'System Automation',
        actorRole: options.actorRole || 'system',
        action: 'STUDENT_SOS_ACCESS_RESTRICTED',
        entityType: 'User',
        entityId: studentId,
        metadata: {
          confirmedCount,
          threshold,
          caseId: newlyCreatedCase.caseId,
          linkedIncidentIds: incidentIds
        },
        ipAddress: options.ipAddress || ''
      });

      if (io) {
        io.to(`user:${studentId}`).emit('notification:new', restNotif);
        io.to('role:security').to('role:admin').emit('disciplinary_case:created', newlyCreatedCase);
      }
    } else {
      // Update existing open case with any new incident IDs
      openCase.linkedIncidentIds = Array.from(new Set([...openCase.linkedIncidentIds, ...incidentIds]));
      openCase.linkedFalseAlarmRecordIds = Array.from(
        new Set([...openCase.linkedFalseAlarmRecordIds.map(String), ...recordIds.map(String)])
      );
      await openCase.save();
    }
  }

  await safetyStatus.save();

  if (io) {
    io.to(`user:${studentId}`).emit('safety_status:updated', safetyStatus);
    io.to('role:security').to('role:admin').emit('safety_status:updated', {
      studentId,
      safetyStatus
    });
  }

  return { safetyStatus, disciplinaryCase: newlyCreatedCase };
};

/**
 * Submit or verify an incident classification (Security Personnel & Admin)
 */
export const verifyIncidentFalseAlarm = async (req, res, next) => {
  try {
    const {
      incidentId,
      classification,
      investigationNotes = '',
      evidenceReferences = ''
    } = req.body;

    if (!incidentId) {
      return res.status(400).json({
        success: false,
        message: 'Incident ID is required for verification.'
      });
    }

    const validClassifications = [
      'Genuine Emergency',
      'False Alarm — Accidental',
      'False Alarm — Intentional',
      'Under Investigation'
    ];

    if (!classification || !validClassifications.includes(classification)) {
      return res.status(400).json({
        success: false,
        message: `Invalid classification. Must be one of: ${validClassifications.join(', ')}`
      });
    }

    // Require investigation notes for intentional false alarms
    if (classification === 'False Alarm — Intentional' && !investigationNotes.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Detailed investigation notes are required before marking an incident as an intentional false alarm.'
      });
    }

    // Lookup incident safely by incidentId or _id
    let incident = null;
    const cleanId = String(incidentId || '').trim();
    if (cleanId) {
      if (cleanId.startsWith('CS-')) {
        incident = await Incident.findOne({ incidentId: cleanId });
      } else if (cleanId.length === 24 && /^[0-9a-fA-F]{24}$/.test(cleanId)) {
        incident = await Incident.findById(cleanId);
      }
      if (!incident) {
        incident = await Incident.findOne({ incidentId: cleanId });
      }
    }

    if (!incident) {
      return res.status(404).json({
        success: false,
        message: `Incident not found: ${incidentId}`
      });
    }

    const studentId = incident.reporter?._id || incident.reporter;
    let student = null;
    if (studentId) {
      student = await User.findById(studentId);
    }
    const studentName = student ? student.name : (incident.reporterName || 'Student');
    const studentIdentifier = student ? student.identifier : (incident.reporterIdentifier || 'N/A');

    const canonicalIncidentId = incident.incidentId;

    // Check if record already exists for this incident
    let record = await FalseAlarmRecord.findOne({ incidentId: canonicalIncidentId });

    const isUpdate = !!record;
    const previousClassification = record ? record.classification : null;

    if (record) {
      record.classification = classification;
      record.investigationNotes = investigationNotes.trim();
      record.evidenceReferences = evidenceReferences ? String(evidenceReferences).trim() : '';
      record.verifiedBy = req.user._id;
      record.verifierName = req.user.name;
      record.verifierRole = req.user.role;
      record.verifiedAt = new Date();
      record.verificationStatus = 'verified';
      await record.save();
    } else {
      record = await FalseAlarmRecord.create({
        studentId: studentId || req.user._id,
        incidentId: canonicalIncidentId,
        incidentObjectId: incident._id,
        classification,
        investigationNotes: investigationNotes.trim(),
        evidenceReferences: evidenceReferences ? String(evidenceReferences).trim() : '',
        verifiedBy: req.user._id,
        verifierName: req.user.name,
        verifierRole: req.user.role,
        verifiedAt: new Date(),
        verificationStatus: 'verified'
      });
    }

    // Auto-resolve incident if verified as false alarm or resolved emergency
    if (classification === 'False Alarm — Accidental' || classification === 'False Alarm — Intentional' || classification === 'Genuine Emergency') {
      if (incident.status !== 'Resolved') {
        incident.status = 'Resolved';
        incident.resolutionNotes = `[Verified: ${classification}] ${investigationNotes.trim()}`;
        incident.resolvedAt = new Date();
        incident.statusHistory.push({
          status: 'Resolved',
          changedBy: req.user._id,
          note: `Classified as ${classification}. ${investigationNotes.trim()}`,
          timestamp: new Date()
        });
        await incident.save();
      }
    }

    // If classification is intentional false alarm and student exists, notify student immediately
    if (classification === 'False Alarm — Intentional' && studentId) {
      await Notification.create({
        recipient: studentId,
        incident: incident._id,
        type: 'false_alarm_verified',
        title: 'Incident Verified as Intentional False Alarm',
        message: `Campus security investigated incident [${canonicalIncidentId}] and classified it as an Intentional False Alarm. Reason: ${investigationNotes.trim()}`
      });
    }

    // Audit log
    await AuditLog.logAction({
      actor: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: isUpdate ? 'FALSE_ALARM_RECORD_UPDATED' : 'FALSE_ALARM_RECORD_CREATED',
      entityType: 'FalseAlarmRecord',
      entityId: canonicalIncidentId,
      metadata: {
        classification,
        previousClassification,
        studentId,
        studentName,
        studentIdentifier,
        investigationNotes: investigationNotes.trim(),
        evidenceReferences
      },
      ipAddress: req.ip
    });

    // Evaluate student threshold if student exists
    let safetyStatus = null;
    let disciplinaryCase = null;
    if (studentId) {
      const evalRes = await evaluateStudentThreshold(studentId, {
        actorId: req.user._id,
        actorName: req.user.name,
        actorRole: req.user.role,
        ipAddress: req.ip
      });
      safetyStatus = evalRes.safetyStatus;
      disciplinaryCase = evalRes.disciplinaryCase;
    }

    // Real-time broadcast to ALL rooms and specific roles
    const io = getIO();
    if (io) {
      const incObj = incident.toObject ? incident.toObject() : { ...incident };
      incObj.falseAlarmRecord = record;
      io.emit('incident:updated', incObj);
      io.emit('false_alarm:verified', {
        record,
        safetyStatus,
        incidentId: canonicalIncidentId,
        studentId
      });
      io.to('role:security').to('role:admin').emit('false_alarm:verified', {
        record,
        safetyStatus,
        incidentId: canonicalIncidentId
      });
      if (studentId) {
        io.to(`user:${studentId}`).emit('false_alarm:verified', {
          record,
          safetyStatus
        });
      }
    }

    res.json({
      success: true,
      message: `Incident [${canonicalIncidentId}] successfully classified as "${classification}".`,
      record,
      safetyStatus,
      disciplinaryCase
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get student's personal false alarm history & safety status
 */
export const getMyFalseAlarmHistory = async (req, res, next) => {
  try {
    const studentId = req.user._id;

    const [records, safetyStatus, threshold, emergencyContacts] = await Promise.all([
      FalseAlarmRecord.find({ studentId }).sort({ verifiedAt: -1 }),
      StudentSafetyStatus.findOne({ studentId }),
      SystemSetting.getSetting('falseAlarmThreshold', 3),
      EmergencyContact.find().sort({ priority: 1, name: 1 })
    ]);

    const activeStatus = safetyStatus || {
      studentId,
      confirmedIntentionalFalseAlarmCount: 0,
      warningLevel: 'none',
      sosAccessStatus: 'active',
      restrictionReason: '',
      restrictedAt: null
    };

    res.json({
      success: true,
      records,
      safetyStatus: activeStatus,
      threshold,
      emergencyContacts
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get student's current safety & SOS access status
 */
export const getMySafetyStatus = async (req, res, next) => {
  try {
    const studentId = req.user._id;
    let safetyStatus = await StudentSafetyStatus.findOne({ studentId });
    const threshold = await SystemSetting.getSetting('falseAlarmThreshold', 3);

    if (!safetyStatus) {
      safetyStatus = {
        studentId,
        confirmedIntentionalFalseAlarmCount: 0,
        warningLevel: 'none',
        sosAccessStatus: 'active',
        restrictionReason: '',
        restrictedAt: null
      };
    }

    res.json({
      success: true,
      safetyStatus,
      threshold
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all false alarm records (Admin & Security) with filtering & pagination
 */
export const getAllFalseAlarmRecords = async (req, res, next) => {
  try {
    const {
      classification,
      verificationStatus,
      search,
      page = 1,
      limit = 50
    } = req.query;

    const filter = {};
    if (classification) filter.classification = classification;
    if (verificationStatus) filter.verificationStatus = verificationStatus;

    if (search) {
      filter.$or = [
        { incidentId: { $regex: search, $options: 'i' } },
        { investigationNotes: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await FalseAlarmRecord.countDocuments(filter);

    const records = await FalseAlarmRecord.find(filter)
      .populate('studentId', 'name email identifier phone department accountStatus')
      .populate('verifiedBy', 'name email role identifier')
      .sort({ verifiedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    res.json({
      success: true,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      records
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get full false alarm history for a specific student (Admin & Security)
 */
export const getStudentFalseAlarmProfile = async (req, res, next) => {
  try {
    const { studentId } = req.params;

    const student = await User.findById(studentId).select('-passwordHash');
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student record not found.'
      });
    }

    const [records, safetyStatus, disciplinaryCases, auditHistory] = await Promise.all([
      FalseAlarmRecord.find({ studentId }).sort({ verifiedAt: -1 }),
      StudentSafetyStatus.findOne({ studentId }),
      DisciplinaryCase.find({ studentId }).sort({ createdAt: -1 }),
      AuditLog.find({ entityId: String(studentId) }).sort({ timestamp: -1 }).limit(20)
    ]);

    res.json({
      success: true,
      student,
      records,
      safetyStatus: safetyStatus || {
        studentId,
        confirmedIntentionalFalseAlarmCount: 0,
        warningLevel: 'none',
        sosAccessStatus: 'active'
      },
      disciplinaryCases,
      auditHistory
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Restore SOS privileges manually (Admin only with mandatory reason)
 */
export const restoreStudentSosAccess = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        message: 'A detailed administrative override reason is mandatory to restore restricted SOS access.'
      });
    }

    const student = await User.findById(studentId);
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student account not found.'
      });
    }

    let safetyStatus = await StudentSafetyStatus.findOne({ studentId });
    if (!safetyStatus) {
      safetyStatus = new StudentSafetyStatus({ studentId });
    }

    const previousStatus = safetyStatus.sosAccessStatus;
    safetyStatus.sosAccessStatus = 'active';
    safetyStatus.restoredAt = new Date();
    safetyStatus.restoredBy = req.user._id;
    safetyStatus.overrideReason = reason.trim();

    safetyStatus.adminNotes.push({
      text: `Manual SOS Access Restored: ${reason.trim()}`,
      author: req.user._id,
      authorName: req.user.name,
      createdAt: new Date()
    });

    await safetyStatus.save();

    // Audit Log
    await AuditLog.logAction({
      actor: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'ADMIN_OVERRIDE_RESTORE_SOS_ACCESS',
      entityType: 'User',
      entityId: studentId,
      metadata: {
        studentName: student.name,
        studentIdentifier: student.identifier,
        previousStatus,
        overrideReason: reason.trim()
      },
      ipAddress: req.ip
    });

    // Send Notification to student
    const notif = await Notification.create({
      recipient: studentId,
      type: 'sos_access_restored',
      title: '✅ Emergency SOS Access Privileges Restored',
      message: `Your campus emergency SOS privileges have been reinstated by administrator ${req.user.name}. Reason: ${reason.trim()}`
    });

    const io = getIO();
    if (io) {
      io.to(`user:${studentId}`).emit('notification:new', notif);
      io.to(`user:${studentId}`).emit('safety_status:updated', safetyStatus);
      io.to('role:security').to('role:admin').emit('safety_status:updated', {
        studentId,
        safetyStatus
      });
    }

    res.json({
      success: true,
      message: `SOS access privileges successfully restored for ${student.name}.`,
      safetyStatus
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Add administrative note to a student's safety file (Admin only)
 */
export const addAdminNoteToStudent = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Administrative note text cannot be empty.'
      });
    }

    let safetyStatus = await StudentSafetyStatus.findOne({ studentId });
    if (!safetyStatus) {
      safetyStatus = new StudentSafetyStatus({ studentId });
    }

    safetyStatus.adminNotes.push({
      text: text.trim(),
      author: req.user._id,
      authorName: req.user.name,
      createdAt: new Date()
    });

    await safetyStatus.save();

    await AuditLog.logAction({
      actor: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'STUDENT_ADMIN_NOTE_ADDED',
      entityType: 'StudentSafetyStatus',
      entityId: studentId,
      metadata: { text: text.trim() },
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: 'Administrative note recorded in student file.',
      adminNotes: safetyStatus.adminNotes
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get False Alarm Dashboard statistics
 */
export const getFalseAlarmStats = async (req, res, next) => {
  try {
    const threshold = await SystemSetting.getSetting('falseAlarmThreshold', 3);

    const [
      totalReportedFalseAlarms,
      pendingVerificationCases,
      confirmedIntentionalFalseAlarms,
      studentsWith2OrMore,
      studentsSuspended,
      pendingDisciplinaryCases,
      resolvedDisciplinaryCases
    ] = await Promise.all([
      FalseAlarmRecord.countDocuments({
        classification: { $in: ['False Alarm — Accidental', 'False Alarm — Intentional'] }
      }),
      FalseAlarmRecord.countDocuments({
        $or: [{ classification: 'Under Investigation' }, { verificationStatus: 'pending' }]
      }),
      FalseAlarmRecord.countDocuments({
        classification: 'False Alarm — Intentional',
        verificationStatus: 'verified'
      }),
      StudentSafetyStatus.countDocuments({
        confirmedIntentionalFalseAlarmCount: { $gte: 2 }
      }),
      StudentSafetyStatus.countDocuments({
        sosAccessStatus: 'restricted'
      }),
      DisciplinaryCase.countDocuments({
        caseStatus: { $ne: 'Resolved' }
      }),
      DisciplinaryCase.countDocuments({
        caseStatus: 'Resolved'
      })
    ]);

    res.json({
      success: true,
      stats: {
        threshold,
        totalReportedFalseAlarms,
        pendingVerificationCases,
        confirmedIntentionalFalseAlarms,
        studentsWith2OrMoreCases: studentsWith2OrMore,
        studentsSuspended,
        pendingDisciplinaryCases,
        resolvedDisciplinaryCases
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get and update false alarm threshold configuration (Admin only)
 */
export const getThresholdConfig = async (req, res, next) => {
  try {
    const threshold = await SystemSetting.getSetting('falseAlarmThreshold', 3);
    res.json({
      success: true,
      threshold
    });
  } catch (error) {
    next(error);
  }
};

export const updateThresholdConfig = async (req, res, next) => {
  try {
    const { threshold } = req.body;
    const parsedThreshold = parseInt(threshold, 10);

    if (isNaN(parsedThreshold) || parsedThreshold < 1 || parsedThreshold > 20) {
      return res.status(400).json({
        success: false,
        message: 'Threshold must be a valid number between 1 and 20.'
      });
    }

    const previousThreshold = await SystemSetting.getSetting('falseAlarmThreshold', 3);
    await SystemSetting.setSetting(
      'falseAlarmThreshold',
      parsedThreshold,
      'Maximum confirmed intentional false alarms before automated SOS restriction',
      req.user._id
    );

    await AuditLog.logAction({
      actor: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'SYSTEM_CONFIG_UPDATED',
      entityType: 'SystemSetting',
      entityId: 'falseAlarmThreshold',
      metadata: { previousThreshold, newThreshold: parsedThreshold },
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: `False alarm suspension threshold updated to ${parsedThreshold}.`,
      threshold: parsedThreshold
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Export records as CSV/JSON (Admin only)
 */
export const exportFalseAlarmData = async (req, res, next) => {
  try {
    const format = req.query.format || 'csv';

    const records = await FalseAlarmRecord.find()
      .populate('studentId', 'name email identifier department')
      .populate('verifiedBy', 'name email')
      .sort({ verifiedAt: -1 });

    if (format === 'json') {
      return res.json({ success: true, count: records.length, records });
    }

    // Generate CSV
    const headers = [
      'Incident ID',
      'Student Name',
      'Roll Number',
      'Department',
      'Classification',
      'Investigation Notes',
      'Evidence References',
      'Verified By',
      'Verified At',
      'Status'
    ];

    const rows = records.map((r) => [
      `"${r.incidentId || ''}"`,
      `"${(r.studentId && r.studentId.name) || 'Unknown'}"`,
      `"${(r.studentId && r.studentId.identifier) || 'N/A'}"`,
      `"${(r.studentId && r.studentId.department) || 'N/A'}"`,
      `"${r.classification}"`,
      `"${(r.investigationNotes || '').replace(/"/g, '""')}"`,
      `"${(r.evidenceReferences || '').replace(/"/g, '""')}"`,
      `"${r.verifierName || ''}"`,
      `"${r.verifiedAt ? new Date(r.verifiedAt).toISOString() : ''}"`,
      `"${r.verificationStatus}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="campusshield_false_alarms.csv"');
    res.status(200).send(csvContent);
  } catch (error) {
    next(error);
  }
};

/**
 * Get Student Safety Overview Records (Admin & Security) with filtering & pagination
 */
export const getStudentSafetyOverview = async (req, res, next) => {
  try {
    const {
      search,
      department,
      minCount,
      sosStatus,
      disciplinaryStatus,
      page = 1,
      limit = 50
    } = req.query;

    const userFilter = { role: 'student' };
    if (department) {
      userFilter.department = { $regex: department, $options: 'i' };
    }
    if (search) {
      userFilter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { identifier: { $regex: search, $options: 'i' } }
      ];
    }

    const students = await User.find(userFilter).select('-passwordHash').lean();

    // Fetch all safety statuses, disciplinary cases, and last incidents
    const studentIds = students.map((s) => s._id);

    const [safetyStatuses, disciplinaryCases, lastIncidents] = await Promise.all([
      StudentSafetyStatus.find({ studentId: { $in: studentIds } }).lean(),
      DisciplinaryCase.find({ studentId: { $in: studentIds } }).sort({ createdAt: -1 }).lean(),
      Incident.aggregate([
        { $match: { reporter: { $in: studentIds } } },
        { $sort: { reportedAt: -1 } },
        {
          $group: {
            _id: '$reporter',
            lastIncidentDate: { $first: '$reportedAt' },
            lastIncidentId: { $first: '$incidentId' }
          }
        }
      ])
    ]);

    const safetyMap = new Map();
    safetyStatuses.forEach((st) => safetyMap.set(String(st.studentId), st));

    const caseMap = new Map();
    disciplinaryCases.forEach((dc) => {
      const key = String(dc.studentId);
      if (!caseMap.has(key)) {
        caseMap.set(key, dc);
      }
    });

    const incidentMap = new Map();
    lastIncidents.forEach((inc) => incidentMap.set(String(inc._id), inc));

    let merged = students.map((student) => {
      const sId = String(student._id);
      const safety = safetyMap.get(sId) || {
        confirmedIntentionalFalseAlarmCount: 0,
        warningLevel: 'none',
        sosAccessStatus: 'active',
        restrictionReason: '',
        restrictedAt: null
      };

      const dCase = caseMap.get(sId) || null;
      const lastInc = incidentMap.get(sId) || null;

      return {
        _id: student._id,
        name: student.name,
        email: student.email,
        identifier: student.identifier || '—',
        department: student.department || 'General',
        accountStatus: student.accountStatus,
        confirmedFalseAlarms: safety.confirmedIntentionalFalseAlarmCount || 0,
        warningLevel: safety.warningLevel || 'none',
        sosAccessStatus: safety.sosAccessStatus || 'active',
        restrictionReason: safety.restrictionReason || '',
        restrictedAt: safety.restrictedAt || null,
        restoredAt: safety.restoredAt || null,
        lastIncidentDate: lastInc ? lastInc.lastIncidentDate : null,
        lastIncidentId: lastInc ? lastInc.lastIncidentId : null,
        disciplinaryCaseId: dCase ? dCase.caseId : null,
        disciplinaryStatus: dCase ? dCase.caseStatus : 'None'
      };
    });

    // Apply Post-merge Filters
    if (minCount !== undefined && minCount !== '') {
      const countThreshold = parseInt(minCount, 10);
      if (!isNaN(countThreshold)) {
        merged = merged.filter((item) => item.confirmedFalseAlarms >= countThreshold);
      }
    }

    if (sosStatus) {
      merged = merged.filter((item) => item.sosAccessStatus === sosStatus);
    }

    if (disciplinaryStatus) {
      if (disciplinaryStatus === 'None') {
        merged = merged.filter((item) => item.disciplinaryStatus === 'None');
      } else if (disciplinaryStatus === 'Pending') {
        merged = merged.filter((item) => item.disciplinaryStatus !== 'None' && item.disciplinaryStatus !== 'Resolved');
      } else if (disciplinaryStatus === 'Resolved') {
        merged = merged.filter((item) => item.disciplinaryStatus === 'Resolved');
      } else {
        merged = merged.filter((item) => item.disciplinaryStatus === disciplinaryStatus);
      }
    }

    // Sort by confirmed false alarms desc, then by name
    merged.sort((a, b) => {
      if (b.confirmedFalseAlarms !== a.confirmedFalseAlarms) {
        return b.confirmedFalseAlarms - a.confirmedFalseAlarms;
      }
      return a.name.localeCompare(b.name);
    });

    const total = merged.length;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const paginated = merged.slice(skip, skip + parseInt(limit));

    res.json({
      success: true,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      students: paginated
    });
  } catch (error) {
    next(error);
  }
};

