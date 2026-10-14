import mongoose from 'mongoose';

const emergencyContactSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    role: {
      type: String,
      required: true,
      trim: true
    },
    phone: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      trim: true,
      default: ''
    },
    location: {
      type: String,
      trim: true,
      default: 'Kongu Engineering College Campus'
    },
    priority: {
      type: Number,
      default: 1
    }
  },
  {
    timestamps: true
  }
);

export const EmergencyContact = mongoose.model('EmergencyContact', emergencyContactSchema);
