import request from 'supertest';
import { createApp } from '../src/app';
import { startTestDatabase, stopTestDatabase } from './testDb';
import { Organization } from '../src/models/Organization';
import { User } from '../src/models/User';
import { Subscription } from '../src/models/Subscription';
import { Property } from '../src/models/Property';
import { Room } from '../src/models/Room';
import { Bed } from '../src/models/Bed';
import { Tenant } from '../src/models/Tenant';
import { Invoice } from '../src/models/Invoice';
import { DepositLedger } from '../src/models/DepositLedger';
import { BedAssignment } from '../src/models/BedAssignment';
import { generateToken } from '../src/services/token.service';

const app = createApp();
jest.setTimeout(30000);

describe('Quick Check-in & Tenant API (Stage 3 Backend)', () => {
  let orgAToken: string;
  let orgBToken: string;
  let orgAId: string;
  let orgBId: string;
  let propertyAId: string;
  let bed1Id: string;
  let bed2Id: string;

  beforeAll(async () => {
    await startTestDatabase();

    // 1. Setup Organization A (Owner A)
    const orgA = await Organization.create({
      name: 'Sunrise Luxury PG',
      ownerName: 'Alice Owner',
      phone: '9876543210',
      email: 'alice@sunrisepg.com',
      settings: { rentDueDay: 5, gracePeriodDays: 3, defaultLateFeePaise: 10000 },
    });
    orgAId = orgA._id.toString();

    const userA = await User.create({
      organization: orgA._id,
      name: 'Alice Owner',
      phone: '9876543210',
      email: 'alice@sunrisepg.com',
      password: 'Password123!',
      role: 'owner',
    });

    await Subscription.create({
      organization: orgA._id,
      plan: 'starter',
      status: 'active',
      trialEndsAt: new Date(Date.now() + 14 * 86400000),
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
      maxProperties: 1,
      maxBeds: 30,
    });

    orgAToken = generateToken({
      userId: userA._id.toString(),
      email: userA.email,
      role: userA.role,
      orgId: orgAId,
    });

    // 2. Setup Organization B (Owner B for cross-tenant testing)
    const orgB = await Organization.create({
      name: 'Blue Sky Living',
      ownerName: 'Bob Owner',
      phone: '9123456780',
      email: 'bob@bluesky.com',
    });
    orgBId = orgB._id.toString();

    const userB = await User.create({
      organization: orgB._id,
      name: 'Bob Owner',
      phone: '9123456780',
      email: 'bob@bluesky.com',
      password: 'Password123!',
      role: 'owner',
    });

    orgBToken = generateToken({
      userId: userB._id.toString(),
      email: userB.email,
      role: userB.role,
      orgId: orgBId,
    });

    // 3. Create Property and Beds for Org A
    const propA = await Property.create({
      organization: orgA._id,
      name: 'Sunrise HSR Layout',
      type: 'coliving',
      upiVpa: 'sunrise@upi',
      electricityRatePaisePerUnit: 1200,
    });
    propertyAId = propA._id.toString();

    const roomA = await Room.create({
      organization: orgA._id,
      property: propA._id,
      floorNumber: 1,
      roomNumber: '101',
      sharingType: 2,
      baseRentPaisePerBed: 850000, // ₹8,500
    });

    const b1 = await Bed.create({
      organization: orgA._id,
      property: propA._id,
      room: roomA._id,
      bedNumber: '101-A',
      status: 'available',
    });
    bed1Id = b1._id.toString();

    const b2 = await Bed.create({
      organization: orgA._id,
      property: propA._id,
      room: roomA._id,
      bedNumber: '101-B',
      status: 'available',
    });
    bed2Id = b2._id.toString();

    // 4. Create Property for Org B
    await Property.create({
      organization: orgB._id,
      name: 'Blue Sky Koramangala',
      type: 'boys',
      upiVpa: 'bluesky@upi',
      electricityRatePaisePerUnit: 1000,
    });
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  describe('POST /api/checkins/quick (Transactional Check-in)', () => {
    it('successfully checks in a tenant, marks bed occupied, logs deposit, and generates prorated invoice', async () => {
      // Mid-month date: 15th of current month
      const today = new Date();
      const joinDate = new Date(today.getFullYear(), today.getMonth(), 15).toISOString();

      const res = await request(app)
        .post('/api/checkins/quick')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({
          propertyId: propertyAId,
          bedId: bed1Id,
          fullName: 'Kiran Sharma',
          phone: '9876500001',
          emergencyPhone: '9876500002',
          joinDate,
          monthlyRentPaise: 850000,
          depositPaise: 1700000, // ₹17,000 (2 months)
          depositPaidPaise: 1700000, // Fully paid deposit
          depositPaymentMethod: 'upi',
          depositTransactionRef: 'UPI1234567890',
          kycDocType: 'aadhaar',
          kycMaskedNumber: 'XXXX-XXXX-1234',
          kycDocUrl: 'https://res.cloudinary.com/demo/image/authenticated/s--xyz--/sample.jpg',
          kycConsent: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tenant.fullName).toBe('Kiran Sharma');
      expect(res.body.data.tenant.status).toBe('active');
      expect(res.body.data.tenant.kycMaskedNumber).toBe('XXXX-XXXX-1234');
      expect(res.body.data.bed.status).toBe('occupied');

      // 1. Verify Bed record is occupied in DB
      const updatedBed = await Bed.findById(bed1Id);
      expect(updatedBed?.status).toBe('occupied');
      expect(updatedBed?.currentTenant?.toString()).toBe(res.body.data.tenant._id);

      // 2. Verify BedAssignment record was created
      const assignment = await BedAssignment.findOne({
        bed: bed1Id,
        tenant: res.body.data.tenant._id,
      });
      expect(assignment).not.toBeNull();
      expect(assignment?.status).toBe('active');

      // 3. Verify DepositLedger entry was created
      const deposit = await DepositLedger.findOne({
        tenant: res.body.data.tenant._id,
      });
      expect(deposit).not.toBeNull();
      expect(deposit?.amountPaise).toBe(1700000);
      expect(deposit?.paymentMethod).toBe('upi');
      expect(deposit?.transactionRef).toBe('UPI1234567890');

      // 4. Verify First Prorated Invoice was created
      const invoice = await Invoice.findOne({
        tenant: res.body.data.tenant._id,
      });
      expect(invoice).not.toBeNull();
      expect(invoice?.status).toBe('unpaid');
      expect(invoice?.totalAmountPaise).toBe(res.body.data.proration.payablePaise);
      expect(invoice?.items[0]?.category).toBe('rent');
      expect(invoice?.invoiceNumber).toMatch(/^INV-\d{6}-[A-F0-9]{4}-\d{4}$/);
    });

    it('rejects check-in if the bed is already occupied', async () => {
      const res = await request(app)
        .post('/api/checkins/quick')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({
          propertyId: propertyAId,
          bedId: bed1Id, // Already occupied by Kiran
          fullName: 'Another Tenant',
          phone: '9876500099',
          monthlyRentPaise: 850000,
          depositPaise: 1700000,
          kycConsent: true,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Only available beds can be checked into');
    });

    it('rejects check-in if kycConsent is false (DPDP Act requirement)', async () => {
      const res = await request(app)
        .post('/api/checkins/quick')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({
          propertyId: propertyAId,
          bedId: bed2Id,
          fullName: 'No Consent Tenant',
          phone: '9876500088',
          monthlyRentPaise: 850000,
          depositPaise: 1700000,
          kycConsent: false,
        });

      expect(res.status).toBe(400);
      expect(res.body.errors.kycConsent).toBeDefined();
    });

    it('CRITICAL: Prevents Org B from checking in a tenant into Org A bed (404/Cross-tenant)', async () => {
      const res = await request(app)
        .post('/api/checkins/quick')
        .set('Authorization', `Bearer ${orgBToken}`) // Org B token
        .send({
          propertyId: propertyAId, // Org A property
          bedId: bed2Id, // Org A bed
          fullName: 'Hacker Tenant',
          phone: '9999999999',
          monthlyRentPaise: 850000,
          depositPaise: 1700000,
          kycConsent: true,
        });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Property not found');
    });
  });

  describe('GET /api/tenants & GET /api/tenants/:id', () => {
    it('returns all active tenants scoped to Org A', async () => {
      const res = await request(app)
        .get('/api/tenants')
        .set('Authorization', `Bearer ${orgAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].fullName).toBe('Kiran Sharma');
      expect(res.body.data[0].currentBed.bedNumber).toBe('101-A');
    });

    it('Org B gets an empty list of tenants (tenant isolation)', async () => {
      const res = await request(app)
        .get('/api/tenants')
        .set('Authorization', `Bearer ${orgBToken}`);

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(0);
      expect(res.body.data).toEqual([]);
    });

    it('retrieves detailed tenant profile with invoices, deposits, and bed history', async () => {
      const tenant = await Tenant.findOne({ fullName: 'Kiran Sharma' });

      const res = await request(app)
        .get(`/api/tenants/${tenant?._id}`)
        .set('Authorization', `Bearer ${orgAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tenant.fullName).toBe('Kiran Sharma');
      expect(res.body.data.invoices.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.deposits.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.bedHistory.length).toBeGreaterThanOrEqual(1);
    });

    it('CRITICAL: Prevents Org B from accessing Org A tenant details with 404', async () => {
      const tenant = await Tenant.findOne({ fullName: 'Kiran Sharma' });

      const res = await request(app)
        .get(`/api/tenants/${tenant?._id}`)
        .set('Authorization', `Bearer ${orgBToken}`); // Org B token

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Tenant not found');
    });
  });
});
