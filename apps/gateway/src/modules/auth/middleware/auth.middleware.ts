import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';

import {
  InvalidTokenError,
  InvalidTokenVersionError,
  MissingTokenError,
  TokenExpiredError,
  UnauthorizedError,
} from '../errors/auth.errors';
import type { ISessionRepository } from '../repositories/session.repository';
import type { JwtService } from '../services/jwt.service';
import type { AuthenticatedUser, JwtPayload } from '../types/auth.types';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser | undefined;
  }
}

export interface AuthenticateMiddlewareOptions {
  expectedTokenVersion?: number | undefined;
  sessionRepository?: ISessionRepository | undefined;
}

/**
 * Fastify preHandler hook that validates JWT Bearer access token
 * and attaches authenticated user context to request.user.
 */
export function authenticate(
  jwtService: JwtService,
  options: AuthenticateMiddlewareOptions = {},
): preHandlerHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new MissingTokenError('Authorization header is required');
    }

    if (!authHeader.startsWith('Bearer ')) {
      throw new InvalidTokenError('Invalid Authorization header format. Expected Bearer <token>');
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      throw new MissingTokenError('Access token is missing in Authorization header');
    }

    let payload: JwtPayload;
    try {
      payload = jwtService.verifyToken(token, 'access');
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message.toLowerCase().includes('expired')) {
          throw new TokenExpiredError('Access token has expired');
        }
      }
      throw new InvalidTokenError('Invalid or tampered access token signature');
    }

    const tokenVersion = payload.tokenVersion ?? 1;
    if (
      options.expectedTokenVersion !== undefined &&
      tokenVersion !== options.expectedTokenVersion
    ) {
      throw new InvalidTokenVersionError(
        `Token version mismatch. Expected ${options.expectedTokenVersion}, got ${tokenVersion}`,
      );
    }

    if (!payload.sub || !payload.email || !payload.role) {
      throw new InvalidTokenError('Malformed token payload: missing required claims');
    }

    // Session validation & revocation check if sessionRepository is provided and sessionId exists
    if (options.sessionRepository && payload.sessionId) {
      const session = await options.sessionRepository.findSessionById(payload.sessionId);
      if (!session || session.isRevoked || session.expiresAt <= new Date()) {
        throw new UnauthorizedError(
          'Session associated with token is invalid, expired, or revoked',
        );
      }
    }

    const user: AuthenticatedUser = {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      sessionId: payload.sessionId,
      tokenVersion,
      activeOrganizationId: payload.activeOrganizationId,
      organizationRole: payload.organizationRole,
    };

    request.user = user;
  };
}

/**
 * Fastify preHandler hook guard enforcing that request.user is set.
 */
export function requireAuth(): preHandlerHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      throw new UnauthorizedError('Unauthorized access: authenticated user context missing');
    }
  };
}

/**
 * Request context utility retrieving the authenticated user from request context.
 * Throws UnauthorizedError if unauthenticated.
 */
export function getRequestUser(request: FastifyRequest): AuthenticatedUser {
  if (!request.user) {
    throw new UnauthorizedError('No authenticated user attached to request context');
  }
  return request.user;
}
