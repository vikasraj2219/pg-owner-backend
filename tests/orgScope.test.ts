import request from 'supertest';
import express, { Response } from 'express';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { protect, requireRole } from '../src/middleware/auth';
import { enforceOrgScope, scopeFilter } from '../src/middleware/enforceOrgScope';
import { errorHandler } from '../src/middleware/errorHandler';
import { User } from '../src/models/User';
import { Organization } from '../src/models/Organization';
import { generateToken } from '../src/services/token.service';
import { AuthenticatedRequest } from '../src/types';

describe('Organization Scoping & Multi-Tenant Isolation (Stage 1 Test Requirement)', () => {
  let orgAId: string;
  let orgBId: string;
  let tokenOwnerA: string;
  let tokenOwnerB: string;

  // Create test express app mounting test scoped routes
  const testApp = express();
  testApp.use(express.json());

  // Test endpoint 1: Parameter-scoped resource (/properties/:orgId)
  testApp.get(
    '/api/test-scoped/:orgId',
    protect,
    enforceOrgScope,
    (req: AuthenticatedRequest, res: Response) => {
      res.status(200).json({
        success: true,
        message: 'Accessed organization resource successfully',
        orgId: req.orgId,
      });
    },
  );

  // Test endpoint 2: Body-scoped mutation
  testApp.post(
    '/api/test-scoped-create',
    protect,
    enforceOrgScope,
    (req: AuthenticatedRequest, res: Response) => {
      res.status(201).json({
        success: true,
        data: req.body,
      });
    },
  );

  // Test endpoint 3: Role-restricted route (staff cannot access owner-only)
  testApp.get(
    '/api/test-owner-only',
    protect,
    requireRole('owner'),
    (_req: AuthenticatedRequest, res: Response) => {
      res.status(200).json({ success: true, message: 'Owner action allowed' });
    },
  );

  testApp.use(errorHandler);

  beforeAll(async () => {
    await connectDatabase();

    // Create Organization A & Owner A
    const orgA = await Organization.create({
      name: 'Org A Hostels',
      ownerName: 'Owner A',
      phone: '9870000001',
      email: 'ownerA@test-scope.com',
    });
    orgAId = orgA._id.toString();

    const userA = await User.create({
      organization: orgA._id,
      name: 'Owner A',
      email: 'ownerA@test-scope.com',
      phone: '9870000001',
      password: 'password123',
      role: 'owner',
      status: 'active',
    });

    tokenOwnerA = generateToken({
      userId: userA._id.toString(),
      email: userA.email,
      role: userA.role,
      orgId: orgAId,
    });

    // Create Organization B & Owner B
    const orgB = await Organization.create({
      name: 'Org B Coliving',
      ownerName: 'Owner B',
      phone: '9870000002',
      email: 'ownerB@test-scope.com',
    });
    orgBId = orgB._id.toString();

    const userB = await User.create({
      organization: orgB._id,
      name: 'Owner B',
      email: 'ownerB@test-scope.com',
      phone: '9870000002',
      password: 'password123',
      role: 'owner',
      status: 'active',
    });

    tokenOwnerB = generateToken({
      userId: userB._id.toString(),
      email: userB.email,
      role: userB.role,
      orgId: orgBId,
    });
  });

  afterAll(async () => {
    await User.deleteMany({ email: /@test-scope\.com$/ });
    await Organization.deleteMany({ email: /@test-scope\.com$/ });
    await disconnectDatabase();
  });

  it('Owner A can access their own organization resources', async () => {
    const response = await request(testApp)
      .get(`/api/test-scoped/${orgAId}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);

    expect(response.status).toBe(200);
    expect(response.body.orgId).toBe(orgAId);
  });

  it('CRITICAL: Organization B gets a 403 Forbidden when requesting Organization A resources', async () => {
    const response = await request(testApp)
      .get(`/api/test-scoped/${orgAId}`)
      .set('Authorization', `Bearer ${tokenOwnerB}`); // Using Owner B token for Org A route

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain(
      'Forbidden: Access denied to resources of another organization',
    );
  });

  it('CRITICAL: Organization B gets a 403 Forbidden when injecting Organization A ID in body', async () => {
    const response = await request(testApp)
      .post('/api/test-scoped-create')
      .set('Authorization', `Bearer ${tokenOwnerB}`)
      .send({
        title: 'Tampered resource',
        organization: orgAId, // Attempting to assign to Org A
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain(
      'Cannot modify resources belonging to another organization',
    );
  });

  it('scopeFilter helper automatically bounds Mongoose query filters to authenticated org', () => {
    const mockReq = {
      orgId: orgAId,
    } as AuthenticatedRequest;

    const query = scopeFilter(mockReq, { status: 'occupied' });
    expect(query).toEqual({
      status: 'occupied',
      organization: orgAId,
    });
  });

  it('requireRole middleware restricts actions to allowed roles', async () => {
    // Owner A can access
    const ownerRes = await request(testApp)
      .get('/api/test-owner-only')
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(ownerRes.status).toBe(200);

    // Create staff user in Org A
    const staffUser = await User.create({
      organization: orgAId,
      name: 'Staff Member',
      email: 'staff@test-scope.com',
      phone: '9870000003',
      password: 'password123',
      role: 'staff',
      status: 'active',
    });
    const staffToken = generateToken({
      userId: staffUser._id.toString(),
      email: staffUser.email,
      role: staffUser.role,
      orgId: orgAId,
    });

    const staffRes = await request(testApp)
      .get('/api/test-owner-only')
      .set('Authorization', `Bearer ${staffToken}`);
    expect(staffRes.status).toBe(403);
    expect(staffRes.body.message).toContain('Forbidden: You do not have permission');
  });
});
