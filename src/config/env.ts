import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

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
  CLOUDINARY_CLOUD_NAME: z.string().optional().default(''),
  CLOUDINARY_API_KEY: z.string().optional().default(''),
  CLOUDINARY_API_SECRET: z.string().optional().default(''),
});

const parseEnv = () => {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    // In test environment, allow test defaults if some variables are missing
    if (process.env.NODE_ENV === 'test') {
      return envSchema.parse({
        NODE_ENV: 'test',
        PORT: '5001',
        API_PREFIX: '/api',
        MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pg_owner_test',
        JWT_SECRET: 'test_jwt_secret_key_minimum_32_characters_long',
        JWT_EXPIRES_IN: '1d',
        CLIENT_URL: '*',
        INTERNAL_CRON_SECRET: 'test_cron_secret_key_12345',
      });
    }

    console.error('Invalid environment variables:');
    console.error(JSON.stringify(result.error.format(), null, 2));
    process.exit(1);
  }

  return result.data;
};

export const env = parseEnv();
export type Env = z.infer<typeof envSchema>;
