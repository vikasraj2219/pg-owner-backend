import request from 'supertest';
import { createApp } from '../src/app';
import { startTestDatabase, stopTestDatabase } from './testDb';
import { Organization } from '../src/models/Organization';
import { User } from '../src/models/User';
import { Property } from '../src/models/Property';
import { Tenant } from '../src/models/Tenant';
import { Invoice } from '../src/models/Invoice';
import { Payment } from '../src/models/Payment';
import { Expense } from '../src/models/Expense';
import { generateToken } from '../src/services/token.service';

const app = createApp();
jest.setTimeout(30000);

describe('Expense Ledger & Live P&L API (Stage 6 Backend)', () => {
  let orgAToken: string;
  let orgBToken: string;
  let orgAId: string;
  let orgBId: string;
  let propertyAId: string;
  let createdExpenseId: string;

  beforeAll(async () => {
    await startTestDatabase();

    // Org A setup
    const orgA = await Organization.create({
      name: 'Emerald Stay',
      ownerName: 'Emerald Owner',
      phone: '9666611111',
      email: 'owner@emerald.com',
      settings: { rentDueDay: 1, gracePeriodDays: 5, defaultLateFeePaise: 10000 },
    });
    orgAId = orgA._id.toString();

    const userA = await User.create({
      organization: orgA._id,
      name: 'Emerald Owner',
      phone: '9666611111',
      email: 'owner@emerald.com',
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
      name: 'Ruby Stay',
      ownerName: 'Ruby Owner',
      phone: '9666622222',
      email: 'owner@ruby.com',
      settings: { rentDueDay: 1, gracePeriodDays: 5, defaultLateFeePaise: 10000 },
    });
    orgBId = orgB._id.toString();

    const userB = await User.create({
      organization: orgB._id,
      name: 'Ruby Owner',
      phone: '9666622222',
      email: 'owner@ruby.com',
      password: 'Password123!',
      role: 'owner',
    });

    orgBToken = generateToken({
      userId: userB._id.toString(),
      email: userB.email,
      role: userB.role,
      orgId: orgBId,
    });

    // Property for Org A
    const propA = await Property.create({
      organization: orgA._id,
      name: 'Emerald Grand',
      code: 'EMR1',
      type: 'coliving',
      address: 'Indiranagar 100ft Rd, Bengaluru',
      totalFloors: 3,
      upiVpa: 'emerald@upi',
    });
    propertyAId = propA._id.toString();

    const tenantA = await Tenant.create({
      organization: orgA._id,
      property: propA._id,
      fullName: 'Manish Pandey',
      phone: '9888800003',
      monthlyRentPaise: 1500000,
      depositPaise: 3000000,
      status: 'active',
      kycConsent: true,
    });

    const invoiceA = await Invoice.create({
      organization: orgA._id,
      property: propA._id,
      tenant: tenantA._id,
      invoiceNumber: 'INV-202611-TEST-0001',
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
      items: [{ description: 'Rent', amountPaise: 1500000, category: 'rent' }],
      totalAmountPaise: 1500000,
      amountPaidPaise: 1500000,
      balanceDuePaise: 0,
      dueDate: new Date(),
      status: 'paid',
    });

    // Payment collected this month: ₹15,000 (1,500,000 paise)
    await Payment.create({
      organization: orgA._id,
      property: propA._id,
      tenant: tenantA._id,
      invoice: invoiceA._id,
      receiptNumber: 'RCP-202611-EMR-0001',
      amountPaidPaise: 1500000,
      paymentMethod: 'upi',
      paymentDate: new Date(),
    });
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  describe('POST /api/expenses', () => {
    it('creates an operational expense with integer paise amount and category', async () => {
      const res = await request(app)
        .post('/api/expenses')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({
          propertyId: propertyAId,
          category: 'maintenance',
          amountPaise: 300000, // ₹3,000 plumbing repair
          description: 'Plumber repaired 2nd floor pipe leakage',
          paidTo: 'Ramesh Plumber',
          paymentMethod: 'cash',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.amountPaise).toBe(300000);
      expect(res.body.data.category).toBe('maintenance');
      createdExpenseId = res.body.data._id;

      // Add a second expense: wifi bill ₹1,500
      await request(app).post('/api/expenses').set('Authorization', `Bearer ${orgAToken}`).send({
        propertyId: propertyAId,
        category: 'wifi',
        amountPaise: 150000,
        description: 'Airtel Fiber monthly bill',
        paidTo: 'Airtel',
        paymentMethod: 'upi',
      });
    });

    it('rejects invalid expense category with 400', async () => {
      const res = await request(app)
        .post('/api/expenses')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({
          category: 'invalid_category_test',
          amountPaise: 50000,
          description: 'Test invalid',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/expenses & GET /api/expenses/pnl', () => {
    it('lists recorded expenses with total amount summary', async () => {
      const res = await request(app)
        .get('/api/expenses')
        .set('Authorization', `Bearer ${orgAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.count).toBe(2);
      expect(res.body.data.totalExpensesPaise).toBe(450000); // 300000 + 150000
    });

    it('filters expenses by category', async () => {
      const res = await request(app)
        .get('/api/expenses?category=maintenance')
        .set('Authorization', `Bearer ${orgAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.count).toBe(1);
      expect(res.body.data.expenses[0].category).toBe('maintenance');
    });

    it('calculates live Profit & Loss (P&L): collections - expenses = net cashflow', async () => {
      const res = await request(app)
        .get('/api/expenses/pnl')
        .set('Authorization', `Bearer ${orgAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const pnl = res.body.data;
      expect(pnl.collectionsPaise).toBe(1500000); // ₹15,000
      expect(pnl.expensesPaise).toBe(450000); // ₹4,500
      expect(pnl.netCashflowPaise).toBe(1050000); // ₹10,500 profit!
      expect(pnl.categoryBreakdown.length).toBe(2);
    });

    it('CRITICAL: Organization B gets zeroed expenses and collections (tenant isolation)', async () => {
      const res = await request(app)
        .get('/api/expenses/pnl')
        .set('Authorization', `Bearer ${orgBToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.collectionsPaise).toBe(0);
      expect(res.body.data.expensesPaise).toBe(0);
      expect(res.body.data.netCashflowPaise).toBe(0);
    });
  });

  describe('DELETE /api/expenses/:id', () => {
    it('deletes an expense for Org A', async () => {
      const res = await request(app)
        .delete(`/api/expenses/${createdExpenseId}`)
        .set('Authorization', `Bearer ${orgAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const check = await Expense.findById(createdExpenseId);
      expect(check).toBeNull();
    });
  });
});
