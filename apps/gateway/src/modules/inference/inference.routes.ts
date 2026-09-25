import type { ProviderRegistry } from '@baseapikey/shared';
import type { FastifyInstance, FastifyPluginOptions, preHandlerHookHandler } from 'fastify';

import { authenticateApiKey } from '../api-keys/middleware/api-key-auth.middleware';
import {
  API_KEY_PERMISSIONS,
  type ApiKeyPermission,
} from '../api-keys/permissions/permission.constants';
import { requireApiKeyPermission } from '../api-keys/permissions/permission.middleware';
import {
  type IApiKeyRepository,
  PrismaApiKeyRepository,
} from '../api-keys/repositories/api-key.repository';
import { type IUserRepository, PrismaUserRepository } from '../auth/repositories/user.repository';
import {
  type IOrganizationBillingGuard,
  requireAvailableBilling,
} from '../billing/middleware/billing-usage.middleware';
import type { ModelCatalogService } from '../models/services/model-catalog.service';
import { requireQuota } from '../quota/middleware/quota.middleware';
import type { QuotaService } from '../quota/services/quota.service';

import { InferenceController } from './controllers/inference.controller';
import { InferenceService } from './services/inference.service';

export interface InferenceRoutesOptions extends FastifyPluginOptions {
  providerRegistry: ProviderRegistry;
  apiKeyRepository?: IApiKeyRepository;
  userRepository?: IUserRepository;
  quotaService?: QuotaService;
  inferenceService?: InferenceService;
  billingGuard?: IOrganizationBillingGuard;
  modelCatalogService?: ModelCatalogService;
}

export async function inferenceRoutes(
  fastify: FastifyInstance,
  options: InferenceRoutesOptions,
): Promise<void> {
  const apiKeyRepository = options.apiKeyRepository ?? new PrismaApiKeyRepository();
  const userRepository = options.userRepository ?? new PrismaUserRepository();
  const authenticate = authenticateApiKey(apiKeyRepository, userRepository);
  const controller = new InferenceController(
    options.inferenceService ??
      new InferenceService(
        options.providerRegistry,
        '9router',
        undefined,
        options.modelCatalogService,
      ),
  );
  const guards = (permission: ApiKeyPermission): preHandlerHookHandler[] => {
    const handlers = [authenticate, requireApiKeyPermission(permission)];
    if (options.quotaService) handlers.push(requireQuota(options.quotaService));
    if (options.billingGuard) handlers.push(requireAvailableBilling(options.billingGuard));
    return handlers;
  };

  fastify.addContentTypeParser(
    /^multipart\/form-data/i,
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  );

  fastify.post('/v1/embeddings', {
    preHandler: guards(API_KEY_PERMISSIONS.EMBEDDINGS_CREATE),
    handler: (request, reply) => controller.embedding(request, reply),
  });
  fastify.post('/v1/images/generations', {
    preHandler: guards(API_KEY_PERMISSIONS.IMAGES_GENERATE),
    handler: (request, reply) => controller.image(request, reply),
  });
  fastify.post('/v1/audio/speech', {
    preHandler: guards(API_KEY_PERMISSIONS.AUDIO_SPEECH),
    handler: (request, reply) => controller.speech(request, reply),
  });
  fastify.post('/v1/audio/transcriptions', {
    bodyLimit: 25 * 1024 * 1024,
    preHandler: guards(API_KEY_PERMISSIONS.AUDIO_TRANSCRIBE),
    handler: (request, reply) => controller.transcription(request, reply),
  });
}
