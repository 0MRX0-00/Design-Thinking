import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    actorName: {
      type: String,
      default: 'System'
    },
    actorRole: {
      type: String,
      default: 'system'
    },
    action: {
      type: String,
      required: true,
      index: true
    },
    entityType: {
      type: String,
      required: true,
      index: true
    },
    entityId: {
      type: String,
      default: ''
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    ipAddress: {
      type: String,
      default: ''
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    timestamps: false
  }
);

// Never log sensitive passwords or tokens into audit logs
auditLogSchema.statics.logAction = async function ({
  actor = null,
  actorName = 'System',
  actorRole = 'system',
  action,
  entityType,
  entityId = '',
  metadata = {},
  ipAddress = ''
}) {
  try {
    const sanitizedMetadata = { ...metadata };
    delete sanitizedMetadata.password;
    delete sanitizedMetadata.passwordHash;
    delete sanitizedMetadata.token;
    delete sanitizedMetadata.authorization;

    return await this.create({
      actor,
      actorName,
      actorRole,
      action,
      entityType,
      entityId: String(entityId),
      metadata: sanitizedMetadata,
      ipAddress,
      timestamp: new Date()
    });
  } catch (err) {
    console.error('[CampusShield AuditLog] Error logging action:', err.message);
  }
};

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
