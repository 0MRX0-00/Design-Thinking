import mongoose from 'mongoose';

const falseAlarmRecordSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Student reference is required'],
      index: true
    },
    incidentId: {
      type: String,
      required: [true, 'Incident reference ID is required'],
      unique: true,
      index: true
    },
    incidentObjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Incident',
      default: null
    },
    classification: {
      type: String,
      required: [true, 'Classification is required'],
      enum: [
        'Genuine Emergency',
        'False Alarm — Accidental',
        'False Alarm — Intentional',
        'Under Investigation'
      ],
      index: true
    },
    investigationNotes: {
      type: String,
      trim: true,
      default: ''
    },
    evidenceReferences: {
      type: String,
      trim: true,
      default: ''
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Security verifier is required'],
      index: true
    },
    verifierName: {
      type: String,
      default: 'Campus Security Personnel'
    },
    verifierRole: {
      type: String,
      default: 'security'
    },
    verifiedAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'verified',
      index: true
    },
    appealStatus: {
      type: String,
      enum: ['none', 'pending', 'upheld', 'overturned'],
      default: 'none'
    }
  },
  {
    timestamps: true
  }
);

export const FalseAlarmRecord = mongoose.model('FalseAlarmRecord', falseAlarmRecordSchema);
