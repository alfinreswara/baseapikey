import type { AuthenticatedUser } from '../types/auth.types';

import { ROLE_PERMISSIONS, type PermissionName, type RoleName } from './rbac.constants';
import { MissingRoleError } from './rbac.errors';

export class AuthorizationContext {
  /**
   * Resolves the set of permissions associated with a role.
   * Returns an empty set if the role is unrecognized (deny by default).
   */
  static getPermissionsForRole(role?: string | null): ReadonlySet<PermissionName> {
    if (!role) {
      return new Set();
    }
    const normalizedRole = role.toUpperCase();
    return ROLE_PERMISSIONS[normalizedRole] ?? ROLE_PERMISSIONS[role] ?? new Set();
  }

  /**
   * Resolves all permissions granted to an authenticated user context based on their role.
   */
  static getUserPermissions(user: AuthenticatedUser): ReadonlySet<PermissionName> {
    if (!user.role) {
      throw new MissingRoleError();
    }
    return AuthorizationContext.getPermissionsForRole(user.role);
  }

  /**
   * Verifies if an authenticated user possesses a specific permission.
   */
  static hasPermission(user: AuthenticatedUser, requiredPermission: PermissionName): boolean {
    const permissions = AuthorizationContext.getUserPermissions(user);
    return permissions.has(requiredPermission);
  }

  /**
   * Verifies if an authenticated user possesses all of the specified permissions.
   */
  static hasAllPermissions(
    user: AuthenticatedUser,
    requiredPermissions: PermissionName[],
  ): boolean {
    const userPermissions = AuthorizationContext.getUserPermissions(user);
    return requiredPermissions.every((perm) => userPermissions.has(perm));
  }

  /**
   * Verifies if an authenticated user possesses at least one of the specified permissions.
   */
  static hasAnyPermission(user: AuthenticatedUser, requiredPermissions: PermissionName[]): boolean {
    const userPermissions = AuthorizationContext.getUserPermissions(user);
    return requiredPermissions.some((perm) => userPermissions.has(perm));
  }

  /**
   * Verifies if an authenticated user matches any of the specified roles.
   */
  static hasRole(user: AuthenticatedUser, allowedRoles: RoleName[]): boolean {
    if (!user.role) {
      return false;
    }
    const userRoleNormalized = user.role.toUpperCase();
    return allowedRoles.some((r) => r.toUpperCase() === userRoleNormalized);
  }
}
