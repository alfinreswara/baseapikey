import { type ApiKeyPermission } from './permission.constants';
import { PermissionValidator } from './permission.validator';

export class PermissionResolver {
  static resolvePermissions(permissions: unknown): ApiKeyPermission[] {
    if (!Array.isArray(permissions)) {
      return [];
    }
    return permissions.filter((p): p is ApiKeyPermission =>
      PermissionValidator.isValidPermission(p),
    );
  }

  static hasPermission(grantedPermissions: unknown, requiredPermission: ApiKeyPermission): boolean {
    const resolved = this.resolvePermissions(grantedPermissions);
    return resolved.includes(requiredPermission);
  }

  static hasAllPermissions(
    grantedPermissions: unknown,
    requiredPermissions: ApiKeyPermission[],
  ): boolean {
    const resolved = this.resolvePermissions(grantedPermissions);
    return requiredPermissions.every((req) => resolved.includes(req));
  }
}
