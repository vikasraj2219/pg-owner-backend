import request from 'supertest';
import { createApp } from '../src/app';
import { startTestDatabase, stopTestDatabase } from './testDb';
import { Organization } from '../src/models/Organization';
import { User } from '../src/models/User';
import { Property } from '../src/models/Property';
import { Room } from '../src/models/Room';
import { Bed } from '../src/models/Bed';
import { Tenant } from '../src/models/Tenant';
import { generateToken } from '../src/services/token.service';

const app = createApp();
jest.setTimeout(30000);

describe('Notice Period Management API (Stage 6 Backend)', () => {
  let orgAToken: string;
  let orgBToken: string;
  let orgAId: string;
  let orgBId: string;
  let bedAId: string;
  let tenantAId: string;

  beforeAll(async () => {
    await startTestDatabase();

    // Org A setup
    const orgA = await Organization.create({
      name: 'Sunrise Living',
      ownerName: 'Sunrise Owner',
      phone: '9555511111',
      email: 'owner@sunrise.com',
      settings: { rentDueDay: 1, gracePeriodDays: 5, defaultLateFeePaise: 10000 },
    });
    orgAId = orgA._id.toString();

    const userA = await User.create({
      organization: orgA._id,
      name: 'Sunrise Owner',
      phone: '9555511111',
      email: 'owner@sunrise.com',
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
      name: 'Sunset Living',
      ownerName: 'Sunset Owner',
      phone: '9555522222',
      email: 'owner@sunset.com',
      settings: { rentDueDay: 1, gracePeriodDays: 5, defaultLateFeePaise: 10000 },
    });
    orgBId = orgB._id.toString();

    const userB = await User.create({
      organization: orgB._id,
      name: 'Sunset Owner',
      phone: '9555522222',
      email: 'owner@sunset.com',
      password: 'Password123!',
      role: 'owner',
    });

    orgBToken = generateToken({
      userId: userB._id.toString(),
      email: userB.email,
      role: userB.role,
      orgId: orgBId,
    });

    // Property, Room, Bed, Tenant for Org A
    const propA = await Property.create({
      organization: orgA._id,
      name: 'Sunrise PG',
      code: 'SUN1',
      type: 'boys',
      address: 'HSR Layout Sector 1, Bengaluru',
      totalFloors: 2,
      upiVpa: 'sunrise@upi',
    });

    const roomA = await Room.create({
      organization: orgA._id,
      property: propA._id,
      roomNumber: '101',
      floorNumber: 1,
      sharingType: 1,
      baseRentPaisePerBed: 1100000,
    });

    const bedA = await Bed.create({
      organization: orgA._id,
      property: propA._id,
      room: roomA._id,
      bedNumber: '101-A',
      status: 'occupied',
      baseRentPaise: 1100000,
    });
    bedAId = bedA._id.toString();

    const tenantA = await Tenant.create({
      organization: orgA._id,
      property: propA._id,
      currentBed: bedA._id,
      fullName: 'Vikash Kumar',
      phone: '9555500001',
      monthlyRentPaise: 1100000,
      depositPaise: 2200000,
      status: 'active',
      kycConsent: true,
    });
    tenantAId = tenantA._id.toString();

    bedA.currentTenant = tenantA._id;
    await bedA.save();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  describe('POST /api/tenants/:id/notice', () => {
    it('sets notice period on tenant and bed with expectedVacateDate', async () => {
      const vacateDate = new Date();
      vacateDate.setDate(vacateDate.getDate() + 30); // 30 days notice

      const res = await request(app)
        .post(`/api/tenants/${tenantAId}/notice`)
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({
          expectedVacateDate: vacateDate.toISOString(),
          notes: 'Job transfer to Pune',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('notice_period');

      // Verify Bed updated to notice_period with noticeEndDate
      const bedAfter = await Bed.findById(bedAId);
      expect(bedAfter?.status).toBe('notice_period');
      expect(bedAfter?.noticeEndDate).toBeDefined();
    });

    it('CRITICAL: Organization B cannot set notice on Org A tenant (returns 404)', async () => {
      const res = await request(app)
        .post(`/api/tenants/${tenantAId}/notice`)
        .set('Authorization', `Bearer ${orgBToken}`)
        .send({
          expectedVacateDate: new Date().toISOString(),
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/tenants/:id/cancel-notice', () => {
    it('cancels notice period and restores bed to occupied and tenant to active', async () => {
      const res = await request(app)
        .post(`/api/tenants/${tenantAId}/cancel-notice`)
        .set('Authorization', `Bearer ${orgAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('active');

      const bedAfter = await Bed.findById(bedAId);
      expect(bedAfter?.status).toBe('occupied');
      expect(bedAfter?.noticeEndDate).toBeFalsy();
    });
  });
});
