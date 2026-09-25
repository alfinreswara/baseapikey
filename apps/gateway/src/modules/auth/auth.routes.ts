import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

import { loadAuthConfig } from './auth.config';
import { LoginController } from './controllers/login.controller';
import { LogoutController } from './controllers/logout.controller';
import { MeController } from './controllers/me.controller';
import { RefreshController } from './controllers/refresh.controller';
import { RegisterController } from './controllers/register.controller';
import { SessionController } from './controllers/session.controller';
import { authenticate } from './middleware/auth.middleware';
import { PERMISSIONS, requirePermission, requireRole } from './rbac';
import {
  type ISessionRepository,
  PrismaSessionRepository,
} from './repositories/session.repository';
import { type IUserRepository, PrismaUserRepository } from './repositories/user.repository';
import { JwtService } from './services/jwt.service';
import { LoginService } from './services/login.service';
import { LogoutService } from './services/logout.service';
import { PasswordService } from './services/password.service';
import { RefreshTokenService } from './services/refresh.service';
import { RegisterService } from './services/register.service';
import { SessionService } from './services/session.service';
import type { ILoginRateLimiter } from './utils/rate-limiter.interface';

export interface AuthRoutesOptions extends FastifyPluginOptions {
  userRepository?: IUserRepository;
  sessionRepository?: ISessionRepository;
  jwtService?: JwtService;
  passwordService?: PasswordService;
  rateLimiter?: ILoginRateLimiter;
}

export async function authRoutes(
  fastify: FastifyInstance,
  options: AuthRoutesOptions = {},
): Promise<void> {
  const userRepository = options.userRepository ?? new PrismaUserRepository();
  const sessionRepository = options.sessionRepository ?? new PrismaSessionRepository();

  const authConfig = loadAuthConfig();
  const jwtService = options.jwtService ?? new JwtService(authConfig);
  const passwordService = options.passwordService ?? new PasswordService();

  const registerService = new RegisterService(userRepository, passwordService);
  const registerController = new RegisterController(registerService);

  const loginService = new LoginService(
    userRepository,
    sessionRepository,
    jwtService,
    passwordService,
    options.rateLimiter,
  );
  const loginController = new LoginController(loginService);

  const refreshService = new RefreshTokenService(
    userRepository,
    sessionRepository,
    jwtService,
    passwordService,
  );
  const refreshController = new RefreshController(refreshService);

  const logoutService = new LogoutService(userRepository, sessionRepository, jwtService);
  const logoutController = new LogoutController(logoutService);

  const sessionService = new SessionService(sessionRepository, userRepository);
  const sessionController = new SessionController(sessionService);

  const meController = new MeController();

  fastify.post('/v1/auth/register', (request, reply) => registerController.handle(request, reply));
  fastify.post('/v1/auth/login', (request, reply) => loginController.handle(request, reply));
  fastify.post('/v1/auth/refresh', (request, reply) =>
    refreshController.handleRefresh(request, reply),
  );
  fastify.post('/v1/auth/logout', (request, reply) =>
    logoutController.handleLogout(request, reply),
  );
  fastify.post('/v1/auth/logout-all', (request, reply) =>
    logoutController.handleLogoutAll(request, reply),
  );

  fastify.get(
    '/v1/auth/me',
    { preHandler: [authenticate(jwtService, { sessionRepository })] },
    (request, reply) => meController.handleMe(request, reply),
  );

  fastify.get(
    '/v1/auth/sessions',
    { preHandler: [authenticate(jwtService, { sessionRepository })] },
    (request, reply) => sessionController.listSessions(request, reply),
  );

  fastify.get(
    '/v1/auth/sessions/:id',
    { preHandler: [authenticate(jwtService, { sessionRepository })] },
    (request, reply) => sessionController.getSession(request, reply),
  );

  fastify.delete(
    '/v1/auth/sessions/:id',
    { preHandler: [authenticate(jwtService, { sessionRepository })] },
    (request, reply) => sessionController.revokeSession(request, reply),
  );

  // RBAC protected test routes
  fastify.get(
    '/v1/user/apikeys',
    {
      preHandler: [
        authenticate(jwtService, { sessionRepository }),
        requirePermission(PERMISSIONS.APIKEY_READ),
      ],
    },
    async (_request, reply) => reply.status(200).send({ success: true, message: 'API keys list' }),
  );

  fastify.get(
    '/v1/admin/system',
    {
      preHandler: [
        authenticate(jwtService, { sessionRepository }),
        requireRole('ADMIN'),
        requirePermission(PERMISSIONS.SYSTEM_MANAGE),
      ],
    },
    async (_request, reply) =>
      reply.status(200).send({ success: true, message: 'Admin system status' }),
  );
}
