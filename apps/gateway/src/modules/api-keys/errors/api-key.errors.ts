import { AppError } from '@baseapikey/shared';

export class ApiKeyError extends AppError {
  constructor(message: string, statusCode = 400, code = 'API_KEY_ERROR') {
    super(code, message, statusCode);
  }
}

export class MaxApiKeysExceededError extends ApiKeyError {
  constructor(message = 'Maximum API key limit reached for this account') {
    super(message, 409, 'MAX_API_KEYS_EXCEEDED');
  }
}

export class InvalidApiKeyError extends AppError {
  constructor(message = 'Invalid API key') {
    super('INVALID_API_KEY', message, 401);
  }
}

export class ApiKeyExpiredError extends AppError {
  constructor(message = 'API key has expired') {
    super('API_KEY_EXPIRED', message, 401);
  }
}

export class ApiKeyRevokedError extends AppError {
  constructor(message = 'API key has been revoked') {
    super('API_KEY_REVOKED', message, 401);
  }
}

export class MissingApiKeyError extends AppError {
  constructor(message = 'Authorization header or API key is missing') {
    super('MISSING_API_KEY', message, 401);
  }
}

export class ApiKeyNotFoundError extends AppError {
  constructor(id?: string) {
    super('API_KEY_NOT_FOUND', `API key${id ? ` with ID ${id}` : ''} not found`, 404);
  }
}

export class ApiKeyAlreadyRevokedError extends ApiKeyError {
  constructor(message = 'API key has already been revoked') {
    super(message, 400, 'API_KEY_ALREADY_REVOKED');
  }
}

export class ApiKeyForbiddenError extends AppError {
  constructor(message = 'You do not have permission to access or modify this API key') {
    super('API_KEY_FORBIDDEN', message, 403);
  }
}

export class InvalidApiKeyPermissionError extends ApiKeyError {
  constructor(message = 'Invalid or unsupported API key permission') {
    super(message, 400, 'INVALID_API_KEY_PERMISSION');
  }
}

export class ApiKeyPermissionDeniedError extends AppError {
  constructor(message = 'API key does not have the required permission for this endpoint') {
    super('API_KEY_PERMISSION_DENIED', message, 403);
  }
}
