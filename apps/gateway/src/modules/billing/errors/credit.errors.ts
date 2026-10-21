import { AppError } from '@baseapikey/shared';

/**
 * The credit of the organization does not cover the request. The request is
 * not forwarded to a provider.
 */
export class BillingInsufficientCreditError extends AppError {
  constructor(
    message = 'The credit balance does not cover the request',
    details?: Record<string, unknown>,
  ) {
    super('BILLING_INSUFFICIENT_CREDIT', message, 402, details);
  }
}

/**
 * The spending limit of the organization does not cover the request. The
 * request is not forwarded to a provider.
 */
export class BillingSpendingLimitReachedError extends AppError {
  constructor(
    message = 'The monthly spending limit of the organization is reached',
    details?: Record<string, unknown>,
  ) {
    super('BILLING_SPENDING_LIMIT_REACHED', message, 402, details);
  }
}

/**
 * The request could not reserve the credit it needs. The request is not
 * forwarded to a provider.
 */
export class BillingReservationFailedError extends AppError {
  constructor(
    message = 'The request could not reserve the credit it needs',
    details?: Record<string, unknown>,
  ) {
    super('BILLING_RESERVATION_FAILED', message, 402, details);
  }
}
