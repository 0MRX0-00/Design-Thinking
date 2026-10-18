import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Responder } from '../models/Responder.js';
import { Incident } from '../models/Incident.js';
import { Notification } from '../models/Notification.js';
import { AuditLog } from '../models/AuditLog.js';
import { EmergencyContact } from '../models/EmergencyContact.js';
import { SafeWalkSession } from '../models/SafeWalkSession.js';
import { FalseAlarmRecord } from '../models/FalseAlarmRecord.js';
import { StudentSafetyStatus } from '../models/StudentSafetyStatus.js';
import { DisciplinaryCase } from '../models/DisciplinaryCase.js';
import { SystemSetting } from '../models/SystemSetting.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/campusshield';

export const seedCleanDatabase = async () => {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_SEED !== 'true') {
    throw new Error('[CampusShield Safety Gate] Seeding is blocked in production to protect real records. Set ALLOW_PRODUCTION_SEED=true only if intentional.');
  }

  try {
    if (mongoose.connection.readyState !== 1) {
      const masked = MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
      console.log(`[CampusShield Clean Seed] Connecting to MongoDB: ${masked}...`);
      await mongoose.connect(MONGODB_URI);
    }

    console.log('[CampusShield Clean Seed] Connected. Clearing collections for clean seed...');

    // 1. Wipe all active/historical incidents and notifications for a fresh queue
    await Incident.deleteMany({});
    await Notification.deleteMany({});
    await AuditLog.deleteMany({});
    await SafeWalkSession.deleteMany({});
    await FalseAlarmRecord.deleteMany({});
    await StudentSafetyStatus.deleteMany({});
    await DisciplinaryCase.deleteMany({});
    await User.deleteMany({});
    await Responder.deleteMany({});
    await EmergencyContact.deleteMany({});
    await SystemSetting.deleteMany({});

    console.log('[CampusShield Clean Seed] Creating baseline demo accounts...');

    const defaultPassword = 'Password@123';
    const passwordHash = await User.hashPassword(defaultPassword);

    // Baseline Admin
    const adminUser = await User.create({
      name: 'Dr. S. Karthi (Chief Safety Director)',
      email: 'admin@campusshield.kec.edu',
      passwordHash,
      identifier: 'ADMIN-KEC-01',
      phone: '+91 94433 11223',
      department: 'Campus Safety Administration',
      role: 'admin',
      accountStatus: 'active'
    });

    // Baseline Security Personnel
    const secUser1 = await User.create({
      name: 'Officer K. Raman',
      email: 'security.raman@campusshield.kec.edu',
      passwordHash,
      identifier: 'SEC-KEC-001',
      phone: '+91 98422 44556',
      department: 'Campus Security Control',
      role: 'security',
      accountStatus: 'active'
    });

    const secUser2 = await User.create({
      name: 'Officer M. Selvam',
      email: 'security.selvam@campusshield.kec.edu',
      passwordHash,
      identifier: 'SEC-KEC-002',
      phone: '+91 98422 55667',
      department: 'Patrol Division',
      role: 'security',
      accountStatus: 'active'
    });

    // Baseline Students
    const studentUser1 = await User.create({
      name: 'Sumanth S',
      email: 'sumanth@kongu.edu',
      passwordHash,
      identifier: '25ITR146',
      phone: '+91 97890 12345',
      department: 'Information Technology',
      role: 'student',
      accountStatus: 'active'
    });

    const studentUser2 = await User.create({
      name: 'Sangavi S',
      email: 'sangavi@kongu.edu',
      passwordHash,
      identifier: '25ITR125',
      phone: '+91 97890 23456',
      department: 'Information Technology',
      role: 'student',
      accountStatus: 'active'
    });

    // 2. Baseline Responders (all Available)
    await Responder.create([
      {
        user: secUser1._id,
        badgeNumber: 'QRF-01',
        callSign: 'ALPHA-PATROL',
        team: 'Quick Reaction Force',
        availabilityStatus: 'available',
        phone: secUser1.phone,
        activeIncidentCount: 0,
        lastKnownLocation: {
          latitude: 11.2742,
          longitude: 77.6074,
          campusZone: 'Main Gate & Circle',
          updatedAt: new Date()
        }
      },
      {
        user: secUser2._id,
        badgeNumber: 'PAT-02',
        callSign: 'BRAVO-PATROL',
        team: 'Hostel Perimeter Division',
        availabilityStatus: 'available',
        phone: secUser2.phone,
        activeIncidentCount: 0,
        lastKnownLocation: {
          latitude: 11.2755,
          longitude: 77.6085,
          campusZone: 'Hostel Block C Pathway',
          updatedAt: new Date()
        }
      }
    ]);

    // 3. Baseline Verified Emergency Contacts
    await EmergencyContact.create([
      {
        name: 'Campus Security Main Control Room',
        role: 'Central Emergency Dispatch 24/7',
        phone: '+91 4294 226500',
        email: 'security@kongu.ac.in',
        location: 'Admin Block Ground Floor, KEC',
        priority: 1
      },
      {
        name: 'Campus Ambulance & Health Clinic',
        role: 'Emergency Medical Service',
        phone: '+91 4294 226501',
        email: 'healthcenter@kongu.ac.in',
        location: 'Opposite to Student Amenity Center',
        priority: 2
      },
      {
        name: "Women's Safety & Anti-Harassment Cell",
        role: 'Confidential Safety Support',
        phone: '1091',
        email: 'womensafety@kongu.ac.in',
        location: 'Student Welfare Center',
        priority: 3
      },
      {
        name: 'Perundurai Police Station',
        role: 'Local Police Assistance',
        phone: '+91 4294 220233',
        email: 'perundurai-ps@tnpolice.gov.in',
        location: 'Perundurai, Erode',
        priority: 4
      }
    ]);

    // 4. Baseline System Settings
    await SystemSetting.create({
      key: 'FALSE_ALARM_AUTO_RESTRICT_THRESHOLD',
      value: 4,
      description: 'Confirmed intentional false alarms before automated SOS restriction',
      updatedBy: adminUser._id
    });

    console.log(`
=============================================================
  🛡️  CampusShield Clean Slate Dataset Ready!
=============================================================
  Active Emergencies in Queue:  0 (Completely Clean)
  Default Password for all:     Password@123
-------------------------------------------------------------
  1. Student:    sumanth@kongu.edu (or Roll: 25ITR146)
  2. Security:   security.raman@campusshield.kec.edu
  3. Admin:      admin@campusshield.kec.edu
=============================================================
`);

    if (process.argv[1]?.endsWith('seedClean.js')) {
      await mongoose.disconnect();
      process.exit(0);
    }
  } catch (err) {
    console.error('[CampusShield Clean Seed Error]:', err);
    process.exit(1);
  }
};

if (process.argv[1]?.endsWith('seedClean.js')) {
  seedCleanDatabase();
}
