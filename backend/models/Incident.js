import mongoose from 'mongoose';

const statusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      required: true,
      enum: ['Submitted', 'Acknowledged', 'Assigned', 'Dispatched', 'On Scene', 'Resolved', 'Cancelled']
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    note: {
      type: String,
      default: ''
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  },
  { _id: false }
);

const incidentNoteSchema = new mongoose.Schema(
  {
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    authorName: {
      type: String,
      default: 'Security Personnel'
    },
    text: {
      type: String,
      required: true,
      trim: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  },
  { _id: true }
);

const incidentSchema = new mongoose.Schema(
  {
    incidentId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    category: {
      type: String,
      required: [true, 'Incident category is required'],
      enum: [
        'Medical emergency',
        'Harassment or personal safety concern',
        'Theft',
        'Accident',
        'Suspicious activity',
        'Fire',
        'Other'
      ],
      index: true
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    requirements: {
      type: [String],
      default: []
    },
    locationDetails: {
      type: String,
      trim: true,
      default: ''
    },
    peopleInvolved: {
      type: String,
      default: '1 person'
    },
    silentAlert: {
      type: Boolean,
      default: false
    },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'high',
      index: true
    },
    status: {
      type: String,
      enum: ['Submitted', 'Acknowledged', 'Assigned', 'Dispatched', 'On Scene', 'Resolved', 'Cancelled'],
      default: 'Submitted',
      index: true
    },
    location: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      accuracy: { type: Number, default: null },
      campusLocation: {
        type: String,
        required: [true, 'Campus location is required'],
        trim: true,
        default: 'Main Campus Quad'
      }
    },
    assignedResponder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Responder',
      default: null,
      index: true
    },
    reportedAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    acknowledgedAt: {
      type: Date,
      default: null
    },
    dispatchedAt: {
      type: Date,
      default: null
    },
    arrivedAt: {
      type: Date,
      default: null
    },
    resolvedAt: {
      type: Date,
      default: null
    },
    resolutionNotes: {
      type: String,
      default: ''
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    statusHistory: [statusHistorySchema],
    notes: [incidentNoteSchema]
  },
  {
    timestamps: true
  }
);

// Compound indexes for high-frequency queries
incidentSchema.index({ reporter: 1, reportedAt: -1 });
incidentSchema.index({ status: 1, reportedAt: -1 });
incidentSchema.index({ severity: 1, status: 1 });
incidentSchema.index({ assignedResponder: 1, status: 1 });

// Helper method to generate unique human-readable ID
incidentSchema.statics.generateIncidentId = async function () {
  const year = new Date().getFullYear();
  const timeSlice = Date.now().toString().slice(-4);
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `CS-${year}-${timeSlice}-${randomSuffix}`;
};

export const Incident = mongoose.model('Incident', incidentSchema);
