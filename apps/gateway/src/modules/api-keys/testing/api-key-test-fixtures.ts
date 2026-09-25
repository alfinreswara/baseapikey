import { UserRole, UserStatus } from '@baseapikey/database';
import { AppError } from '@baseapikey/shared';
import type { FastifyInstance } from 'fastify';
import fastify, { LogController } from 'fastify';

import { PasswordService } from '../../auth/services/password.service';
import { MockUserRepository } from '../../auth/testing/auth-test-utils';
import { requireQuota } from '../../quota/middleware/quota.middleware';
import { QuotaService } from '../../quota/services/quota.service';
import { MockQuotaRepository } from '../../quota/testing/mock-quota.repository';
import { registerUsageTrackingHook } from '../../usage/middleware/usage.middleware';
import { AsyncUsageRecorder } from '../../usage/services/usage-recorder';
import { UsageTrackingService } from '../../usage/services/usage-tracking.service';
import { MockUsageRepository } from '../../usage/testing/mock-usage.repository';
import { ApiKeyController } from '../controllers/create-api-key.controller';
import { authenticateApiKey } from '../middleware/api-key-auth.middleware';
import { API_KEY_PERMISSIONS } from '../permissions/permission.constants';
import { requireApiKeyPermission } from '../permissions/permission.middleware';
import { ApiKeyPermissionService } from '../services/api-key-permission.service';
import { ApiKeyRevocationService } from '../services/api-key-revocation.service';
import { ApiKeyRotationService } from '../services/api-key-rotation.service';
import { ApiKeyService } from '../services/api-key.service';
import { generateApiKey } from '../utils/api-key-generator.util';

import { MockApiKeyRepository } from './mock-api-key.repository';

export interface TestContainer {
  app: FastifyInstance;
  mockUserRepo: MockUserRepository;
  mockApiKeyRepo: MockApiKeyRepository;
  mockQuotaRepo: MockQuotaRepository;
  mockUsageRepo: MockUsageRepository;
  passwordService: PasswordService;
  apiKeyService: ApiKeyService;
  permissionService: ApiKeyPermissionService;
  rotationService: ApiKeyRotationService;
  revocationService: ApiKeyRevocationService;
  quotaService: QuotaService;
  usageService: UsageTrackingService;
  usageRecorder: AsyncUsageRecorder;
  controller: ApiKeyController;
}

export async function createTestContainer(): Promise<TestContainer> {
  const mockUserRepo = new MockUserRepository();
  const mockApiKeyRepo = new MockApiKeyRepository();
  const mockQuotaRepo = new MockQuotaRepository();
  const mockUsageRepo = new MockUsageRepository();
  const passwordService = new PasswordService();

  const apiKeyService = new ApiKeyService(mockApiKeyRepo, passwordService);
  const permissionService = new ApiKeyPermissionService(mockApiKeyRepo);
  const rotationService = new ApiKeyRotationService(mockApiKeyRepo, passwordService);
  const revocationService = new ApiKeyRevocationService(mockApiKeyRepo);

  const quotaService = new QuotaService(mockQuotaRepo);
  const usageService = new UsageTrackingService(mockUsageRepo, mockApiKeyRepo);
  const usageRecorder = new AsyncUsageRecorder(usageService);

  const controller = new ApiKeyController(
    apiKeyService,
    permissionService,
    rotationService,
    revocationService,
  );

  const app = fastify({ logController: new LogController({ disableRequestLogging: true }) });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      void reply.status(error.statusCode).send(error.toJSON());
      return;
    }
    void reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Internal server error',
      },
    });
  });

  // Attach usage tracking hook
  registerUsageTrackingHook(app, usageRecorder);

  // Set up test routes
  const apiKeyAuthMiddleware = authenticateApiKey(mockApiKeyRepo, mockUserRepo, passwordService);

  // Simulated AI Chat Completions Route
  app.post(
    '/v1/chat/completions',
    {
      preHandler: [
        apiKeyAuthMiddleware,
        requireApiKeyPermission(API_KEY_PERMISSIONS.CHAT_COMPLETIONS),
        requireQuota(quotaService),
      ],
    },
    async (req, reply) => {
      // Set usage metadata for tracking
      req.usageMetadata = {
        provider: 'openai',
        model: 'gpt-4o',
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        estimatedCost: 0.003,
      };

      void reply.status(200).send({
        id: 'chatcmpl-test-123',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Integration test response' },
            finish_reason: 'stop',
          },
        ],
      });
    },
  );

  // Simulated Embeddings Route
  app.post(
    '/v1/embeddings',
    {
      preHandler: [
        apiKeyAuthMiddleware,
        requireApiKeyPermission(API_KEY_PERMISSIONS.EMBEDDINGS_CREATE),
        requireQuota(quotaService),
      ],
    },
    async (_req, reply) => {
      void reply.status(200).send({
        object: 'list',
        data: [{ object: 'embedding', embedding: [0.1, 0.2, 0.3], index: 0 }],
      });
    },
  );

  await app.ready();

  return {
    app,
    mockUserRepo,
    mockApiKeyRepo,
    mockQuotaRepo,
    mockUsageRepo,
    passwordService,
    apiKeyService,
    permissionService,
    rotationService,
    revocationService,
    quotaService,
    usageService,
    usageRecorder,
    controller,
  };
}

export async function createTestUserHelper(
  mockUserRepo: MockUserRepository,
  passwordService: PasswordService,
  overrides?: { email?: string; username?: string; role?: UserRole; status?: UserStatus },
) {
  return mockUserRepo.create({
    email: overrides?.email ?? 'integrationuser@example.com',
    username: overrides?.username ?? 'integrationuser',
    fullName: 'Integration Test User',
    passwordHash: await passwordService.hash('Password123!'),
    role: overrides?.role ?? UserRole.USER,
    status: overrides?.status ?? UserStatus.ACTIVE,
  });
}

export async function createTestApiKeyHelper(
  mockApiKeyRepo: MockApiKeyRepository,
  passwordService: PasswordService,
  userId: string,
  overrides?: { name?: string; permissions?: string[]; expiresAt?: Date | null },
) {
  const { plaintextKey, keyPrefix } = generateApiKey();
  const keyHash = await passwordService.hash(plaintextKey);

  const record = await mockApiKeyRepo.createKey({
    userId,
    name: overrides?.name ?? 'Test API Key',
    keyHash,
    keyPrefix,
    permissions: overrides?.permissions ?? [
      API_KEY_PERMISSIONS.CHAT_COMPLETIONS,
      API_KEY_PERMISSIONS.MODELS_LIST,
    ],
    expiresAt: overrides?.expiresAt ?? null,
  });

  return { record, plaintextKey };
}
