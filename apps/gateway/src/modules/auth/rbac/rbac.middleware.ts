import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';

import { UnauthorizedError } from '../errors/auth.errors';

import type { PermissionName, RoleName } from './rbac.constants';
import { AuthorizationContext } from './rbac.context';
import { ForbiddenError, MissingPermissionError, MissingRoleError } from './rbac.errors';

/**
 * Fastify preHandler guard requiring the authenticated user to have one of the specified roles.
 * Returns 401 Unauthorized if unauthenticated, 403 Forbidden if role mismatch.
 */
export function requireRole(...allowedRoles: RoleName[]): preHandlerHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      throw new UnauthorizedError('Unauthorized access: unauthenticated request');
    }

    if (!request.user.role) {
      throw new MissingRoleError('Forbidden: user context lacks a role');
    }

    if (!AuthorizationContext.hasRole(request.user, allowedRoles)) {
      request.log?.warn?.(
        {
          userId: request.user.userId,
          role: request.user.role,
          allowedRoles,
          event: 'AUTH_PERMISSION_DENIED',
        },
        'AUTH_PERMISSION_DENIED: Role not authorized',
      );
      throw new ForbiddenError(
        `Forbidden: role '${request.user.role}' is not authorized to access this resource`,
      );
    }
  };
}

/**
 * Fastify preHandler guard requiring the authenticated user to possess all specified permissions.
 * Returns 401 Unauthorized if unauthenticated, 403 Forbidden if missing permission.
 */
export function requirePermission(...requiredPermissions: PermissionName[]): preHandlerHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      throw new UnauthorizedError('Unauthorized access: unauthenticated request');
    }

    if (!request.user.role) {
      throw new MissingRoleError('Forbidden: user context lacks a role');
    }

    for (const perm of requiredPermissions) {
      if (!AuthorizationContext.hasPermission(request.user, perm)) {
        request.log?.warn?.(
          {
            userId: request.user.userId,
            role: request.user.role,
            requiredPermission: perm,
            event: 'AUTH_PERMISSION_DENIED',
          },
          'AUTH_PERMISSION_DENIED: Permission not granted',
        );
        throw new MissingPermissionError(perm);
      }
    }
  };
}

export interface AuthorizeOptions {
  roles?: RoleName[] | undefined;
  permissions?: PermissionName[] | undefined;
}

/**
 * Fastify preHandler guard enforcing combined role and permission authorization constraints.
 */
export function authorize(options: AuthorizeOptions): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      throw new UnauthorizedError('Unauthorized access: unauthenticated request');
    }

    if (options.roles && options.roles.length > 0) {
      const roleGuard = requireRole(...options.roles);
      await (roleGuard as (req: FastifyRequest, rep: FastifyReply) => Promise<void>)(
        request,
        reply,
      );
    }

    if (options.permissions && options.permissions.length > 0) {
      const permGuard = requirePermission(...options.permissions);
      await (permGuard as (req: FastifyRequest, rep: FastifyReply) => Promise<void>)(
        request,
        reply,
      );
    }
  };
}
