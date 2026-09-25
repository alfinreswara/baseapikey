import { z } from 'zod';

const DEFAULT_ACCESS_SECRET = 'default_jwt_access_secret_32chars_min_len';
const DEFAULT_REFRESH_SECRET = 'default_jwt_refresh_secret_32chars_min_len';
const EXAMPLE_PROVIDER_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const INSECURE_PRODUCTION_SECRETS = new Set([
  DEFAULT_ACCESS_SECRET,
  DEFAULT_REFRESH_SECRET,
  'test-jwt-access-secret-minimum-32-chars-long',
  'test-jwt-refresh-secret-minimum-32-chars-long',
]);

function isInsecureProductionSecret(secret: string): boolean {
  return (
    secret.length < 32 ||
    INSECURE_PRODUCTION_SECRETS.has(secret) ||
    secret.toLowerCase().includes('change_me')
  );
}

function parseTrustProxy(value: string): boolean | string | string[] {
  const normalized = value.trim();
  if (normalized === '' || normalized === 'false') return false;
  if (normalized === 'true') return true;
  const entries = normalized
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length === 1 ? entries[0]! : entries;
}

function isValidEncryptionKey(value: string): boolean {
  try {
    return Buffer.from(value, 'base64').length === 32;
  } catch {
    return false;
  }
}

