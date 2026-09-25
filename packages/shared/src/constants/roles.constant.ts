export const ROLES = {
  ADMIN: 'admin',
  USER: 'user',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ORG_ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
} as const;

export type OrgRole = (typeof ORG_ROLES)[keyof typeof ORG_ROLES];

export const PERMISSIONS = {
  MANAGE_PROVIDERS: 'manage_providers',
  MANAGE_USERS: 'manage_users',
  MANAGE_ORG: 'manage_org',
  MANAGE_MEMBERS: 'manage_members',
  MANAGE_KEYS: 'manage_keys',
  VIEW_USAGE: 'view_usage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
