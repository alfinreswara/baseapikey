import { ApiKeyStatus, AuditSeverity } from '@baseapikey/database';

import type { ApiKeyResponseDto, UpdateApiKeyPermissionsDto } from '../dto/create-api-key.dto';
import {
  ApiKeyAlreadyRevokedError,
  ApiKeyForbiddenError,
  ApiKeyNotFoundError,
} from '../errors/api-key.errors';
import { PermissionValidator } from '../permissions/permission.validator';
import type { ApiKeyRecord, IApiKeyRepository } from '../repositories/api-key.repository';

import type { ApiKeyRequestMetadata } from './api-key.service';

export class ApiKeyPermissionService {
  constructor(private readonly apiKeyRepository: IApiKeyRepository) {}

  private mapToResponseDto(record: ApiKeyRecord): ApiKeyResponseDto {
    return {
      id: record.id,
      name: record.name,
      keyPrefix: record.keyPrefix,
      status: record.status,
      permissions: record.permissions,
      lastUsedAt: record.lastUsedAt ? record.lastUsedAt.toISOString() : null,
      expiresAt: record.expiresAt ? record.expiresAt.toISOString() : null,
      createdAt: record.createdAt.toISOString(),
    };
  }

  async updatePermissions(
    userId: string,
    keyId: string,
    dto: UpdateApiKeyPermissionsDto,
    meta: ApiKeyRequestMetadata = {},
    organizationId?: string,
  ): Promise<ApiKeyResponseDto> {
    // 1. Retrieve API key by ID
    const key = await this.apiKeyRepository.findById(keyId);
    if (!key) {
      throw new ApiKeyNotFoundError(keyId);
    }

    // 2. Ownership check: users may update permissions ONLY for their own API keys
    if (organizationId ? key.organizationId !== organizationId : key.userId !== userId) {
      throw new ApiKeyForbiddenError(
        'You do not have permission to update permissions for this API key',
      );
    }

    // 3. Status check: reject updates on revoked API keys
    if (key.status === ApiKeyStatus.REVOKED || key.deletedAt !== null) {
      throw new ApiKeyAlreadyRevokedError('Cannot update permissions for a revoked API key');
    }

    // 4. Validate permissions array against supported permissions
    const validatedPermissions = PermissionValidator.validatePermissions(dto.permissions);

    // 5. Update permissions in repository
    const updatedRecord = await this.apiKeyRepository.updatePermissions(
      keyId,
      validatedPermissions,
    );

    // 6. Record AuditLog event
    await this.apiKeyRepository.recordAuditLog({
      userId,
      apiKeyId: updatedRecord.id,
      action: 'API_KEY_UPDATE_PERMISSIONS',
      resource: 'ApiKey',
      resourceId: updatedRecord.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
      severity: AuditSeverity.INFO,
      metadata: {
        permissions: updatedRecord.permissions,
      },
      organizationId,
    });

    // 7. Return updated DTO (omits keyHash & plaintext key)
    return this.mapToResponseDto(updatedRecord);
  }
}
