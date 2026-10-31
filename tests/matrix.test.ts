import request from 'supertest';
import { app } from '../src/app';
import { startTestDatabase, stopTestDatabase } from './testDb';
import { User } from '../src/models/User';
import { Organization } from '../src/models/Organization';
import { Property } from '../src/models/Property';
import { Room } from '../src/models/Room';
import { Bed } from '../src/models/Bed';

describe('Visual Bed Matrix & Bed Status API (Stage 2 Backend)', () => {
  let tokenOrgA: string;
  let tokenOrgB: string;
  let propertyId: string;
  let bed101AId: string;
  let bed101BId: string;

  beforeAll(async () => {
    await startTestDatabase();

    await User.deleteMany({ email: /@test-stage2-matrix\.com$/ });
    await Organization.deleteMany({ email: /@test-stage2-matrix\.com$/ });
    await Property.deleteMany({});
    await Room.deleteMany({});
    await Bed.deleteMany({});

    // 1. Create Org A
    const regResA = await request(app).post('/api/auth/register-owner').send({
      ownerName: 'Owner Matrix Alpha',
      orgName: 'Matrix Living',
      phone: '9811100001',
      email: 'owner@test-stage2-matrix.com',
      password: 'Password123!',
    });
    tokenOrgA = regResA.body.data.token;

    // 2. Create Org B
    const regResB = await request(app).post('/api/auth/register-owner').send({
      ownerName: 'Owner Matrix Beta',
      orgName: 'Other Hostel',
      phone: '9811100002',
      email: 'other@test-stage2-matrix.com',
      password: 'Password123!',
    });
    tokenOrgB = regResB.body.data.token;

    // 3. Create Property for Org A
    const propRes = await request(app)
      .post('/api/properties')
      .set('Authorization', `Bearer ${tokenOrgA}`)
      .send({
        name: 'Matrix Residency',
        type: 'coliving',
        address: 'Gachibowli, Hyderabad',
        upiVpa: 'matrix@upi',
        electricityRatePaisePerUnit: 1200,
      });
    propertyId = propRes.body.data._id;

    // 4. Create Floor 1 Rooms
    const r101Res = await request(app)
      .post(`/api/properties/${propertyId}/rooms`)
      .set('Authorization', `Bearer ${tokenOrgA}`)
      .send({
        floorNumber: 1,
        roomNumber: '101',
        sharingType: 2,
        baseRentPaisePerBed: 900000,
        tags: ['AC', 'Washroom'],
      });
    bed101AId = r101Res.body.data.beds[0]._id;
    bed101BId = r101Res.body.data.beds[1]._id;

    // 5. Create Floor 2 Room (Room 201 with 1 bed)
    await request(app)
      .post(`/api/properties/${propertyId}/rooms`)
      .set('Authorization', `Bearer ${tokenOrgA}`)
      .send({
        floorNumber: 2,
        roomNumber: '201',
        sharingType: 1,
        baseRentPaisePerBed: 1500000,
        tags: ['Private Room', 'Balcony'],
      });
  }, 60000);

  afterAll(async () => {
    await User.deleteMany({ email: /@test-stage2-matrix\.com$/ });
    await Organization.deleteMany({ email: /@test-stage2-matrix\.com$/ });
    await Property.deleteMany({});
    await Room.deleteMany({});
    await Bed.deleteMany({});
    await stopTestDatabase();
  });

  describe('GET /api/properties/:id/matrix', () => {
    it('returns grouped floor-room-bed hierarchy with summary statistics', async () => {
      const res = await request(app)
        .get(`/api/properties/${propertyId}/matrix`)
        .set('Authorization', `Bearer ${tokenOrgA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      expect(data.property.name).toBe('Matrix Residency');
      expect(data.floors).toHaveLength(2); // Floor 1 and Floor 2

      // Check Floor 1
      const floor1 = data.floors.find((f: { floorNumber: number }) => f.floorNumber === 1);
      expect(floor1).toBeDefined();
      expect(floor1.rooms).toHaveLength(1);
      expect(floor1.rooms[0].roomNumber).toBe('101');
      expect(floor1.rooms[0].baseRentPaisePerBed).toBe(900000);
      expect(floor1.rooms[0].beds).toHaveLength(2);
      expect(floor1.rooms[0].beds[0].bedNumber).toBe('101-A');
      expect(floor1.rooms[0].beds[0].status).toBe('available');
      expect(floor1.rooms[0].beds[0].baseRentPaise).toBe(900000);

      // Check Floor 2
      const floor2 = data.floors.find((f: { floorNumber: number }) => f.floorNumber === 2);
      expect(floor2).toBeDefined();
      expect(floor2.rooms).toHaveLength(1);
      expect(floor2.rooms[0].roomNumber).toBe('201');
      expect(floor2.rooms[0].beds).toHaveLength(1);

      // Check Summary
      expect(data.summary).toEqual({
        totalRooms: 2,
        totalBeds: 3,
        occupiedBeds: 0,
        availableBeds: 3,
        noticePeriodBeds: 0,
        maintenanceBeds: 0,
        occupancyRate: 0,
      });
    });

    it('prevents cross-tenant access to matrix from Org B with 404', async () => {
      const res = await request(app)
        .get(`/api/properties/${propertyId}/matrix`)
        .set('Authorization', `Bearer ${tokenOrgB}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/not found or does not belong/i);
    });
  });

  describe('PUT /api/beds/:id/status & GET /api/beds/:id', () => {
    it('retrieves single bed details with populated room and property', async () => {
      const res = await request(app)
        .get(`/api/beds/${bed101AId}`)
        .set('Authorization', `Bearer ${tokenOrgA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.bedNumber).toBe('101-A');
      expect(res.body.data.room.roomNumber).toBe('101');
      expect(res.body.data.property.name).toBe('Matrix Residency');
    });

    it('updates bed status to maintenance with maintenanceNote', async () => {
      const res = await request(app)
        .put(`/api/beds/${bed101AId}/status`)
        .set('Authorization', `Bearer ${tokenOrgA}`)
        .send({
          status: 'maintenance',
          maintenanceNote: 'Broken switchboard, electrician scheduled',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('maintenance');
      expect(res.body.data.maintenanceNote).toBe('Broken switchboard, electrician scheduled');

      // Verify matrix summary updates
      const matrixRes = await request(app)
        .get(`/api/properties/${propertyId}/matrix`)
        .set('Authorization', `Bearer ${tokenOrgA}`);

      expect(matrixRes.body.data.summary.maintenanceBeds).toBe(1);
      expect(matrixRes.body.data.summary.availableBeds).toBe(2);
    });

    it('updates bed status to notice_period with noticeEndDate', async () => {
      const futureDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();
      const res = await request(app)
        .put(`/api/beds/${bed101BId}/status`)
        .set('Authorization', `Bearer ${tokenOrgA}`)
        .send({
          status: 'notice_period',
          noticeEndDate: futureDate,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('notice_period');
      expect(res.body.data.noticeEndDate).toBeDefined();

      // Verify matrix summary
      const matrixRes = await request(app)
        .get(`/api/properties/${propertyId}/matrix`)
        .set('Authorization', `Bearer ${tokenOrgA}`);

      expect(matrixRes.body.data.summary.noticePeriodBeds).toBe(1);
      expect(matrixRes.body.data.summary.availableBeds).toBe(1);
      expect(matrixRes.body.data.summary.maintenanceBeds).toBe(1);
    });

    it('prevents Org B from modifying Org A bed status with 404', async () => {
      const res = await request(app)
        .put(`/api/beds/${bed101AId}/status`)
        .set('Authorization', `Bearer ${tokenOrgB}`)
        .send({
          status: 'available',
        });

      expect(res.status).toBe(404);
    });
  });
});
