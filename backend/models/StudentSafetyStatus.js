import mongoose from 'mongoose';

const adminNoteSchema = new mongoose.Schema(
  {
    text: {
      type: String,
      required: true,
      trim: true
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    authorName: {
      type: String,
      default: 'Administrator'
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  },
  { _id: true }
);

const studentSafetyStatusSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true
    },
    confirmedIntentionalFalseAlarmCount: {
      type: Number,
      default: 0,
      min: 0,
      index: true
    },
    warningLevel: {
      type: String,
      enum: ['none', 'warning_level_1', 'final_warning', 'restricted'],
      default: 'none',
      index: true
    },
    sosAccessStatus: {
      type: String,
      enum: ['active', 'restricted'],
      default: 'active',
      index: true
    },
    restrictionReason: {
      type: String,
      trim: true,
      default: ''
    },
    restrictedAt: {
      type: Date,
      default: null
    },
    restoredAt: {
      type: Date,
      default: null
    },
    restoredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    overrideReason: {
      type: String,
      trim: true,
      default: ''
    },
    adminNotes: [adminNoteSchema]
  },
  {
    timestamps: true
  }
);

export const StudentSafetyStatus = mongoose.model('StudentSafetyStatus', studentSafetyStatusSchema);
