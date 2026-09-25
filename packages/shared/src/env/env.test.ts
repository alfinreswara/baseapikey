import { ERROR_CODES } from '../constants/error-codes.constant';
import { ROLES } from '../constants/roles.constant';
import { ValidationError, NotFoundError } from '../errors/app-error';
import { hashSha256 } from '../utils/hash.util';
import { generateUuidV7 } from '../utils/id.util';
import { ok, err } from '../utils/result.util';

import { parseDashboardEnv } from './dashboard.env';
import { loadEnv } from './env.loader';
import { parseGatewayEnv } from './gateway.env';

// Environment tests
const validGatewayInput = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/baseapikey',
  REDIS_URL: 'redis://localhost:6379',
  NINE_ROUTER_API_KEY: 'nr_test_key',
};

const gatewayEnv = parseGatewayEnv(validGatewayInput);
if (gatewayEnv.PORT !== 3000) {
  throw new Error('Gateway default PORT should be 3000');
}
if (gatewayEnv.TRUST_PROXY !== false) {
  throw new Error('Gateway TRUST_PROXY should be disabled by default');
}
if (gatewayEnv.MODEL_CATALOG_CACHE_TTL_SECONDS !== 300) {
  throw new Error('Gateway model catalog cache TTL should default to 300 seconds');
}
if (
  gatewayEnv.EMAIL_VERIFICATION_TOKEN_TTL_SECONDS !== 86_400 ||
  gatewayEnv.PASSWORD_RESET_TOKEN_TTL_SECONDS !== 900
) {
  throw new Error('Gateway account token TTL defaults are invalid');
}

const proxiedGatewayEnv = parseGatewayEnv({
  ...validGatewayInput,
  TRUST_PROXY: '10.0.0.0/8,192.168.0.0/16',
});
if (!Array.isArray(proxiedGatewayEnv.TRUST_PROXY) || proxiedGatewayEnv.TRUST_PROXY.length !== 2) {
  throw new Error('Gateway TRUST_PROXY should parse trusted CIDR lists');
}

let partialWebhookEnvRejected = false;
try {
  parseGatewayEnv({
    ...validGatewayInput,
    ACCOUNT_EMAIL_WEBHOOK_URL: 'https://mailer.example.com/account-events',
  });
} catch (error) {
  partialWebhookEnvRejected =
    error instanceof Error && error.message.includes('ACCOUNT_EMAIL_WEBHOOK_SECRET');
}
if (!partialWebhookEnvRejected) {
  throw new Error('Gateway env must reject a webhook URL without its secret');
}

let insecureProductionEnvRejected = false;
try {
  parseGatewayEnv({
    ...validGatewayInput,
    NODE_ENV: 'production',
  });
} catch (error) {
  insecureProductionEnvRejected =
    error instanceof Error && error.message.includes('JWT_ACCESS_SECRET');
}
if (!insecureProductionEnvRejected) {
  throw new Error('Production gateway env must reject default JWT secrets');
}

const productionGatewayEnv = parseGatewayEnv({
  ...validGatewayInput,
  NODE_ENV: 'production',
  NINE_ROUTER_API_KEY: 'nr_live_production_key_without_placeholder',
  JWT_ACCESS_SECRET: 'production-access-secret-that-is-at-least-32-characters',
  JWT_REFRESH_SECRET: 'production-refresh-secret-that-is-different-and-at-least-32-characters',
  ACCOUNT_EMAIL_WEBHOOK_URL: 'https://mailer.example.com/account-events',
  ACCOUNT_EMAIL_WEBHOOK_SECRET: 'production-account-email-webhook-secret-value',
  PROVIDER_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  BILLING_PROVIDER_URL: 'https://payments.example.com/api',
  BILLING_PROVIDER_API_KEY: 'payments-production-api-key',
  BILLING_WEBHOOK_SECRET: 'production-billing-webhook-secret-value',
  METRICS_TOKEN: 'production-metrics-token-that-is-at-least-32-characters',
  DASHBOARD_PUBLIC_URL: 'https://console.example.com',
  ERROR_REPORTING_WEBHOOK_URL: 'https://errors.example.com/events',
  ERROR_REPORTING_WEBHOOK_SECRET: 'production-error-reporting-secret-value',
});
if (productionGatewayEnv.NODE_ENV !== 'production') {
  throw new Error('Valid production gateway env should parse successfully');
}

const validDashboardInput = {};

const dashboardEnv = parseDashboardEnv(validDashboardInput);
if (dashboardEnv.DASHBOARD_PORT !== 3001) {
  throw new Error('Dashboard default DASHBOARD_PORT should be 3001');
}

const appEnv = loadEnv({ ...validGatewayInput, ...validDashboardInput });
if (appEnv.gateway.PORT !== 3000 || appEnv.dashboard.DASHBOARD_PORT !== 3001) {
  throw new Error('loadEnv failed');
}

// Result tests
const successRes = ok(42);
if (!successRes.success || successRes.data !== 42) {
  throw new Error('Result ok failed');
}

const errRes = err(new ValidationError('Invalid input'));
if (errRes.success || errRes.error.statusCode !== 400) {
  throw new Error('Result err failed');
}

// Utility tests
const uuid = generateUuidV7();
if (typeof uuid !== 'string' || uuid.length !== 36) {
  throw new Error('UUID v7 generation failed');
}

const hash = hashSha256('test-data');
if (typeof hash !== 'string' || hash.length !== 64) {
  throw new Error('SHA-256 hash failed');
}

const notFoundErr = new NotFoundError('User', '123');
if (notFoundErr.statusCode !== 404 || notFoundErr.toJSON().error.code !== 'NOT_FOUND') {
  throw new Error('NotFoundError handling failed');
}

if (ERROR_CODES.NOT_FOUND !== 'NOT_FOUND' || ROLES.ADMIN !== 'admin') {
  throw new Error('Constants validation failed');
}

console.log('Shared package unit tests passed successfully.');
