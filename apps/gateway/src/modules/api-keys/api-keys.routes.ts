import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

import { loadAuthConfig } from '../auth/auth.config';
import { authenticate } from '../auth/middleware/auth.middleware';
import {
  type ISessionRepository,
  PrismaSessionRepository,
} from '../auth/repositories/session.repository';
import { JwtService } from '../auth/services/jwt.service';
import { PasswordService } from '../auth/services/password.service';
import {
  attachOrganizationContext,
  type IOrganizationContextResolver,
  requireOrganizationManager,
} from '../organizations/middleware/organization-context.middleware';

import { ApiKeyController } from './controllers/create-api-key.controller';
import { type IApiKeyRepository, PrismaApiKeyRepository } from './repositories/api-key.repository';
import { ApiKeyPermissionService } from './services/api-key-permission.service';
import { ApiKeyRevocationService } from './services/api-key-revocation.service';
import { ApiKeyRotationService } from './services/api-key-rotation.service';
import { ApiKeyService } from './services/api-key.service';

export interface ApiKeyRoutesOptions extends FastifyPluginOptions {
  apiKeyRepository?: IApiKeyRepository;
  sessionRepository?: ISessionRepository;
  jwtService?: JwtService;
  passwordService?: PasswordService;
  apiKeyPermissionService?: ApiKeyPermissionService;
  apiKeyRotationService?: ApiKeyRotationService;
  apiKeyRevocationService?: ApiKeyRevocationService;
  organizationContextResolver?: IOrganizationContextResolver;
}

export async function apiKeyRoutes(
  fastify: FastifyInstance,
  options: ApiKeyRoutesOptions = {},
): Promise<void> {
  const apiKeyRepository = options.apiKeyRepository ?? new PrismaApiKeyRepository();
  const sessionRepository = options.sessionRepository ?? new PrismaSessionRepository();

  const authConfig = loadAuthConfig();
  const jwtService = options.jwtService ?? new JwtService(authConfig);
  const passwordService = options.passwordService ?? new PasswordService();

  const apiKeyService = new ApiKeyService(apiKeyRepository, passwordService);
  const apiKeyPermissionService =
    options.apiKeyPermissionService ?? new ApiKeyPermissionService(apiKeyRepository);
  const apiKeyRotationService =
    options.apiKeyRotationService ?? new ApiKeyRotationService(apiKeyRepository, passwordService);
  const apiKeyRevocationService =
    options.apiKeyRevocationService ?? new ApiKeyRevocationService(apiKeyRepository);
  const apiKeyController = new ApiKeyController(
    apiKeyService,
    apiKeyPermissionService,
    apiKeyRotationService,
    apiKeyRevocationService,
  );

  const authMiddleware = authenticate(jwtService, { sessionRepository });
  const readGuard = options.organizationContextResolver
    ? [authMiddleware, attachOrganizationContext(options.organizationContextResolver)]
    : [authMiddleware];
  const writeGuard = options.organizationContextResolver
    ? [...readGuard, requireOrganizationManager()]
    : [authMiddleware];

  fastify.post(
    '/v1/api-keys',
    {
      preHandler: writeGuard,
    },
    (request, reply) => apiKeyController.createApiKey(request, reply),
  );

  fastify.get(
    '/v1/api-keys',
    {
      preHandler: readGuard,
    },
    (request, reply) => apiKeyController.listApiKeys(request, reply),
  );

  fastify.get(
    '/v1/api-keys/:id',
    {
      preHandler: readGuard,
    },
    (request, reply) => apiKeyController.getApiKey(request, reply),
  );

  fastify.patch(
    '/v1/api-keys/:id',
    {
      preHandler: writeGuard,
    },
    (request, reply) => apiKeyController.updateApiKey(request, reply),
  );

  fastify.patch(
    '/v1/api-keys/:id/permissions',
    {
      preHandler: writeGuard,
    },
    (request, reply) => apiKeyController.updateApiKeyPermissions(request, reply),
  );

  fastify.post(
    '/v1/api-keys/:id/rotate',
    {
      preHandler: writeGuard,
    },
    (request, reply) => apiKeyController.rotateApiKey(request, reply),
  );

  fastify.post(
    '/v1/api-keys/:id/revoke',
    {
      preHandler: writeGuard,
    },
    (request, reply) => apiKeyController.revokeApiKey(request, reply),
  );

  fastify.delete(
    '/v1/api-keys/:id',
    {
      preHandler: writeGuard,
    },
    (request, reply) => apiKeyController.revokeApiKey(request, reply),
  );
}
