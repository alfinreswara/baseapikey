import { AppError } from '@baseapikey/shared';

export class ProviderEncryptionNotConfiguredError extends AppError {
  constructor() {
    super(
      'PROVIDER_ENCRYPTION_NOT_CONFIGURED',
      'Provider credential encryption is not configured',
      503,
    );
  }
}
