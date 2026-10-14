import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../app.js';
import { User } from '../models/User.js';
import { Incident } from '../models/Incident.js';
import { FalseAlarmRecord } from '../models/FalseAlarmRecord.js';
import { StudentSafetyStatus } from '../models/StudentSafetyStatus.js';
import { DisciplinaryCase } from '../models/DisciplinaryCase.js';
import { SystemSetting } from '../models/SystemSetting.js';
import { Notification } from '../models/Notification.js';
import { AuditLog } from '../models/AuditLog.js';

let mongoServer;
let studentToken;
let studentUser;
let repeatStudentToken;
let repeatStudentUser;
let securityToken;
let securityUser;
let adminToken;
let adminUser;

describe('CampusShield False Alarm & Disciplinary Management Verification Suite', () => {
  before(async () => {
    process.env.NODE_ENV = 'test';
    try {
      mongoServer = await MongoMemoryServer.create();
      const uri = mongoServer.getUri();
      await mongoose.connect(uri);
    } catch (err) {
      console.warn('MongoMemoryServer fallback to local test DB:', err.message);
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/campusshield_test_fa');
    }

    // Clear collections
    await User.deleteMany({});
    await Incident.deleteMany({});
    await FalseAlarmRecord.deleteMany({});
    await StudentSafetyStatus.deleteMany({});
    await DisciplinaryCase.deleteMany({});
    await SystemSetting.deleteMany({});
    await Notification.deleteMany({});
    await AuditLog.deleteMany({});

    const passHash = await User.hashPassword('Password@123');

    // 1. Admin
    adminUser = await User.create({
      name: 'Safety Dean Dr. Karthi',
      email: 'dean.admin@kec.edu',
      passwordHash: passHash,
      role: 'admin',
      identifier: 'ADM-FA-01',
      accountStatus: 'active'
    });

    // 2. Security Personnel
    securityUser = await User.create({
      name: 'Officer Raman',
      email: 'officer.raman@kec.edu',
      passwordHash: passHash,
      role: 'security',
      identifier: 'SEC-FA-01',
      accountStatus: 'active'
    });

    // 3. Regular Student 1
    studentUser = await User.create({
      name: 'Anand Kumar',
      email: 'anand.k@kongu.edu',
      passwordHash: passHash,
      role: 'student',
      identifier: '25ITR001',
      department: 'Information Technology',
      accountStatus: 'active'
    });

    // 4. Repeat Student 2 (for multi-threshold testing)
    repeatStudentUser = await User.create({
      name: 'Kavitha R',
      email: 'kavitha.r@kongu.edu',
      passwordHash: passHash,
      role: 'student',
      identifier: '25ITR099',
      department: 'Computer Science',
      accountStatus: 'active'
    });

    // Generate tokens
    const [admRes, secRes, stuRes, repRes] = await Promise.all([
      request(app).post('/api/auth/login').send({ email: 'dean.admin@kec.edu', password: 'Password@123' }),
      request(app).post('/api/auth/login').send({ email: 'officer.raman@kec.edu', password: 'Password@123' }),
      request(app).post('/api/auth/login').send({ email: 'anand.k@kongu.edu', password: 'Password@123' }),
      request(app).post('/api/auth/login').send({ email: 'kavitha.r@kongu.edu', password: 'Password@123' })
    ]);

    adminToken = admRes.body.token;
    securityToken = secRes.body.token;
    studentToken = stuRes.body.token;
    repeatStudentToken = repRes.body.token;
  });

  after(async () => {
    await mongoose.connection.close();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  test('Test 1: Genuine emergency classification does not increase false alarm count', async () => {
    // Student creates an emergency incident
    const incRes = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        category: 'Medical emergency',
        campusLocation: 'Central Library',
        description: 'Student experiencing severe dizziness and fainting.'
      });

    assert.equal(incRes.status, 201);
    const incidentId = incRes.body.incident.incidentId;

    // Security verifies incident as Genuine Emergency
    const verifyRes = await request(app)
      .post('/api/false-alarms/verify')
      .set('Authorization', `Bearer ${securityToken}`)
      .send({
        incidentId,
        classification: 'Genuine Emergency',
        investigationNotes: 'Ambulance called, medical team administered first aid.'
      });

    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.body.record.classification, 'Genuine Emergency');
    assert.equal(verifyRes.body.safetyStatus.confirmedIntentionalFalseAlarmCount, 0);
    assert.equal(verifyRes.body.safetyStatus.sosAccessStatus, 'active');
  });

  test('Test 2: Accidental SOS trigger does not increase intentional false alarm count', async () => {
    const incRes = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        category: 'Other',
        campusLocation: 'Food Court',
        description: 'Phone pocket dialled SOS.'
      });

    assert.equal(incRes.status, 201);
    const incidentId = incRes.body.incident.incidentId;

    const verifyRes = await request(app)
      .post('/api/false-alarms/verify')
      .set('Authorization', `Bearer ${securityToken}`)
      .send({
        incidentId,
        classification: 'False Alarm — Accidental',
        investigationNotes: 'Student demonstrated phone screen tapped accidentally while in backpack.'
      });

    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.body.record.classification, 'False Alarm — Accidental');
    assert.equal(verifyRes.body.safetyStatus.confirmedIntentionalFalseAlarmCount, 0);
    assert.equal(verifyRes.body.safetyStatus.sosAccessStatus, 'active');
  });

  test('Test 3: Unverified or disputed classification (Under Investigation) does not penalize student', async () => {
    const incRes = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        category: 'Suspicious activity',
        campusLocation: 'Hostel Gate',
        description: 'Unidentified shadow reported.'
      });

    assert.equal(incRes.status, 201);
    const incidentId = incRes.body.incident.incidentId;

    const verifyRes = await request(app)
      .post('/api/false-alarms/verify')
      .set('Authorization', `Bearer ${securityToken}`)
      .send({
        incidentId,
        classification: 'Under Investigation',
        investigationNotes: 'CCTV footage pending review by surveillance operator.'
      });

    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.body.record.classification, 'Under Investigation');
    assert.equal(verifyRes.body.safetyStatus.confirmedIntentionalFalseAlarmCount, 0);
  });

  test('Test 4: Intentional false alarms progression triggers warnings at 2 and 3 confirmed cases', async () => {
    // 1st Intentional False Alarm for Repeat Student
    const inc1 = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${repeatStudentToken}`)
      .send({ category: 'Fire', campusLocation: 'Mech Block', description: 'Prank smoke alarm' });
    assert.equal(inc1.status, 201);

    const v1 = await request(app)
      .post('/api/false-alarms/verify')
      .set('Authorization', `Bearer ${securityToken}`)
      .send({
        incidentId: inc1.body.incident.incidentId,
        classification: 'False Alarm — Intentional',
        investigationNotes: 'Deliberate false report admitted during officer questioning.'
      });
    assert.equal(v1.status, 200);
    assert.equal(v1.body.safetyStatus.confirmedIntentionalFalseAlarmCount, 1);
    assert.equal(v1.body.safetyStatus.warningLevel, 'none');

    // 2nd Intentional False Alarm -> Warning Level 1
    const inc2 = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${repeatStudentToken}`)
      .send({ category: 'Theft', campusLocation: 'Library', description: 'Fake stolen laptop' });
    assert.equal(inc2.status, 201);

    const v2 = await request(app)
      .post('/api/false-alarms/verify')
      .set('Authorization', `Bearer ${securityToken}`)
      .send({
        incidentId: inc2.body.incident.incidentId,
        classification: 'False Alarm — Intentional',
        investigationNotes: 'Student staged theft as joke.'
      });
    assert.equal(v2.status, 200);
    assert.equal(v2.body.safetyStatus.confirmedIntentionalFalseAlarmCount, 2);
    assert.equal(v2.body.safetyStatus.warningLevel, 'warning_level_1');

    // Check warning notification was generated for student
    const notifs2 = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${repeatStudentToken}`);
    const warn1Notif = notifs2.body.notifications.find((n) => n.type === 'false_alarm_warning');
    assert.ok(warn1Notif, 'Warning level 1 notification should be received');

    // 3rd Intentional False Alarm -> Final Warning
    const inc3 = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${repeatStudentToken}`)
      .send({ category: 'Accident', campusLocation: 'Quad', description: 'Staged bicycle collision' });
    assert.equal(inc3.status, 201);

    const v3 = await request(app)
      .post('/api/false-alarms/verify')
      .set('Authorization', `Bearer ${securityToken}`)
      .send({
        incidentId: inc3.body.incident.incidentId,
        classification: 'False Alarm — Intentional',
        investigationNotes: 'Third intentional fake incident confirmed by ground security patrol.'
      });
    assert.equal(v3.status, 200);
    assert.equal(v3.body.safetyStatus.confirmedIntentionalFalseAlarmCount, 3);
    assert.equal(v3.body.safetyStatus.warningLevel, 'final_warning');
    assert.equal(v3.body.safetyStatus.sosAccessStatus, 'active', 'Privileges should remain active until threshold is exceeded');
  });

  test('Test 5: Four confirmed false alarms automatically restricts SOS privileges and creates Disciplinary Case', async () => {
    // 4th Intentional False Alarm (> threshold of 3)
    const inc4 = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${repeatStudentToken}`)
      .send({ category: 'Harassment or personal safety concern', campusLocation: 'Hostel C', description: 'Fourth false report' });
    assert.equal(inc4.status, 201);

    const v4 = await request(app)
      .post('/api/false-alarms/verify')
      .set('Authorization', `Bearer ${securityToken}`)
      .send({
        incidentId: inc4.body.incident.incidentId,
        classification: 'False Alarm — Intentional',
        investigationNotes: 'Fourth intentional false alarm verified. Disciplinary threshold breached.'
      });

    assert.equal(v4.status, 200);
    assert.equal(v4.body.safetyStatus.confirmedIntentionalFalseAlarmCount, 4);
    assert.equal(v4.body.safetyStatus.sosAccessStatus, 'restricted');
    assert.equal(v4.body.safetyStatus.warningLevel, 'restricted');

    // Verify Disciplinary Case was created and linked to incidents
    assert.ok(v4.body.disciplinaryCase, 'Disciplinary case must be automatically created');
    assert.ok(v4.body.disciplinaryCase.caseId.startsWith('DC-'));
    assert.equal(v4.body.disciplinaryCase.caseStatus, 'Case Created');
    assert.equal(v4.body.disciplinaryCase.linkedIncidentIds.length, 4);

    // Verify notification was sent to student
    const notifs = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${repeatStudentToken}`);
    const restNotif = notifs.body.notifications.find((n) => n.type === 'false_alarm_restricted');
    assert.ok(restNotif, 'Restricted notification must be present in student inbox');
  });

  test('Test 6: Restricted student is blocked from submitting SOS alerts but receives alternative emergency helplines', async () => {
    const blockedRes = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${repeatStudentToken}`)
      .send({
        category: 'Medical emergency',
        campusLocation: 'Auditorium',
        description: 'New alert attempt while restricted'
      });

    assert.equal(blockedRes.status, 403);
    assert.equal(blockedRes.body.success, false);
    assert.equal(blockedRes.body.restricted, true);
    assert.ok(blockedRes.body.message.includes('restricted'));
    assert.ok(blockedRes.body.alternativeEmergencyContacts, 'Alternative emergency contacts must be provided');
    assert.ok(blockedRes.body.alternativeEmergencyContacts.length > 0);
  });

  test('Test 7: Duplicate verification updates existing record without double-counting', async () => {
    // Re-verify incident 4 with updated notes
    const priorCount = (await StudentSafetyStatus.findOne({ studentId: repeatStudentUser._id })).confirmedIntentionalFalseAlarmCount;

    const reVerifyRes = await request(app)
      .post('/api/false-alarms/verify')
      .set('Authorization', `Bearer ${securityToken}`)
      .send({
        incidentId: (await FalseAlarmRecord.findOne({ studentId: repeatStudentUser._id })).incidentId,
        classification: 'False Alarm — Intentional',
        investigationNotes: 'Amended investigation notes with supervisor review.'
      });

    assert.equal(reVerifyRes.status, 200);
    assert.equal(reVerifyRes.body.safetyStatus.confirmedIntentionalFalseAlarmCount, priorCount, 'Count must not increase upon re-verification');
  });

  test('Test 8: Unauthorized users cannot verify false alarms, restore access, or change threshold', async () => {
    // Student tries to verify an incident
    const unauthorizedVerify = await request(app)
      .post('/api/false-alarms/verify')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        incidentId: 'CS-2026-0001-9999',
        classification: 'Genuine Emergency',
        investigationNotes: 'Self classification'
      });
    assert.equal(unauthorizedVerify.status, 403);

    // Student tries to restore SOS access
    const unauthorizedRestore = await request(app)
      .post(`/api/false-alarms/restore-sos/${studentUser._id}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ reason: 'Self unblocking' });
    assert.equal(unauthorizedRestore.status, 403);

    // Security officer tries to change system threshold (Admin only)
    const unauthorizedThreshold = await request(app)
      .patch('/api/false-alarms/config')
      .set('Authorization', `Bearer ${securityToken}`)
      .send({ threshold: 5 });
    assert.equal(unauthorizedThreshold.status, 403);
  });

  test('Test 9: Administrative restoration of SOS privileges with required override reason', async () => {
    // Attempt restore without reason -> 400
    const failRestore = await request(app)
      .post(`/api/false-alarms/restore-sos/${repeatStudentUser._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: '   ' });
    assert.equal(failRestore.status, 400);

    // Valid restoration
    const validRestore = await request(app)
      .post(`/api/false-alarms/restore-sos/${repeatStudentUser._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Student completed mandatory counseling session and apologized in writing.' });

    assert.equal(validRestore.status, 200);
    assert.equal(validRestore.body.safetyStatus.sosAccessStatus, 'active');
    assert.ok(validRestore.body.safetyStatus.restoredAt);

    // Verify student can now submit emergency SOS again
    const restoredSos = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${repeatStudentToken}`)
      .send({
        category: 'Medical emergency',
        campusLocation: 'Sports Complex',
        description: 'Leg sprain during football practice.'
      });
    assert.equal(restoredSos.status, 201);
  });

  test('Test 10: Disciplinary case workflow, student representation, and final resolution', async () => {
    const studentCasesRes = await request(app)
      .get('/api/disciplinary-cases/my')
      .set('Authorization', `Bearer ${repeatStudentToken}`);

    assert.equal(studentCasesRes.status, 200);
    assert.ok(studentCasesRes.body.cases.length > 0);
    const caseId = studentCasesRes.body.cases[0].caseId;

    // Student submits appeal / explanation
    const appealRes = await request(app)
      .post(`/api/disciplinary-cases/${caseId}/appeal`)
      .set('Authorization', `Bearer ${repeatStudentToken}`)
      .send({
        explanation: 'I sincerely regret triggering false alarms. I promise to abide by all campus safety rules.'
      });
    assert.equal(appealRes.status, 200);
    assert.ok(appealRes.body.case.studentResponse.includes('sincerely regret'));

    // Admin schedules meeting
    const scheduleRes = await request(app)
      .patch(`/api/disciplinary-cases/${caseId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        caseStatus: 'Meeting Scheduled',
        meetingDate: new Date(Date.now() + 86400000).toISOString(),
        meetingLocation: 'Chamber 101'
      });
    assert.equal(scheduleRes.status, 200);
    assert.equal(scheduleRes.body.case.caseStatus, 'Meeting Scheduled');

    // Admin resolves case with decision
    const resolveCaseRes = await request(app)
      .patch(`/api/disciplinary-cases/${caseId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        caseStatus: 'Resolved',
        committeeNotes: 'Student appeared before committee with advisor.',
        finalDecision: 'Mandatory awareness session completed; Formal warning issued.'
      });
    assert.equal(resolveCaseRes.status, 200);
    assert.equal(resolveCaseRes.body.case.caseStatus, 'Resolved');
    assert.ok(resolveCaseRes.body.case.decisionDate);
  });

  test('Test 11: Concurrent verification requests do not cause incorrect counts', async () => {
    // Create 3 incidents for student 1
    const [i1, i2, i3] = await Promise.all([
      request(app).post('/api/incidents').set('Authorization', `Bearer ${studentToken}`).send({ category: 'Theft', campusLocation: 'Hostel' }),
      request(app).post('/api/incidents').set('Authorization', `Bearer ${studentToken}`).send({ category: 'Fire', campusLocation: 'Lab' }),
      request(app).post('/api/incidents').set('Authorization', `Bearer ${studentToken}`).send({ category: 'Accident', campusLocation: 'Gate' })
    ]);

    // Concurrently classify them as intentional false alarms
    await Promise.all([
      request(app).post('/api/false-alarms/verify').set('Authorization', `Bearer ${securityToken}`).send({
        incidentId: i1.body.incident.incidentId,
        classification: 'False Alarm — Intentional',
        investigationNotes: 'Concurrent test 1'
      }),
      request(app).post('/api/false-alarms/verify').set('Authorization', `Bearer ${securityToken}`).send({
        incidentId: i2.body.incident.incidentId,
        classification: 'False Alarm — Intentional',
        investigationNotes: 'Concurrent test 2'
      }),
      request(app).post('/api/false-alarms/verify').set('Authorization', `Bearer ${securityToken}`).send({
        incidentId: i3.body.incident.incidentId,
        classification: 'False Alarm — Intentional',
        investigationNotes: 'Concurrent test 3'
      })
    ]);

    // Student 1 had 0 intentional false alarms previously. Now must have exactly 3!
    const safetyRes = await request(app)
      .get('/api/false-alarms/status/me')
      .set('Authorization', `Bearer ${studentToken}`);

    assert.equal(safetyRes.status, 200);
    assert.equal(safetyRes.body.safetyStatus.confirmedIntentionalFalseAlarmCount, 3);
  });
});
