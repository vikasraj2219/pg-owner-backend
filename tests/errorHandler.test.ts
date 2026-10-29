import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError, errorHandler } from '../src/middleware/errorHandler';

describe('Error Handler Middleware', () => {
  const createTestApp = () => {
    const app = express();
    app.use(express.json());

    // Route triggering AppError
    app.get('/test-app-error', (_req: Request, _res: Response, next: NextFunction) => {
      next(new AppError('Custom operational error', 400, { detail: 'Invalid operation' }));
    });

    // Route triggering ZodError
    app.post('/test-zod-error', (req: Request, _res: Response, next: NextFunction) => {
      try {
        const schema = z.object({
          email: z.string().email(),
          amountPaise: z.number().int().positive(),
        });
        schema.parse(req.body);
      } catch (err) {
        return next(err);
      }
    });

    // Route triggering duplicate key error
    app.get('/test-duplicate-key', (_req: Request, _res: Response, next: NextFunction) => {
      const err = new Error('E11000 duplicate key error') as Error & { code: number };
      err.code = 11000;
      next(err);
    });

    // Route triggering CastError
    app.get('/test-cast-error', (_req: Request, _res: Response, next: NextFunction) => {
      const err = new Error('Cast to ObjectId failed');
      err.name = 'CastError';
      next(err);
    });

    // Route triggering JsonWebTokenError
    app.get('/test-jwt-error', (_req: Request, _res: Response, next: NextFunction) => {
      const err = new Error('invalid signature');
      err.name = 'JsonWebTokenError';
      next(err);
    });

    // Route triggering TokenExpiredError
    app.get('/test-jwt-expired', (_req: Request, _res: Response, next: NextFunction) => {
      const err = new Error('jwt expired');
      err.name = 'TokenExpiredError';
      next(err);
    });

    // Route triggering unhandled error
    app.get('/test-generic-error', (_req: Request, _res: Response, next: NextFunction) => {
      next(new Error('Unexpected system explosion'));
    });

    app.use(errorHandler);
    return app;
  };

  const testApp = createTestApp();

  it('handles custom AppError with statusCode and operational errors', async () => {
    const response = await request(testApp).get('/test-app-error');

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        success: false,
        message: 'Custom operational error',
        errors: { detail: 'Invalid operation' },
      }),
    );
  });

  it('handles Zod validation errors and returns 400 with field errors', async () => {
    const response = await request(testApp)
      .post('/test-zod-error')
      .send({ email: 'invalid-email', amountPaise: -50 });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('success', false);
    expect(response.body).toHaveProperty('message', 'Validation failed');
    expect(response.body.errors).toHaveProperty('email');
    expect(response.body.errors).toHaveProperty('amountPaise');
  });

  it('handles Mongoose duplicate key error (11000) with 409', async () => {
    const response = await request(testApp).get('/test-duplicate-key');

    expect(response.status).toBe(409);
    expect(response.body).toHaveProperty('success', false);
    expect(response.body.message).toContain('Duplicate key error');
  });

  it('handles Mongoose CastError with 400', async () => {
    const response = await request(testApp).get('/test-cast-error');

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        success: false,
        message: 'Invalid resource ID format',
      }),
    );
  });

  it('handles JsonWebTokenError with 401', async () => {
    const response = await request(testApp).get('/test-jwt-error');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Invalid authorization token',
    });
  });

  it('handles TokenExpiredError with 401', async () => {
    const response = await request(testApp).get('/test-jwt-expired');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Authorization token has expired',
    });
  });

  it('handles generic unhandled error with 500', async () => {
    const response = await request(testApp).get('/test-generic-error');

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty('success', false);
    expect(response.body).toHaveProperty('message');
  });
});
