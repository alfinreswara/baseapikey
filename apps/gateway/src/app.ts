import { createLogger, logCompletedRequest, logIncomingRequest } from '@baseapikey/logger';
import { AppError, ProviderRegistry } from '@baseapikey/shared';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastify, { FastifyInstance, LogController } from 'fastify';

import { accountRoutes } from './modules/account/account.routes';
import {
  type IAccountRepository,
  PrismaAccountRepository,
} from './modules/account/repositories/account.repository';
import {
  type IAccountNotificationService,
  NoopAccountNotificationService,
} from './modules/account/services/account-notification.service';
import {
  type IAccountTokenStore,
  InMemoryAccountTokenStore,
} from './modules/account/services/account-token.store';
import { AccountService } from './modules/account/services/account.service';
import { adminRoutes } from './modules/admin/admin.routes';
import {
  type IAdminRepository,
  PrismaAdminRepository,
} from './modules/admin/repositories/admin.repository';
import { AdminService } from './modules/admin/services/admin.service';
import { ProviderSecretService } from './modules/admin/services/provider-secret.service';
import { apiKeyRoutes } from './modules/api-keys/api-keys.routes';
import {
  type IApiKeyRepository,
  PrismaApiKeyRepository,
} from './modules/api-keys/repositories/api-key.repository';
import { loadAuthConfig } from './modules/auth/auth.config';
import { authRoutes } from './modules/auth/auth.routes';
import {
  type ISessionRepository,
  PrismaSessionRepository,
} from './modules/auth/repositories/session.repository';
import {
  type IUserRepository,
  PrismaUserRepository,
} from './modules/auth/repositories/user.repository';
import { JwtService } from './modules/auth/services/jwt.service';
import { PasswordService } from './modules/auth/services/password.service';
import type { ILoginRateLimiter } from './modules/auth/utils/rate-limiter.interface';
import { billingRoutes } from './modules/billing/billing.routes';
import type { IOrganizationBillingGuard } from './modules/billing/middleware/billing-usage.middleware';
import {
  DisabledBillingPaymentProvider,
  HttpBillingPaymentProvider,
  type IBillingPaymentProvider,
} from './modules/billing/providers/billing-payment.provider';
import {
  type IBillingRepository,
  PrismaBillingRepository,
} from './modules/billing/repositories/billing.repository';
import { BillingService } from './modules/billing/services/billing.service';
import { chatRoutes } from './modules/chat/chat.routes';
import { healthRoutes } from './modules/health/health.routes';
import type { HealthService } from './modules/health/health.service';
import { inferenceRoutes } from './modules/inference/inference.routes';
import { metricsRoutes } from './modules/metrics/metrics.routes';
import { MetricsService } from './modules/metrics/metrics.service';
import type { IModelCatalogCache } from './modules/models/cache/model-catalog.cache';
import { NoopModelCatalogCache } from './modules/models/cache/model-catalog.cache';
import { modelRoutes } from './modules/models/models.routes';
import {
  type IModelCatalogRepository,
  PrismaModelCatalogRepository,
} from './modules/models/repositories/model-catalog.repository';
import { ModelCatalogService } from './modules/models/services/model-catalog.service';
import type { IErrorReporter } from './modules/observability/error-reporter';
import type { IOrganizationContextResolver } from './modules/organizations/middleware/organization-context.middleware';
import { organizationRoutes } from './modules/organizations/organization.routes';
import {
  type IOrganizationRepository,
  PrismaOrganizationRepository,
} from './modules/organizations/repositories/organization.repository';
import type { IOrganizationInvitationNotificationService } from './modules/organizations/services/organization-invitation-notification.service';
import { OrganizationService } from './modules/organizations/services/organization.service';
import { registerNineRouter } from './modules/providers/9router';
import { syncDatabaseProviders } from './modules/providers/provider-loader';
import { PrismaQuotaRepository } from './modules/quota/repositories/quota.repository';
import { QuotaService } from './modules/quota/services/quota.service';
import { registerUsageTrackingHook } from './modules/usage/middleware/usage.middleware';
import {
  type IUsageAnalyticsRepository,
  PrismaUsageAnalyticsRepository,
} from './modules/usage/repositories/usage-analytics.repository';
import { PrismaUsageRepository } from './modules/usage/repositories/usage.repository';
import { UsageAnalyticsService } from './modules/usage/services/usage-analytics.service';
import type { IUsageBillingService } from './modules/usage/services/usage-billing.service';
import type { IUsageCostResolver } from './modules/usage/services/usage-cost.service';
import { AsyncUsageRecorder, type IUsageRecorder } from './modules/usage/services/usage-recorder';
import { UsageTrackingService } from './modules/usage/services/usage-tracking.service';
import { usageRoutes } from './modules/usage/usage.routes';

