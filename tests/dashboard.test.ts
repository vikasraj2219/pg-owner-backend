import request from 'supertest';
import { createApp } from '../src/app';
import { startTestDatabase, stopTestDatabase } from './testDb';
import { Organization } from '../src/models/Organization';
import { User } from '../src/models/User';
import { Property } from '../src/models/Property';
import { Room } from '../src/models/Room';
import { Bed } from '../src/models/Bed';
import { Tenant } from '../src/models/Tenant';
import { Invoice } from '../src/models/Invoice';
import { Payment } from '../src/models/Payment';
import { generateToken } from '../src/services/token.service';

const app = createApp();
jest.setTimeout(30000);

describe('Dashboard & Pulse Analytics API (Stage 5 Backend)', () => {
  let orgAToken: string;
  let orgBToken: string;
  let orgAId: string;
  let orgBId: string;
  let propertyAId: string;

  beforeAll(async () => {
    await startTestDatabase();

    // 1. Setup Org A
    const orgA = await Organization.create({
      name: 'Orchid Living PG',
      ownerName: 'Vikram Owner',
      phone: '9900011122',
      email: 'vikram@orchidpg.com',
      settings: { rentDueDay: 5, gracePeriodDays: 3, defaultLateFeePaise: 10000 },
    });
    orgAId = orgA._id.toString();

    const userA = await User.create({
      organization: orgA._id,
      name: 'Vikram Owner',
      phone: '9900011122',
      email: 'vikram@orchidpg.com',
      password: 'Password123!',
      role: 'owner',
    });

    orgAToken = generateToken({
      userId: userA._id.toString(),
      email: userA.email,
      role: userA.role,
      orgId: orgAId,
    });

    // 2. Setup Org B
    const orgB = await Organization.create({
      name: 'Jasmine PG',
      ownerName: 'Geeta Owner',
      phone: '9900011133',
      email: 'geeta@jasminepg.com',
      settings: { rentDueDay: 1, gracePeriodDays: 5, defaultLateFeePaise: 10000 },
    });
    orgBId = orgB._id.toString();

    const userB = await User.create({
      organization: orgB._id,
      name: 'Geeta Owner',
      phone: '9900011133',
      email: 'geeta@jasminepg.com',
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
      name: 'Orchid Residency',
      type: 'coliving',
      address: 'Indiranagar 100ft Rd, Bengaluru',
      totalFloors: 3,
      upiVpa: 'vikram@okhdfcbank',
      electricityRatePaisePerUnit: 1200,
    });
    propertyAId = propA._id.toString();

    const room101 = await Room.create({
      organization: orgA._id,
      property: propA._id,
      floorNumber: 1,
      roomNumber: '101',
      sharingType: 3,
      baseRentPaisePerBed: 1000000, // ₹10,000
    });

    const bed1 = await Bed.create({
      organization: orgA._id,
      property: propA._id,
      room: room101._id,
      bedNumber: '101-A',
      status: 'occupied',
    });

    await Bed.create({
      organization: orgA._id,
      property: propA._id,
      room: room101._id,
      bedNumber: '101-B',
      status: 'available',
    });

    await Bed.create({
      organization: orgA._id,
      property: propA._id,
      room: room101._id,
      bedNumber: '101-C',
      status: 'maintenance',
      maintenanceNote: 'AC repair needed',
    });

    // 4. Setup Tenant and Invoices
    const tenant1 = await Tenant.create({
      organization: orgA._id,
      property: propA._id,
      currentBed: bed1._id,
      fullName: 'Aman Deep',
      phone: '9988776655',
      monthlyRentPaise: 1000000,
      depositPaise: 2000000,
      status: 'active',
      kycConsent: true,
      kycConsentTimestamp: new Date(),
      idProofNumberMasked: 'XXXX-XXXX-9988',
    });

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const inv1 = await Invoice.create({
      organization: orgA._id,
      property: propA._id,
      tenant: tenant1._id,
      invoiceNumber: `INV-${currentYear}${String(currentMonth).padStart(2, '0')}-TEST-0001`,
      month: currentMonth,
      year: currentYear,
      dueDate: new Date(currentYear, currentMonth - 1, 5),
      items: [{ description: 'Monthly Rent', amountPaise: 1000000, category: 'rent' }],
      totalAmountPaise: 1000000,
      amountPaidPaise: 600000, // ₹6,000 paid
      balanceDuePaise: 400000, // ₹4,000 balance
      status: 'partially_paid',
    });

    await Payment.create({
      organization: orgA._id,
      property: propA._id,
      tenant: tenant1._id,
      invoice: inv1._id,
      receiptNumber: `RCP-${currentYear}${String(currentMonth).padStart(2, '0')}-TEST-0001`,
      amountPaidPaise: 600000,
      paymentMethod: 'upi',
      transactionReference: 'UPI-TXN-112233',
      paymentDate: new Date(),
    });
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  describe('GET /api/dashboard/stats', () => {
    it('returns accurate aggregations and integer paise financial metrics for Org A', async () => {
      const res = await request(app)
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${orgAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;

      // Bed aggregations
      expect(data.totalRooms).toBe(1);
      expect(data.totalBeds).toBe(3);
      expect(data.occupiedBeds).toBe(1);
      expect(data.availableBeds).toBe(1);
      expect(data.maintenanceBeds).toBe(1);
      expect(data.noticeBeds).toBe(0);
      expect(data.occupancyRate).toBe(33.3); // 1 / 3 = 33.3%

      // Financials in integer paise
      expect(data.collectedThisMonthPaise).toBe(600000);
      expect(data.expectedThisMonthPaise).toBe(1000000);
      expect(data.pendingAmountPaise).toBe(400000);
      expect(data.collectionRate).toBe(60); // 600000 / 1000000 = 60%
      expect(data.netProfitPaise).toBe(600000);
      expect(data.totalTenants).toBe(1);

      // Activity Feed
      expect(data.recentActivity).toBeDefined();
      expect(data.recentActivity.length).toBeGreaterThanOrEqual(1);
      expect(data.recentActivity[0]).toHaveProperty('title');
      expect(data.recentActivity[0]).toHaveProperty('subtitle');
    });

    it('filters dashboard metrics by propertyId query parameter', async () => {
      const res = await request(app)
        .get(`/api/dashboard/stats?propertyId=${propertyAId}`)
        .set('Authorization', `Bearer ${orgAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalBeds).toBe(3);
    });

    it('returns 400 for invalid propertyId format', async () => {
      const res = await request(app)
        .get('/api/dashboard/stats?propertyId=invalid-id-123')
        .set('Authorization', `Bearer ${orgAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid property ID format');
    });

    it('CRITICAL: Organization B gets zeroed stats for Organization A data (tenant isolation)', async () => {
      const res = await request(app)
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${orgBToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;

      expect(data.totalBeds).toBe(0);
      expect(data.occupiedBeds).toBe(0);
      expect(data.availableBeds).toBe(0);
      expect(data.collectedThisMonthPaise).toBe(0);
      expect(data.totalTenants).toBe(0);
      expect(data.recentActivity.length).toBe(0);
    });
  });
});
