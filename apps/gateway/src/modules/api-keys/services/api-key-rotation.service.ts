import { ApiKeyStatus, AuditSeverity } from '@baseapikey/database';

import { PasswordService } from '../../auth/services/password.service';
import type { RotateApiKeyResponseDto } from '../dto/create-api-key.dto';
import {
  ApiKeyAlreadyRevokedError,
  ApiKeyExpiredError,
  ApiKeyForbiddenError,
  ApiKeyNotFoundError,
} from '../errors/api-key.errors';
import type { IApiKeyRepository } from '../repositories/api-key.repository';
import { generateApiKey } from '../utils/api-key-generator.util';

import type { ApiKeyRequestMetadata } from './api-key.service';

export class ApiKeyRotationService {
  constructor(
    private readonly apiKeyRepository: IApiKeyRepository,
    private readonly passwordService: PasswordService = new PasswordService(),
  ) {}

  async rotateApiKey(
    userId: string,
    keyId: string,
    meta: ApiKeyRequestMetadata = {},
    organizationId?: string,
  ): Promise<RotateApiKeyResponseDto> {
    // 1. Retrieve target API key
    const key = await this.apiKeyRepository.findById(keyId);
    if (!key) {
      throw new ApiKeyNotFoundError(keyId);
    }

    // 2. Ownership check: users may rotate ONLY their own API keys
    if (organizationId ? key.organizationId !== organizationId : key.userId !== userId) {
      throw new ApiKeyForbiddenError('You do not have permission to rotate this API key');
    }

    // 3. Status check: reject rotating already revoked API keys
    if (key.status === ApiKeyStatus.REVOKED || key.deletedAt !== null) {
      throw new ApiKeyAlreadyRevokedError('Cannot rotate an API key that has been revoked');
    }

    // 4. Expiration check: reject rotating expired API keys
    if (key.expiresAt !== null && key.expiresAt <= new Date()) {
      throw new ApiKeyExpiredError('Cannot rotate an expired API key');
    }

    // 5. Generate a completely new cryptographically secure API key
    const { plaintextKey, keyPrefix } = generateApiKey();

    // 6. Hash new plaintext key using Argon2id for secure database storage
    const keyHash = await this.passwordService.hash(plaintextKey);

    // 7. Update database record: replace old keyHash and keyPrefix
    const rotatedRecord = await this.apiKeyRepository.rotateKey(keyId, {
      keyHash,
      keyPrefix,
    });

    // 8. Record rotation event in AuditLog
    await this.apiKeyRepository.recordAuditLog({
      userId,
      apiKeyId: rotatedRecord.id,
      action: 'API_KEY_ROTATE',
      resource: 'ApiKey',
      resourceId: rotatedRecord.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
      severity: AuditSeverity.INFO,
      metadata: {
        name: rotatedRecord.name,
        keyPrefix: rotatedRecord.keyPrefix,
      },
      organizationId,
    });

    // 9. Return response containing plaintext new API key ONLY ONCE
    return {
      id: rotatedRecord.id,
      name: rotatedRecord.name,
      apiKey: plaintextKey,
      rotatedAt: rotatedRecord.updatedAt.toISOString(),
      expiresAt: rotatedRecord.expiresAt ? rotatedRecord.expiresAt.toISOString() : null,
    };
  }
}
