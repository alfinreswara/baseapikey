import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

import { authenticate } from '../auth/middleware/auth.middleware';
import { PERMISSIONS, requirePermission } from '../auth/rbac';
import type { ISessionRepository } from '../auth/repositories/session.repository';
import type { JwtService } from '../auth/services/jwt.service';
import {
  attachOrganizationContext,
  type IOrganizationContextResolver,
} from '../organizations/middleware/organization-context.middleware';

import { UsageAnalyticsController } from './controllers/usage-analytics.controller';
import type { UsageAnalyticsService } from './services/usage-analytics.service';

export interface UsageRoutesOptions extends FastifyPluginOptions {
  jwtService: JwtService;
  sessionRepository: ISessionRepository;
  usageAnalyticsService: UsageAnalyticsService;
  organizationContextResolver?: IOrganizationContextResolver;
}

export async function usageRoutes(
  fastify: FastifyInstance,
  options: UsageRoutesOptions,
): Promise<void> {
  const controller = new UsageAnalyticsController(options.usageAnalyticsService);
  const auth = authenticate(options.jwtService, { sessionRepository: options.sessionRepository });
  const preHandler = options.organizationContextResolver
    ? [
        auth,
        attachOrganizationContext(options.organizationContextResolver),
        requirePermission(PERMISSIONS.USAGE_READ),
      ]
    : [auth, requirePermission(PERMISSIONS.USAGE_READ)];

  fastify.get('/api/v1/usage', {
    preHandler,
    handler: (request, reply) => controller.getTimeseries(request, reply),
  });
  fastify.get('/api/v1/usage/summary', {
    preHandler,
    handler: (request, reply) => controller.getSummary(request, reply),
  });
  fastify.get('/api/v1/usage/history', {
    preHandler,
    handler: (request, reply) => controller.getHistory(request, reply),
  });
}
