import { ApiKeyStatus } from '@baseapikey/database';
import { generateUuidV7 } from '@baseapikey/shared';

import { DEFAULT_API_KEY_PERMISSIONS } from '../permissions/permission.constants';
import type {
  ApiKeyAuditLogData,
  ApiKeyRecord,
  CreateApiKeyRepositoryData,
  IApiKeyRepository,
} from '../repositories/api-key.repository';

export class MockApiKeyRepository implements IApiKeyRepository {
  public apiKeys: ApiKeyRecord[] = [];
  public auditLogs: ApiKeyAuditLogData[] = [];

  async createKey(data: CreateApiKeyRepositoryData): Promise<ApiKeyRecord> {
    const record: ApiKeyRecord = {
      id: data.id ?? generateUuidV7(),
      userId: data.userId,
      name: data.name,
      keyHash: data.keyHash,
      keyPrefix: data.keyPrefix,
      status: ApiKeyStatus.ACTIVE,
      permissions: data.permissions ?? [...DEFAULT_API_KEY_PERMISSIONS],
      lastUsedAt: null,
      expiresAt: data.expiresAt ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    this.apiKeys.push(record);
    return record;
  }

  async countActiveKeysByUserId(userId: string): Promise<number> {
    return this.apiKeys.filter(
      (k) => k.userId === userId && k.status === ApiKeyStatus.ACTIVE && k.deletedAt === null,
    ).length;
  }

  async findActiveByPrefix(keyPrefix: string): Promise<ApiKeyRecord[]> {
    return this.apiKeys.filter(
      (k) => k.keyPrefix === keyPrefix && k.status === ApiKeyStatus.ACTIVE && k.deletedAt === null,
    );
  }

  async findByPrefix(keyPrefix: string): Promise<ApiKeyRecord[]> {
    return this.apiKeys.filter((k) => k.keyPrefix === keyPrefix);
  }

  async updateLastUsedAt(id: string, lastUsedAt: Date): Promise<void> {
    const key = this.apiKeys.find((k) => k.id === id);
    if (key) {
      key.lastUsedAt = lastUsedAt;
      key.updatedAt = new Date();
    }
  }

  async findAllByUserId(userId: string): Promise<ApiKeyRecord[]> {
    return this.apiKeys
      .filter((k) => k.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findById(id: string): Promise<ApiKeyRecord | null> {
    return this.apiKeys.find((k) => k.id === id) ?? null;
  }

  async updateKey(
    id: string,
    data: { name?: string | undefined; expiresAt?: Date | null | undefined },
  ): Promise<ApiKeyRecord> {
    const key = this.apiKeys.find((k) => k.id === id);
    if (!key) {
      throw new Error('API key not found');
    }
    if (data.name !== undefined) {
      key.name = data.name;
    }
    if (data.expiresAt !== undefined) {
      key.expiresAt = data.expiresAt;
    }
    key.updatedAt = new Date();
    return key;
  }

  async updatePermissions(id: string, permissions: string[]): Promise<ApiKeyRecord> {
    const key = this.apiKeys.find((k) => k.id === id);
    if (!key) {
      throw new Error('API key not found');
    }
    key.permissions = [...permissions];
    key.updatedAt = new Date();
    return key;
  }

  async rotateKey(id: string, data: { keyHash: string; keyPrefix: string }): Promise<ApiKeyRecord> {
    const key = this.apiKeys.find((k) => k.id === id);
    if (!key) {
      throw new Error('API key not found');
    }
    key.keyHash = data.keyHash;
    key.keyPrefix = data.keyPrefix;
    key.updatedAt = new Date();
    return key;
  }

  async revokeKey(id: string): Promise<ApiKeyRecord> {
    const key = this.apiKeys.find((k) => k.id === id);
    if (!key) {
      throw new Error('API key not found');
    }
    key.status = ApiKeyStatus.REVOKED;
    key.deletedAt = new Date();
    key.updatedAt = new Date();
    return key;
  }

  async recordAuditLog(log: ApiKeyAuditLogData): Promise<void> {
    this.auditLogs.push(log);
  }

  clear(): void {
    this.apiKeys = [];
    this.auditLogs = [];
  }
}
