import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';

import { getRequestApiKey } from '../middleware/api-key-auth.middleware';

import type { ApiKeyPermission } from './permission.constants';
import { PermissionGuard } from './permission.guard';

export function requireApiKeyPermission(
  requiredPermission: ApiKeyPermission,
): preHandlerHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const apiKeyCtx = getRequestApiKey(request);
    PermissionGuard.checkPermission(apiKeyCtx.permissions, requiredPermission);
  };
}

export const PermissionMiddleware = {
  requirePermission: requireApiKeyPermission,
};
