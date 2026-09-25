import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

import { authenticate } from '../auth/middleware/auth.middleware';
import { PERMISSIONS, requirePermission } from '../auth/rbac';
import type { ISessionRepository } from '../auth/repositories/session.repository';
import type { JwtService } from '../auth/services/jwt.service';

import { BillingController } from './controllers/billing.controller';
import type { BillingService } from './services/billing.service';

export interface BillingRoutesOptions extends FastifyPluginOptions {
  billingService: BillingService;
  jwtService: JwtService;
  sessionRepository: ISessionRepository;
}

export async function billingRoutes(
  fastify: FastifyInstance,
  options: BillingRoutesOptions,
): Promise<void> {
  const controller = new BillingController(options.billingService);
  const readGuard = [
    authenticate(options.jwtService, { sessionRepository: options.sessionRepository }),
    requirePermission(PERMISSIONS.USAGE_READ),
  ];
  const writeGuard = [
    authenticate(options.jwtService, { sessionRepository: options.sessionRepository }),
    requirePermission(PERMISSIONS.PROFILE_UPDATE),
  ];

  fastify.get('/api/v1/organizations/:id/billing', { preHandler: readGuard }, (request, reply) =>
    controller.getAccount(request, reply),
  );
  fastify.get(
    '/api/v1/organizations/:id/billing/invoices',
    { preHandler: readGuard },
    (request, reply) => controller.listInvoices(request, reply),
  );
  fastify.get(
    '/api/v1/organizations/:id/billing/transactions',
    { preHandler: readGuard },
    (request, reply) => controller.listTransactions(request, reply),
  );
  fastify.post(
    '/api/v1/organizations/:id/billing/checkout',
    { preHandler: writeGuard },
    (request, reply) => controller.createCheckout(request, reply),
  );
  fastify.post('/api/v1/billing/webhooks/:provider', (request, reply) =>
    controller.webhook(request, reply),
  );
}
