import { AppError } from '@baseapikey/shared';

export class QuotaExceededError extends AppError {
  constructor(
    message = 'Requests per minute limit exceeded. Please slow down.',
    details?: Record<string, unknown>,
  ) {
    super('RATE_LIMIT_EXCEEDED', message, 429, details);
  }
}

export class DailyLimitExceededError extends AppError {
  constructor(message = 'Daily request limit exceeded.', details?: Record<string, unknown>) {
    super('DAILY_LIMIT_EXCEEDED', message, 429, details);
  }
}

export class TokenQuotaExceededError extends AppError {
  constructor(message = 'Daily token quota exceeded.', details?: Record<string, unknown>) {
    super('TOKEN_QUOTA_EXCEEDED', message, 429, details);
  }
}

export class MonthlyBudgetExceededError extends AppError {
  constructor(message = 'Monthly budget limit exceeded.', details?: Record<string, unknown>) {
    super('MONTHLY_BUDGET_EXCEEDED', message, 429, details);
  }
}

export class InvalidQuotaConfigError extends AppError {
  constructor(
    message = 'Invalid quota configuration provided.',
    details?: Record<string, unknown>,
  ) {
    super('INVALID_QUOTA_CONFIG', message, 400, details);
  }
}
