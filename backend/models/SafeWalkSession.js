import mongoose from 'mongoose';

const safeWalkSessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    userName: {
      type: String,
      default: ''
    },
    startLocation: {
      type: String,
      required: [true, 'Start location is required'],
      trim: true
    },
    destination: {
      type: String,
      required: [true, 'Destination is required'],
      trim: true
    },
    status: {
      type: String,
      enum: ['active', 'completed', 'cancelled', 'emergency_triggered'],
      default: 'active',
      index: true
    },
    startedAt: {
      type: Date,
      default: Date.now
    },
    endedAt: {
      type: Date,
      default: null
    },
    notes: {
      type: String,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

export const SafeWalkSession = mongoose.model('SafeWalkSession', safeWalkSessionSchema);
