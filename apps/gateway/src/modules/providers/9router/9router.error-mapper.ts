import { ProviderError } from '@baseapikey/shared';

/**
 * Strips sensitive values (API keys, Authorization headers) from raw error payloads.
 */
function sanitizeRawError(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') {
    return raw;
  }

  const copy = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;

  const sanitizeObject = (obj: Record<string, unknown>): void => {
    for (const key of Object.keys(obj)) {
      if (
        /api[-_]?key|auth|authorization|token|secret/i.test(key) &&
        typeof obj[key] === 'string'
      ) {
        obj[key] = '[REDACTED]';
      } else if (obj[key] && typeof obj[key] === 'object') {
        sanitizeObject(obj[key] as Record<string, unknown>);
      }
    }
  };

  sanitizeObject(copy);
  return copy;
}

/**
 * Normalizes 9Router provider errors into standard ProviderError.
 */
export function mapNineRouterError(
  error: unknown,
  statusCode?: number,
  providerSlug = '9router',
): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }

  const sanitized = sanitizeRawError(error);

  // Check if error was caused by AbortSignal cancellation
  if (
    error instanceof Error &&
    (error.name === 'AbortError' || error.message.toLowerCase().includes('abort'))
  ) {
    return new ProviderError({
      code: 'PROVIDER_CANCELLED',
      message: 'Request was cancelled by client signal',
      statusCode: 499,
      category: 'TIMEOUT',
      isRetryable: false,
      providerSlug,
      rawError: sanitized,
    });
  }

  // Check for timeout
  if (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.message.toLowerCase().includes('timeout'))
  ) {
    return new ProviderError({
      code: 'PROVIDER_TIMEOUT',
      message: '9Router request timed out',
      statusCode: 504,
      category: 'TIMEOUT',
      isRetryable: true,
      providerSlug,
      rawError: sanitized,
    });
  }

  // Handle explicit HTTP status code if available
  if (statusCode && statusCode >= 400) {
    let message = `9Router API returned HTTP ${statusCode}`;
    if (error && typeof error === 'object' && 'message' in error) {
      message = String((error as { message: unknown }).message);
    }
    const mappedErr = ProviderError.fromHttpStatus(statusCode, message, providerSlug, sanitized);
    return mappedErr;
  }

  // Generic fallback error
  const errMsg = error instanceof Error ? error.message : 'Unknown 9Router provider error';
  return new ProviderError({
    code: 'PROVIDER_UNKNOWN_ERROR',
    message: errMsg,
    statusCode: 502,
    category: 'PROVIDER_UNAVAILABLE',
    isRetryable: true,
    providerSlug,
    rawError: sanitized,
  });
}
