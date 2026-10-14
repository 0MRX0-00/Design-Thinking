import { Responder } from '../models/Responder.js';
import { AuditLog } from '../models/AuditLog.js';
import { getIO } from '../sockets/socketHandler.js';

export const getResponders = async (req, res, next) => {
  try {
    const { status, team } = req.query;
    const filter = {};
    if (status) filter.availabilityStatus = status;
    if (team) filter.team = team;

    const responders = await Responder.find(filter)
      .populate('user', 'name email phone identifier department role')
      .sort({ availabilityStatus: 1, callSign: 1 });

    res.json({
      success: true,
      count: responders.length,
      responders
    });
  } catch (error) {
    next(error);
  }
};

export const getResponderById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const responder = await Responder.findById(id).populate('user', 'name email phone identifier department role');

    if (!responder) {
      return res.status(404).json({
        success: false,
        message: 'Responder not found.'
      });
    }

    res.json({
      success: true,
      responder
    });
  } catch (error) {
    next(error);
  }
};

export const updateResponderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { availabilityStatus } = req.body;

    const valid = ['available', 'dispatched', 'busy', 'off_duty'];
    if (!availabilityStatus || !valid.includes(availabilityStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid availability status. Must be one of: ${valid.join(', ')}`
      });
    }

    const responder = await Responder.findById(id).populate('user', 'name email phone');
    if (!responder) {
      return res.status(404).json({
        success: false,
        message: 'Responder not found.'
      });
    }

    const prev = responder.availabilityStatus;
    responder.availabilityStatus = availabilityStatus;
    await responder.save();

    await AuditLog.logAction({
      actor: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'RESPONDER_STATUS_CHANGED',
      entityType: 'Responder',
      entityId: responder._id,
      metadata: { previousStatus: prev, newStatus: availabilityStatus },
      ipAddress: req.ip
    });

    const io = getIO();
    if (io) {
      io.to('role:security').to('role:admin').emit('responder:status_changed', responder);
    }

    res.json({
      success: true,
      message: `Responder status updated to ${availabilityStatus}.`,
      responder
    });
  } catch (error) {
    next(error);
  }
};
