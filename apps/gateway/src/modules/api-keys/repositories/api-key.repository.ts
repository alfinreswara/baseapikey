import { ApiKeyStatus, AuditSeverity, prisma } from '@baseapikey/database';

import { DEFAULT_API_KEY_PERMISSIONS } from '../permissions/permission.constants';

export interface CreateApiKeyRepositoryData {
  id?: string;
  userId: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  expiresAt?: Date | null;
  permissions?: string[];
  organizationId?: string | undefined;
}

export interface ApiKeyRecord {
  id: string;
  userId: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  status: ApiKeyStatus;
  permissions: unknown;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  organizationId?: string | null | undefined;
}

export interface ApiKeyAuditLogData {
  userId?: string | undefined;
  apiKeyId?: string | undefined;
  action: string;
  resource: string;
  resourceId?: string | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
  severity?: AuditSeverity | undefined;
  metadata?: Record<string, unknown> | undefined;
  organizationId?: string | undefined;
}

export interface IApiKeyRepository {
  createKey(data: CreateApiKeyRepositoryData): Promise<ApiKeyRecord>;
  countActiveKeysByUserId(userId: string, organizationId?: string): Promise<number>;
  findActiveByPrefix(keyPrefix: string): Promise<ApiKeyRecord[]>;
  findByPrefix(keyPrefix: string): Promise<ApiKeyRecord[]>;
  updateLastUsedAt(id: string, lastUsedAt: Date): Promise<void>;
  findAllByUserId(userId: string, organizationId?: string): Promise<ApiKeyRecord[]>;
  findById(id: string): Promise<ApiKeyRecord | null>;
  updateKey(
    id: string,
    data: { name?: string | undefined; expiresAt?: Date | null | undefined },
  ): Promise<ApiKeyRecord>;
  updatePermissions(id: string, permissions: string[]): Promise<ApiKeyRecord>;
  rotateKey(id: string, data: { keyHash: string; keyPrefix: string }): Promise<ApiKeyRecord>;
  revokeKey(id: string): Promise<ApiKeyRecord>;
  recordAuditLog(log: ApiKeyAuditLogData): Promise<void>;
}

export class PrismaApiKeyRepository implements IApiKeyRepository {
  async createKey(data: CreateApiKeyRepositoryData): Promise<ApiKeyRecord> {
    const preference = data.organizationId
      ? null
      : await prisma.userOrganizationPreference.findUnique({
          where: { userId: data.userId },
          select: { activeOrganizationId: true },
        });
    const created = await prisma.apiKey.create({
      data: {
        ...(data.id ? { id: data.id } : {}),
        userId: data.userId,
        name: data.name,
        keyHash: data.keyHash,
        keyPrefix: data.keyPrefix,
        status: ApiKeyStatus.ACTIVE,
        expiresAt: data.expiresAt ?? null,
        permissions: (data.permissions ?? DEFAULT_API_KEY_PERMISSIONS) as unknown as object[],
        organizationId: data.organizationId ?? preference?.activeOrganizationId ?? null,
      },
    });
    return created;
  }

  async countActiveKeysByUserId(userId: string, organizationId?: string): Promise<number> {
    return prisma.apiKey.count({
      where: {
        ...(organizationId ? { organizationId } : { userId }),
        status: ApiKeyStatus.ACTIVE,
        deletedAt: null,
      },
    });
  }

  async findActiveByPrefix(keyPrefix: string): Promise<ApiKeyRecord[]> {
    return prisma.apiKey.findMany({
      where: {
        keyPrefix,
        status: ApiKeyStatus.ACTIVE,
        deletedAt: null,
      },
    });
  }

  async findByPrefix(keyPrefix: string): Promise<ApiKeyRecord[]> {
    return prisma.apiKey.findMany({
      where: {
        keyPrefix,
      },
    });
  }

  async updateLastUsedAt(id: string, lastUsedAt: Date): Promise<void> {
    await prisma.apiKey.update({
      where: { id },
      data: { lastUsedAt },
    });
  }

  async findAllByUserId(userId: string, organizationId?: string): Promise<ApiKeyRecord[]> {
    return prisma.apiKey.findMany({
      where: organizationId ? { organizationId } : { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string): Promise<ApiKeyRecord | null> {
    return prisma.apiKey.findUnique({
      where: { id },
    });
  }

  async updateKey(
    id: string,
    data: { name?: string | undefined; expiresAt?: Date | null | undefined },
  ): Promise<ApiKeyRecord> {
    const updateData: { name?: string; expiresAt?: Date | null } = {};
    if (data.name !== undefined) {
      updateData.name = data.name;
    }
    if (data.expiresAt !== undefined) {
      updateData.expiresAt = data.expiresAt;
    }

    return prisma.apiKey.update({
      where: { id },
      data: updateData,
    });
  }

  async updatePermissions(id: string, permissions: string[]): Promise<ApiKeyRecord> {
    return prisma.apiKey.update({
      where: { id },
      data: {
        permissions: permissions as unknown as object[],
      },
    });
  }

  async rotateKey(id: string, data: { keyHash: string; keyPrefix: string }): Promise<ApiKeyRecord> {
    return prisma.apiKey.update({
      where: { id },
      data: {
        keyHash: data.keyHash,
        keyPrefix: data.keyPrefix,
      },
    });
  }

  async revokeKey(id: string): Promise<ApiKeyRecord> {
    return prisma.apiKey.update({
      where: { id },
      data: {
        status: ApiKeyStatus.REVOKED,
        deletedAt: new Date(),
      },
    });
  }

  async recordAuditLog(log: ApiKeyAuditLogData): Promise<void> {
    await prisma.auditLog.create({
      data: {
        userId: log.userId ?? null,
        apiKeyId: log.apiKeyId ?? null,
        action: log.action,
        resource: log.resource,
        resourceId: log.resourceId ?? null,
        ipAddress: log.ipAddress ?? null,
        userAgent: log.userAgent ?? null,
        requestId: log.requestId ?? null,
        severity: log.severity ?? AuditSeverity.INFO,
        metadata: (log.metadata as object) ?? {},
        organizationId: log.organizationId ?? null,
      },
    });
  }
}
