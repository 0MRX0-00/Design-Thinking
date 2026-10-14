import mongoose from 'mongoose';

const systemSettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    description: {
      type: String,
      default: ''
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  {
    timestamps: true
  }
);

systemSettingSchema.statics.getSetting = async function (key, defaultValue) {
  const setting = await this.findOne({ key });
  if (!setting) return defaultValue;
  return setting.value;
};

systemSettingSchema.statics.setSetting = async function (key, value, description = '', updatedBy = null) {
  return this.findOneAndUpdate(
    { key },
    { value, description, updatedBy, updatedAt: new Date() },
    { upsert: true, new: true }
  );
};

export const SystemSetting = mongoose.model('SystemSetting', systemSettingSchema);
