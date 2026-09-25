import { AppError } from '@baseapikey/shared';

export class InvalidAccountTokenError extends AppError {
  constructor() {
    super('INVALID_ACCOUNT_TOKEN', 'Account token is invalid or expired', 400);
  }
}
