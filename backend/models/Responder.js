import mongoose from 'mongoose';

const responderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true
    },
    badgeNumber: {
      type: String,
      required: [true, 'Badge number is required'],
      unique: true,
      trim: true
    },
    callSign: {
      type: String,
      required: true,
      trim: true,
      default: 'PATROL-1'
    },
    team: {
      type: String,
      required: true,
      trim: true,
      default: 'Quick Response Team'
    },
    availabilityStatus: {
      type: String,
      enum: ['available', 'dispatched', 'busy', 'off_duty'],
      default: 'available',
      index: true
    },
    phone: {
      type: String,
      default: ''
    },
    lastKnownLocation: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      campusZone: { type: String, default: 'Security Control Room' },
      updatedAt: { type: Date, default: Date.now }
    },
    activeIncidentCount: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

export const Responder = mongoose.model('Responder', responderSchema);
