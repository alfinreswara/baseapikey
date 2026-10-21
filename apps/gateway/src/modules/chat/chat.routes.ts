import type { ProviderRegistry } from '@baseapikey/shared';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

import { authenticateApiKey } from '../api-keys/middleware/api-key-auth.middleware';
import { API_KEY_PERMISSIONS } from '../api-keys/permissions/permission.constants';
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

import { createChatCompletionController } from './controllers/chat-completion.controller';
import { ChatCompletionService } from './services/chat-completion.service';

export interface ChatRoutesOptions extends FastifyPluginOptions {
  apiKeyRepository?: IApiKeyRepository;
  userRepository?: IUserRepository;
  providerRegistry?: ProviderRegistry;
  chatCompletionService?: ChatCompletionService;
  /** Resolves the model, the provider, and the price before the request. */
  modelPolicyResolver?: ModelPolicyResolver;
  /** Reserves the credit of the request before it reaches a provider. */
  creditAuthorization?: CreditAuthorizationService;
  /** Router that also carries the service wide abort signal. */
  resilientRouter?: ResilientProviderRouter;
  quotaService?: QuotaService;
  billingGuard?: IOrganizationBillingGuard;
  modelCatalogService?: ModelCatalogService;
  /** The deadline of a request that reaches a provider. */
  requestDeadlineMs?: number;
}

export async function chatRoutes(
  fastify: FastifyInstance,
  options: ChatRoutesOptions = {},
): Promise<void> {
  const apiKeyRepository = options.apiKeyRepository ?? new PrismaApiKeyRepository();
  const userRepository = options.userRepository ?? new PrismaUserRepository();
  const authMiddleware = authenticateApiKey(apiKeyRepository, userRepository);
  const permissionMiddleware = requireApiKeyPermission(API_KEY_PERMISSIONS.CHAT_COMPLETIONS);

  if (!options.providerRegistry && !options.chatCompletionService) {
    throw new Error('ChatRoutes requires providerRegistry or chatCompletionService option');
  }

  const chatService =
    options.chatCompletionService ??
    new ChatCompletionService(
      options.providerRegistry!,
      '9router',
      options.resilientRouter,
      options.modelCatalogService,
    );

  if (!options.modelPolicyResolver) {
    throw new Error('ChatRoutes requires a modelPolicyResolver');
  }
  if (!options.creditAuthorization) {
    throw new Error('ChatRoutes requires a creditAuthorization');
  }
  const controller = createChatCompletionController(
    chatService,
    options.modelPolicyResolver,
    options.creditAuthorization,
    options.requestDeadlineMs,
  );
  const preHandler = [authMiddleware, permissionMiddleware];
  if (options.quotaService) {
    preHandler.push(requireQuota(options.quotaService));
  }
  if (options.billingGuard) {
    preHandler.push(requireAvailableBilling(options.billingGuard));
  }

  fastify.post('/v1/chat/completions', {
    preHandler,
    handler: controller,
  });
}
