import request from 'supertest';
import { createApp } from '../src/app';
import { startTestDatabase, stopTestDatabase } from './testDb';
import { Organization } from '../src/models/Organization';
import { User } from '../src/models/User';
import { Property } from '../src/models/Property';
import { Subscription } from '../src/models/Subscription';
import { generateToken } from '../src/services/token.service';

const app = createApp();
jest.setTimeout(30000);

describe('Team Roles & Multi-Staff Access API (Stage 7 Backend)', () => {
  let orgAToken: string;
  let managerAToken: string;
  let orgBToken: string;
  let orgAId: string;
  let orgBId: string;
  let propertyAId: string;
  let createdStaffId: string;

  beforeAll(async () => {
    await startTestDatabase();

    // 1. Setup Org A with active subscription
    const orgA = await Organization.create({
      name: 'Skyline PG',
      ownerName: 'Suresh Owner',
      phone: '9444411111',
      email: 'suresh@skyline.com',
      settings: { rentDueDay: 1, gracePeriodDays: 5, defaultLateFeePaise: 10000 },
    });
    orgAId = orgA._id.toString();

    await Subscription.create({
      organization: orgA._id,
      plan: 'growth',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const ownerA = await User.create({
      organization: orgA._id,
      name: 'Suresh Owner',
      phone: '9444411111',
      email: 'suresh@skyline.com',
      password: 'Password123!',
      role: 'owner',
    });

    orgAToken = generateToken({
      userId: ownerA._id.toString(),
      email: ownerA.email,
      role: ownerA.role,
      orgId: orgAId,
    });

    // Property for Org A
    const propA = await Property.create({
      organization: orgA._id,
      name: 'Skyline Tower A',
      code: 'SKY1',
      type: 'coliving',
      address: 'Whitefield, Bengaluru',
      totalFloors: 3,
      upiVpa: 'skyline@upi',
    });
    propertyAId = propA._id.toString();

    // Org B
    const orgB = await Organization.create({
      name: 'Oasis PG',
      ownerName: 'Anil Owner',
      phone: '9444422222',
      email: 'anil@oasis.com',
      settings: { rentDueDay: 1, gracePeriodDays: 5, defaultLateFeePaise: 10000 },
    });
    orgBId = orgB._id.toString();

    await Subscription.create({
      organization: orgB._id,
      plan: 'starter',
      status: 'trialing',
    });

    const ownerB = await User.create({
      organization: orgB._id,
      name: 'Anil Owner',
      phone: '9444422222',
      email: 'anil@oasis.com',
      password: 'Password123!',
      role: 'owner',
    });

    orgBToken = generateToken({
      userId: ownerB._id.toString(),
      email: ownerB.email,
      role: ownerB.role,
      orgId: orgBId,
    });
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  describe('POST /api/team/members', () => {
    it('owner can create a manager assigned to a specific property', async () => {
      const res = await request(app)
        .post('/api/team/members')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({
          name: 'Karan Manager',
          email: 'karan@skyline.com',
          phone: '9444433333',
          password: 'Password123!',
          role: 'manager',
          assignedProperties: [propertyAId],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.role).toBe('manager');
      expect(res.body.data.assignedProperties.length).toBe(1);

      managerAToken = generateToken({
        userId: res.body.data._id,
        email: res.body.data.email,
        role: res.body.data.role,
        orgId: orgAId,
      });
    });

    it('owner can create a staff/warden member', async () => {
      const res = await request(app)
        .post('/api/team/members')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({
          name: 'Sunil Warden',
          email: 'sunil@skyline.com',
          phone: '9444455555',
          password: 'Password123!',
          role: 'staff',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.role).toBe('staff');
      createdStaffId = res.body.data._id;
    });

    it('prevents non-owner (manager) from creating team members with 403', async () => {
      const res = await request(app)
        .post('/api/team/members')
        .set('Authorization', `Bearer ${managerAToken}`)
        .send({
          name: 'Intruder Staff',
          email: 'intruder@skyline.com',
          phone: '9444466666',
          password: 'Password123!',
          role: 'staff',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Only organization owner');
    });
  });

  describe('GET /api/team/members', () => {
    it('returns all team members for Org A', async () => {
      const res = await request(app)
        .get('/api/team/members')
        .set('Authorization', `Bearer ${orgAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(3); // owner, manager, staff
    });

    it('CRITICAL: Organization B sees only their own team members (tenant isolation)', async () => {
      const res = await request(app)
        .get('/api/team/members')
        .set('Authorization', `Bearer ${orgBToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1); // only Org B owner
      expect(res.body.data[0].email).toBe('anil@oasis.com');
    });
  });

  describe('PUT /api/team/members/:id & DELETE /api/team/members/:id', () => {
    it('owner can update team member details', async () => {
      const res = await request(app)
        .put(`/api/team/members/${createdStaffId}`)
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({
          name: 'Sunil Senior Warden',
          role: 'manager',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Sunil Senior Warden');
      expect(res.body.data.role).toBe('manager');
    });

    it('owner can remove a team member', async () => {
      const res = await request(app)
        .delete(`/api/team/members/${createdStaffId}`)
        .set('Authorization', `Bearer ${orgAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const check = await User.findById(createdStaffId);
      expect(check).toBeNull();
    });
  });
});