export const GatewayEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default('0.0.0.0'),
    TRUST_PROXY: z.string().default('false').transform(parseTrustProxy),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_POOL_SIZE: z.coerce.number().int().positive().default(5),
    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
    REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    USAGE_QUEUE_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(50),
    USAGE_QUEUE_INTERVAL_MS: z.coerce.number().int().min(50).max(60000).default(250),
    LOGIN_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
    HEALTH_CHECK_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    MODEL_CATALOG_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    PROVIDER_HEALTH_CHECK_INTERVAL_MS: z.coerce.number().int().min(10000).default(60000),
    METRICS_TOKEN: z.string().min(32).optional(),
    DASHBOARD_PUBLIC_URL: z.string().url().default('http://localhost:3001'),
    ERROR_REPORTING_WEBHOOK_URL: z.string().url().optional(),
    ERROR_REPORTING_WEBHOOK_SECRET: z.string().min(32).optional(),
    EMAIL_VERIFICATION_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
    PASSWORD_RESET_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    ACCOUNT_EMAIL_WEBHOOK_URL: z.string().url().optional(),
    ACCOUNT_EMAIL_WEBHOOK_SECRET: z.string().min(32).optional(),
    ACCOUNT_EMAIL_WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    NINE_ROUTER_API_KEY: z.string().min(1, 'NINE_ROUTER_API_KEY is required'),
    NINE_ROUTER_BASE_URL: z.string().url().optional(),
    PROVIDER_ENCRYPTION_KEY: z
      .string()
      .refine(isValidEncryptionKey, {
        message: 'PROVIDER_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
      })
      .optional(),
    BILLING_PROVIDER_NAME: z.string().min(1).max(50).default('payment-provider'),
    BILLING_PROVIDER_URL: z.string().url().optional(),
    BILLING_PROVIDER_API_KEY: z.string().min(1).optional(),
    BILLING_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
    BILLING_WEBHOOK_SECRET: z.string().min(32).optional(),
    CORS_ORIGIN: z.string().default('*'),
    MAX_REQUEST_SIZE: z.coerce.number().int().positive().default(1048576),
    JWT_ACCESS_SECRET: z
      .string()
      .min(1, 'JWT_ACCESS_SECRET is required')
      .default(DEFAULT_ACCESS_SECRET),
    JWT_REFRESH_SECRET: z
      .string()
      .min(1, 'JWT_REFRESH_SECRET is required')
      .default(DEFAULT_REFRESH_SECRET),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  })
  .superRefine((env, ctx) => {
    if (env.ACCOUNT_EMAIL_WEBHOOK_URL && !env.ACCOUNT_EMAIL_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ACCOUNT_EMAIL_WEBHOOK_SECRET'],
        message: 'ACCOUNT_EMAIL_WEBHOOK_SECRET is required when the webhook URL is configured',
      });
    }

    if (!env.ACCOUNT_EMAIL_WEBHOOK_URL && env.ACCOUNT_EMAIL_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ACCOUNT_EMAIL_WEBHOOK_URL'],
        message: 'ACCOUNT_EMAIL_WEBHOOK_URL is required when the webhook secret is configured',
      });
    }

    if (env.BILLING_PROVIDER_URL && !env.BILLING_PROVIDER_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BILLING_PROVIDER_API_KEY'],
        message: 'BILLING_PROVIDER_API_KEY is required when billing provider URL is configured',
      });
    }

    if (!env.BILLING_PROVIDER_URL && env.BILLING_PROVIDER_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BILLING_PROVIDER_URL'],
        message: 'BILLING_PROVIDER_URL is required when billing provider API key is configured',
      });
    }

    if (env.ERROR_REPORTING_WEBHOOK_URL && !env.ERROR_REPORTING_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ERROR_REPORTING_WEBHOOK_SECRET'],
        message: 'ERROR_REPORTING_WEBHOOK_SECRET is required with the reporting URL',
      });
    }

    if (env.NODE_ENV !== 'production') {
      return;
    }

    if (isInsecureProductionSecret(env.JWT_ACCESS_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_ACCESS_SECRET'],
        message:
          'JWT_ACCESS_SECRET must be a unique, non-placeholder secret of at least 32 characters',
      });
    }

    if (isInsecureProductionSecret(env.JWT_REFRESH_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message:
          'JWT_REFRESH_SECRET must be a unique, non-placeholder secret of at least 32 characters',
      });
    }

    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT access and refresh secrets must be different in production',
      });
    }

    if (env.NINE_ROUTER_API_KEY.toLowerCase().includes('change_me')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NINE_ROUTER_API_KEY'],
        message: 'NINE_ROUTER_API_KEY must not use the example placeholder in production',
      });
    }

    if (!env.ACCOUNT_EMAIL_WEBHOOK_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ACCOUNT_EMAIL_WEBHOOK_URL'],
        message: 'ACCOUNT_EMAIL_WEBHOOK_URL is required in production',
      });
    } else if (!env.ACCOUNT_EMAIL_WEBHOOK_URL.startsWith('https://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ACCOUNT_EMAIL_WEBHOOK_URL'],
        message: 'ACCOUNT_EMAIL_WEBHOOK_URL must use HTTPS in production',
      });
    }

    if (!env.METRICS_TOKEN || isInsecureProductionSecret(env.METRICS_TOKEN)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['METRICS_TOKEN'],
        message: 'METRICS_TOKEN must be a unique production secret of at least 32 characters',
      });
    }

    if (!env.DASHBOARD_PUBLIC_URL.startsWith('https://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DASHBOARD_PUBLIC_URL'],
        message: 'DASHBOARD_PUBLIC_URL must use HTTPS in production',
      });
    }

    if (
      !env.ERROR_REPORTING_WEBHOOK_URL ||
      !env.ERROR_REPORTING_WEBHOOK_URL.startsWith('https://') ||
      !env.ERROR_REPORTING_WEBHOOK_SECRET
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ERROR_REPORTING_WEBHOOK_URL'],
        message: 'HTTPS error reporting webhook and secret are required in production',
      });
    }

    if (!env.ACCOUNT_EMAIL_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ACCOUNT_EMAIL_WEBHOOK_SECRET'],
        message: 'ACCOUNT_EMAIL_WEBHOOK_SECRET is required in production',
      });
    } else if (
      isInsecureProductionSecret(env.ACCOUNT_EMAIL_WEBHOOK_SECRET) ||
      env.ACCOUNT_EMAIL_WEBHOOK_SECRET.toLowerCase().includes('replace_with') ||
      env.ACCOUNT_EMAIL_WEBHOOK_SECRET === env.JWT_ACCESS_SECRET ||
      env.ACCOUNT_EMAIL_WEBHOOK_SECRET === env.JWT_REFRESH_SECRET
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ACCOUNT_EMAIL_WEBHOOK_SECRET'],
        message: 'ACCOUNT_EMAIL_WEBHOOK_SECRET must be unique and must not use a placeholder',
      });
    }

    if (
      !env.PROVIDER_ENCRYPTION_KEY ||
      env.PROVIDER_ENCRYPTION_KEY === EXAMPLE_PROVIDER_ENCRYPTION_KEY
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PROVIDER_ENCRYPTION_KEY'],
        message: 'PROVIDER_ENCRYPTION_KEY is required in production',
      });
    }

    if (!env.BILLING_PROVIDER_URL || !env.BILLING_PROVIDER_URL.startsWith('https://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BILLING_PROVIDER_URL'],
        message: 'BILLING_PROVIDER_URL must use HTTPS in production',
      });
    }

    if (
      !env.BILLING_PROVIDER_API_KEY ||
      env.BILLING_PROVIDER_API_KEY.toLowerCase().includes('replace_with') ||
      env.BILLING_PROVIDER_API_KEY.toLowerCase().includes('change_me')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BILLING_PROVIDER_API_KEY'],
        message: 'BILLING_PROVIDER_API_KEY is required in production',
      });
    }

    if (
      !env.BILLING_WEBHOOK_SECRET ||
      isInsecureProductionSecret(env.BILLING_WEBHOOK_SECRET) ||
      env.BILLING_WEBHOOK_SECRET.toLowerCase().includes('replace_with')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BILLING_WEBHOOK_SECRET'],
        message: 'BILLING_WEBHOOK_SECRET must be a unique production secret',
      });
    }
  });

export type GatewayEnv = z.infer<typeof GatewayEnvSchema>;

export function parseGatewayEnv(
  inputEnv: Record<string, string | undefined> = process.env,
): GatewayEnv {
  const result = GatewayEnvSchema.safeParse(inputEnv);

  if (!result.success) {
    const formattedErrors = result.error.errors
      .map((err) => `  - ${err.path.join('.')}: ${err.message}`)
      .join('\n');
    throw new Error(`Invalid Gateway Environment Variables:\n${formattedErrors}`);
  }

  return result.data;
}
