import mongoose from 'mongoose';

const disciplinaryCaseSchema = new mongoose.Schema(
  {
    caseId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Student is required for disciplinary case'],
      index: true
    },
    linkedIncidentIds: {
      type: [String],
      default: []
    },
    linkedFalseAlarmRecordIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'FalseAlarmRecord'
      }
    ],
    caseStatus: {
      type: String,
      enum: [
        'Case Created',
        'Awaiting Committee Review',
        'Meeting Scheduled',
        'Student Notified',
        'Hearing Completed',
        'Decision Pending',
        'Resolved'
      ],
      default: 'Case Created',
      index: true
    },
    meetingDate: {
      type: Date,
      default: null
    },
    meetingLocation: {
      type: String,
      trim: true,
      default: 'Campus Disciplinary Committee Chamber (Admin Block 204)'
    },
    studentResponse: {
      type: String,
      trim: true,
      default: ''
    },
    studentResponseSubmittedAt: {
      type: Date,
      default: null
    },
    committeeNotes: {
      type: String,
      trim: true,
      default: ''
    },
    finalDecision: {
      type: String,
      trim: true,
      default: ''
    },
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    deciderName: {
      type: String,
      default: ''
    },
    decisionDate: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

disciplinaryCaseSchema.statics.generateCaseId = async function () {
  const year = new Date().getFullYear();
  const count = await this.countDocuments();
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `DC-${year}-${String(count + 1).padStart(4, '0')}-${randomSuffix}`;
};

export const DisciplinaryCase = mongoose.model('DisciplinaryCase', disciplinaryCaseSchema);
