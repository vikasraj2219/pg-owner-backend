import request from 'supertest';
import { createApp } from '../src/app';
import { startTestDatabase, stopTestDatabase } from './testDb';
import { Organization } from '../src/models/Organization';
import { User } from '../src/models/User';
import { Property } from '../src/models/Property';
import { Subscription } from '../src/models/Subscription';
import { generateToken } from '../src/services/token.service';

const app = createApp();
jest.setTimeout(30000);

describe('Subscription Enforcement & Read-Only Paywall API (Stage 7 Backend)', () => {
  let orgAToken: string;
  let orgAId: string;
  let propertyAId: string;

  beforeAll(async () => {
    await startTestDatabase();

    // 1. Setup Org A
    const orgA = await Organization.create({
      name: 'Pinnacle Living',
      ownerName: 'Pinnacle Owner',
      phone: '9333311111',
      email: 'owner@pinnacle.com',
      settings: { rentDueDay: 1, gracePeriodDays: 5, defaultLateFeePaise: 10000 },
    });
    orgAId = orgA._id.toString();

    // Start with an expired trial
    await Subscription.create({
      organization: orgA._id,
      plan: 'starter',
      status: 'expired',
      trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // yesterday
      currentPeriodEnd: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    const userA = await User.create({
      organization: orgA._id,
      name: 'Pinnacle Owner',
      phone: '9333311111',
      email: 'owner@pinnacle.com',
      password: 'Password123!',
      role: 'owner',
    });

    orgAToken = generateToken({
      userId: userA._id.toString(),
      email: userA.email,
      role: userA.role,
      orgId: orgAId,
    });

    const propA = await Property.create({
      organization: orgA._id,
      name: 'Pinnacle Heights',
      code: 'PIN1',
      type: 'coliving',
      address: 'Koramangala, Bengaluru',
      totalFloors: 2,
      upiVpa: 'pinnacle@upi',
    });
    propertyAId = propA._id.toString();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  describe('Read-Only Mode on Expired Subscription', () => {
    it('CRITICAL: GET requests succeed on expired subscription (owners never locked out of data)', async () => {
      const res = await request(app)
        .get('/api/properties')
        .set('Authorization', `Bearer ${orgAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(1);
    });

    it('CRITICAL: Mutating POST requests return 402 Payment Required when subscription is expired', async () => {
      const res = await request(app)
        .post('/api/expenses')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({
          propertyId: propertyAId,
          category: 'maintenance',
          amountPaise: 50000,
          description: 'Attempting expense while expired',
        });

      expect(res.status).toBe(402);
      expect(res.body.code).toBe('SUBSCRIPTION_EXPIRED');
      expect(res.body.message).toContain('read-only mode');
    });

    it('GET /api/subscription/current reflects read-only mode and plan info', async () => {
      const res = await request(app)
        .get('/api/subscription/current')
        .set('Authorization', `Bearer ${orgAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.isReadOnly).toBe(true);
      expect(res.body.data.status).toBe('expired');
      expect(res.body.data.propertiesUsed).toBe(1);
    });
  });

  describe('Unlocking Mutations via Subscription Upgrade & Trial Extension', () => {
    it('POST /api/subscription/upgrade unlocks account and allows mutations immediately', async () => {
      const upgradeRes = await request(app)
        .post('/api/subscription/upgrade')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ plan: 'growth' });

      expect(upgradeRes.status).toBe(200);
      expect(upgradeRes.body.success).toBe(true);
      expect(upgradeRes.body.data.plan).toBe('growth');
      expect(upgradeRes.body.data.status).toBe('active');

      // Now verify mutating POST request succeeds
      const expenseRes = await request(app)
        .post('/api/expenses')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({
          propertyId: propertyAId,
          category: 'maintenance',
          amountPaise: 50000,
          description: 'Repaired lock on 1st floor',
        });

      expect(expenseRes.status).toBe(201);
      expect(expenseRes.body.success).toBe(true);
    });

    it('POST /api/subscription/extend-trial extends trial days', async () => {
      const res = await request(app)
        .post('/api/subscription/extend-trial')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ days: 30 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('trialing');
    });
  });
});

