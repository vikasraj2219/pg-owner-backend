import request from 'supertest';
import { app } from '../src/app';
import { startTestDatabase, stopTestDatabase } from './testDb';
import { User } from '../src/models/User';
import { Organization } from '../src/models/Organization';
import { Property } from '../src/models/Property';
import { Room } from '../src/models/Room';
import { Bed } from '../src/models/Bed';

describe('Property & Room Management API (Stage 2 Backend)', () => {
  let tokenOrgA: string;
  let orgAId: string;
  let tokenOrgB: string;

  beforeAll(async () => {
    await startTestDatabase();

    // Clean up test data
    await User.deleteMany({ email: /@test-stage2-prop\.com$/ });
    await Organization.deleteMany({ email: /@test-stage2-prop\.com$/ });
    await Property.deleteMany({});
    await Room.deleteMany({});
    await Bed.deleteMany({});

    // 1. Setup Organization A (Starter trial: max 1 property, max 30 beds)
    const regResA = await request(app).post('/api/auth/register-owner').send({
      ownerName: 'Owner Alpha',
      orgName: 'Alpha PG Co',
      phone: '9800000001',
      email: 'alpha@test-stage2-prop.com',
      password: 'Password123!',
    });
    tokenOrgA = regResA.body.data.token;
    orgAId = regResA.body.data.organization.id || regResA.body.data.organization._id;

    // 2. Setup Organization B
    const regResB = await request(app).post('/api/auth/register-owner').send({
      ownerName: 'Owner Beta',
      orgName: 'Beta PG Co',
      phone: '9800000002',
      email: 'beta@test-stage2-prop.com',
      password: 'Password123!',
    });
    tokenOrgB = regResB.body.data.token;
  }, 60000);

  afterAll(async () => {
    await User.deleteMany({ email: /@test-stage2-prop\.com$/ });
    await Organization.deleteMany({ email: /@test-stage2-prop\.com$/ });
    await Property.deleteMany({});
    await Room.deleteMany({});
    await Bed.deleteMany({});
    await stopTestDatabase();
  });

  let createdPropertyId: string;

  describe('POST /api/properties', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app).post('/api/properties').send({
        name: 'Alpha Heights',
        type: 'boys',
        upiVpa: 'alpha@upi',
      });
      expect(res.status).toBe(401);
    });

    it('rejects invalid property data with 400', async () => {
      const res = await request(app)
        .post('/api/properties')
        .set('Authorization', `Bearer ${tokenOrgA}`)
        .send({
          name: '',
          type: 'invalid-type',
          upiVpa: 'not-a-vpa',
          electricityRatePaisePerUnit: -100,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('successfully creates a property with integer paise rate and scopes to Org A', async () => {
      const res = await request(app)
        .post('/api/properties')
        .set('Authorization', `Bearer ${tokenOrgA}`)
        .send({
          name: 'Alpha Heights Madhapur',
          type: 'boys',
          address: 'Plot 42, Silicon Valley, Madhapur, Hyderabad',
          upiVpa: 'alphaheights@icici',
          electricityRatePaisePerUnit: 1200, // ₹12.00/unit
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('_id');
      expect(res.body.data.name).toBe('Alpha Heights Madhapur');
      expect(res.body.data.electricityRatePaisePerUnit).toBe(1200);
      expect(res.body.data.organization.toString()).toBe(orgAId);

      createdPropertyId = res.body.data._id;
    });

    it('rejects duplicate property name for the same organization with 409', async () => {
      const res = await request(app)
        .post('/api/properties')
        .set('Authorization', `Bearer ${tokenOrgA}`)
        .send({
          name: 'Alpha Heights Madhapur',
          type: 'boys',
          upiVpa: 'alpha@upi',
          electricityRatePaisePerUnit: 1200,
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/already exists/i);
    });

    it('enforces subscription property quota (Starter plan allows 1 property)', async () => {
      const res = await request(app)
        .post('/api/properties')
        .set('Authorization', `Bearer ${tokenOrgA}`)
        .send({
          name: 'Second Property Attempt',
          type: 'coliving',
          upiVpa: 'alpha2@upi',
          electricityRatePaisePerUnit: 1200,
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Subscription plan limit reached/i);
    });
  });

  describe('GET /api/properties', () => {
    it('returns properties scoped strictly to the caller organization', async () => {
      // Org A should have 1 property
      const resA = await request(app)
        .get('/api/properties')
        .set('Authorization', `Bearer ${tokenOrgA}`);

      expect(resA.status).toBe(200);
      expect(resA.body.count).toBe(1);
      expect(resA.body.data[0]._id).toBe(createdPropertyId);
      expect(resA.body.data[0].stats).toEqual(
        expect.objectContaining({
          totalRooms: 0,
          totalBeds: 0,
          occupiedBeds: 0,
          availableBeds: 0,
        }),
      );

      // Org B should have 0 properties
      const resB = await request(app)
        .get('/api/properties')
        .set('Authorization', `Bearer ${tokenOrgB}`);

      expect(resB.status).toBe(200);
      expect(resB.body.count).toBe(0);
    });
  });

  describe('GET /api/properties/:id', () => {
    it('retrieves property details for owner organization', async () => {
      const res = await request(app)
        .get(`/api/properties/${createdPropertyId}`)
        .set('Authorization', `Bearer ${tokenOrgA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Alpha Heights Madhapur');
      expect(res.body.data.stats).toBeDefined();
    });

    it('prevents cross-tenant access to Org A property from Org B with 404', async () => {
      const res = await request(app)
        .get(`/api/properties/${createdPropertyId}`)
        .set('Authorization', `Bearer ${tokenOrgB}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/not found or does not belong/i);
    });
  });

  describe('PUT /api/properties/:id', () => {
    it('successfully updates property details', async () => {
      const res = await request(app)
        .put(`/api/properties/${createdPropertyId}`)
        .set('Authorization', `Bearer ${tokenOrgA}`)
        .send({
          electricityRatePaisePerUnit: 1400, // ₹14.00/unit
          upiVpa: 'alpha-new@upi',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.electricityRatePaisePerUnit).toBe(1400);
      expect(res.body.data.upiVpa).toBe('alpha-new@upi');
    });
  });

  let createdRoomId: string;

  describe('POST /api/properties/:id/rooms', () => {
    it('auto-generates beds when creating a room (Room 101 with 2 sharing -> 101-A, 101-B)', async () => {
      const res = await request(app)
        .post(`/api/properties/${createdPropertyId}/rooms`)
        .set('Authorization', `Bearer ${tokenOrgA}`)
        .send({
          floorNumber: 1,
          roomNumber: '101',
          sharingType: 2,
          baseRentPaisePerBed: 850000, // ₹8,500.00
          tags: ['AC', 'Washroom'],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.room.roomNumber).toBe('101');
      expect(res.body.data.room.baseRentPaisePerBed).toBe(850000);
      expect(res.body.data.beds).toHaveLength(2);
      expect(res.body.data.beds[0].bedNumber).toBe('101-A');
      expect(res.body.data.beds[1].bedNumber).toBe('101-B');
      expect(res.body.data.beds[0].status).toBe('available');

      createdRoomId = res.body.data.room._id;

      // Verify DB persistence of generated beds
      const dbBeds = await Bed.find({ room: createdRoomId }).sort({ bedNumber: 1 });
      expect(dbBeds).toHaveLength(2);
      expect(dbBeds[0]!.bedNumber).toBe('101-A');
      expect(dbBeds[1]!.bedNumber).toBe('101-B');
      expect(dbBeds[0]!.organization.toString()).toBe(orgAId);
    });

    it('rejects duplicate room number in the same property with 409', async () => {
      const res = await request(app)
        .post(`/api/properties/${createdPropertyId}/rooms`)
        .set('Authorization', `Bearer ${tokenOrgA}`)
        .send({
          floorNumber: 1,
          roomNumber: '101',
          sharingType: 3,
          baseRentPaisePerBed: 700000,
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/already exists/i);
    });

    it('creates triple sharing room 102 on floor 1 (102-A, 102-B, 102-C)', async () => {
      const res = await request(app)
        .post(`/api/properties/${createdPropertyId}/rooms`)
        .set('Authorization', `Bearer ${tokenOrgA}`)
        .send({
          floorNumber: 1,
          roomNumber: '102',
          sharingType: 3,
          baseRentPaisePerBed: 750000,
          tags: ['Non-AC'],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.beds).toHaveLength(3);
      expect(res.body.data.beds.map((b: { bedNumber: string }) => b.bedNumber)).toEqual([
        '102-A',
        '102-B',
        '102-C',
      ]);
    });

    it('prevents Org B from creating rooms in Org A property', async () => {
      const res = await request(app)
        .post(`/api/properties/${createdPropertyId}/rooms`)
        .set('Authorization', `Bearer ${tokenOrgB}`)
        .send({
          floorNumber: 2,
          roomNumber: '201',
          sharingType: 2,
          baseRentPaisePerBed: 800000,
        });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/properties/:id/rooms', () => {
    it('returns all rooms for property with populated beds', async () => {
      const res = await request(app)
        .get(`/api/properties/${createdPropertyId}/rooms`)
        .set('Authorization', `Bearer ${tokenOrgA}`);

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2);
      expect(res.body.data[0].beds).toHaveLength(2);
      expect(res.body.data[1].beds).toHaveLength(3);
    });

    it('filters rooms by floorNumber', async () => {
      const res = await request(app)
        .get(`/api/properties/${createdPropertyId}/rooms?floorNumber=1`)
        .set('Authorization', `Bearer ${tokenOrgA}`);

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2);

      const resFloor2 = await request(app)
        .get(`/api/properties/${createdPropertyId}/rooms?floorNumber=2`)
        .set('Authorization', `Bearer ${tokenOrgA}`);

      expect(resFloor2.status).toBe(200);
      expect(resFloor2.body.count).toBe(0);
    });
  });

  describe('DELETE /api/properties/:id', () => {
    it('prevents non-owners (manager/staff) from deleting property', async () => {
      // Create a manager user in Org A
      const managerUser = await User.create({
        organization: orgAId,
        name: 'Manager Mike',
        email: 'mike@test-stage2-prop.com',
        phone: '9800000003',
        password: 'Password123!',
        role: 'manager',
        status: 'active',
      });

      const { generateToken } = await import('../src/services/token.service');
      const managerToken = generateToken({
        userId: managerUser._id.toString(),
        email: managerUser.email,
        role: 'manager',
        orgId: orgAId,
      });

      const res = await request(app)
        .delete(`/api/properties/${createdPropertyId}`)
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(403);
    });
  });
});
