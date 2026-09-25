export const ROLES = {
  ADMIN: 'ADMIN',
  USER: 'USER',
} as const;

export type RoleName = (typeof ROLES)[keyof typeof ROLES] | 'admin' | 'user';

export const PERMISSIONS = {
  PROFILE_READ: 'profile:read',
  PROFILE_UPDATE: 'profile:update',
  APIKEY_CREATE: 'apikey:create',
  APIKEY_READ: 'apikey:read',
  APIKEY_UPDATE: 'apikey:update',
  APIKEY_DELETE: 'apikey:delete',
  USAGE_READ: 'usage:read',
  USERS_READ: 'users:read',
  USERS_UPDATE: 'users:update',
  USERS_DELETE: 'users:delete',
  PROVIDERS_MANAGE: 'providers:manage',
  MODELS_MANAGE: 'models:manage',
  AUDIT_READ: 'audit:read',
  SYSTEM_MANAGE: 'system:manage',
} as const;

export type PermissionName = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const USER_PERMISSIONS: ReadonlySet<PermissionName> = new Set([
  PERMISSIONS.PROFILE_READ,
  PERMISSIONS.PROFILE_UPDATE,
  PERMISSIONS.APIKEY_CREATE,
  PERMISSIONS.APIKEY_READ,
  PERMISSIONS.APIKEY_UPDATE,
  PERMISSIONS.APIKEY_DELETE,
  PERMISSIONS.USAGE_READ,
]);

export const ADMIN_PERMISSIONS: ReadonlySet<PermissionName> = new Set([
  ...USER_PERMISSIONS,
  PERMISSIONS.USERS_READ,
  PERMISSIONS.USERS_UPDATE,
  PERMISSIONS.USERS_DELETE,
  PERMISSIONS.PROVIDERS_MANAGE,
  PERMISSIONS.MODELS_MANAGE,
  PERMISSIONS.AUDIT_READ,
  PERMISSIONS.SYSTEM_MANAGE,
]);

export const ROLE_PERMISSIONS: Record<string, ReadonlySet<PermissionName>> = {
  ADMIN: ADMIN_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
  USER: USER_PERMISSIONS,
  user: USER_PERMISSIONS,
};
