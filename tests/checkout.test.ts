import request from 'supertest';
import { createApp } from '../src/app';
import { startTestDatabase, stopTestDatabase } from './testDb';
import { Organization } from '../src/models/Organization';
import { User } from '../src/models/User';
import { Property } from '../src/models/Property';
import { Room } from '../src/models/Room';
import { Bed } from '../src/models/Bed';
import { Tenant } from '../src/models/Tenant';
import { BedAssignment } from '../src/models/BedAssignment';
import { Invoice } from '../src/models/Invoice';
import { DepositLedger } from '../src/models/DepositLedger';
import { generateToken } from '../src/services/token.service';

const app = createApp();
jest.setTimeout(30000);

describe('Guarded Checkout & Settlement API (Stage 6 Backend)', () => {
  let orgAToken: string;
  let orgBToken: string;
  let orgAId: string;
  let orgBId: string;
  let bedAId: string;
  let tenantAId: string;
  let invoiceAId: string;

  beforeAll(async () => {
    await startTestDatabase();

    // Org A setup
    const orgA = await Organization.create({
      name: 'Alpha PG Co',
      ownerName: 'Alpha Owner',
      phone: '9888811111',
      email: 'owner@alpha.com',
      settings: { rentDueDay: 5, gracePeriodDays: 3, defaultLateFeePaise: 10000 },
    });
    orgAId = orgA._id.toString();

    const userA = await User.create({
      organization: orgA._id,
      name: 'Alpha Owner',
      phone: '9888811111',
      email: 'owner@alpha.com',
      password: 'Password123!',
      role: 'owner',
    });

    orgAToken = generateToken({
      userId: userA._id.toString(),
      email: userA.email,
      role: userA.role,
      orgId: orgAId,
    });

    // Org B setup
    const orgB = await Organization.create({
      name: 'Beta PG Co',
      ownerName: 'Beta Owner',
      phone: '9888822222',
      email: 'owner@beta.com',
      settings: { rentDueDay: 1, gracePeriodDays: 5, defaultLateFeePaise: 10000 },
    });
    orgBId = orgB._id.toString();

    const userB = await User.create({
      organization: orgB._id,
      name: 'Beta Owner',
      phone: '9888822222',
      email: 'owner@beta.com',
      password: 'Password123!',
      role: 'owner',
    });

    orgBToken = generateToken({
      userId: userB._id.toString(),
      email: userB.email,
      role: userB.role,
      orgId: orgBId,
    });

    // Property, Room, Bed for Org A
    const propA = await Property.create({
      organization: orgA._id,
      name: 'Alpha Heights',
      code: 'ALPH1',
      type: 'coliving',
      address: 'Outer Ring Rd, Bengaluru, 560103',
      totalFloors: 3,
      electricityRatePaisePerUnit: 1200,
      upiVpa: 'alpha@upi',
    });

    const roomA = await Room.create({
      organization: orgA._id,
      property: propA._id,
      roomNumber: '101',
      floorNumber: 1,
      sharingType: 1,
      baseRentPaisePerBed: 1000000,
    });

    const bedA = await Bed.create({
      organization: orgA._id,
      property: propA._id,
      room: roomA._id,
      bedNumber: '101-A',
      status: 'occupied',
      baseRentPaise: 1000000,
    });
    bedAId = bedA._id.toString();

    // Tenant for Org A
    const tenantA = await Tenant.create({
      organization: orgA._id,
      property: propA._id,
      currentBed: bedA._id,
      fullName: 'Rahul Sharma',
      phone: '9876543210',
      monthlyRentPaise: 1000000,
      depositPaise: 2000000,
      depositPaidPaise: 2000000,
      status: 'active',
      kycConsent: true,
    });
    tenantAId = tenantA._id.toString();

    bedA.currentTenant = tenantA._id;
    await bedA.save();

    await BedAssignment.create({
      organization: orgA._id,
      property: propA._id,
      room: roomA._id,
      bed: bedA._id,
      tenant: tenantA._id,
      startDate: new Date('2026-10-01'),
      monthlyRentPaise: 1000000,
      depositPaise: 2000000,
      status: 'active',
    });

    // An unpaid invoice for Rahul
    const invA = await Invoice.create({
      organization: orgA._id,
      property: propA._id,
      tenant: tenantA._id,
      invoiceNumber: 'INV-202610-TEST-0001',
      month: 10,
      year: 2026,
      items: [
        {
          description: 'October Monthly Rent',
          amountPaise: 1000000,
          category: 'rent',
        },
      ],
      totalAmountPaise: 1000000,
      amountPaidPaise: 200000,
      balanceDuePaise: 800000,
      dueDate: new Date('2026-10-05'),
      status: 'partially_paid',
    });
    invoiceAId = invA._id.toString();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  describe('GET /api/checkouts/preview/:tenantId', () => {
    it('returns accurate settlement breakdown preview for Org A tenant', async () => {
      const res = await request(app)
        .get(`/api/checkouts/preview/${tenantAId}`)
        .set('Authorization', `Bearer ${orgAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tenant.fullName).toBe('Rahul Sharma');
      expect(res.body.data.depositPaidPaise).toBe(2000000);
      expect(res.body.data.unpaidDuesPaise).toBe(800000);
      expect(res.body.data.estimatedRefundPaise).toBe(1200000); // 2000000 - 800000
      expect(res.body.data.unpaidInvoices.length).toBe(1);
    });

    it('CRITICAL: Organization B gets 404 when attempting to preview Org A tenant', async () => {
      const res = await request(app)
        .get(`/api/checkouts/preview/${tenantAId}`)
        .set('Authorization', `Bearer ${orgBToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/checkouts/confirm (Atomic Settlement)', () => {
    it('executes atomic checkout transaction, releases bed, marks invoice paid, and generates sequential settlement', async () => {
      const res = await request(app)
        .post('/api/checkouts/confirm')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({
          tenantId: tenantAId,
          damageDeductionsPaise: 150000, // ₹1,500 damage deduction
          electricityDeductionsPaise: 50000, // ₹500 unbilled electricity
          otherDeductionsPaise: 0,
          paymentMethod: 'upi',
          transactionReference: 'UPI1234567890',
          notes: 'Key returned, room clean except wall paint touchup',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('checked_out');

      const settlement = res.body.data.settlement;
      expect(settlement.settlementNumber).toMatch(/^SET-\d{6}-[A-F0-9]{4}-\d{4}$/);
      expect(settlement.depositPaidPaise).toBe(2000000);
      expect(settlement.unpaidDuesPaise).toBe(800000);
      expect(settlement.damageDeductionsPaise).toBe(150000);
      expect(settlement.electricityDeductionsPaise).toBe(50000);
      expect(settlement.totalDeductionsPaise).toBe(1000000); // 800000 + 150000 + 50000
      expect(settlement.netRefundPaise).toBe(1000000); // 2000000 - 1000000

      // 1. Verify Bed released to available
      const bedAfter = await Bed.findById(bedAId);
      expect(bedAfter?.status).toBe('available');
      expect(bedAfter?.currentTenant).toBeFalsy();

      // 2. Verify BedAssignment status vacated
      const assignmentAfter = await BedAssignment.findOne({ tenant: tenantAId });
      expect(assignmentAfter?.status).toBe('vacated');
      expect(assignmentAfter?.endDate).toBeDefined();

      // 3. Verify Tenant status checked_out
      const tenantAfter = await Tenant.findById(tenantAId);
      expect(tenantAfter?.status).toBe('checked_out');
      expect(tenantAfter?.currentBed).toBeFalsy();

      // 4. Verify Invoice settled
      const invoiceAfter = await Invoice.findById(invoiceAId);
      expect(invoiceAfter?.status).toBe('paid');
      expect(invoiceAfter?.balanceDuePaise).toBe(0);

      // 5. Verify DepositLedger entries recorded
      const refundEntry = await DepositLedger.findOne({
        tenant: tenantAId,
        type: 'refunded',
      });
      expect(refundEntry).toBeDefined();
      expect(refundEntry?.amountPaise).toBe(1000000);

      const deductionEntry = await DepositLedger.findOne({
        tenant: tenantAId,
        type: 'deducted',
      });
      expect(deductionEntry).toBeDefined();
      expect(deductionEntry?.amountPaise).toBe(200000); // 150000 damage + 50000 electricity
    });

    it('rejects checkout on already checked out tenant with 400', async () => {
      const res = await request(app)
        .post('/api/checkouts/confirm')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({
          tenantId: tenantAId,
          damageDeductionsPaise: 0,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('already checked out');
    });

    it('CRITICAL: Organization B cannot checkout Org A tenant (returns 404)', async () => {
      const res = await request(app)
        .post('/api/checkouts/confirm')
        .set('Authorization', `Bearer ${orgBToken}`)
        .send({
          tenantId: tenantAId,
          damageDeductionsPaise: 0,
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/checkouts/statements', () => {
    it('returns settlement statements for Org A', async () => {
      const res = await request(app)
        .get('/api/checkouts/statements')
        .set('Authorization', `Bearer ${orgAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].settlementNumber).toMatch(/^SET-/);
    });

    it('Organization B gets empty settlement statements list', async () => {
      const res = await request(app)
        .get('/api/checkouts/statements')
        .set('Authorization', `Bearer ${orgBToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(0);
    });
  });
});
