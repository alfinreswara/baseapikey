import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

import { authenticate } from '../auth/middleware/auth.middleware';
import { PERMISSIONS, requirePermission, requireRole, ROLES } from '../auth/rbac';
import type { ISessionRepository } from '../auth/repositories/session.repository';
import type { JwtService } from '../auth/services/jwt.service';

import { AdminController } from './controllers/admin.controller';
import type { AdminService } from './services/admin.service';

export interface AdminRoutesOptions extends FastifyPluginOptions {
  adminService: AdminService;
  jwtService: JwtService;
  sessionRepository: ISessionRepository;
}

export async function adminRoutes(
  fastify: FastifyInstance,
  options: AdminRoutesOptions,
): Promise<void> {
  const controller = new AdminController(options.adminService);
  const auth = authenticate(options.jwtService, { sessionRepository: options.sessionRepository });
  const providerGuard = [
    auth,
    requireRole(ROLES.ADMIN),
    requirePermission(PERMISSIONS.PROVIDERS_MANAGE),
  ];
  const modelGuard = [auth, requireRole(ROLES.ADMIN), requirePermission(PERMISSIONS.MODELS_MANAGE)];
  const auditGuard = [auth, requireRole(ROLES.ADMIN), requirePermission(PERMISSIONS.AUDIT_READ)];
  const userGuard = [auth, requireRole(ROLES.ADMIN), requirePermission(PERMISSIONS.USERS_READ)];
  const systemGuard = [
    auth,
    requireRole(ROLES.ADMIN),
    requirePermission(PERMISSIONS.SYSTEM_MANAGE),
  ];

  fastify.get('/api/v1/admin/providers', { preHandler: providerGuard }, (request, reply) =>
    controller.listProviders(request, reply),
  );
  fastify.post('/api/v1/admin/providers', { preHandler: providerGuard }, (request, reply) =>
    controller.createProvider(request, reply),
  );
  fastify.patch('/api/v1/admin/providers/:id', { preHandler: providerGuard }, (request, reply) =>
    controller.updateProvider(request, reply),
  );
  fastify.get('/api/v1/admin/models', { preHandler: modelGuard }, (request, reply) =>
    controller.listModels(request, reply),
  );
  fastify.post('/api/v1/admin/models', { preHandler: modelGuard }, (request, reply) =>
    controller.createModel(request, reply),
  );
  fastify.patch('/api/v1/admin/models/:id', { preHandler: modelGuard }, (request, reply) =>
    controller.updateModel(request, reply),
  );
  fastify.get('/api/v1/admin/audit-logs', { preHandler: auditGuard }, (request, reply) =>
    controller.listAudits(request, reply),
  );
  fastify.get('/api/v1/admin/users', { preHandler: userGuard }, (request, reply) =>
    controller.listUsers(request, reply),
  );
  fastify.get('/api/v1/admin/health', { preHandler: systemGuard }, (request, reply) =>
    controller.health(request, reply),
  );
  fastify.get('/api/v1/admin/usage', { preHandler: systemGuard }, (request, reply) =>
    controller.usage(request, reply),
  );
}
