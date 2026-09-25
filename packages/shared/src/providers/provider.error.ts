import { AppError } from '../errors/app-error';

export type ProviderErrorCategory =
  | 'AUTHENTICATION_ERROR'
  | 'INVALID_REQUEST'
  | 'MODEL_NOT_FOUND'
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'SERVER_ERROR'
  | 'UNKNOWN_ERROR';

export interface ProviderErrorOptions {
  code: string;
  message: string;
  statusCode: number;
  category: ProviderErrorCategory;
  isRetryable: boolean;
  providerSlug?: string | undefined;
  rawError?: unknown | undefined;
}

/**
 * Normalized Provider Error class extending AppError.
 * Preserves error category, retryability, provider attribution, and optional raw error payload.
 */
export class ProviderError extends AppError {
  public readonly category: ProviderErrorCategory;
  public readonly isRetryable: boolean;
  public readonly providerSlug?: string | undefined;
  public readonly rawError?: unknown | undefined;

  constructor(options: ProviderErrorOptions);
  constructor(message: string, providerCode?: string);
  constructor(optionsOrMessage: ProviderErrorOptions | string, providerCode?: string) {
    if (typeof optionsOrMessage === 'string') {
      const opts: ProviderErrorOptions = {
        code: 'PROVIDER_ERROR',
        message: optionsOrMessage,
        statusCode: 502,
        category: 'PROVIDER_UNAVAILABLE',
        isRetryable: true,
        providerSlug: providerCode,
      };
      super(opts.code, opts.message, opts.statusCode, {
        category: opts.category,
        isRetryable: opts.isRetryable,
        ...(opts.providerSlug ? { providerSlug: opts.providerSlug } : {}),
      });
      this.category = opts.category;
      this.isRetryable = opts.isRetryable;
      this.providerSlug = opts.providerSlug;
      this.rawError = undefined;
    } else {
      const opts = optionsOrMessage;
      super(opts.code, opts.message, opts.statusCode, {
        category: opts.category,
        isRetryable: opts.isRetryable,
        ...(opts.providerSlug ? { providerSlug: opts.providerSlug } : {}),
      });
      this.category = opts.category;
      this.isRetryable = opts.isRetryable;
      this.providerSlug = opts.providerSlug;
      this.rawError = opts.rawError;
    }
  }

  /**
   * Evaluates if an error category is eligible for retry operations.
   */
  static isRetryableCategory(category: ProviderErrorCategory): boolean {
    return (
      category === 'RATE_LIMIT' ||
      category === 'TIMEOUT' ||
      category === 'PROVIDER_UNAVAILABLE' ||
      category === 'SERVER_ERROR'
    );
  }

  /**
   * Factory normalizing HTTP status code into ProviderError.
   */
  static fromHttpStatus(
    statusCode: number,
    message: string,
    providerSlug?: string,
    rawError?: unknown,
  ): ProviderError {
    let category: ProviderErrorCategory;
    let code: string;

    switch (statusCode) {
      case 401:
      case 403:
        category = 'AUTHENTICATION_ERROR';
        code = 'PROVIDER_AUTH_ERROR';
        break;
      case 400:
      case 422:
        category = 'INVALID_REQUEST';
        code = 'PROVIDER_INVALID_REQUEST';
        break;
      case 404:
        category = 'MODEL_NOT_FOUND';
        code = 'PROVIDER_MODEL_NOT_FOUND';
        break;
      case 429:
        category = 'RATE_LIMIT';
        code = 'PROVIDER_RATE_LIMIT';
        break;
      case 408:
      case 504:
        category = 'TIMEOUT';
        code = 'PROVIDER_TIMEOUT';
        break;
      case 502:
      case 503:
        category = 'PROVIDER_UNAVAILABLE';
        code = 'PROVIDER_UNAVAILABLE';
        break;
      default:
        if (statusCode >= 500) {
          category = 'SERVER_ERROR';
          code = 'PROVIDER_SERVER_ERROR';
        } else {
          category = 'UNKNOWN_ERROR';
          code = 'PROVIDER_UNKNOWN_ERROR';
        }
        break;
    }

    return new ProviderError({
      code,
      message,
      statusCode,
      category,
      isRetryable: ProviderError.isRetryableCategory(category),
      providerSlug,
      rawError,
    });
  }
}
