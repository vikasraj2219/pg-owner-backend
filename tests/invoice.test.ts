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
import { generateToken } from '../src/services/token.service';
import { env } from '../src/config/env';

const app = createApp();
jest.setTimeout(30000);

describe('Invoice & Payment Collections API (Stage 4 Backend)', () => {
  let orgAToken: string;
  let orgBToken: string;
  let orgAId: string;
  let orgBId: string;
  let tenant1Id: string;
  let invoice1Id: string;

  beforeAll(async () => {
    await startTestDatabase();

    // 1. Setup Organization A
    const orgA = await Organization.create({
      name: 'Lotus PG Living',
      ownerName: 'Sunita Owner',
      phone: '9876543201',
      email: 'sunita@lotuspg.com',
      settings: { rentDueDay: 5, gracePeriodDays: 3, defaultLateFeePaise: 10000 },
    });
    orgAId = orgA._id.toString();

    const userA = await User.create({
      organization: orgA._id,
      name: 'Sunita Owner',
      phone: '9876543201',
      email: 'sunita@lotuspg.com',
      password: 'Password123!',
      role: 'owner',
    });

    orgAToken = generateToken({
      userId: userA._id.toString(),
      email: userA.email,
      role: userA.role,
      orgId: orgAId,
    });

    // 2. Setup Organization B (for cross-tenant checks)
    const orgB = await Organization.create({
      name: 'Marigold Co-living',
      ownerName: 'Manish Owner',
      phone: '9876543202',
      email: 'manish@marigoldpg.com',
      settings: { rentDueDay: 1, gracePeriodDays: 5, defaultLateFeePaise: 15000 },
    });
    orgBId = orgB._id.toString();

    const userB = await User.create({
      organization: orgB._id,
      name: 'Manish Owner',
      phone: '9876543202',
      email: 'manish@marigoldpg.com',
      password: 'Password123!',
      role: 'owner',
    });

    orgBToken = generateToken({
      userId: userB._id.toString(),
      email: userB.email,
      role: userB.role,
      orgId: orgBId,
    });

    // 3. Setup Property, Room, Beds for Org A
    const propA = await Property.create({
      organization: orgA._id,
      name: 'Lotus PG Green Glen',
      type: 'coliving',
      address: 'Outer Ring Rd, Bengaluru, 560103',
      totalFloors: 2,
      upiVpa: 'sunita@okhdfcbank',
      electricityRatePaisePerUnit: 1200,
    });

    const room = await Room.create({
      organization: orgA._id,
      property: propA._id,
      floorNumber: 1,
      roomNumber: '101',
      sharingType: 2,
      baseRentPaisePerBed: 800000, // ₹8,000
    });

    const bed1 = await Bed.create({
      organization: orgA._id,
      property: propA._id,
      room: room._id,
      bedNumber: '101-A',
      status: 'occupied',
    });

    const bed2 = await Bed.create({
      organization: orgA._id,
      property: propA._id,
      room: room._id,
      bedNumber: '101-B',
      status: 'occupied',
    });

    // 4. Setup Active Tenants and BedAssignments for Org A
    const tenant1 = await Tenant.create({
      organization: orgA._id,
      property: propA._id,
      currentBed: bed1._id,
      fullName: 'Rahul Sharma',
      phone: '9811122233',
      email: 'rahul@example.com',
      monthlyRentPaise: 800000,
      depositPaise: 1600000,
      status: 'active',
      kycConsent: true,
      kycConsentTimestamp: new Date(),
      idProofNumberMasked: 'XXXX-XXXX-1234',
    });
    tenant1Id = tenant1._id.toString();

    await BedAssignment.create({
      organization: orgA._id,
      property: propA._id,
      room: room._id,
      bed: bed1._id,
      tenant: tenant1._id,
      startDate: new Date('2026-10-01'),
      status: 'active',
      monthlyRentPaise: 800000,
    });

    const tenant2 = await Tenant.create({
      organization: orgA._id,
      property: propA._id,
      currentBed: bed2._id,
      fullName: 'Priya Verma',
      phone: '9822233344',
      email: 'priya@example.com',
      monthlyRentPaise: 850000,
      depositPaise: 1700000,
      status: 'active',
      kycConsent: true,
      kycConsentTimestamp: new Date(),
      idProofNumberMasked: 'XXXX-XXXX-5678',
    });

    await BedAssignment.create({
      organization: orgA._id,
      property: propA._id,
      room: room._id,
      bed: bed2._id,
      tenant: tenant2._id,
      startDate: new Date('2026-10-01'),
      status: 'active',
      monthlyRentPaise: 850000, // ₹8,500
    });
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  describe('POST /api/invoices/generate-monthly', () => {
    it('generates monthly invoices for active tenants with active assignments', async () => {
      const res = await request(app)
        .post('/api/invoices/generate-monthly')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ month: 11, year: 2026 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.generatedCount).toBe(2);
      expect(res.body.data.skippedCount).toBe(0);

      // Verify invoice records created in DB
      const invoices = await Invoice.find({ organization: orgAId, month: 11, year: 2026 });
      expect(invoices.length).toBe(2);
      expect(invoices[0]!.invoiceNumber).toMatch(/^INV-202611-[A-F0-9]{4}-000[12]$/);
      expect(invoices[0]!.status).toBe('unpaid');
      expect(invoices[0]!.totalAmountPaise).toBeGreaterThan(0);

      // Save invoice1Id for subsequent tests
      const inv1 = invoices.find(i => i.tenant.toString() === tenant1Id);
      expect(inv1).toBeDefined();
      invoice1Id = inv1!._id.toString();
    });

    it('IDEMPOTENCY: running generation twice creates 0 new invoices and skips existing', async () => {
      const res = await request(app)
        .post('/api/invoices/generate-monthly')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ month: 11, year: 2026 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.generatedCount).toBe(0);
      expect(res.body.data.skippedCount).toBe(2);

      // Invoices count remains exactly 2
      const totalInvoices = await Invoice.countDocuments({
        organization: orgAId,
        month: 11,
        year: 2026,
      });
      expect(totalInvoices).toBe(2);
    });

    it('executes successfully via x-cron-secret without user JWT', async () => {
      const res = await request(app)
        .post('/api/invoices/generate-monthly')
        .set('x-cron-secret', env.INTERNAL_CRON_SECRET)
        .send({ month: 12, year: 2026, organizationId: orgAId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.generatedCount).toBe(2);
    });

    it('rejects unauthenticated requests lacking both JWT and valid cron secret', async () => {
      const res = await request(app)
        .post('/api/invoices/generate-monthly')
        .send({ month: 11, year: 2026 });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/invoices', () => {
    it('returns all invoices scoped to caller organization with overdue status calculation', async () => {
      const res = await request(app)
        .get('/api/invoices')
        .set('Authorization', `Bearer ${orgAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(4);
      expect(res.body.data[0]).toHaveProperty('overdueDays');
      expect(res.body.data[0]).toHaveProperty('isOverdue');
      expect(res.body.data[0].tenant).toHaveProperty('fullName');
    });

    it('filters invoices by search query matching tenant name', async () => {
      const res = await request(app)
        .get('/api/invoices?search=Rahul')
        .set('Authorization', `Bearer ${orgAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].tenant.fullName).toBe('Rahul Sharma');
    });

    it('Organization B gets an empty list of invoices (tenant isolation)', async () => {
      const res = await request(app)
        .get('/api/invoices')
        .set('Authorization', `Bearer ${orgBToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(0);
    });
  });

  describe('POST /api/invoices/:id/pay (Payment & Receipts)', () => {
    it('records a partial payment, updates balance, and changes status to partially_paid', async () => {
      const res = await request(app)
        .post(`/api/invoices/${invoice1Id}/pay`)
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({
          amountPaise: 300000, // ₹3,000 partial payment
          paymentMethod: 'upi',
          transactionReference: 'UPI/2026/87654321',
          notes: 'First installment via GPay',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.invoice.status).toBe('partially_paid');
      expect(res.body.data.invoice.amountPaidPaise).toBe(300000);
      expect(res.body.data.invoice.balanceDuePaise).toBe(500000); // 800000 - 300000

      // Verify payment receipt created
      expect(res.body.data.payment.receiptNumber).toMatch(/^RCP-\d{6}-[A-F0-9]{4}-0001$/);
      expect(res.body.data.payment.amountPaidPaise).toBe(300000);
      expect(res.body.data.payment.paymentMethod).toBe('upi');
    });

    it('rejects payment amount exceeding balance due', async () => {
      const res = await request(app)
        .post(`/api/invoices/${invoice1Id}/pay`)
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({
          amountPaise: 600000, // Exceeds remaining 500000 balance
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Payment amount cannot exceed balance due');
    });

    it('records remaining balance payment, updates status to paid, and generates sequential receipt', async () => {
      const res = await request(app)
        .post(`/api/invoices/${invoice1Id}/pay`)
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({
          amountPaise: 500000, // Remaining ₹5,000
          paymentMethod: 'cash',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.invoice.status).toBe('paid');
      expect(res.body.data.invoice.balanceDuePaise).toBe(0);
      expect(res.body.data.invoice.paidAt).toBeDefined();

      // Sequential receipt numbering: second payment in the month gets 0002
      expect(res.body.data.payment.receiptNumber).toMatch(/^RCP-\d{6}-[A-F0-9]{4}-0002$/);
    });

    it('rejects further payments on an already fully paid invoice', async () => {
      const res = await request(app)
        .post(`/api/invoices/${invoice1Id}/pay`)
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({
          amountPaise: 100000,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('This invoice is already fully paid');
    });

    it('CRITICAL: Organization B cannot record payment on Org A invoice (returns 404)', async () => {
      const res = await request(app)
        .post(`/api/invoices/${invoice1Id}/pay`)
        .set('Authorization', `Bearer ${orgBToken}`)
        .send({
          amountPaise: 100000,
        });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain(
        'Invoice not found or does not belong to your organization',
      );
    });
  });

  describe('GET /api/payments', () => {
    it('returns all payments/receipts scoped to caller organization', async () => {
      const res = await request(app)
        .get('/api/payments')
        .set('Authorization', `Bearer ${orgAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(2);
      expect(res.body.data[0]).toHaveProperty('receiptNumber');
      expect(res.body.data[0]).toHaveProperty('amountPaidPaise');
    });

    it('Organization B gets empty payments list (multi-tenant protection)', async () => {
      const res = await request(app)
        .get('/api/payments')
        .set('Authorization', `Bearer ${orgBToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(0);
    });
  });
});
