import { InvalidApiKeyPermissionError } from '../errors/api-key.errors';

import { ALL_API_KEY_PERMISSIONS, type ApiKeyPermission } from './permission.constants';

export class PermissionValidator {
  static isValidPermission(permission: unknown): permission is ApiKeyPermission {
    return (
      typeof permission === 'string' &&
      ALL_API_KEY_PERMISSIONS.includes(permission as ApiKeyPermission)
    );
  }

  static validatePermission(permission: unknown): ApiKeyPermission {
    if (!this.isValidPermission(permission)) {
      throw new InvalidApiKeyPermissionError(
        `Invalid or unsupported API key permission: '${String(permission)}'`,
      );
    }
    return permission;
  }

  static validatePermissions(permissions: unknown[]): ApiKeyPermission[] {
    if (!Array.isArray(permissions)) {
      throw new InvalidApiKeyPermissionError('Permissions must be an array of string permissions');
    }
    return permissions.map((p) => this.validatePermission(p));
  }
}
