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
import { generateToken } from '../src/services/token.service';

const app = createApp();
jest.setTimeout(30000);

describe('Sub-meter Electricity Reader API (Stage 6 Backend)', () => {
  let orgAToken: string;
  let orgBToken: string;
  let orgAId: string;
  let orgBId: string;
  let propertyAId: string;
  let roomAId: string;

  beforeAll(async () => {
    await startTestDatabase();

    // Org A setup
    const orgA = await Organization.create({
      name: 'Lotus PG',
      ownerName: 'Lotus Owner',
      phone: '9777711111',
      email: 'owner@lotus.com',
      settings: { rentDueDay: 1, gracePeriodDays: 5, defaultLateFeePaise: 10000 },
    });
    orgAId = orgA._id.toString();

    const userA = await User.create({
      organization: orgA._id,
      name: 'Lotus Owner',
      phone: '9777711111',
      email: 'owner@lotus.com',
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
      name: 'Tulip PG',
      ownerName: 'Tulip Owner',
      phone: '9777722222',
      email: 'owner@tulip.com',
      settings: { rentDueDay: 1, gracePeriodDays: 5, defaultLateFeePaise: 10000 },
    });
    orgBId = orgB._id.toString();

    const userB = await User.create({
      organization: orgB._id,
      name: 'Tulip Owner',
      phone: '9777722222',
      email: 'owner@tulip.com',
      password: 'Password123!',
      role: 'owner',
    });

    orgBToken = generateToken({
      userId: userB._id.toString(),
      email: userB.email,
      role: userB.role,
      orgId: orgBId,
    });

    // Property, Room, Beds for Org A
    const propA = await Property.create({
      organization: orgA._id,
      name: 'Lotus Green',
      code: 'LOT1',
      type: 'girls',
      address: 'Koramangala 4th Block, Bengaluru',
      totalFloors: 2,
      electricityRatePaisePerUnit: 1200, // ₹12/unit
      upiVpa: 'lotus@upi',
    });
    propertyAId = propA._id.toString();

    const roomA = await Room.create({
      organization: orgA._id,
      property: propA._id,
      roomNumber: '201',
      floorNumber: 2,
      sharingType: 2,
      baseRentPaisePerBed: 900000,
    });
    roomAId = roomA._id.toString();

    const bed1 = await Bed.create({
      organization: orgA._id,
      property: propA._id,
      room: roomA._id,
      bedNumber: '201-A',
      status: 'occupied',
      baseRentPaise: 900000,
    });

    const bed2 = await Bed.create({
      organization: orgA._id,
      property: propA._id,
      room: roomA._id,
      bedNumber: '201-B',
      status: 'occupied',
      baseRentPaise: 900000,
    });

    // Tenants in Room 201
    const t1 = await Tenant.create({
      organization: orgA._id,
      property: propA._id,
      currentBed: bed1._id,
      fullName: 'Priya Iyer',
      phone: '9888800001',
      monthlyRentPaise: 900000,
      depositPaise: 1800000,
      status: 'active',
      kycConsent: true,
    });

    const t2 = await Tenant.create({
      organization: orgA._id,
      property: propA._id,
      currentBed: bed2._id,
      fullName: 'Ananya Verma',
      phone: '9888800002',
      monthlyRentPaise: 900000,
      depositPaise: 1800000,
      status: 'active',
      kycConsent: true,
    });

    await BedAssignment.create({
      organization: orgA._id,
      property: propA._id,
      room: roomA._id,
      bed: bed1._id,
      tenant: t1._id,
      startDate: new Date('2026-10-01'),
      monthlyRentPaise: 900000,
      depositPaise: 1800000,
      status: 'active',
    });

    await BedAssignment.create({
      organization: orgA._id,
      property: propA._id,
      room: roomA._id,
      bed: bed2._id,
      tenant: t2._id,
      startDate: new Date('2026-10-01'),
      monthlyRentPaise: 900000,
      depositPaise: 1800000,
      status: 'active',
    });
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  describe('POST /api/meters/reading', () => {
    it('records meter reading and calculates equal split across room tenants in integer paise', async () => {
      const res = await request(app)
        .post('/api/meters/reading')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({
          propertyId: propertyAId,
          roomId: roomAId,
          meterIdentifier: 'Room 201 Sub-meter',
          previousReading: 1200,
          currentReading: 1250, // 50 units
          ratePaisePerUnit: 1200, // ₹12/unit -> total 60,000 paise (₹600)
          splitMethod: 'equal',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      expect(data.unitsConsumed).toBe(50);
      expect(data.totalAmountPaise).toBe(60000);
      expect(data.tenantSplits.length).toBe(2);

      // Verify each tenant gets 30,000 paise (₹300)
      expect(data.tenantSplits[0].sharePaise).toBe(30000);
      expect(data.tenantSplits[1].sharePaise).toBe(30000);
    });

    it('rejects reading when currentReading is less than previousReading with 400', async () => {
      const res = await request(app)
        .post('/api/meters/reading')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({
          propertyId: propertyAId,
          roomId: roomAId,
          previousReading: 1500,
          currentReading: 1400,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('CRITICAL: Organization B cannot record reading for Org A room (returns 404)', async () => {
      const res = await request(app)
        .post('/api/meters/reading')
        .set('Authorization', `Bearer ${orgBToken}`)
        .send({
          propertyId: propertyAId,
          roomId: roomAId,
          previousReading: 1250,
          currentReading: 1300,
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/meters/readings & GET /api/meters/room/:roomId/latest', () => {
    it('returns latest reading for pre-filling subsequent meter reading', async () => {
      const res = await request(app)
        .get(`/api/meters/room/${roomAId}/latest`)
        .set('Authorization', `Bearer ${orgAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.currentReading).toBe(1250);
    });

    it('lists readings for Org A', async () => {
      const res = await request(app)
        .get('/api/meters/readings')
        .set('Authorization', `Bearer ${orgAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('Organization B gets empty meter readings list', async () => {
      const res = await request(app)
        .get('/api/meters/readings')
        .set('Authorization', `Bearer ${orgBToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(0);
    });

    it('updates an existing reading via PUT /api/meters/reading/:id', async () => {
      const readings = await request(app)
        .get('/api/meters/readings')
        .set('Authorization', `Bearer ${orgAToken}`);
      const readingId = readings.body.data[0]._id;

      const res = await request(app)
        .put(`/api/meters/reading/${readingId}`)
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({
          currentReading: 1300,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.currentReading).toBe(1300);
      expect(res.body.data.unitsConsumed).toBe(100);
    });

    it('deletes a meter reading via DELETE /api/meters/reading/:id', async () => {
      const readings = await request(app)
        .get('/api/meters/readings')
        .set('Authorization', `Bearer ${orgAToken}`);
      const readingId = readings.body.data[0]._id;

      const res = await request(app)
        .delete(`/api/meters/reading/${readingId}`)
        .set('Authorization', `Bearer ${orgAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
