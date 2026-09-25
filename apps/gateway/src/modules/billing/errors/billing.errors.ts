import { AppError } from '@baseapikey/shared';

export class BillingForbiddenError extends AppError {
  constructor(message = 'Only organization owners and admins may access billing') {
    super('BILLING_FORBIDDEN', message, 403);
  }
}

export class BillingNotConfiguredError extends AppError {
  constructor() {
    super('BILLING_NOT_CONFIGURED', 'Payment checkout is not configured', 503);
  }
}

export class InvalidBillingWebhookError extends AppError {
  constructor() {
    super('INVALID_BILLING_WEBHOOK', 'Billing webhook signature is invalid', 401);
  }
}

export class BillingUsageBlockedError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('BILLING_USAGE_BLOCKED', message, 402, details);
  }
}
