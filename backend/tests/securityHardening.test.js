import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../app.js';
import { User } from '../models/User.js';
import { Incident } from '../models/Incident.js';
import { generateToken } from '../middleware/auth.js';
import { seedDatabase } from '../scripts/seed.js';
import { seedCleanDatabase } from '../scripts/seedClean.js';

let mongoServer;
let studentUser;
let studentToken;

describe('CampusShield Security Hardening & Data Safety Verification Suite', () => {
  before(async () => {
    process.env.NODE_ENV = 'test';
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

    const passwordHash = await User.hashPassword('RealSecurePass@123');
    studentUser = await User.create({
      name: 'Hardened Test Student',
      email: 'hardened.student@kongu.edu',
      passwordHash,
      identifier: '22CS999',
      role: 'student',
      accountStatus: 'active'
    });
    studentToken = generateToken(studentUser);
  });

  after(async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.ALLOW_PRODUCTION_SEED;
    await mongoose.connection.close();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  test('Test S1: Production startup safety gate blocks seed.js from clearing database', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_PRODUCTION_SEED;

    await assert.rejects(
      async () => {
        await seedDatabase();
      },
      (err) => {
        assert.ok(err.message.includes('Seeding is blocked in production'));
        return true;
      }
    );

    process.env.NODE_ENV = originalEnv;
  });

  test('Test S2: Production startup safety gate blocks seedClean.js from clearing database', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_PRODUCTION_SEED;

    await assert.rejects(
      async () => {
        await seedCleanDatabase();
      },
      (err) => {
        assert.ok(err.message.includes('Seeding is blocked in production'));
        return true;
      }
    );

    process.env.NODE_ENV = originalEnv;
  });

  test('Test S3: Duplicate SOS submission within 5 seconds is gracefully deduplicated', async () => {
    // First SOS submission
    const res1 = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        category: 'Medical emergency',
        description: 'Student fell during sports practice',
        campusLocation: 'Sports Complex',
        severity: 'high'
      });

    assert.equal(res1.status, 201);
    assert.equal(res1.body.success, true);
    const firstIncidentId = res1.body.incident.incidentId;

    // Immediate second SOS submission (simulating double click or network retry)
    const res2 = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        category: 'Medical emergency',
        description: 'Student fell during sports practice',
        campusLocation: 'Sports Complex',
        severity: 'high'
      });

    assert.equal(res2.status, 200);
    assert.equal(res2.body.success, true);
    assert.equal(res2.body.duplicatePrevented, true);
    assert.equal(res2.body.incident.incidentId, firstIncidentId);

    // Verify database only has 1 incident record
    const incidentCount = await Incident.countDocuments({ reporter: studentUser._id });
    assert.equal(incidentCount, 1);
  });

  test('Test S4: Production mode rejects demo backdoor passwords', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'student@campusshield.edu',
        password: 'student123'
      });

    assert.equal(loginRes.status, 401);
    assert.equal(loginRes.body.success, false);

    process.env.NODE_ENV = originalEnv;
  });

  test('Test S5: Production forgotPassword does not disclose reset token in JSON response', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const forgotRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({
        email: 'hardened.student@kongu.edu'
      });

    assert.equal(forgotRes.status, 200);
    assert.equal(forgotRes.body.success, true);
    assert.equal(forgotRes.body.resetToken, null);

    process.env.NODE_ENV = originalEnv;
  });

  test('Test S6: Off-campus location is rejected with alternative emergency helplines', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    // Coordinates far outside KEC campus (e.g. Chennai: lat 13.0827, lng 80.2707)
    const offCampusRes = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        category: 'Fire',
        description: 'Testing off campus boundary',
        latitude: 13.0827,
        longitude: 80.2707,
        campusLocation: 'Off Campus Boundary Test'
      });

    assert.equal(offCampusRes.status, 403);
    assert.equal(offCampusRes.body.code, 'OUT_OF_CAMPUS_BOUNDARY');
    assert.ok(Array.isArray(offCampusRes.body.offCampusHelplines));
    assert.ok(offCampusRes.body.offCampusHelplines.length >= 2);

    process.env.NODE_ENV = originalEnv;
  });
});