export interface BuildAppOptions {
  userRepository?: IUserRepository;
  sessionRepository?: ISessionRepository;
  apiKeyRepository?: IApiKeyRepository;
  rateLimiter?: ILoginRateLimiter;
  providerRegistry?: ProviderRegistry;
  quotaService?: QuotaService;
  usageRecorder?: IUsageRecorder;
  maxRequestSize?: number;
  corsOrigin?: string;
  healthService?: HealthService;
  trustProxy?: boolean | string | string[];
  modelCatalogRepository?: IModelCatalogRepository;
  modelCatalogCache?: IModelCatalogCache;
  modelCatalogCacheTtlSeconds?: number;
  jwtService?: JwtService;
  passwordService?: PasswordService;
  usageAnalyticsRepository?: IUsageAnalyticsRepository;
  accountRepository?: IAccountRepository;
  accountTokenStore?: IAccountTokenStore;
  accountNotificationService?: IAccountNotificationService;
  emailVerificationTokenTtlSeconds?: number;
  passwordResetTokenTtlSeconds?: number;
  organizationRepository?: IOrganizationRepository;
  billingRepository?: IBillingRepository;
  billingPaymentProvider?: IBillingPaymentProvider;
  billingWebhookSecret?: string;
  adminRepository?: IAdminRepository;
  providerEncryptionKey?: string;
  organizationContextResolver?: IOrganizationContextResolver;
  usageBillingService?: IUsageBillingService;
  usageCostResolver?: IUsageCostResolver;
  billingUsageGuard?: IOrganizationBillingGuard;
  metricsToken?: string;
  organizationInvitationNotificationService?: IOrganizationInvitationNotificationService;
  errorReporter?: IErrorReporter;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const logger = createLogger({
    serviceName: 'gateway',
    environment: process.env['NODE_ENV'] || 'development',
  });

  const configuredRequestSize = Number(process.env['MAX_REQUEST_SIZE']);
  const maxRequestSize =
    options.maxRequestSize ??
    (Number.isSafeInteger(configuredRequestSize) && configuredRequestSize > 0
      ? configuredRequestSize
      : 1_048_576);

  const app = fastify({
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: maxRequestSize,
    trustProxy: options.trustProxy ?? false,
  });
  const metricsService = new MetricsService();
  metricsService.registerHooks(app);

