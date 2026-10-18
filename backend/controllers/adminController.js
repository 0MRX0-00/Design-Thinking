import { User } from '../models/User.js';
import { AuditLog } from '../models/AuditLog.js';
import { EmergencyContact } from '../models/EmergencyContact.js';

export const getUsers = async (req, res, next) => {
  try {
    const { role, status, search, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (role) filter.role = role;
    if (status) filter.accountStatus = status;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { identifier: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = parseInt(limit);

    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .select('-passwordHash')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean()
    ]);

    res.json({
      success: true,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limitNum),
      users
    });
  } catch (error) {
    next(error);
  }
};

export const updateUserRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    const validRoles = ['student', 'faculty', 'security', 'admin'];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Must be one of: ${validRoles.join(', ')}`
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.'
      });
    }

    const prevRole = user.role;
    user.role = role;
    await user.save();

    await AuditLog.logAction({
      actor: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'USER_ROLE_UPDATED',
      entityType: 'User',
      entityId: user._id,
      metadata: { targetUserEmail: user.email, previousRole: prevRole, newRole: role },
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: `Role for ${user.name} updated to ${role}.`,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
};

export const updateUserStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { accountStatus } = req.body;

    if (!['active', 'suspended', 'pending'].includes(accountStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid account status.'
      });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { accountStatus },
      { new: true }
    ).select('-passwordHash');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.'
      });
    }

    await AuditLog.logAction({
      actor: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'USER_STATUS_UPDATED',
      entityType: 'User',
      entityId: user._id,
      metadata: { newStatus: accountStatus },
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: `Account status updated to ${accountStatus}.`,
      user
    });
  } catch (error) {
    next(error);
  }
};

export const getAuditLogs = async (req, res, next) => {
  try {
    const { action, entityType, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (action) filter.action = action;
    if (entityType) filter.entityType = entityType;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await AuditLog.countDocuments(filter);

    const logs = await AuditLog.find(filter)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    res.json({
      success: true,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      logs
    });
  } catch (error) {
    next(error);
  }
};

export const getEmergencyContacts = async (req, res, next) => {
  try {
    const contacts = await EmergencyContact.find().sort({ priority: 1, name: 1 }).lean();
    res.json({
      success: true,
      contacts
    });
  } catch (error) {
    next(error);
  }
};

export const createEmergencyContact = async (req, res, next) => {
  try {
    const { name, role, phone, email, location, priority } = req.body;
    if (!name || !role || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Name, role, and phone are required for emergency contact.'
      });
    }

    const contact = await EmergencyContact.create({
      name: name.trim(),
      role: role.trim(),
      phone: phone.trim(),
      email: email ? email.trim() : '',
      location: location ? location.trim() : 'Campus',
      priority: priority || 1
    });

    res.status(201).json({
      success: true,
      contact
    });
  } catch (error) {
    next(error);
  }
};

export const deleteEmergencyContact = async (req, res, next) => {
  try {
    const { id } = req.params;
    await EmergencyContact.findByIdAndDelete(id);
    res.json({
      success: true,
      message: 'Emergency contact removed.'
    });
  } catch (error) {
    next(error);
  }
};

export const createUser = async (req, res, next) => {
  try {
    const { name, email, password, identifier, phone, department, role, accountStatus } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, institutional email, and initial password are required.'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long.'
      });
    }

    const validRoles = ['student', 'faculty', 'security', 'admin'];
    const assignedRole = role && validRoles.includes(role) ? role : 'student';

    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'A user account with this email address already exists.'
      });
    }

    if (identifier && identifier.trim()) {
      const existingId = await User.findOne({ identifier: identifier.trim() });
      if (existingId) {
        return res.status(409).json({
          success: false,
          message: `A user with Roll No / Identifier "${identifier.trim()}" already exists.`
        });
      }
    }

    const passwordHash = await User.hashPassword(password);
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      identifier: identifier ? identifier.trim() : '',
      phone: phone ? phone.trim() : '',
      department: department ? department.trim() : 'General Campus',
      role: assignedRole,
      accountStatus: accountStatus || 'active'
    });

    await AuditLog.logAction({
      actor: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'USER_CREATED_BY_ADMIN',
      entityType: 'User',
      entityId: user._id,
      metadata: { createdUserEmail: user.email, role: user.role, identifier: user.identifier },
      ipAddress: req.ip
    });

    res.status(201).json({
      success: true,
      message: `User ${user.name} (${user.role.toUpperCase()}) added successfully.`,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        identifier: user.identifier,
        department: user.department,
        accountStatus: user.accountStatus
      }
    });
  } catch (error) {
    next(error);
  }
};
