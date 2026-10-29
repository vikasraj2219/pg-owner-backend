import { z } from 'zod';

describe('Environment Variables Schema', () => {
  const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z
      .string()
      .default('5000')
      .transform(val => parseInt(val, 10))
      .refine(val => val > 0 && val < 65536, {
        message: 'PORT must be a valid port number between 1 and 65535',
      }),
    API_PREFIX: z.string().default('/api'),
    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters long'),
    JWT_EXPIRES_IN: z.string().default('30d'),
    CLIENT_URL: z.string().default('*'),
    INTERNAL_CRON_SECRET: z.string().min(8, 'INTERNAL_CRON_SECRET is required'),
  });

  it('validates a correct environment configuration', () => {
    const validEnv = {
      NODE_ENV: 'development',
      PORT: '5000',
      API_PREFIX: '/api',
      MONGODB_URI: 'mongodb+srv://user:pass@cluster.mongodb.net/db',
      JWT_SECRET: 'super_secret_jwt_key_at_least_16_chars',
      INTERNAL_CRON_SECRET: 'cron_secret_token_123',
    };

    const parsed = envSchema.safeParse(validEnv);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.PORT).toBe(5000);
      expect(parsed.data.JWT_EXPIRES_IN).toBe('30d');
      expect(parsed.data.CLIENT_URL).toBe('*');
    }
  });

  it('fails if PORT is not a valid number', () => {
    const invalidEnv = {
      PORT: '70000', // exceeds 65535
      MONGODB_URI: 'mongodb://localhost:27017/test',
      JWT_SECRET: 'super_secret_jwt_key_at_least_16_chars',
      INTERNAL_CRON_SECRET: 'cron_secret_token_123',
    };

    const parsed = envSchema.safeParse(invalidEnv);
    expect(parsed.success).toBe(false);
  });

  it('fails if JWT_SECRET is shorter than 16 characters', () => {
    const invalidEnv = {
      MONGODB_URI: 'mongodb://localhost:27017/test',
      JWT_SECRET: 'short_key',
      INTERNAL_CRON_SECRET: 'cron_secret_token_123',
    };

    const parsed = envSchema.safeParse(invalidEnv);
    expect(parsed.success).toBe(false);
  });

  it('fails if MONGODB_URI is empty', () => {
    const invalidEnv = {
      MONGODB_URI: '',
      JWT_SECRET: 'super_secret_jwt_key_at_least_16_chars',
      INTERNAL_CRON_SECRET: 'cron_secret_token_123',
    };

    const parsed = envSchema.safeParse(invalidEnv);
    expect(parsed.success).toBe(false);
  });
});
