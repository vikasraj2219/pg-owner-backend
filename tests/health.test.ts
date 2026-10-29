import request from 'supertest';
import { app } from '../src/app';

describe('Health Check API', () => {
  it('GET /health returns 200 with status ok', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'ok');
    expect(response.body).toHaveProperty('timestamp');
  });

  it('GET /api/health returns 200 with detailed system and database status', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('success', true);
    expect(response.body.data).toHaveProperty('status', 'ok');
    expect(response.body.data).toHaveProperty('uptimeSeconds');
    expect(response.body.data).toHaveProperty('environment', 'test');
    expect(response.body.data).toHaveProperty('database');
    expect(response.body.data.database).toHaveProperty('state');
    expect(response.body.data).toHaveProperty('version', '0.1.0');
  });

  it('GET /unknown-route returns 404 with error message', async () => {
    const response = await request(app).get('/api/non-existent-endpoint');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      message: 'Endpoint not found: GET /api/non-existent-endpoint',
    });
  });
});
