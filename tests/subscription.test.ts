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

  describe('Real-Time Subscription Lifecycle: Purchase Before & After Trial Expiry', () => {
    let testOrgToken: string;
    let testOrgId: string;

    beforeEach(async () => {
      // Create fresh organization for each test case
      const testOrg = await Organization.create({
        name: `Test PG ${Date.now()}`,
        ownerName: 'Test PG Owner',
        phone: '9888877777',
        email: `owner_${Date.now()}@testpg.com`,
      });
      testOrgId = testOrg._id.toString();

      const user = await User.create({
        organization: testOrg._id,
        name: 'Test PG Owner',
        phone: '9888877777',
        email: `owner_${Date.now()}@testpg.com`,
        password: 'Password123!',
        role: 'owner',
      });

      testOrgToken = generateToken({
        userId: user._id.toString(),
        email: user.email,
        role: user.role,
        orgId: testOrgId,
      });
    });

    it('CASE 1: User purchases PRO plan BEFORE free trial expires -> preserves remaining trial days + adds 30 days of PRO tier', async () => {
      const now = new Date();
      // Setup trial with 10 days remaining
      const tenDaysFromNow = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
      await Subscription.create({
        organization: testOrgId,
        plan: 'starter',
        status: 'trialing',
        trialEndsAt: tenDaysFromNow,
        currentPeriodEnd: tenDaysFromNow,
        maxProperties: 1,
        maxBeds: 30,
      });

      // User upgrades to Pro before trial expires
      const res = await request(app)
        .post('/api/subscription/upgrade')
        .set('Authorization', `Bearer ${testOrgToken}`)
        .send({ plan: 'pro' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.plan).toBe('pro');
      expect(res.body.data.status).toBe('active');
      expect(res.body.data.maxProperties).toBe(999);
      expect(res.body.data.maxBeds).toBe(9999);

      // Period end should be now + remaining trial (10 days) + 30 days paid = ~40 days from now
      const periodEnd = new Date(res.body.data.currentPeriodEnd);
      const daysFromNow = Math.round((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      expect(daysFromNow).toBeGreaterThanOrEqual(39);
      expect(daysFromNow).toBeLessThanOrEqual(41);

      // Check current subscription API returns PRO plan and not trial
      const currentRes = await request(app)
        .get('/api/subscription/current')
        .set('Authorization', `Bearer ${testOrgToken}`);

      expect(currentRes.status).toBe(200);
      expect(currentRes.body.data.plan).toBe('pro');
      expect(currentRes.body.data.status).toBe('active');
      expect(currentRes.body.data.isReadOnly).toBe(false);
      expect(currentRes.body.data.daysLeft).toBeGreaterThanOrEqual(39);
    });

    it('CASE 2: User purchases PRO plan AFTER free trial expires -> unlocks read-only mode, activates 30 days of PRO tier', async () => {
      const now = new Date();
      // Setup expired trial (2 days ago)
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
      await Subscription.create({
        organization: testOrgId,
        plan: 'starter',
        status: 'expired',
        trialEndsAt: twoDaysAgo,
        currentPeriodEnd: twoDaysAgo,
        maxProperties: 1,
        maxBeds: 30,
      });

      // Verify currently in read-only mode
      const preCheck = await request(app)
        .get('/api/subscription/current')
        .set('Authorization', `Bearer ${testOrgToken}`);
      expect(preCheck.body.data.isReadOnly).toBe(true);

      // User purchases Pro plan after expiry via verify endpoint
      const res = await request(app)
        .post('/api/subscription/verify')
        .set('Authorization', `Bearer ${testOrgToken}`)
        .send({
          razorpay_order_id: 'order_mock_after_expiry_123',
          razorpay_payment_id: 'pay_mock_456',
          razorpay_signature: 'test_signature_valid',
          plan: 'pro',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.plan).toBe('pro');
      expect(res.body.data.status).toBe('active');

      // Period end should be exactly ~30 days from now
      const periodEnd = new Date(res.body.data.currentPeriodEnd);
      const daysFromNow = Math.round((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      expect(daysFromNow).toBeGreaterThanOrEqual(29);
      expect(daysFromNow).toBeLessThanOrEqual(31);

      // Check current subscription API confirms read-only is removed
      const postCheck = await request(app)
        .get('/api/subscription/current')
        .set('Authorization', `Bearer ${testOrgToken}`);
      expect(postCheck.body.data.isReadOnly).toBe(false);
      expect(postCheck.body.data.plan).toBe('pro');
      expect(postCheck.body.data.status).toBe('active');
    });

    it('CASE 3: User extends/renews PRO plan while ALREADY ACTIVE -> extends currentPeriodEnd by 30 days', async () => {
      const now = new Date();
      // Setup already active Pro plan with 15 days remaining
      const fifteenDaysFromNow = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
      await Subscription.create({
        organization: testOrgId,
        plan: 'pro',
        status: 'active',
        currentPeriodEnd: fifteenDaysFromNow,
        maxProperties: 9999,
        maxBeds: 99999,
      });

      // User extends subscription
      const res = await request(app)
        .post('/api/subscription/upgrade')
        .set('Authorization', `Bearer ${testOrgToken}`)
        .send({ plan: 'pro' });

      expect(res.status).toBe(200);
      expect(res.body.data.plan).toBe('pro');
      expect(res.body.data.status).toBe('active');

      // Period end should be fifteenDaysFromNow + 30 days = ~45 days from now
      const periodEnd = new Date(res.body.data.currentPeriodEnd);
      const daysFromNow = Math.round((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      expect(daysFromNow).toBeGreaterThanOrEqual(44);
      expect(daysFromNow).toBeLessThanOrEqual(46);
    });

    it('CASE 4: User completes payment via Razorpay Payment Link (plink_...) -> verifies and activates PRO tier', async () => {
      const now = new Date();
      const fiveDaysFromNow = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
      await Subscription.create({
        organization: testOrgId,
        plan: 'starter',
        status: 'trialing',
        trialEndsAt: fiveDaysFromNow,
        currentPeriodEnd: fiveDaysFromNow,
      });

      const res = await request(app)
        .post('/api/subscription/verify')
        .set('Authorization', `Bearer ${testOrgToken}`)
        .send({
          razorpay_order_id: 'plink_mock_test_7788',
          razorpay_payment_id: 'pay_rzp_link_99',
          razorpay_signature: 'verified_signature',
          plan: 'pro',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.plan).toBe('pro');
      expect(res.body.data.status).toBe('active');
    });
  });
});