  const configuredCorsOrigin = options.corsOrigin ?? process.env['CORS_ORIGIN'] ?? '*';
  const corsOrigins = configuredCorsOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  void app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: {
      maxAge: 31_536_000,
      includeSubDomains: true,
    },
    xFrameOptions: { action: 'deny' },
    xXssProtection: true,
  });
  void app.register(cors, {
    origin: corsOrigins.length === 0 ? '*' : corsOrigins,
    credentials: false,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-ID', 'X-Correlation-ID'],
    exposedHeaders: ['X-Request-ID', 'X-Correlation-ID'],
    maxAge: 600,
  });

  const providerRegistry = options.providerRegistry ?? new ProviderRegistry();
  const userRepository = options.userRepository ?? new PrismaUserRepository();
  const sessionRepository = options.sessionRepository ?? new PrismaSessionRepository();
  const apiKeyRepository = options.apiKeyRepository ?? new PrismaApiKeyRepository();
  const jwtService = options.jwtService ?? new JwtService(loadAuthConfig());
  const passwordService = options.passwordService ?? new PasswordService();
  const quotaService = options.quotaService ?? new QuotaService(new PrismaQuotaRepository());
  const usageRecorder =
    options.usageRecorder ??
    new AsyncUsageRecorder(
      new UsageTrackingService(
        new PrismaUsageRepository(),
        apiKeyRepository,
        options.usageBillingService,
      ),
    );
  const configuredModelCacheTtl = Number(process.env['MODEL_CATALOG_CACHE_TTL_SECONDS']);
  const modelCatalogCacheTtlSeconds =
    options.modelCatalogCacheTtlSeconds ??
    (Number.isSafeInteger(configuredModelCacheTtl) && configuredModelCacheTtl > 0
      ? configuredModelCacheTtl
      : 300);
  const modelCatalogCache = options.modelCatalogCache ?? new NoopModelCatalogCache();
  const modelCatalogService = new ModelCatalogService(
    options.modelCatalogRepository ?? new PrismaModelCatalogRepository(),
    modelCatalogCache,
    modelCatalogCacheTtlSeconds,
    logger,
  );
  const inferenceModelResolver =
    options.modelCatalogRepository || process.env['DATABASE_URL'] ? modelCatalogService : undefined;
  const usageAnalyticsService = new UsageAnalyticsService(
    options.usageAnalyticsRepository ?? new PrismaUsageAnalyticsRepository(),
  );
  const configuredEmailVerificationTtl = Number(
    process.env['EMAIL_VERIFICATION_TOKEN_TTL_SECONDS'],
  );
  const configuredPasswordResetTtl = Number(process.env['PASSWORD_RESET_TOKEN_TTL_SECONDS']);
  const accountService = new AccountService(
    options.accountRepository ?? new PrismaAccountRepository(),
    sessionRepository,
    passwordService,
    options.accountTokenStore ?? new InMemoryAccountTokenStore(),
    options.accountNotificationService ?? new NoopAccountNotificationService(),
    options.emailVerificationTokenTtlSeconds ??
      (Number.isSafeInteger(configuredEmailVerificationTtl) && configuredEmailVerificationTtl > 0
        ? configuredEmailVerificationTtl
        : 86_400),
    options.passwordResetTokenTtlSeconds ??
      (Number.isSafeInteger(configuredPasswordResetTtl) && configuredPasswordResetTtl > 0
        ? configuredPasswordResetTtl
        : 900),
    logger,
    options.rateLimiter,
  );
  const organizationService = new OrganizationService(
    options.organizationRepository ?? new PrismaOrganizationRepository(),
    options.organizationInvitationNotificationService,
  );
  const paymentBaseUrl = process.env['BILLING_PROVIDER_URL'];
  const paymentApiKey = process.env['BILLING_PROVIDER_API_KEY'];
  const configuredPaymentTimeout = Number(process.env['BILLING_PROVIDER_TIMEOUT_MS']);
  const billingPaymentProvider =
    options.billingPaymentProvider ??
    (paymentBaseUrl && paymentApiKey
      ? new HttpBillingPaymentProvider(
          paymentBaseUrl,
          paymentApiKey,
          process.env['BILLING_PROVIDER_NAME'] ?? 'payment-provider',
          Number.isSafeInteger(configuredPaymentTimeout) && configuredPaymentTimeout > 0
            ? configuredPaymentTimeout
            : 10_000,
        )
      : new DisabledBillingPaymentProvider());
  const billingService = new BillingService(
    options.billingRepository ?? new PrismaBillingRepository(),
    billingPaymentProvider,
    options.billingWebhookSecret ?? process.env['BILLING_WEBHOOK_SECRET'],
  );
  const adminService = new AdminService(
    options.adminRepository ?? new PrismaAdminRepository(),
    new ProviderSecretService(
      options.providerEncryptionKey ?? process.env['PROVIDER_ENCRYPTION_KEY'],
    ),
    modelCatalogCache,
    options.providerEncryptionKey
      ? async () => {
          await syncDatabaseProviders(providerRegistry, options.providerEncryptionKey!);
        }
      : undefined,
  );

  // If no custom registry was passed and 9Router API Key is in env, auto-register default 9Router provider
  const nineRouterKey = process.env['NINE_ROUTER_API_KEY'] || process.env['NINEROUTER_API_KEY'];
  if (!options.providerRegistry && nineRouterKey) {
    registerNineRouter(providerRegistry, {
      apiKey: nineRouterKey,
      baseUrl: process.env['NINE_ROUTER_BASE_URL'] || process.env['NINEROUTER_BASE_URL'],
    });
  }

  app.addHook('onRequest', (request, reply, done) => {
    const rawReqId = request.headers['x-request-id'];
    const rawCorrId = request.headers['x-correlation-id'];

    const requestId =
      typeof rawReqId === 'string' && rawReqId.trim() !== ''
        ? rawReqId.trim()
        : request.id || 'req-id';

    const correlationId =
      typeof rawCorrId === 'string' && rawCorrId.trim() !== '' ? rawCorrId.trim() : requestId;

    void reply.header('X-Request-ID', requestId);
    void reply.header('X-Correlation-ID', correlationId);

    logIncomingRequest(logger, {
      method: request.method,
      url: request.url,
      requestId,
    });
    done();
  });

  app.addHook('onResponse', (request, reply, done) => {
    logCompletedRequest(
      logger,
      {
        method: request.method,
        url: request.url,
        requestId: request.id,
      },
      reply.statusCode,
      reply.elapsedTime,
    );
    done();
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      const retryAfter = error.details?.['retryAfter'];
      if (error.statusCode === 429 && typeof retryAfter === 'number') {
        void reply.header('Retry-After', Math.max(1, Math.ceil(retryAfter)));
      }
      void reply.status(error.statusCode).send(error.toJSON());
      return;
    }

    const fastifyError = error as { statusCode?: number; code?: string };
    if (fastifyError.statusCode === 413 || fastifyError.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      void reply.status(413).send({
        success: false,
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: `Request payload exceeds the ${maxRequestSize} byte limit`,
        },
      });
      return;
    }

    logger.error(
      {
        err: error,
        requestId: request.id,
        method: request.method,
        url: request.url,
      },
      'Unhandled request error',
    );
    options.errorReporter?.capture({
      service: 'gateway',
      environment: process.env['NODE_ENV'] ?? 'development',
      errorName: error instanceof Error ? error.name : 'Error',
      requestId: request.id,
      method: request.method,
      route: request.routeOptions.url ?? request.url.split('?')[0] ?? 'unknown',
      statusCode: 500,
      occurredAt: new Date().toISOString(),
    });

    void reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      },
    });
  });

  registerUsageTrackingHook(app, usageRecorder, quotaService, options.usageCostResolver);

  void app.register(
    healthRoutes,
    options.healthService ? { healthService: options.healthService } : {},
  );
  void app.register(metricsRoutes, {
    metricsService,
    ...(options.metricsToken ? { token: options.metricsToken } : {}),
  });
  void app.register(authRoutes, {
    userRepository,
    sessionRepository,
    jwtService,
    passwordService,
    rateLimiter: options.rateLimiter,
  });
  void app.register(accountRoutes, {
    accountService,
    jwtService,
    sessionRepository,
  });
  void app.register(organizationRoutes, {
    organizationService,
    jwtService,
    sessionRepository,
  });
  void app.register(billingRoutes, {
    billingService,
    jwtService,
    sessionRepository,
  });
  void app.register(adminRoutes, {
    adminService,
    jwtService,
    sessionRepository,
  });
  void app.register(apiKeyRoutes, {
    apiKeyRepository,
    sessionRepository,
    ...(options.organizationContextResolver
      ? { organizationContextResolver: options.organizationContextResolver }
      : {}),
  });
  void app.register(chatRoutes, {
    apiKeyRepository,
    userRepository,
    providerRegistry,
    quotaService,
    ...(options.billingUsageGuard ? { billingGuard: options.billingUsageGuard } : {}),
    ...(inferenceModelResolver ? { modelCatalogService: inferenceModelResolver } : {}),
  });
  void app.register(inferenceRoutes, {
    apiKeyRepository,
    userRepository,
    providerRegistry,
    quotaService,
    ...(options.billingUsageGuard ? { billingGuard: options.billingUsageGuard } : {}),
    ...(inferenceModelResolver ? { modelCatalogService: inferenceModelResolver } : {}),
  });
  void app.register(modelRoutes, { modelCatalogService });
  void app.register(usageRoutes, {
    jwtService,
    sessionRepository,
    usageAnalyticsService,
    ...(options.organizationContextResolver
      ? { organizationContextResolver: options.organizationContextResolver }
      : {}),
  });

  return app;
}
