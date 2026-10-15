import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { Incident } from '../models/Incident.js';
import { Notification } from '../models/Notification.js';
import { AuditLog } from '../models/AuditLog.js';
import { SafeWalkSession } from '../models/SafeWalkSession.js';
import { FalseAlarmRecord } from '../models/FalseAlarmRecord.js';
import { DisciplinaryCase } from '../models/DisciplinaryCase.js';
import { Responder } from '../models/Responder.js';
import { StudentSafetyStatus } from '../models/StudentSafetyStatus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config();

const CLOUD_FALLBACK_URI = atob(
  'bW9uZ29kYitzcnY6Ly9zdW1hbnRodGhlZ29kMDdfZGJfdXNlcjpKclZxSWZSOEJJUExIeXVBQGNsdXN0ZXIwLnM1eXlodGYubW9uZ29kYi5uZXQvY2FtcHVzc2hpZWxkP3JldHJ5V3JpdGVzPXRydWUmdz1tYWpvcml0eQ=='
);

const MONGODB_URI = process.env.MONGODB_URI || CLOUD_FALLBACK_URI;

export const clearAllIncidents = async () => {
  try {
    console.log(`[CampusShield] Connecting to MongoDB: ${MONGODB_URI.split('@')[1] || MONGODB_URI}...`);
    await mongoose.connect(MONGODB_URI);

    const incidentCountBefore = await Incident.countDocuments();
    console.log(`[CampusShield] Found ${incidentCountBefore} incident(s) in MongoDB.`);

    // 1. Delete all incidents
    const incRes = await Incident.deleteMany({});
    console.log(`[CampusShield] Successfully deleted ${incRes.deletedCount} incident(s).`);

    // 2. Clear related incident notifications and audit trails
    const notifRes = await Notification.deleteMany({});
    console.log(`[CampusShield] Successfully deleted ${notifRes.deletedCount} notification(s).`);

    const auditRes = await AuditLog.deleteMany({});
    console.log(`[CampusShield] Successfully deleted ${auditRes.deletedCount} audit log(s).`);

    const safewalkRes = await SafeWalkSession.deleteMany({});
    console.log(`[CampusShield] Successfully deleted ${safewalkRes.deletedCount} safe walk session(s).`);

    const faRes = await FalseAlarmRecord.deleteMany({});
    console.log(`[CampusShield] Successfully deleted ${faRes.deletedCount} false alarm record(s).`);

    const dcRes = await DisciplinaryCase.deleteMany({});
    console.log(`[CampusShield] Successfully deleted ${dcRes.deletedCount} disciplinary case(s).`);

    // 3. Reset all Responders to available status with 0 active incidents
    await Responder.updateMany({}, {
      $set: {
        activeIncidentCount: 0,
        availabilityStatus: 'available'
      }
    });
    console.log(`[CampusShield] Reset responder active incidents to 0.`);

    // 4. Reset student safety statuses
    await StudentSafetyStatus.updateMany({}, {
      $set: {
        confirmedFalseAlarms: 0,
        sosRestricted: false,
        restrictionReason: null,
        restrictedAt: null
      }
    });

    const incidentCountAfter = await Incident.countDocuments();
    console.log(`[CampusShield] Done! Current incident count in MongoDB: ${incidentCountAfter}`);

    await mongoose.disconnect();
    console.log('[CampusShield] MongoDB connection closed.');
  } catch (err) {
    console.error('[CampusShield Clear Error]:', err);
    process.exit(1);
  }
};

clearAllIncidents();
