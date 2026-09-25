import { AppError } from '../errors/app-error';

/**
 * Custom error thrown by ProviderRegistry during registration or lookup failures.
 */
export class ProviderRegistryError extends AppError {
  constructor(code: string, message: string, statusCode = 404, details?: Record<string, unknown>) {
    super(code, message, statusCode, details);
  }
}
