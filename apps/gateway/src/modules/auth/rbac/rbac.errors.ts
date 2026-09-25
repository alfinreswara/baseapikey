import { AppError } from '@baseapikey/shared';

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden: insufficient permissions') {
    super('FORBIDDEN', message, 403);
  }
}

export class MissingRoleError extends AppError {
  constructor(message = 'Forbidden: user context lacks a required role') {
    super('MISSING_ROLE', message, 403);
  }
}

export class MissingPermissionError extends AppError {
  constructor(permission?: string) {
    const message = permission
      ? `Forbidden: missing required permission '${permission}'`
      : 'Forbidden: missing required permission';
    super('MISSING_PERMISSION', message, 403);
  }
}
