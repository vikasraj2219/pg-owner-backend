"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const zod_1 = require("zod");
// Load environment variables from .env file
dotenv_1.default.config({ path: path_1.default.resolve(process.cwd(), '.env') });
const envSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['development', 'production', 'test']).default('development'),
    PORT: zod_1.z
        .string()
        .default('5000')
        .transform(val => parseInt(val, 10))
        .refine(val => val > 0 && val < 65536, {
        message: 'PORT must be a valid port number between 1 and 65535',
    }),
    API_PREFIX: zod_1.z.string().default('/api'),
    MONGODB_URI: zod_1.z.string().min(1, 'MONGODB_URI is required'),
    JWT_SECRET: zod_1.z.string().min(16, 'JWT_SECRET must be at least 16 characters long'),
    JWT_EXPIRES_IN: zod_1.z.string().default('30d'),
    CLIENT_URL: zod_1.z.string().default('*'),
    INTERNAL_CRON_SECRET: zod_1.z.string().min(8, 'INTERNAL_CRON_SECRET is required'),
    CLOUDINARY_CLOUD_NAME: zod_1.z.string().optional().default('dfhvqof2'),
    CLOUDINARY_API_KEY: zod_1.z.string().optional().default('151557572339636'),
    CLOUDINARY_API_SECRET: zod_1.z.string().optional().default('nIQB56H67YQKP1xMXBRSc4alGpQ'),
    RAZORPAY_KEY_ID: zod_1.z.string().optional().default('rzp_test_Tw3LXfbSgMW3Np'),
    RAZORPAY_KEY_SECRET: zod_1.z.string().optional().default('YuO4zCPfnhfbXrj9Lx3HpaKT'),
    RAZORPAY_WEBHOOK_SECRET: zod_1.z.string().optional().default(''),
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
exports.env = parseEnv();
