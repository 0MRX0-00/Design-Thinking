import dotenv from 'dotenv';
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

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/campusshield';

const seedDatabase = async () => {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_SEED !== 'true') {
    throw new Error('[CampusShield Safety Gate] Seeding is blocked in production to protect real records. Set ALLOW_PRODUCTION_SEED=true only if intentional.');
  }

  try {
    if (mongoose.connection.readyState !== 1) {
      const maskedUri = MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
      console.log(`[CampusShield Seed] Connecting to MongoDB: ${maskedUri}...`);
      await mongoose.connect(MONGODB_URI);
    }
    console.log('[CampusShield Seed] Connected. Clearing development collections...');

    await User.deleteMany({});
    await Responder.deleteMany({});
    await Incident.deleteMany({});
    await Notification.deleteMany({});
    await AuditLog.deleteMany({});
    await EmergencyContact.deleteMany({});
    await SafeWalkSession.deleteMany({});
    await FalseAlarmRecord.deleteMany({});
    await StudentSafetyStatus.deleteMany({});
    await DisciplinaryCase.deleteMany({});
    await SystemSetting.deleteMany({});

    console.log('[CampusShield Seed] Creating development user accounts...');

    const defaultPassword = 'Password@123';
    const passwordHash = await User.hashPassword(defaultPassword);

    // 1. Admin
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

    // 2. Security Personnel
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

    const secUser3 = await User.create({
      name: 'Nurse P. Deepa',
      email: 'nurse.deepa@campusshield.kec.edu',
      passwordHash,
      identifier: 'MED-KEC-005',
      phone: '+91 98422 66778',
      department: 'Campus Health Center',
      role: 'security',
      accountStatus: 'active'
    });

    const secUser4 = await User.create({
      name: 'Officer R. Anand',
      email: 'security.anand@campusshield.kec.edu',
      passwordHash,
      identifier: 'SEC-KEC-003',
      phone: '+91 98422 77889',
      department: 'Perimeter Security',
      role: 'security',
      accountStatus: 'active'
    });

    // 3. Students
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

    const studentUser3 = await User.create({
      name: 'Karthik R',
      email: 'karthik@kongu.edu',
      passwordHash,
      identifier: '25CSR042',
      phone: '+91 97890 34567',
      department: 'Computer Science & Engineering',
      role: 'student',
      accountStatus: 'active'
    });

    const studentUser4 = await User.create({
      name: 'Praveen M',
      email: 'praveen@kongu.edu',
      passwordHash,
      identifier: '25MEC088',
      phone: '+91 97890 45678',
      department: 'Mechanical Engineering',
      role: 'student',
      accountStatus: 'active'
    });

    // 3b. Faculty & Disciplinary Committee Representative
    const facultyUser = await User.create({
      name: 'Dr. V. Priya (Disciplinary Committee Head)',
      email: 'priya.faculty@kongu.edu',
      passwordHash,
      identifier: 'FAC-DC-001',
      phone: '+91 94433 88990',
      department: 'Academic & Student Affairs',
      role: 'faculty',
      accountStatus: 'active'
    });

    // 4. Create Responders linked to security users
    const responderAlpha = await Responder.create({
      user: secUser1._id,
      badgeNumber: 'QRF-01',
      callSign: 'ALPHA-PATROL',
      team: 'Quick Reaction Force',
      availabilityStatus: 'available',
      phone: secUser1.phone,
      lastKnownLocation: {
        latitude: 11.2742,
        longitude: 77.6074,
        campusZone: 'Main Gate & Circle',
        updatedAt: new Date()
      }
    });

    const responderBravo = await Responder.create({
      user: secUser2._id,
      badgeNumber: 'PAT-02',
      callSign: 'BRAVO-PATROL',
      team: 'Hostel Perimeter Division',
      availabilityStatus: 'dispatched',
      phone: secUser2.phone,
      activeIncidentCount: 1,
      lastKnownLocation: {
        latitude: 11.2755,
        longitude: 77.6085,
        campusZone: 'Hostel Block C Pathway',
        updatedAt: new Date()
      }
    });

    const responderDelta = await Responder.create({
      user: secUser3._id,
      badgeNumber: 'MED-01',
      callSign: 'MEDIC-DELTA',
      team: 'Medical First Response Unit',
      availabilityStatus: 'available',
      phone: secUser3.phone,
      lastKnownLocation: {
        latitude: 11.2738,
        longitude: 77.6068,
        campusZone: 'Campus Health Center',
        updatedAt: new Date()
      }
    });

    const responderCharlie = await Responder.create({
      user: secUser4._id,
      badgeNumber: 'PAT-03',
      callSign: 'CHARLIE-PATROL',
      team: 'IT Park Quad Division',
      availabilityStatus: 'available',
      phone: secUser4.phone,
      lastKnownLocation: {
        latitude: 11.2748,
        longitude: 77.6062,
        campusZone: 'IT Park Front Lawn',
        updatedAt: new Date()
      }
    });

    console.log('[CampusShield Seed] Creating verified campus emergency contacts...');
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
        name: 'Chief Warden Office',
        role: 'Hostel Safety & Disciplinary Cell',
        phone: '+91 4294 226502',
        email: 'chiefwarden@kongu.ac.in',
        location: 'Hostel Administrative Office',
        priority: 3
      },
      {
        name: "Women's Safety & Anti-Harassment Cell",
        role: 'Confidential Safety Support',
        phone: '1091',
        email: 'womensafety@kongu.ac.in',
        location: 'Student Welfare Center',
        priority: 4
      },
      {
        name: 'Perundurai Police Station',
        role: 'Local Police Assistance',
        phone: '+91 4294 220233',
        email: 'perundurai-ps@tnpolice.gov.in',
        location: 'Perundurai, Erode',
        priority: 5
      }
    ]);

    console.log('[CampusShield Seed] Creating initial realistic campus incidents...');

    // Incident 1: Harassment / Personal Safety (Active - Dispatched)
    const inc1Date = new Date(Date.now() - 15 * 60 * 1000); // 15 mins ago
    const inc1 = await Incident.create({
      incidentId: 'CS-2026-0001',
      reporter: studentUser1._id,
      category: 'Harassment or personal safety concern',
      description: 'Suspicious individual tailgating near Hostel Block C walkway towards library. Student feels threatened.',
      severity: 'critical',
      status: 'Dispatched',
      location: {
        latitude: 11.2753,
        longitude: 77.6081,
        accuracy: 12,
        campusLocation: 'Hostel Block C - North Walkway'
      },
      assignedResponder: responderBravo._id,
      reportedAt: inc1Date,
      acknowledgedAt: new Date(inc1Date.getTime() + 2 * 60 * 1000),
      dispatchedAt: new Date(inc1Date.getTime() + 3 * 60 * 1000),
      statusHistory: [
        {
          status: 'Submitted',
          changedBy: studentUser1._id,
          note: 'One-tap SOS triggered with GPS coordinates.',
          timestamp: inc1Date
        },
        {
          status: 'Acknowledged',
          changedBy: secUser1._id,
          note: 'Officer Raman acknowledged alert from CCTV monitor.',
          timestamp: new Date(inc1Date.getTime() + 2 * 60 * 1000)
        },
        {
          status: 'Dispatched',
          changedBy: secUser1._id,
          note: 'Dispatched BRAVO-PATROL to Hostel Block C walkway.',
          timestamp: new Date(inc1Date.getTime() + 3 * 60 * 1000)
        }
      ],
      notes: [
        {
          author: secUser1._id,
          authorName: secUser1.name,
          text: 'Camera CAM-07 switched to pan-tilt preset for Hostel walkway. Unit Bravo en route.',
          createdAt: new Date(inc1Date.getTime() + 4 * 60 * 1000)
        }
      ]
    });

    // Incident 2: Medical emergency (Resolved)
    const inc2Date = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3 hours ago
    const inc2 = await Incident.create({
      incidentId: 'CS-2026-0002',
      reporter: studentUser2._id,
      category: 'Medical emergency',
      description: 'Student slipped on laboratory stairs, sprained ankle and mild concussion.',
      severity: 'high',
      status: 'Resolved',
      location: {
        latitude: 11.2745,
        longitude: 77.6065,
        accuracy: 8,
        campusLocation: 'IT Park - Staircase 2'
      },
      assignedResponder: responderDelta._id,
      reportedAt: inc2Date,
      acknowledgedAt: new Date(inc2Date.getTime() + 1.5 * 60 * 1000),
      dispatchedAt: new Date(inc2Date.getTime() + 2.5 * 60 * 1000),
      arrivedAt: new Date(inc2Date.getTime() + 5 * 60 * 1000),
      resolvedAt: new Date(inc2Date.getTime() + 35 * 60 * 1000),
      resolutionNotes: 'First aid rendered on site. Student safely escorted to Campus Health Center. Stable condition.',
      resolvedBy: secUser1._id,
      statusHistory: [
        { status: 'Submitted', changedBy: studentUser2._id, note: 'Emergency form submitted.', timestamp: inc2Date },
        { status: 'Acknowledged', changedBy: secUser1._id, note: 'Control room acknowledged.', timestamp: new Date(inc2Date.getTime() + 1.5 * 60 * 1000) },
        { status: 'Dispatched', changedBy: secUser1._id, note: 'Medic Delta unit dispatched.', timestamp: new Date(inc2Date.getTime() + 2.5 * 60 * 1000) },
        { status: 'On Scene', changedBy: secUser3._id, note: 'Medical team on scene.', timestamp: new Date(inc2Date.getTime() + 5 * 60 * 1000) },
        { status: 'Resolved', changedBy: secUser1._id, note: 'Incident treated and closed.', timestamp: new Date(inc2Date.getTime() + 35 * 60 * 1000) }
      ]
    });

    // Incident 3: Theft report (Submitted)
    const inc3Date = new Date(Date.now() - 45 * 60 * 1000);
    await Incident.create({
      incidentId: 'CS-2026-0003',
      reporter: studentUser1._id,
      category: 'Theft',
      description: 'Laptop bag with HP laptop missing from Central Library 2nd Floor reading room table.',
      severity: 'medium',
      status: 'Submitted',
      location: {
        latitude: 11.2739,
        longitude: 77.6071,
        accuracy: 15,
        campusLocation: 'Central Library - 2nd Floor'
      },
      reportedAt: inc3Date,
      statusHistory: [
        {
          status: 'Submitted',
          changedBy: studentUser1._id,
          note: 'Theft report filed with description.',
          timestamp: inc3Date
        }
      ]
    });

    console.log('[CampusShield Seed] Creating notifications and audit logs...');
    await Notification.create([
      {
        recipient: studentUser1._id,
        incident: inc1._id,
        type: 'responder_assigned',
        title: 'Security Unit Dispatched',
        message: 'BRAVO-PATROL has been dispatched to your location at Hostel Block C - North Walkway.',
        read: false
      },
      {
        recipient: studentUser2._id,
        incident: inc2._id,
        type: 'incident_resolved',
        title: 'Incident Resolved',
        message: 'Medical incident CS-2026-0002 has been marked as resolved.',
        read: true,
        readAt: new Date()
      }
    ]);

    await AuditLog.create([
      {
        actor: adminUser._id,
        actorName: adminUser.name,
        actorRole: 'admin',
        action: 'DATABASE_INITIALIZED',
        entityType: 'System',
        entityId: 'SYSTEM',
        metadata: { environment: 'development', college: 'Kongu Engineering College' },
        timestamp: new Date()
      }
    ]);

    console.log('[CampusShield Seed] Creating false alarm history and disciplinary cases...');

    // System setting for threshold
    await SystemSetting.create({
      key: 'falseAlarmThreshold',
      value: 3,
      description: 'Maximum permitted intentional false alarms before automated restriction',
      updatedBy: adminUser._id
    });

    // Student 2: Sangavi S (2 Confirmed False Alarms -> Warning Level 1)
    const incFA1 = await Incident.create({
      incidentId: 'CS-2026-0004',
      reporter: studentUser2._id,
      category: 'Medical emergency',
      description: 'Staged fainting stunt in Canteen.',
      severity: 'high',
      status: 'Resolved',
      location: { campusLocation: 'Food Court & Student Canteen' },
      reportedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000)
    });

    const incFA2 = await Incident.create({
      incidentId: 'CS-2026-0005',
      reporter: studentUser2._id,
      category: 'Theft',
      description: 'Falsely claimed textbook stolen from IT Park.',
      severity: 'medium',
      status: 'Resolved',
      location: { campusLocation: 'IT Park / Computer Block' },
      reportedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000)
    });

    const faRec1 = await FalseAlarmRecord.create({
      studentId: studentUser2._id,
      incidentId: 'CS-2026-0004',
      incidentObjectId: incFA1._id,
      classification: 'False Alarm — Intentional',
      investigationNotes: 'Security CCTV verified intentional prank video recording.',
      evidenceReferences: 'CCTV footage CAM-04 clip archived.',
      verifiedBy: secUser1._id,
      verifierName: secUser1.name,
      verifierRole: 'security',
      verifiedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000)
    });

    const faRec2 = await FalseAlarmRecord.create({
      studentId: studentUser2._id,
      incidentId: 'CS-2026-0005',
      incidentObjectId: incFA2._id,
      classification: 'False Alarm — Intentional',
      investigationNotes: 'Book was located in student locker. Deliberate misreport confirmed.',
      evidenceReferences: 'Locker search report signed by proctor.',
      verifiedBy: secUser2._id,
      verifierName: secUser2.name,
      verifierRole: 'security',
      verifiedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000)
    });

    await StudentSafetyStatus.create({
      studentId: studentUser2._id,
      confirmedIntentionalFalseAlarmCount: 2,
      warningLevel: 'warning_level_1',
      sosAccessStatus: 'active'
    });

    // Student 3: Karthik R (4 Confirmed False Alarms -> Restricted & Active Disciplinary Case)
    const karthikIncidents = [];
    const karthikRecords = [];
    const karthikReasons = [
      'Deliberately triggered fire alert in mechanical lab without hazard.',
      'Reported intruder in hostel block during proctorial round as distraction.',
      'False medical emergency reported during mid-semester examination.',
      'Deliberate prank call claiming gas leak in chemistry block.'
    ];

    for (let i = 0; i < 4; i++) {
      const inc = await Incident.create({
        incidentId: `CS-2026-00${10 + i}`,
        reporter: studentUser3._id,
        category: 'Fire',
        description: `False report ${i + 1}`,
        severity: 'critical',
        status: 'Resolved',
        location: { campusLocation: 'Mechanical Sciences Block' },
        reportedAt: new Date(Date.now() - (10 - i * 2) * 24 * 3600 * 1000)
      });
      karthikIncidents.push(inc);

      const rec = await FalseAlarmRecord.create({
        studentId: studentUser3._id,
        incidentId: inc.incidentId,
        incidentObjectId: inc._id,
        classification: 'False Alarm — Intentional',
        investigationNotes: karthikReasons[i],
        evidenceReferences: `Security Incident Dossier Ref #${100 + i}`,
        verifiedBy: secUser1._id,
        verifierName: secUser1.name,
        verifierRole: 'security',
        verifiedAt: new Date(Date.now() - (10 - i * 2) * 24 * 3600 * 1000)
      });
      karthikRecords.push(rec);
    }

    await StudentSafetyStatus.create({
      studentId: studentUser3._id,
      confirmedIntentionalFalseAlarmCount: 4,
      warningLevel: 'restricted',
      sosAccessStatus: 'restricted',
      restrictionReason: 'Exceeded maximum permitted intentional false alarms (threshold of 3). Automated restriction applied.',
      restrictedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000)
    });

    await DisciplinaryCase.create({
      caseId: 'DC-2026-0001-4421',
      studentId: studentUser3._id,
      linkedIncidentIds: karthikIncidents.map((k) => k.incidentId),
      linkedFalseAlarmRecordIds: karthikRecords.map((k) => k._id),
      caseStatus: 'Meeting Scheduled',
      meetingDate: new Date(Date.now() + 2 * 24 * 3600 * 1000),
      meetingLocation: 'Campus Disciplinary Committee Chamber (Admin Block 204)',
      committeeNotes: 'Student accumulated 4 confirmed intentional false alarms. Formal hearing scheduled with HOD & Chief Warden.',
      studentResponse: 'I am deeply apologetic for my actions and was not aware of the strict consequences.'
    });

    // Student 4: Praveen M (1 Accidental False Alarm -> Normal Active)
    const incFAAcc = await Incident.create({
      incidentId: 'CS-2026-0020',
      reporter: studentUser4._id,
      category: 'Accident',
      description: 'SOS triggered when phone dropped on sports turf.',
      severity: 'medium',
      status: 'Resolved',
      location: { campusLocation: 'Sports Complex & Athletic Ground' },
      reportedAt: new Date(Date.now() - 1 * 24 * 3600 * 1000)
    });

    await FalseAlarmRecord.create({
      studentId: studentUser4._id,
      incidentId: incFAAcc.incidentId,
      incidentObjectId: incFAAcc._id,
      classification: 'False Alarm — Accidental',
      investigationNotes: 'Physical drop triggered hardware panic button. Unintentional.',
      verifiedBy: secUser1._id,
      verifierName: secUser1.name,
      verifierRole: 'security',
      verifiedAt: new Date(Date.now() - 1 * 24 * 3600 * 1000)
    });

    await StudentSafetyStatus.create({
      studentId: studentUser4._id,
      confirmedIntentionalFalseAlarmCount: 0,
      warningLevel: 'none',
      sosAccessStatus: 'active'
    });

    console.log('\n=============================================================');
    console.log('  🛡️  CampusShield Seed Database Completed Successfully!');
    console.log('=============================================================');
    console.log('  Default Password for all accounts:  Password@123');
    console.log('-------------------------------------------------------------');
    console.log('  1. Administrator Account: admin@campusshield.kec.edu');
    console.log('  2. Security Personnel:    security.raman@campusshield.kec.edu');
    console.log('  3. Student Account:       sumanth@kongu.edu');
    console.log('=============================================================\n');

    return true;
  } catch (error) {
    console.error('[CampusShield Seed Error]:', error);
    throw error;
  }
};

export { seedDatabase };
export const seedDatabaseData = seedDatabase;

// Run directly from CLI
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('seed.js')) {
  seedDatabase().then(async () => {
    await mongoose.connection.close();
    process.exit(0);
  }).catch(() => {
    process.exit(1);
  });
}

