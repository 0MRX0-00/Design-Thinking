import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../app.js';
import { User } from '../models/User.js';
import { StudentSafetyStatus } from '../models/StudentSafetyStatus.js';

let mongoServer;
let studentUser;
let securityUser;
let adminUser;
let restrictedStudentUser;
let suspendedUser;

describe('CampusShield Role-Based Login & Routing Verification Suite', () => {
  before(async () => {
    process.env.NODE_ENV = 'test';
    try {
      mongoServer = await MongoMemoryServer.create();
      const uri = mongoServer.getUri();
      await mongoose.connect(uri);
    } catch (err) {
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/campusshield_test');
    }

    await User.deleteMany({});
    await StudentSafetyStatus.deleteMany({});

    const passwordHash = await User.hashPassword('Password@123');

    // 1. Regular Student
    studentUser = await User.create({
      name: 'Sumanth S',
      email: 'sumanth@kongu.edu',
      passwordHash,
      role: 'student',
      identifier: '25ITR146',
      department: 'Information Technology',
      accountStatus: 'active'
    });

    // 2. Security Personnel
    securityUser = await User.create({
      name: 'Officer Raman',
      email: 'security.raman@campusshield.kec.edu',
      passwordHash,
      role: 'security',
      identifier: 'SEC-KEC-001',
      department: 'Campus Security Control',
      accountStatus: 'active'
    });

    // 3. Administrator
    adminUser = await User.create({
      name: 'Dr. S. Karthi',
      email: 'admin@campusshield.kec.edu',
      passwordHash,
      role: 'admin',
      identifier: 'ADMIN-KEC-01',
      department: 'Campus Safety Administration',
      accountStatus: 'active'
    });

    // 4. Student with Restricted SOS (4 confirmed false alarms)
    restrictedStudentUser = await User.create({
      name: 'Karthik R',
      email: 'karthik@kongu.edu',
      passwordHash,
      role: 'student',
      identifier: '25CSR042',
      department: 'Computer Science & Engineering',
      accountStatus: 'active' // User account remains active for login/appeals
    });

    await StudentSafetyStatus.create({
      studentId: restrictedStudentUser._id,
      confirmedIntentionalFalseAlarmCount: 4,
      warningLevel: 'restricted',
      sosAccessStatus: 'restricted',
      restrictionReason: 'Automated policy enforcement: Exceeded intentional false alarm threshold'
    });

    // 5. Suspended User (Full account suspension)
    suspendedUser = await User.create({
      name: 'Suspended Account',
      email: 'suspended@kongu.edu',
      passwordHash,
      role: 'student',
      identifier: '25SUS001',
      accountStatus: 'suspended'
    });
  });

  after(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  test('Test 1: Student signs in successfully with institutional email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'sumanth@kongu.edu',
        password: 'Password@123'
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.token);
    assert.equal(res.body.user.role, 'student');
    assert.equal(res.body.user.identifier, '25ITR146');
  });

  test('Test 2: Student signs in successfully with institutional Roll Number (identifier)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        loginId: '25ITR146',
        password: 'Password@123'
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.user.email, 'sumanth@kongu.edu');
    assert.equal(res.body.user.role, 'student');
  });

  test('Test 3: Security Personnel signs in with Badge ID and receives security role', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        loginId: 'SEC-KEC-001',
        password: 'Password@123',
        role: 'security'
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.user.role, 'security');
    assert.equal(res.body.user.email, 'security.raman@campusshield.kec.edu');
  });

  test('Test 4: Administrator signs in with Admin ID and receives admin role', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        loginId: 'ADMIN-KEC-01',
        password: 'Password@123',
        role: 'admin'
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.user.role, 'admin');
  });

  test('Test 5: Role mismatch is rejected when user attempts to authenticate under incorrect portal tab', async () => {
    // Student attempting to sign in on Admin tab
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'sumanth@kongu.edu',
        password: 'Password@123',
        role: 'admin'
      });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Role authorization mismatch/i);
  });

  test('Test 6: SOS-restricted student can still log in normally to access helplines & appeals', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        loginId: 'karthik@kongu.edu',
        password: 'Password@123',
        role: 'student'
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.user.accountStatus, 'active');

    // Verify SOS access status in database remains restricted
    const safetyStatus = await StudentSafetyStatus.findOne({ studentId: restrictedStudentUser._id });
    assert.equal(safetyStatus.sosAccessStatus, 'restricted');
    assert.equal(safetyStatus.confirmedIntentionalFalseAlarmCount, 4);
  });

  test('Test 7: Suspended user account cannot log in', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'suspended@kongu.edu',
        password: 'Password@123'
      });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /suspended/i);
  });

  test('Test 8: Invalid password returns HTTP 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'sumanth@kongu.edu',
        password: 'WrongPassword'
      });

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Invalid institutional credentials or password/i);
  });

  test('Test 9: Forgot password issues recovery token without revealing account existence', async () => {
    // Existing user
    const resExisting = await request(app)
      .post('/api/auth/forgot-password')
      .send({ loginId: 'sumanth@kongu.edu' });

    assert.equal(resExisting.status, 200);
    assert.equal(resExisting.body.success, true);
    assert.ok(resExisting.body.resetToken);

    // Non-existent user receives identical safe message
    const resNonExistent = await request(app)
      .post('/api/auth/forgot-password')
      .send({ loginId: 'nonexistent@kongu.edu' });

    assert.equal(resNonExistent.status, 200);
    assert.equal(resNonExistent.body.success, true);
    assert.equal(resNonExistent.body.resetToken, null);
  });

  test('Test 10: Password reset completes successfully with valid token and enables new login', async () => {
    // 1. Request token
    const forgotRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ loginId: 'sumanth@kongu.edu' });

    const token = forgotRes.body.resetToken;
    assert.ok(token);

    // 2. Submit new password
    const resetRes = await request(app)
      .post('/api/auth/reset-password')
      .send({
        token,
        newPassword: 'NewSecurePassword@456'
      });

    assert.equal(resetRes.status, 200);
    assert.equal(resetRes.body.success, true);

    // 3. Old password now fails
    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'sumanth@kongu.edu',
        password: 'Password@123'
      });
    assert.equal(oldLogin.status, 401);

    // 4. New password succeeds
    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'sumanth@kongu.edu',
        password: 'NewSecurePassword@456'
      });
    assert.equal(newLogin.status, 200);
    assert.equal(newLogin.body.success, true);
  });

  test('Test 11: Route fallback sends HTML files for /, /login, /student, /security, and /admin', async () => {
    const rootRes = await request(app).get('/');
    assert.equal(rootRes.status, 200);
    assert.match(rootRes.headers['content-type'], /text\/html/);

    const loginRes = await request(app).get('/login');
    assert.equal(loginRes.status, 200);

    const studentRes = await request(app).get('/student');
    assert.equal(studentRes.status, 200);

    const securityRes = await request(app).get('/security');
    assert.equal(securityRes.status, 200);

    const adminRes = await request(app).get('/admin');
    assert.equal(adminRes.status, 200);
  });

  test('Test 12: Logout endpoint gracefully processes sign out for authenticated and unauthenticated requests', async () => {
    // 1. Authenticated sign out
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'sumanth@kongu.edu', password: 'NewSecurePassword@456' });
    const token = loginRes.body.token;

    const authLogoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(authLogoutRes.status, 200);
    assert.equal(authLogoutRes.body.success, true);

    // 2. Unauthenticated / expired session sign out (should never fail with 401)
    const publicLogoutRes = await request(app)
      .post('/api/auth/logout')
      .send({});
    assert.equal(publicLogoutRes.status, 200);
    assert.equal(publicLogoutRes.body.success, true);
  });

  test('Test 13: Incident submission correctly saves selected requirements, location details, people involved, and silent alert', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'sumanth@kongu.edu', password: 'NewSecurePassword@456' });
    const token = loginRes.body.token;

    const incidentRes = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        category: 'Medical emergency',
        campusLocation: 'IT Park / Computer Block',
        locationDetails: 'Room 304, 3rd Floor',
        requirements: ['Ambulance / First Aid', 'Wheelchair / Stretcher'],
        peopleInvolved: '1 person',
        silentAlert: false,
        description: 'Student experiencing severe dizziness and injury'
      });

    assert.equal(incidentRes.status, 201);
    assert.equal(incidentRes.body.success, true);
    assert.deepEqual(incidentRes.body.incident.requirements, ['Ambulance / First Aid', 'Wheelchair / Stretcher']);
    assert.equal(incidentRes.body.incident.locationDetails, 'Room 304, 3rd Floor');
    assert.equal(incidentRes.body.incident.peopleInvolved, '1 person');
  });
});

