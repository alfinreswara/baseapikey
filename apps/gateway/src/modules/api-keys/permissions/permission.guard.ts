import { ApiKeyPermissionDeniedError } from '../errors/api-key.errors';

import type { ApiKeyPermission } from './permission.constants';
import { PermissionResolver } from './permission.resolver';

export class PermissionGuard {
  static checkPermission(grantedPermissions: unknown, requiredPermission: ApiKeyPermission): void {
    const allowed = PermissionResolver.hasPermission(grantedPermissions, requiredPermission);
    if (!allowed) {
      throw new ApiKeyPermissionDeniedError(
        `API key does not have the required permission '${requiredPermission}' for this endpoint`,
      );
    }
  }
}
