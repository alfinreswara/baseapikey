import { AppError } from '@baseapikey/shared';

export class InvalidTokenError extends AppError {
  constructor(message = 'Invalid authentication token') {
    super('INVALID_TOKEN', message, 401);
  }
}

export class TokenExpiredError extends AppError {
  constructor(message = 'Authentication token has expired') {
    super('TOKEN_EXPIRED', message, 401);
  }
}

export class MissingTokenError extends AppError {
  constructor(message = 'Authorization header or token is missing') {
    super('MISSING_TOKEN', message, 401);
  }
}

export class InvalidTokenVersionError extends AppError {
  constructor(message = 'Invalid token version') {
    super('INVALID_TOKEN_VERSION', message, 401);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized access') {
    super('UNAUTHORIZED', message, 401);
  }
}

export class InvalidCredentialsError extends AppError {
  constructor(message = 'Invalid email or password') {
    super('INVALID_CREDENTIALS', message, 401);
  }
}

export class AuthConfigError extends AppError {
  constructor(message = 'Authentication configuration error') {
    super('AUTH_CONFIG_ERROR', message, 500);
  }
}
