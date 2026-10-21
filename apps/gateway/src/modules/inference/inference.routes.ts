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
import type { CreditAuthorizationService } from '../billing/services/credit-authorization.service';
import type { ModelCatalogService } from '../models/services/model-catalog.service';
import type { ModelPolicyResolver } from '../models/services/model-policy.service';
import type { ResilientProviderRouter } from '../providers/resilience/resilient-provider-router';
import { requireQuota } from '../quota/middleware/quota.middleware';
import type { QuotaService } from '../quota/services/quota.service';

import { InferenceController } from './controllers/inference.controller';
import { InferenceService } from './services/inference.service';

export interface InferenceRoutesOptions extends FastifyPluginOptions {
  providerRegistry: ProviderRegistry;
  /** Resolves the model, the provider, and the price before the request. */
  modelPolicyResolver?: ModelPolicyResolver;
  /** Reserves the credit of the request before it reaches a provider. */
  creditAuthorization?: CreditAuthorizationService;
  apiKeyRepository?: IApiKeyRepository;
  userRepository?: IUserRepository;
  quotaService?: QuotaService;
  inferenceService?: InferenceService;
  /** Router that also carries the service wide abort signal. */
  resilientRouter?: ResilientProviderRouter;
  billingGuard?: IOrganizationBillingGuard;
  modelCatalogService?: ModelCatalogService;
  /** The deadline of a request that reaches a provider. */
  requestDeadlineMs?: number;
}

export async function inferenceRoutes(
  fastify: FastifyInstance,
  options: InferenceRoutesOptions,
): Promise<void> {
  const apiKeyRepository = options.apiKeyRepository ?? new PrismaApiKeyRepository();
  const userRepository = options.userRepository ?? new PrismaUserRepository();
  const authenticate = authenticateApiKey(apiKeyRepository, userRepository);
  if (!options.modelPolicyResolver) {
    throw new Error('InferenceRoutes requires a modelPolicyResolver');
  }
  if (!options.creditAuthorization) {
    throw new Error('InferenceRoutes requires a creditAuthorization');
  }
  const controller = new InferenceController(
    options.inferenceService ??
      new InferenceService(
        options.providerRegistry,
        '9router',
        options.resilientRouter,
        options.modelCatalogService,
      ),
    options.modelPolicyResolver,
    options.creditAuthorization,
    options.requestDeadlineMs,
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
