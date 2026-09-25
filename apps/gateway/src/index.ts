import { prisma } from '@baseapikey/database';
import { ProviderRegistry } from '@baseapikey/shared';
import { parseGatewayEnv } from '@baseapikey/shared/env';
import type { FastifyInstance } from 'fastify';
import { createClient } from 'redis';

import { buildApp } from './app';
import { WebhookAccountNotificationService } from './modules/account/services/account-notification.service';
import { RedisAccountTokenStore } from './modules/account/services/account-token.store';
import { PrismaApiKeyRepository } from './modules/api-keys/repositories/api-key.repository';
import { RedisLoginRateLimiter } from './modules/auth/utils/redis-login-rate-limiter';
import { PrismaOrganizationBillingGuard } from './modules/billing/middleware/billing-usage.middleware';
import { HealthService } from './modules/health/health.service';
import { RedisModelCatalogCache } from './modules/models/cache/model-catalog.cache';
import { WebhookErrorReporter } from './modules/observability/error-reporter';
import { PrismaOrganizationContextResolver } from './modules/organizations/middleware/organization-context.middleware';
import { WebhookOrganizationInvitationNotificationService } from './modules/organizations/services/organization-invitation-notification.service';
import { registerNineRouter } from './modules/providers/9router';
import { ProviderHealthMonitor } from './modules/providers/provider-health.monitor';
import { loadDatabaseProviders } from './modules/providers/provider-loader';
import { PrismaUsageRepository } from './modules/usage/repositories/usage.repository';
import { RedisUsageRecorder, RedisUsageWorker } from './modules/usage/services/redis-usage-queue';
import { PrismaUsageBillingService } from './modules/usage/services/usage-billing.service';
import { PrismaUsageCostResolver } from './modules/usage/services/usage-cost.service';
import { UsageTrackingService } from './modules/usage/services/usage-tracking.service';

