import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('5000'),
  LOG_LEVEL: z.string().default('info'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_EXPIRE_IN: z.string().default('1h'),
  JWT_REFRESH_EXPIRE_IN: z.string().default('7d'),

  // Firebase
  FIREBASE_PROJECT_ID: z.string().min(1, 'FIREBASE_PROJECT_ID is required'),

  // Razorpay
  RAZORPAY_KEY_ID: z.string().min(1, 'RAZORPAY_KEY_ID is required'),
  RAZORPAY_KEY_SECRET: z.string().min(1, 'RAZORPAY_KEY_SECRET is required'),

  // Frontend
  FRONTEND_URL: z.string().default('http://localhost:5173'),

  // QR Encryption
  QR_ENCRYPTION_KEY: z.string().min(32, 'QR_ENCRYPTION_KEY must be at least 32 characters'),

  // Optional services
  SENDGRID_API_KEY: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
});

export type Environment = z.infer<typeof envSchema>;

let cachedEnv: Environment | null = null;

/**
 * Validate and return typed environment variables.
 * Throws on first call if validation fails.
 */
export const getEnv = (): Environment => {
  if (cachedEnv) return cachedEnv;

  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('❌ Environment validation failed:');
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration. Check .env.local file.');
  }

  cachedEnv = parsed.data;
  return cachedEnv;
};

export default getEnv;
