import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

import { authenticate } from '../auth/middleware/auth.middleware';
import { PERMISSIONS, requirePermission } from '../auth/rbac';
import type { ISessionRepository } from '../auth/repositories/session.repository';
import type { JwtService } from '../auth/services/jwt.service';

import { OrganizationController } from './controllers/organization.controller';
import type { OrganizationService } from './services/organization.service';

export interface OrganizationRoutesOptions extends FastifyPluginOptions {
  organizationService: OrganizationService;
  jwtService: JwtService;
  sessionRepository: ISessionRepository;
}

export async function organizationRoutes(
  fastify: FastifyInstance,
  options: OrganizationRoutesOptions,
): Promise<void> {
  const controller = new OrganizationController(options.organizationService);
  const readGuard = [
    authenticate(options.jwtService, { sessionRepository: options.sessionRepository }),
    requirePermission(PERMISSIONS.PROFILE_READ),
  ];
  const writeGuard = [
    authenticate(options.jwtService, { sessionRepository: options.sessionRepository }),
    requirePermission(PERMISSIONS.PROFILE_UPDATE),
  ];

  fastify.get('/api/v1/me/organizations', { preHandler: readGuard }, (request, reply) =>
    controller.listMine(request, reply),
  );
  fastify.post(
    '/api/v1/me/organizations/:id/switch',
    { preHandler: writeGuard },
    (request, reply) => controller.switchActive(request, reply),
  );
  fastify.post('/api/v1/organizations', { preHandler: writeGuard }, (request, reply) =>
    controller.create(request, reply),
  );
  fastify.get('/api/v1/organizations/:id', { preHandler: readGuard }, (request, reply) =>
    controller.get(request, reply),
  );
  fastify.patch('/api/v1/organizations/:id', { preHandler: writeGuard }, (request, reply) =>
    controller.update(request, reply),
  );
  fastify.get('/api/v1/organizations/:id/members', { preHandler: readGuard }, (request, reply) =>
    controller.listMembers(request, reply),
  );
  fastify.post('/api/v1/organizations/:id/members', { preHandler: writeGuard }, (request, reply) =>
    controller.inviteMember(request, reply),
  );
  fastify.post(
    '/api/v1/organizations/:id/invitations',
    { preHandler: writeGuard },
    (request, reply) => controller.createInvitation(request, reply),
  );
  fastify.post(
    '/api/v1/organization-invitations/:token/accept',
    { preHandler: writeGuard },
    (request, reply) => controller.acceptInvitation(request, reply),
  );
  fastify.patch(
    '/api/v1/organizations/:id/members/:userId',
    { preHandler: writeGuard },
    (request, reply) => controller.updateMember(request, reply),
  );
  fastify.delete(
    '/api/v1/organizations/:id/members/:userId',
    { preHandler: writeGuard },
    (request, reply) => controller.removeMember(request, reply),
  );
}
