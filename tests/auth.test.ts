import request from 'supertest';
import { app } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { User } from '../src/models/User';
import { Organization } from '../src/models/Organization';
import { Subscription } from '../src/models/Subscription';

describe('Auth API (Stage 1 Backend)', () => {
  beforeAll(async () => {
    await connectDatabase();
    await User.deleteMany({ email: /@test-stage1\.com$/ });
    await Organization.deleteMany({ email: /@test-stage1\.com$/ });
    await Subscription.deleteMany({});
  });

  afterAll(async () => {
    // Clean up test collections
    await User.deleteMany({ email: /@test-stage1\.com$/ });
    await Organization.deleteMany({ email: /@test-stage1\.com$/ });
    await Subscription.deleteMany({});
    await disconnectDatabase();
  });

  describe('POST /api/auth/register-owner', () => {
    it('successfully registers owner, creates org, user and 14-day starter subscription', async () => {
      const payload = {
        ownerName: 'Vikas Raj',
        orgName: 'Green View PG',
        phone: '9876500001',
        email: 'vikas@test-stage1.com',
        password: 'password123',
      };

      const response = await request(app).post('/api/auth/register-owner').send(payload);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('token');
      expect(response.body.data.user).toEqual(
        expect.objectContaining({
          name: 'Vikas Raj',
          email: 'vikas@test-stage1.com',
          phone: '9876500001',
          role: 'owner',
        }),
      );
      expect(response.body.data.organization).toEqual(
        expect.objectContaining({
          name: 'Green View PG',
          ownerName: 'Vikas Raj',
        }),
      );
      expect(response.body.data.subscription).toEqual(
        expect.objectContaining({
          plan: 'starter',
          status: 'trialing',
          maxProperties: 1,
          maxBeds: 30,
        }),
      );

      // Verify password is not leaked in response
      expect(response.body.data.user).not.toHaveProperty('password');

      // Verify DB persistence
      const dbUser = await User.findOne({ email: payload.email }).select('+password');
      expect(dbUser).not.toBeNull();
      expect(dbUser?.password).not.toBe(payload.password); // Must be hashed
      const isPasswordValid = await dbUser?.comparePassword(payload.password);
      expect(isPasswordValid).toBe(true);

      const dbOrg = await Organization.findById(dbUser?.organization);
      expect(dbOrg).not.toBeNull();
      expect(dbOrg?.settings.defaultLateFeePaise).toBe(10000); // Default ₹100
    });

    it('returns 409 conflict when registering with already used email', async () => {
      const payload = {
        ownerName: 'Duplicate Email',
        orgName: 'Duplicate PG',
        phone: '9876500002',
        email: 'vikas@test-stage1.com', // same email
        password: 'password123',
      };

      const response = await request(app).post('/api/auth/register-owner').send(payload);

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('email address already exists');
    });

    it('returns 409 conflict when registering with already used phone number', async () => {
      const payload = {
        ownerName: 'Duplicate Phone',
        orgName: 'Duplicate PG 2',
        phone: '9876500001', // same phone
        email: 'unique@test-stage1.com',
        password: 'password123',
      };

      const response = await request(app).post('/api/auth/register-owner').send(payload);

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('phone number already exists');
    });

    it('returns 400 when validation constraints fail (short password, invalid email)', async () => {
      const payload = {
        ownerName: 'A', // too short
        orgName: 'B',
        phone: '123', // too short
        email: 'invalid-email',
        password: '123', // < 6 chars
      };

      const response = await request(app).post('/api/auth/register-owner').send(payload);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.errors).toHaveProperty('ownerName');
      expect(response.body.errors).toHaveProperty('phone');
      expect(response.body.errors).toHaveProperty('email');
      expect(response.body.errors).toHaveProperty('password');
    });
  });

  describe('POST /api/auth/login', () => {
    it('successfully logs in with email', async () => {
      const response = await request(app).post('/api/auth/login').send({
        identifier: 'vikas@test-stage1.com',
        password: 'password123',
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('token');
      expect(response.body.data.user.email).toBe('vikas@test-stage1.com');
      expect(response.body.data.organization.name).toBe('Green View PG');
      expect(response.body.data.subscription.status).toBe('trialing');
    });

    it('successfully logs in with phone number', async () => {
      const response = await request(app).post('/api/auth/login').send({
        identifier: '9876500001',
        password: 'password123',
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('token');
      expect(response.body.data.user.phone).toBe('9876500001');
    });

    it('returns 401 when password does not match', async () => {
      const response = await request(app).post('/api/auth/login').send({
        identifier: 'vikas@test-stage1.com',
        password: 'wrongpassword',
      });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid email/phone or password');
    });

    it('returns 401 when user does not exist', async () => {
      const response = await request(app).post('/api/auth/login').send({
        identifier: 'nonexistent@test-stage1.com',
        password: 'password123',
      });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/auth/me', () => {
    let authToken = '';

    beforeAll(async () => {
      const loginRes = await request(app).post('/api/auth/login').send({
        identifier: 'vikas@test-stage1.com',
        password: 'password123',
      });
      authToken = loginRes.body.data.token;
    });

    it('returns authenticated user profile, organization and subscription with valid token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe('vikas@test-stage1.com');
      expect(response.body.data.organization.name).toBe('Green View PG');
      expect(response.body.data.subscription.plan).toBe('starter');
    });

    it('returns 401 when authorization header is missing', async () => {
      const response = await request(app).get('/api/auth/me');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('returns 401 when token is invalid or corrupted', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid.token.payload');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });
});
