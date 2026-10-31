import request from 'supertest';
import express, { Response } from 'express';
import { startTestDatabase, stopTestDatabase } from './testDb';
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
    await startTestDatabase();

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
      name: 'Org B Hostels',
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
  }, 60000);

  afterAll(async () => {
    await User.deleteMany({ email: /@test-scope\.com$/ });
    await Organization.deleteMany({ email: /@test-scope\.com$/ });
    await stopTestDatabase();
  });

  it('Owner A can access their own organization resources', async () => {
    const response = await request(testApp)
      .get(`/api/test-scoped/${orgAId}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.orgId).toBe(orgAId);
  });

  it('CRITICAL: Organization B gets a 403 Forbidden when attempting to access Organization A resources', async () => {
    // Owner B attempts to request Organization A's route
    const response = await request(testApp)
      .get(`/api/test-scoped/${orgAId}`)
      .set('Authorization', `Bearer ${tokenOwnerB}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('Access denied to resources of another organization');
  });

  it('CRITICAL: Organization B gets a 403 Forbidden when injecting Organization A ID in request body', async () => {
    // Owner B attempts to create or mutate data specifying Org A ID
    const response = await request(testApp)
      .post('/api/test-scoped-create')
      .set('Authorization', `Bearer ${tokenOwnerB}`)
      .send({
        organization: orgAId, // Attempt to write to Org A
        name: 'Malicious Room',
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain(
      'Cannot modify resources belonging to another organization',
    );
  });

  it('Automatically binds body organization to authenticated orgId when not specified', async () => {
    const response = await request(testApp)
      .post('/api/test-scoped-create')
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({
        name: 'Legitimate Room',
      });

    expect(response.status).toBe(201);
    expect(response.body.data.organization).toBe(orgAId);
  });

  it('scopeFilter helper safely appends organization to Mongoose query criteria', () => {
    const mockReq: AuthenticatedRequest = {
      orgId: orgAId,
    } as AuthenticatedRequest;

    const queryFilter = scopeFilter(mockReq, { status: 'occupied', floor: 2 });

    expect(queryFilter).toEqual({
      status: 'occupied',
      floor: 2,
      organization: orgAId,
    });
  });

  it('scopeFilter throws 403 if req.orgId is missing', () => {
    const mockReq: AuthenticatedRequest = {} as AuthenticatedRequest;

    expect(() => {
      scopeFilter(mockReq, { status: 'occupied' });
    }).toThrow('Cannot scope query without authenticated organization context');
  });
});
