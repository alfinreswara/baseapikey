import { ApiKeyStatus, AuditSeverity } from '@baseapikey/database';

import { PasswordService } from '../../auth/services/password.service';
import { API_KEY_CONSTANTS } from '../api-keys.constants';
import type {
  ApiKeyResponseDto,
  CreateApiKeyDto,
  CreateApiKeyResponseDto,
  UpdateApiKeyDto,
} from '../dto/create-api-key.dto';
import {
  ApiKeyAlreadyRevokedError,
  ApiKeyForbiddenError,
  ApiKeyNotFoundError,
  MaxApiKeysExceededError,
} from '../errors/api-key.errors';
import type { ApiKeyRecord, IApiKeyRepository } from '../repositories/api-key.repository';
import { generateApiKey } from '../utils/api-key-generator.util';

export interface ApiKeyRequestMetadata {
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

export class ApiKeyService {
  constructor(
    private readonly apiKeyRepository: IApiKeyRepository,
    private readonly passwordService: PasswordService = new PasswordService(),
    private readonly maxKeysPerUser: number = API_KEY_CONSTANTS.DEFAULT_MAX_KEYS_PER_USER,
  ) {}

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

  async createApiKey(
    userId: string,
    dto: CreateApiKeyDto,
    meta: ApiKeyRequestMetadata = {},
    organizationId?: string,
  ): Promise<CreateApiKeyResponseDto> {
    // 1. Enforce active keys count limit per user
    const activeCount = await this.apiKeyRepository.countActiveKeysByUserId(userId, organizationId);
    if (activeCount >= this.maxKeysPerUser) {
      throw new MaxApiKeysExceededError(
        `Maximum limit of ${this.maxKeysPerUser} active API keys reached`,
      );
    }

    // 2. Generate cryptographically secure API key
    const { plaintextKey, keyPrefix } = generateApiKey();

    // 3. Hash plaintext key using Argon2id for secure database storage
    const keyHash = await this.passwordService.hash(plaintextKey);

    // 4. Create ApiKey database record
    const expiresAtDate = dto.expiresAt ? new Date(dto.expiresAt) : null;

    const apiKeyRecord = await this.apiKeyRepository.createKey({
      userId,
      name: dto.name,
      keyHash,
      keyPrefix,
      expiresAt: expiresAtDate,
      organizationId,
    });

    // 5. Record creation event in AuditLog
    await this.apiKeyRepository.recordAuditLog({
      userId,
      apiKeyId: apiKeyRecord.id,
      action: 'API_KEY_CREATE',
      resource: 'ApiKey',
      resourceId: apiKeyRecord.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
      severity: AuditSeverity.INFO,
      metadata: {
        name: apiKeyRecord.name,
        keyPrefix: apiKeyRecord.keyPrefix,
        expiresAt: apiKeyRecord.expiresAt ? apiKeyRecord.expiresAt.toISOString() : null,
      },
      organizationId,
    });

    // 6. Return response containing plaintext key ONLY ONCE
    return {
      id: apiKeyRecord.id,
      name: apiKeyRecord.name,
      apiKey: plaintextKey,
      createdAt: apiKeyRecord.createdAt.toISOString(),
      expiresAt: apiKeyRecord.expiresAt ? apiKeyRecord.expiresAt.toISOString() : null,
    };
  }

  async listApiKeys(userId: string, organizationId?: string): Promise<ApiKeyResponseDto[]> {
    const keys = await this.apiKeyRepository.findAllByUserId(userId, organizationId);
    return keys.map((key) => this.mapToResponseDto(key));
  }

  async getApiKey(
    userId: string,
    keyId: string,
    organizationId?: string,
  ): Promise<ApiKeyResponseDto> {
    const key = await this.apiKeyRepository.findById(keyId);
    if (!key) {
      throw new ApiKeyNotFoundError(keyId);
    }
    if (organizationId ? key.organizationId !== organizationId : key.userId !== userId) {
      throw new ApiKeyForbiddenError('You do not have permission to view this API key');
    }
    return this.mapToResponseDto(key);
  }

  async updateApiKey(
    userId: string,
    keyId: string,
    dto: UpdateApiKeyDto,
    meta: ApiKeyRequestMetadata = {},
    organizationId?: string,
  ): Promise<ApiKeyResponseDto> {
    const key = await this.apiKeyRepository.findById(keyId);
    if (!key) {
      throw new ApiKeyNotFoundError(keyId);
    }
    if (organizationId ? key.organizationId !== organizationId : key.userId !== userId) {
      throw new ApiKeyForbiddenError('You do not have permission to update this API key');
    }
    if (key.status === ApiKeyStatus.REVOKED || key.deletedAt !== null) {
      throw new ApiKeyAlreadyRevokedError('Cannot update an API key that has already been revoked');
    }

    const expiresAtDate =
      dto.expiresAt !== undefined
        ? dto.expiresAt === null
          ? null
          : new Date(dto.expiresAt)
        : undefined;

    const updatedKey = await this.apiKeyRepository.updateKey(keyId, {
      name: dto.name,
      expiresAt: expiresAtDate,
    });

    await this.apiKeyRepository.recordAuditLog({
      userId,
      apiKeyId: updatedKey.id,
      action: 'API_KEY_UPDATE',
      resource: 'ApiKey',
      resourceId: updatedKey.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
      severity: AuditSeverity.INFO,
      metadata: {
        name: updatedKey.name,
        expiresAt: updatedKey.expiresAt ? updatedKey.expiresAt.toISOString() : null,
      },
      organizationId,
    });

    return this.mapToResponseDto(updatedKey);
  }

  async revokeApiKey(
    userId: string,
    keyId: string,
    meta: ApiKeyRequestMetadata = {},
    organizationId?: string,
  ): Promise<ApiKeyResponseDto> {
    const key = await this.apiKeyRepository.findById(keyId);
    if (!key) {
      throw new ApiKeyNotFoundError(keyId);
    }
    if (organizationId ? key.organizationId !== organizationId : key.userId !== userId) {
      throw new ApiKeyForbiddenError('You do not have permission to revoke this API key');
    }
    if (key.status === ApiKeyStatus.REVOKED || key.deletedAt !== null) {
      throw new ApiKeyAlreadyRevokedError('API key has already been revoked');
    }

    const revokedKey = await this.apiKeyRepository.revokeKey(keyId);

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

    return this.mapToResponseDto(revokedKey);
  }
}
