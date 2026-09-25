import { ApiKeyStatus, AuditSeverity } from '@baseapikey/database';

import {
  ApiKeyAlreadyRevokedError,
  ApiKeyForbiddenError,
  ApiKeyNotFoundError,
} from '../errors/api-key.errors';
import type { IApiKeyRepository } from '../repositories/api-key.repository';

import type { ApiKeyRequestMetadata } from './api-key.service';

export interface RevokeApiKeyResponseDto {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

export class ApiKeyRevocationService {
  constructor(private readonly apiKeyRepository: IApiKeyRepository) {}

  async revokeApiKey(
    userId: string,
    keyId: string,
    meta: ApiKeyRequestMetadata = {},
    organizationId?: string,
  ): Promise<RevokeApiKeyResponseDto> {
    // 1. Retrieve API key by ID
    const key = await this.apiKeyRepository.findById(keyId);
    if (!key) {
      throw new ApiKeyNotFoundError(keyId);
    }

    // 2. Ownership check: users may revoke ONLY their own API keys
    if (organizationId ? key.organizationId !== organizationId : key.userId !== userId) {
      throw new ApiKeyForbiddenError('You do not have permission to revoke this API key');
    }

    // 3. Status check: reject revoking an already revoked API key
    if (key.status === ApiKeyStatus.REVOKED || key.deletedAt !== null) {
      throw new ApiKeyAlreadyRevokedError('API key has already been revoked');
    }

    // 4. Soft revoke API key in repository (sets status = REVOKED, deletedAt = now)
    const revokedKey = await this.apiKeyRepository.revokeKey(keyId);

    // 5. Record revocation event in AuditLog
    await this.apiKeyRepository.recordAuditLog({
      userId,
      apiKeyId: revokedKey.id,
      action: 'API_KEY_REVOKE',
      resource: 'ApiKey',
      resourceId: revokedKey.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
      severity: AuditSeverity.WARNING,
      metadata: {
        name: revokedKey.name,
        keyPrefix: revokedKey.keyPrefix,
      },
      organizationId,
    });

    // 6. Return standardized response
    return {
      success: true,
      message: 'API key revoked successfully.',
      data: {
        id: revokedKey.id,
        name: revokedKey.name,
        keyPrefix: revokedKey.keyPrefix,
        status: revokedKey.status,
        permissions: revokedKey.permissions,
        lastUsedAt: revokedKey.lastUsedAt ? revokedKey.lastUsedAt.toISOString() : null,
        expiresAt: revokedKey.expiresAt ? revokedKey.expiresAt.toISOString() : null,
        createdAt: revokedKey.createdAt.toISOString(),
      },
    };
  }
}
