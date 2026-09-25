import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

import { authenticate } from '../auth/middleware/auth.middleware';
import { PERMISSIONS, requirePermission } from '../auth/rbac';
import type { ISessionRepository } from '../auth/repositories/session.repository';
import type { JwtService } from '../auth/services/jwt.service';

import { AccountController } from './controllers/account.controller';
import type { AccountService } from './services/account.service';

export interface AccountRoutesOptions extends FastifyPluginOptions {
  accountService: AccountService;
  jwtService: JwtService;
  sessionRepository: ISessionRepository;
}

export async function accountRoutes(
  fastify: FastifyInstance,
  options: AccountRoutesOptions,
): Promise<void> {
  const controller = new AccountController(options.accountService);
  const authenticateUser = authenticate(options.jwtService, {
    sessionRepository: options.sessionRepository,
  });

  fastify.get('/api/v1/me', {
    preHandler: [authenticateUser, requirePermission(PERMISSIONS.PROFILE_READ)],
    handler: (request, reply) => controller.getProfile(request, reply),
  });
  fastify.patch('/api/v1/me', {
    preHandler: [authenticateUser, requirePermission(PERMISSIONS.PROFILE_UPDATE)],
    handler: (request, reply) => controller.updateProfile(request, reply),
  });
  fastify.patch('/api/v1/me/password', {
    preHandler: [authenticateUser, requirePermission(PERMISSIONS.PROFILE_UPDATE)],
    handler: (request, reply) => controller.changePassword(request, reply),
  });
  fastify.post('/api/v1/me/email-verification/request', {
    preHandler: [authenticateUser, requirePermission(PERMISSIONS.PROFILE_UPDATE)],
    handler: (request, reply) => controller.requestEmailVerification(request, reply),
  });

  fastify.post('/api/v1/account/email-verification/confirm', (request, reply) =>
    controller.confirmEmailVerification(request, reply),
  );
  fastify.post('/api/v1/account/password-reset/request', (request, reply) =>
    controller.requestPasswordReset(request, reply),
  );
  fastify.post('/api/v1/account/password-reset/confirm', (request, reply) =>
    controller.confirmPasswordReset(request, reply),
  );
}
