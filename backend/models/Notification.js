import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    incident: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Incident',
      default: null
    },
    type: {
      type: String,
      required: true,
      enum: [
        'incident_submitted',
        'incident_acknowledged',
        'responder_assigned',
        'security_dispatched',
        'responder_arrived',
        'incident_resolved',
        'safety_announcement',
        'false_alarm_verified',
        'false_alarm_warning',
        'false_alarm_restricted',
        'disciplinary_case_created',
        'disciplinary_meeting_scheduled',
        'disciplinary_decision',
        'sos_access_restored',
        'general'
      ],
      default: 'general'
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    message: {
      type: String,
      required: true,
      trim: true
    },
    read: {
      type: Boolean,
      default: false,
      index: true
    },
    readAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

export const Notification = mongoose.model('Notification', notificationSchema);
