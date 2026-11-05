import request from 'supertest';
import crypto from 'crypto';
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

    it('POST /api/subscription/create-order creates Razorpay subscription order', async () => {
      const res = await request(app)
        .post('/api/subscription/create-order')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ plan: 'growth' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.amount).toBe(99900);
      expect(res.body.data.currency).toBe('INR');
      expect(res.body.data.plan).toBe('growth');
      expect(res.body.data.orderId).toBeDefined();
    });

    it('POST /api/subscription/verify verifies payment and upgrades subscription', async () => {
      const orderRes = await request(app)
        .post('/api/subscription/create-order')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ plan: 'pro' });

      const paymentId = 'pay_test_123';
      const keySecret = process.env.RAZORPAY_KEY_SECRET || 'YuO4zCPfnhfbXrj9Lx3HpaKT';
      const validSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${orderRes.body.data.orderId}|${paymentId}`)
        .digest('hex');

      const res = await request(app)
        .post('/api/subscription/verify')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({
          razorpay_order_id: orderRes.body.data.orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: validSignature,
          plan: 'pro',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.plan).toBe('pro');
      expect(res.body.data.status).toBe('active');
    });

    it('POST /api/subscription/payment-link creates payment link for checkout', async () => {
      const res = await request(app)
        .post('/api/subscription/payment-link')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ plan: 'starter' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.amount).toBe(49900);
      expect(res.body.data.plan).toBe('starter');
    });

    it('GET /api/subscription/callback updates subscription in DB and deep links to app', async () => {
      const res = await request(app).get(
        `/api/subscription/callback?razorpay_payment_id=pay_callback_999&razorpay_payment_link_status=paid&plan=growth&orgId=${orgAId}`,
      );

      expect(res.status).toBe(200);
      expect(res.text).toContain(
        'pgowner://subscription?status=success&plan=growth&payment_id=pay_callback_999',
      );

      // Verify subscription in DB was updated immediately to active growth tier
      const updatedSub = await Subscription.findOne({ organization: orgAId });
      expect(updatedSub).toBeDefined();
      expect(updatedSub?.plan).toBe('growth');
      expect(updatedSub?.status).toBe('active');
      expect(updatedSub?.maxProperties).toBe(3);
      expect(updatedSub?.maxBeds).toBe(100);
      expect(updatedSub?.razorpayPaymentId).toBe('pay_callback_999');
    });
  });
});
