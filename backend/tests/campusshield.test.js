import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../app.js';
import { User } from '../models/User.js';
import { Incident } from '../models/Incident.js';
import { Responder } from '../models/Responder.js';
import { Notification } from '../models/Notification.js';

let mongoServer;
let studentToken;
let studentUser;
let securityToken;
let securityUser;
let adminToken;
let adminUser;
let testResponder;
let createdIncidentId;
let createdIncidentMongoId;

describe('CampusShield Automated Verification Suite (Tests 1-15)', () => {
  before(async () => {
    process.env.NODE_ENV = 'test';
    try {
      mongoServer = await MongoMemoryServer.create();
      const uri = mongoServer.getUri();
      await mongoose.connect(uri);
    } catch (err) {
      console.warn('MongoMemoryServer fallback to local DB:', err.message);
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/campusshield_test');
    }

    // Clear test database
    await User.deleteMany({});
    await Incident.deleteMany({});
    await Responder.deleteMany({});
    await Notification.deleteMany({});

    // Seed Security & Admin users for subsequent test steps
    const passHash = await User.hashPassword('Password@123');

    adminUser = await User.create({
      name: 'System Admin',
      email: 'admin.test@kec.edu',
      passwordHash: passHash,
      role: 'admin',
      identifier: 'ADM-01',
      accountStatus: 'active'
    });

    securityUser = await User.create({
      name: 'Officer Test',
      email: 'security.test@kec.edu',
      passwordHash: passHash,
      role: 'security',
      identifier: 'SEC-01',
      accountStatus: 'active'
    });

    testResponder = await Responder.create({
      user: securityUser._id,
      badgeNumber: 'QRF-TEST-01',
      callSign: 'ALPHA-TEST',
      team: 'Quick Reaction Force',
      availabilityStatus: 'available'
    });

    // Obtain security and admin tokens via login API
    const secLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'security.test@kec.edu', password: 'Password@123' });
    securityToken = secLogin.body.token;

    const admLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin.test@kec.edu', password: 'Password@123' });
    adminToken = admLogin.body.token;
  });

  after(async () => {
    await mongoose.connection.close();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  test('Test 1: A student registers and signs in', async () => {
    // Registration
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Sumanth S',
        email: 'sumanth.test@kongu.edu',
        password: 'Password@123',
        identifier: '25ITR146',
        department: 'Information Technology',
        role: 'student'
      });

    assert.equal(regRes.status, 201);
    assert.equal(regRes.body.success, true);
    assert.equal(regRes.body.user.role, 'student');
    assert.ok(regRes.body.token);

    // Login
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'sumanth.test@kongu.edu',
        password: 'Password@123'
      });

    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.body.success, true);
    assert.ok(loginRes.body.token);
    assert.equal(loginRes.body.user.email, 'sumanth.test@kongu.edu');

    studentToken = loginRes.body.token;
    studentUser = loginRes.body.user;
  });

  test('Test 2: A student submits an SOS report', async () => {
    const sosRes = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        category: 'Medical emergency',
        description: 'Student fell unconscious near IT Park 2nd floor lab.',
        severity: 'critical',
        campusLocation: 'IT Park - 2nd Floor Corridor',
        latitude: 11.2745,
        longitude: 77.6065,
        accuracy: 10
      });

    assert.equal(sosRes.status, 201);
    assert.equal(sosRes.body.success, true);
    assert.ok(sosRes.body.incident);
    assert.equal(sosRes.body.incident.status, 'Submitted');
    assert.equal(sosRes.body.incident.category, 'Medical emergency');
    assert.equal(sosRes.body.incident.severity, 'critical');

    createdIncidentId = sosRes.body.incident.incidentId;
    createdIncidentMongoId = sosRes.body.incident._id;
  });

  test('Test 3: The incident receives a unique ID and is persisted in MongoDB', async () => {
    assert.ok(createdIncidentId.startsWith('CS-'), 'Incident ID must begin with CS-');
    
    const dbIncident = await Incident.findOne({ incidentId: createdIncidentId });
    assert.ok(dbIncident, 'Incident must be found in MongoDB');
    assert.equal(dbIncident.status, 'Submitted');
    assert.equal(dbIncident.location.campusLocation, 'IT Park - 2nd Floor Corridor');
    assert.equal(dbIncident.location.latitude, 11.2745);
  });

  test('Test 4: Authorized security personnel see the incident in the queue', async () => {
    const secRes = await request(app)
      .get('/api/incidents')
      .set('Authorization', `Bearer ${securityToken}`);

    assert.equal(secRes.status, 200);
    assert.equal(secRes.body.success, true);
    const found = secRes.body.incidents.find((i) => i.incidentId === createdIncidentId);
    assert.ok(found, 'Security personnel queue must contain the reported incident');
    assert.equal(found.status, 'Submitted');
  });

  test('Test 5: Security acknowledges the incident', async () => {
    const ackRes = await request(app)
      .patch(`/api/incidents/${createdIncidentId}/status`)
      .set('Authorization', `Bearer ${securityToken}`)
      .send({
        status: 'Acknowledged',
        note: 'Officer Test acknowledged SOS via control room.'
      });

    assert.equal(ackRes.status, 200);
    assert.equal(ackRes.body.success, true);
    assert.equal(ackRes.body.incident.status, 'Acknowledged');
    assert.ok(ackRes.body.incident.acknowledgedAt);
  });

  test('Test 6: Security assigns an available responder', async () => {
    const assignRes = await request(app)
      .patch(`/api/incidents/${createdIncidentId}/assign`)
      .set('Authorization', `Bearer ${securityToken}`)
      .send({
        responderId: testResponder._id,
        dispatchImmediately: true,
        note: 'Dispatched ALPHA-TEST unit.'
      });

    assert.equal(assignRes.status, 200);
    assert.equal(assignRes.body.success, true);
    assert.equal(assignRes.body.incident.status, 'Dispatched');
    assert.ok(assignRes.body.incident.assignedResponder);
  });

  test('Test 7: The incident status history records every lifecycle change', async () => {
    const detailRes = await request(app)
      .get(`/api/incidents/${createdIncidentId}`)
      .set('Authorization', `Bearer ${securityToken}`);

    assert.equal(detailRes.status, 200);
    const history = detailRes.body.incident.statusHistory;
    assert.ok(history.length >= 3, 'Must have at least Submitted, Acknowledged, Dispatched in history');
    assert.equal(history[0].status, 'Submitted');
    assert.equal(history[1].status, 'Acknowledged');
    assert.equal(history[2].status, 'Dispatched');
  });

  test('Test 8: The reporter receives permitted in-app updates and notifications', async () => {
    const notifRes = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${studentToken}`);

    assert.equal(notifRes.status, 200);
    assert.ok(notifRes.body.notifications.length > 0);
    const relevantNotif = notifRes.body.notifications.find(
      (n) => n.incident && (n.incident.incidentId === createdIncidentId || String(n.incident._id) === String(createdIncidentMongoId))
    );
    assert.ok(relevantNotif, 'Reporter must receive notifications for their emergency');
  });

  test('Test 9: Security resolves the incident', async () => {
    const resolveRes = await request(app)
      .patch(`/api/incidents/${createdIncidentId}/status`)
      .set('Authorization', `Bearer ${securityToken}`)
      .send({
        status: 'Resolved',
        note: 'First aid rendered. Patient stable.',
        resolutionNotes: 'Medical assistance provided within 4 minutes. Situation normalized.'
      });

    assert.equal(resolveRes.status, 200);
    assert.equal(resolveRes.body.incident.status, 'Resolved');
    assert.ok(resolveRes.body.incident.resolvedAt);
    assert.equal(resolveRes.body.incident.resolutionNotes, 'Medical assistance provided within 4 minutes. Situation normalized.');
  });

  test('Test 10: The resolved incident remains available in historical records', async () => {
    const historyRes = await request(app)
      .get('/api/incidents?status=Resolved')
      .set('Authorization', `Bearer ${securityToken}`);

    assert.equal(historyRes.status, 200);
    const resolvedItem = historyRes.body.incidents.find((i) => i.incidentId === createdIncidentId);
    assert.ok(resolvedItem, 'Resolved incident must be present in history filter');
    assert.equal(resolvedItem.status, 'Resolved');
  });

  test('Test 11: Unauthorized users cannot access restricted records or administrative endpoints', async () => {
    // Student attempts to access admin user management
    const adminAccessRes = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${studentToken}`);

    assert.equal(adminAccessRes.status, 403, 'Student must be forbidden from accessing admin users');

    // Student attempts to access admin audit logs
    const auditRes = await request(app)
      .get('/api/admin/audit-logs')
      .set('Authorization', `Bearer ${studentToken}`);

    assert.equal(auditRes.status, 403, 'Student must be forbidden from accessing audit logs');

    // Self-service admin privilege escalation attempt during registration
    const exploitReg = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Hacker',
        email: 'attacker@evil.com',
        password: 'Password@123',
        role: 'admin'
      });

    assert.equal(exploitReg.status, 403, 'Public self-service admin registration must be blocked');
  });

  test('Test 12: Invalid requests and validation errors produce meaningful error responses', async () => {
    // Missing category
    const badSos = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        description: 'No category provided'
      });

    assert.equal(badSos.status, 400);
    assert.equal(badSos.body.success, false);
    assert.ok(badSos.body.message.includes('category'));

    // Invalid coordinates
    const badCoord = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        category: 'Accident',
        latitude: 999
      });

    assert.equal(badCoord.status, 400);
    assert.equal(badCoord.body.success, false);
  });

  test('Test 13: Dashboard metrics are derived from actual stored database records', async () => {
    const dashRes = await request(app)
      .get('/api/dashboard/summary')
      .set('Authorization', `Bearer ${securityToken}`);

    assert.equal(dashRes.status, 200);
    assert.equal(dashRes.body.success, true);
    assert.ok(dashRes.body.summary.totalIncidents >= 1);
    assert.ok(typeof dashRes.body.summary.avgResponseTimeMinutes === 'number');
    assert.ok(dashRes.body.summary.fleet.total >= 1);
  });

  test('Test 14: Safe Walk workflow functions properly', async () => {
    const walkStart = await request(app)
      .post('/api/safewalk/start')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        startLocation: 'Library Quadrangle',
        destination: 'Hostel Block C'
      });

    assert.equal(walkStart.status, 201);
    assert.equal(walkStart.body.session.status, 'active');

    const walkEnd = await request(app)
      .patch(`/api/safewalk/${walkStart.body.session._id}/end`)
      .set('Authorization', `Bearer ${studentToken}`);

    assert.equal(walkEnd.status, 200);
    assert.equal(walkEnd.body.session.status, 'completed');
  });

  test('Test 15: Public Health Check reports real system and database status', async () => {
    const healthRes = await request(app).get('/api/health');

    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.body.status, 'ok');
    assert.equal(healthRes.body.dbConnected, true);
    assert.ok(healthRes.body.institution.includes('Kongu Engineering College'));
  });
});
