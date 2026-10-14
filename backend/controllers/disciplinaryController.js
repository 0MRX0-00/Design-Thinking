import { DisciplinaryCase } from '../models/DisciplinaryCase.js';
import { User } from '../models/User.js';
import { FalseAlarmRecord } from '../models/FalseAlarmRecord.js';
import { StudentSafetyStatus } from '../models/StudentSafetyStatus.js';
import { Notification } from '../models/Notification.js';
import { AuditLog } from '../models/AuditLog.js';
import { getIO } from '../sockets/socketHandler.js';

export const VALID_CASE_STATUSES = [
  'Case Created',
  'Awaiting Committee Review',
  'Meeting Scheduled',
  'Student Notified',
  'Hearing Completed',
  'Decision Pending',
  'Resolved'
];

/**
 * List all disciplinary cases (Admin & Security)
 */
export const getDisciplinaryCases = async (req, res, next) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;

    const filter = {};
    if (status && VALID_CASE_STATUSES.includes(status)) {
      filter.caseStatus = status;
    }

    if (search) {
      filter.$or = [
        { caseId: { $regex: search, $options: 'i' } },
        { committeeNotes: { $regex: search, $options: 'i' } },
        { finalDecision: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await DisciplinaryCase.countDocuments(filter);

    const cases = await DisciplinaryCase.find(filter)
      .populate('studentId', 'name email identifier phone department accountStatus')
      .populate('decidedBy', 'name email role')
      .populate('linkedFalseAlarmRecordIds')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    res.json({
      success: true,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      cases
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get cases involving the authenticated student
 */
export const getMyDisciplinaryCases = async (req, res, next) => {
  try {
    const cases = await DisciplinaryCase.find({ studentId: req.user._id })
      .populate('linkedFalseAlarmRecordIds')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: cases.length,
      cases
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get single disciplinary case details
 */
export const getDisciplinaryCaseById = async (req, res, next) => {
  try {
    const { id } = req.params;

    let cCase;
    if (id.startsWith('DC-')) {
      cCase = await DisciplinaryCase.findOne({ caseId: id });
    } else {
      cCase = await DisciplinaryCase.findById(id);
    }

    if (!cCase) {
      return res.status(404).json({
        success: false,
        message: 'Disciplinary case dossier not found.'
      });
    }

    // Role check: Admin, Security or the involved Student
    const isStudentInvolved = String(cCase.studentId) === String(req.user._id);
    const isPrivileged = req.user.role === 'admin' || req.user.role === 'security';

    if (!isStudentInvolved && !isPrivileged) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden. You do not have permission to view this disciplinary case.'
      });
    }

    await cCase.populate('studentId', 'name email identifier phone department accountStatus');
    await cCase.populate('decidedBy', 'name email role');
    await cCase.populate({
      path: 'linkedFalseAlarmRecordIds',
      populate: { path: 'verifiedBy', select: 'name email role' }
    });

    res.json({
      success: true,
      case: cCase
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Manually create a disciplinary case (Admin only)
 */
export const createDisciplinaryCase = async (req, res, next) => {
  try {
    const {
      studentId,
      linkedIncidentIds = [],
      meetingDate = null,
      meetingLocation,
      committeeNotes = ''
    } = req.body;

    if (!studentId) {
      return res.status(400).json({
        success: false,
        message: 'Student ID is required to initiate a disciplinary case.'
      });
    }

    const student = await User.findById(studentId);
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student account not found.'
      });
    }

    // Find linked false alarm records
    const linkedRecords = await FalseAlarmRecord.find({
      studentId,
      classification: 'False Alarm — Intentional'
    });

    const caseId = await DisciplinaryCase.generateCaseId();

    const newCase = await DisciplinaryCase.create({
      caseId,
      studentId,
      linkedIncidentIds: linkedIncidentIds.length > 0 ? linkedIncidentIds : linkedRecords.map((r) => r.incidentId),
      linkedFalseAlarmRecordIds: linkedRecords.map((r) => r._id),
      caseStatus: meetingDate ? 'Meeting Scheduled' : 'Case Created',
      meetingDate: meetingDate ? new Date(meetingDate) : null,
      meetingLocation: meetingLocation || 'Campus Disciplinary Committee Chamber (Admin Block 204)',
      committeeNotes: committeeNotes.trim()
    });

    await newCase.populate('studentId', 'name email identifier department');

    // Notify Student
    await Notification.create({
      recipient: studentId,
      type: 'disciplinary_case_created',
      title: 'Disciplinary Committee Case Initiated',
      message: `Disciplinary case [${caseId}] has been opened regarding emergency false alarm compliance. You may submit your explanation via the student portal.`
    });

    // Audit Log
    await AuditLog.logAction({
      actor: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'DISCIPLINARY_CASE_CREATED_MANUAL',
      entityType: 'DisciplinaryCase',
      entityId: caseId,
      metadata: { studentId, studentName: student.name },
      ipAddress: req.ip
    });

    const io = getIO();
    if (io) {
      io.to('role:admin').to('role:security').emit('disciplinary_case:created', newCase);
      io.to(`user:${studentId}`).emit('disciplinary_case:created', newCase);
    }

    res.status(201).json({
      success: true,
      message: `Disciplinary case [${caseId}] created successfully.`,
      case: newCase
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update case status, hearing schedule, notes, or final decision (Admin only)
 */
export const updateDisciplinaryCase = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      caseStatus,
      meetingDate,
      meetingLocation,
      committeeNotes,
      finalDecision
    } = req.body;

    let cCase;
    if (id.startsWith('DC-')) {
      cCase = await DisciplinaryCase.findOne({ caseId: id });
    } else {
      cCase = await DisciplinaryCase.findById(id);
    }

    if (!cCase) {
      return res.status(404).json({
        success: false,
        message: 'Disciplinary case not found.'
      });
    }

    const previousStatus = cCase.caseStatus;

    if (caseStatus) {
      if (!VALID_CASE_STATUSES.includes(caseStatus)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Must be one of: ${VALID_CASE_STATUSES.join(', ')}`
        });
      }
      cCase.caseStatus = caseStatus;
    }

    if (meetingDate !== undefined) {
      cCase.meetingDate = meetingDate ? new Date(meetingDate) : null;
    }

    if (meetingLocation !== undefined) {
      cCase.meetingLocation = meetingLocation.trim();
    }

    if (committeeNotes !== undefined) {
      cCase.committeeNotes = committeeNotes.trim();
    }

    const io = getIO();

    // Meeting Scheduled notification
    if (caseStatus === 'Meeting Scheduled' || (meetingDate && previousStatus !== 'Meeting Scheduled')) {
      const scheduledDateStr = cCase.meetingDate ? cCase.meetingDate.toLocaleString() : 'TBD';
      await Notification.create({
        recipient: cCase.studentId,
        type: 'disciplinary_meeting_scheduled',
        title: '🗓️ Disciplinary Committee Meeting Scheduled',
        message: `A formal hearing for case [${cCase.caseId}] is scheduled for ${scheduledDateStr} at ${cCase.meetingLocation}. You are requested to attend or submit written representation.`
      });

      if (io) {
        io.to(`user:${cCase.studentId}`).emit('notification:new', {
          title: 'Disciplinary Hearing Scheduled',
          message: `Meeting scheduled for ${scheduledDateStr}.`
        });
      }
    }

    // Final Decision Recording
    if (finalDecision !== undefined && finalDecision.trim()) {
      cCase.finalDecision = finalDecision.trim();
      cCase.decidedBy = req.user._id;
      cCase.deciderName = req.user.name;
      cCase.decisionDate = new Date();

      if (!caseStatus) {
        cCase.caseStatus = 'Resolved';
      }

      // If decision includes privilege restoration, automatically update safety status if requested
      if (
        finalDecision.toLowerCase().includes('restoration') ||
        finalDecision.toLowerCase().includes('restore') ||
        finalDecision.toLowerCase().includes('reinstated')
      ) {
        const safetyStatus = await StudentSafetyStatus.findOne({ studentId: cCase.studentId });
        if (safetyStatus && safetyStatus.sosAccessStatus === 'restricted') {
          safetyStatus.sosAccessStatus = 'active';
          safetyStatus.restoredAt = new Date();
          safetyStatus.restoredBy = req.user._id;
          safetyStatus.overrideReason = `Disciplinary Committee Resolution: ${finalDecision.trim()}`;
          await safetyStatus.save();
        }
      }

      await Notification.create({
        recipient: cCase.studentId,
        type: 'disciplinary_decision',
        title: '📋 Disciplinary Committee Decision Finalized',
        message: `Case [${cCase.caseId}] has been finalized with outcome: "${finalDecision.trim()}". Decision recorded by ${req.user.name}.`
      });

      if (io) {
        io.to(`user:${cCase.studentId}`).emit('notification:new', {
          title: 'Disciplinary Case Decision',
          message: `Final decision recorded for [${cCase.caseId}]: ${finalDecision.trim()}`
        });
      }
    }

    await cCase.save();

    await AuditLog.logAction({
      actor: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'DISCIPLINARY_CASE_UPDATED',
      entityType: 'DisciplinaryCase',
      entityId: cCase.caseId,
      metadata: {
        previousStatus,
        newStatus: cCase.caseStatus,
        meetingDate: cCase.meetingDate,
        finalDecision: cCase.finalDecision
      },
      ipAddress: req.ip
    });

    await cCase.populate('studentId', 'name email identifier department');
    await cCase.populate('decidedBy', 'name email role');

    if (io) {
      io.to('role:admin').to('role:security').emit('disciplinary_case:updated', cCase);
      io.to(`user:${cCase.studentId._id || cCase.studentId}`).emit('disciplinary_case:updated', cCase);
    }

    res.json({
      success: true,
      message: `Disciplinary case [${cCase.caseId}] updated successfully.`,
      case: cCase
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Submit student response, explanation or appeal for hearing
 */
export const submitStudentResponse = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { explanation } = req.body;

    if (!explanation || !explanation.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Explanation text cannot be blank.'
      });
    }

    let cCase;
    if (id.startsWith('DC-')) {
      cCase = await DisciplinaryCase.findOne({ caseId: id });
    } else {
      cCase = await DisciplinaryCase.findById(id);
    }

    if (!cCase) {
      return res.status(404).json({
        success: false,
        message: 'Disciplinary case dossier not found.'
      });
    }

    // Only the student assigned or an administrator can submit representation
    const isStudentInvolved = String(cCase.studentId) === String(req.user._id);
    const isAdmin = req.user.role === 'admin';

    if (!isStudentInvolved && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only the involved student or an administrator can submit an explanation for this case.'
      });
    }

    cCase.studentResponse = explanation.trim();
    cCase.studentResponseSubmittedAt = new Date();
    await cCase.save();

    await AuditLog.logAction({
      actor: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'DISCIPLINARY_CASE_STUDENT_RESPONSE_SUBMITTED',
      entityType: 'DisciplinaryCase',
      entityId: cCase.caseId,
      metadata: { explanation: explanation.trim() },
      ipAddress: req.ip
    });

    const io = getIO();
    if (io) {
      io.to('role:admin').emit('disciplinary_case:updated', cCase);
      io.to('role:security').emit('disciplinary_case:updated', cCase);
    }

    res.json({
      success: true,
      message: 'Your explanation and representation have been submitted for committee review.',
      case: cCase
    });
  } catch (error) {
    next(error);
  }
};
