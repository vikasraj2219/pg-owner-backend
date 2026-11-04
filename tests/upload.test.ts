import request from 'supertest';
import { createApp } from '../src/app';
import { startTestDatabase, stopTestDatabase } from './testDb';
import { Organization } from '../src/models/Organization';
import { User } from '../src/models/User';
import { Subscription } from '../src/models/Subscription';
import { generateToken } from '../src/services/token.service';

const app = createApp();
jest.setTimeout(30000);

describe('Cloudinary Storage & KYC Upload API', () => {
  let orgAId: string;
  let orgBId: string;
  let orgAToken: string;
  let orgBToken: string;

  beforeAll(async () => {
    await startTestDatabase();

    // 1. Setup Organization A
    const orgA = await Organization.create({
      name: 'Emerald PG Org',
      ownerName: 'Emerald Owner',
      phone: '9876543210',
      email: 'ownerA@emerald.com',
    });
    orgAId = orgA._id.toString();

    const userA = await User.create({
      organization: orgA._id,
      name: 'Emerald Owner',
      email: 'ownerA@emerald.com',
      password: 'Password123!',
      role: 'owner',
      phone: '9876543210',
    });

    await Subscription.create({
      organization: orgA._id,
      plan: 'growth',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      maxProperties: 5,
      maxBeds: 100,
    });

    orgAToken = generateToken({
      userId: userA._id.toString(),
      orgId: orgAId,
      role: 'owner',
      email: userA.email,
    });

    // 2. Setup Organization B
    const orgB = await Organization.create({
      name: 'Ruby PG Org',
      ownerName: 'Ruby Owner',
      phone: '9876543211',
      email: 'ownerB@ruby.com',
    });
    orgBId = orgB._id.toString();

    const userB = await User.create({
      organization: orgB._id,
      name: 'Ruby Owner',
      email: 'ownerB@ruby.com',
      password: 'Password123!',
      role: 'owner',
      phone: '9876543211',
    });

    await Subscription.create({
      organization: orgB._id,
      plan: 'starter',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      maxProperties: 1,
      maxBeds: 30,
    });

    orgBToken = generateToken({
      userId: userB._id.toString(),
      orgId: orgBId,
      role: 'owner',
      email: userB.email,
    });
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  describe('GET /api/uploads/status', () => {
    it('returns storage provider status and limits', async () => {
      const res = await request(app)
        .get('/api/uploads/status')
        .set('Authorization', `Bearer ${orgAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.provider).toBe('cloudinary');
      expect(res.body.data.maxFileSizeMb).toBe(10);
      expect(res.body.data.allowedFormats).toContain('jpeg');
    });

    it('rejects unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/uploads/status');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/uploads/kyc (Cloudinary Document Upload)', () => {
    it('successfully uploads an image and returns Cloudinary secure URL and publicId', async () => {
      const fakeImageBuffer = Buffer.from('fake-jpeg-binary-image-data-for-testing');

      const res = await request(app)
        .post('/api/uploads/kyc')
        .set('Authorization', `Bearer ${orgAToken}`)
        .attach('file', fakeImageBuffer, {
          filename: 'aadhaar_front.jpg',
          contentType: 'image/jpeg',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.secureUrl).toContain('cloudinary.com');
      expect(res.body.data.publicId).toContain(`pg-owner/${orgAId}/kyc`);
      expect(res.body.data.format).toBe('jpg');
      expect(res.body.data.originalName).toBe('aadhaar_front.jpg');
    });

    it('rejects upload when no file is attached with 400', async () => {
      const res = await request(app)
        .post('/api/uploads/kyc')
        .set('Authorization', `Bearer ${orgAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/no file/i);
    });

    it('rejects unsupported file formats with 400', async () => {
      const fakeExecutable = Buffer.from('binary-exe-data');

      const res = await request(app)
        .post('/api/uploads/kyc')
        .set('Authorization', `Bearer ${orgAToken}`)
        .attach('file', fakeExecutable, {
          filename: 'malicious.exe',
          contentType: 'application/octet-stream',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/only jpeg, png, webp, and pdf/i);
    });
  });

  describe('DELETE /api/uploads/:publicId (Document Deletion & Tenant Boundary)', () => {
    it('prevents Organization B from deleting Organization A file with 403', async () => {
      const orgAFilePublicId = `pg-owner/${orgAId}/kyc/aadhaar_12345`;

      const res = await request(app)
        .delete(`/api/uploads/${encodeURIComponent(orgAFilePublicId)}`)
        .set('Authorization', `Bearer ${orgBToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/unauthorized/i);
    });

    it('allows Organization A to delete its own uploaded document', async () => {
      // First upload a document
      const fakeImageBuffer = Buffer.from('delete-test-file-buffer');
      const uploadRes = await request(app)
        .post('/api/uploads/kyc')
        .set('Authorization', `Bearer ${orgAToken}`)
        .attach('file', fakeImageBuffer, {
          filename: 'delete_me.jpg',
          contentType: 'image/jpeg',
        });

      expect(uploadRes.status).toBe(201);
      const uploadedPublicId = uploadRes.body.data.publicId;

      const res = await request(app)
        .delete(`/api/uploads/${encodeURIComponent(uploadedPublicId)}`)
        .set('Authorization', `Bearer ${orgAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