async function start(): Promise<void> {
  const env = parseGatewayEnv(process.env);
  const redisClient = createClient({
    url: env.REDIS_URL,
    socket: {
      connectTimeout: env.REDIS_CONNECT_TIMEOUT_MS,
      reconnectStrategy: (retries) => (retries < 3 ? Math.min(250 * 2 ** retries, 2_000) : false),
    },
  });
  redisClient.on('error', (error) => {
    console.error('Redis client error:', error.message);
  });

  let app: FastifyInstance | undefined;
  let providerHealthMonitor: ProviderHealthMonitor | undefined;
  let usageWorker: RedisUsageWorker | undefined;
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown || !app) {
      return;
    }
    shuttingDown = true;
    providerHealthMonitor?.stop();
    await usageWorker?.stop();

    console.log(`Received ${signal}; shutting down Gateway API`);
    const forceShutdownTimer = setTimeout(() => {
      console.error('Gateway shutdown timed out after 30 seconds');
      process.exit(1);
    }, 30_000);
    forceShutdownTimer.unref();

    try {
      const results = await Promise.allSettled([
        app.close(),
        redisClient.isOpen ? redisClient.close() : Promise.resolve(),
        prisma.$disconnect(),
      ]);
      const failedResult = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failedResult) {
        throw failedResult.reason;
      }
      clearTimeout(forceShutdownTimer);
      console.log('Gateway API shut down cleanly');
      process.exitCode = 0;
    } catch (error) {
      clearTimeout(forceShutdownTimer);
      console.error('Failed to shut down Gateway API cleanly:', error);
      process.exitCode = 1;
    }
  };

  try {
    await redisClient.connect();

    const healthService = new HealthService(
      'gateway',
      '0.1.0',
      env.NODE_ENV,
      {
        async database(): Promise<void> {
          await prisma.$queryRaw`SELECT 1`;
        },
        async redis(): Promise<void> {
          if (!redisClient.isReady || (await redisClient.ping()) !== 'PONG') {
            throw new Error('Redis is not ready');
          }
        },
      },
      env.HEALTH_CHECK_TIMEOUT_MS,
    );
    const rateLimiter = new RedisLoginRateLimiter(
      {
        eval: (script, options) => redisClient.eval(script, options),
      },
      {
        maxAttempts: env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
        windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
      },
    );
    const modelCatalogCache = new RedisModelCatalogCache({
      get: (key) => redisClient.get(key),
      set: (key, value, options) => redisClient.set(key, value, options),
      del: (key) => redisClient.del(key),
    });
    const accountTokenStore = new RedisAccountTokenStore({
      set: (key, value, options) => redisClient.set(key, value, options),
      eval: (script, options) => redisClient.eval(script, options),
    });
    const accountNotificationService =
      env.ACCOUNT_EMAIL_WEBHOOK_URL && env.ACCOUNT_EMAIL_WEBHOOK_SECRET
        ? new WebhookAccountNotificationService(
            env.ACCOUNT_EMAIL_WEBHOOK_URL,
            env.ACCOUNT_EMAIL_WEBHOOK_SECRET,
            env.ACCOUNT_EMAIL_WEBHOOK_TIMEOUT_MS,
          )
        : undefined;
    const organizationInvitationNotificationService =
      env.ACCOUNT_EMAIL_WEBHOOK_URL && env.ACCOUNT_EMAIL_WEBHOOK_SECRET
        ? new WebhookOrganizationInvitationNotificationService(
            env.ACCOUNT_EMAIL_WEBHOOK_URL,
            env.ACCOUNT_EMAIL_WEBHOOK_SECRET,
            env.DASHBOARD_PUBLIC_URL,
            env.ACCOUNT_EMAIL_WEBHOOK_TIMEOUT_MS,
          )
        : undefined;
    const errorReporter =
      env.ERROR_REPORTING_WEBHOOK_URL && env.ERROR_REPORTING_WEBHOOK_SECRET
        ? new WebhookErrorReporter(
            env.ERROR_REPORTING_WEBHOOK_URL,
            env.ERROR_REPORTING_WEBHOOK_SECRET,
          )
        : undefined;
    const providerRegistry = new ProviderRegistry();
    registerNineRouter(
      providerRegistry,
      {
        apiKey: env.NINE_ROUTER_API_KEY,
        baseUrl: env.NINE_ROUTER_BASE_URL,
      },
      { priority: 100 },
    );
    if (env.PROVIDER_ENCRYPTION_KEY) {
      await loadDatabaseProviders(providerRegistry, env.PROVIDER_ENCRYPTION_KEY);
    }
    providerHealthMonitor = new ProviderHealthMonitor(
      providerRegistry,
      env.PROVIDER_HEALTH_CHECK_INTERVAL_MS,
    );
    providerHealthMonitor.start();

    const apiKeyRepository = new PrismaApiKeyRepository();
    const usageBillingService = new PrismaUsageBillingService();
    const usageTrackingService = new UsageTrackingService(
      new PrismaUsageRepository(),
      apiKeyRepository,
      usageBillingService,
    );
    const usageQueueClient = {
      lPush: (key: string, value: string) => redisClient.lPush(key, value),
      rPop: (key: string, count: number) => redisClient.rPopCount(key, count),
    };
    const usageRecorder = new RedisUsageRecorder(usageQueueClient);
    usageWorker = new RedisUsageWorker(
      usageQueueClient,
      usageTrackingService,
      env.USAGE_QUEUE_BATCH_SIZE,
      env.USAGE_QUEUE_INTERVAL_MS,
    );
    usageWorker.start();

    app = buildApp({
      maxRequestSize: env.MAX_REQUEST_SIZE,
      corsOrigin: env.CORS_ORIGIN,
      healthService,
      rateLimiter,
      trustProxy: env.TRUST_PROXY,
      modelCatalogCache,
      modelCatalogCacheTtlSeconds: env.MODEL_CATALOG_CACHE_TTL_SECONDS,
      accountTokenStore,
      ...(accountNotificationService ? { accountNotificationService } : {}),
      ...(organizationInvitationNotificationService
        ? { organizationInvitationNotificationService }
        : {}),
      ...(errorReporter ? { errorReporter } : {}),
      emailVerificationTokenTtlSeconds: env.EMAIL_VERIFICATION_TOKEN_TTL_SECONDS,
      passwordResetTokenTtlSeconds: env.PASSWORD_RESET_TOKEN_TTL_SECONDS,
      providerRegistry,
      apiKeyRepository,
      usageRecorder,
      organizationContextResolver: new PrismaOrganizationContextResolver(),
      usageCostResolver: new PrismaUsageCostResolver(),
      billingUsageGuard: new PrismaOrganizationBillingGuard(),
      ...(env.METRICS_TOKEN ? { metricsToken: env.METRICS_TOKEN } : {}),
      ...(env.PROVIDER_ENCRYPTION_KEY
        ? { providerEncryptionKey: env.PROVIDER_ENCRYPTION_KEY }
        : {}),
      ...(env.BILLING_WEBHOOK_SECRET ? { billingWebhookSecret: env.BILLING_WEBHOOK_SECRET } : {}),
    });

    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    process.once('SIGINT', () => void shutdown('SIGINT'));

    const address = await app.listen({
      port: env.PORT,
      host: env.HOST,
    });
    console.log(`Gateway API listening at ${address}`);
  } catch (err) {
    console.error('Failed to start Gateway API:', err);
    if (app) {
      await app.close().catch(() => undefined);
    }
    if (redisClient.isOpen) {
      await redisClient.close().catch(() => undefined);
    }
    await prisma.$disconnect().catch(() => undefined);
    process.exitCode = 1;
  }
}

void start();
