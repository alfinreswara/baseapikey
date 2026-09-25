import {
  type AuditSeverity,
  type ModelCategory,
  type ProviderStatus,
  prisma,
  type UserRole,
  type UserStatus,
} from '@baseapikey/database';

export interface AdminProviderRecord {
  id: string;
  name: string;
  slug: string;
  baseUrl: string;
  apiVersion: string | null;
  status: ProviderStatus;
  priority: number;
  timeoutMs: number;
  maxRetries: number;
  supportsStreaming: boolean;
  supportsImages: boolean;
  supportsEmbeddings: boolean;
  supportsAudio: boolean;
  supportsVision: boolean;
  healthStatus: string;
  healthCheckedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminModelRecord {
  id: string;
  providerId: string;
  name: string;
  slug: string;
  displayName: string;
  category: ModelCategory;
  contextWindow: number;
  maxOutputTokens: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsFunctionCalling: boolean;
  supportsJsonMode: boolean;
  supportsReasoning: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminAuditRecord {
  id: string;
  userId: string | null;
  apiKeyId: string | null;
  organizationId: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  ipAddress: string | null;
  requestId: string | null;
  metadata: unknown;
  severity: AuditSeverity;
  createdAt: Date;
}

export interface AdminUserRecord {
  id: string;
  email: string;
  username: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  _count: { organizationMemberships: number; apiKeys: number };
}

export interface IAdminRepository {
  listProviders(limit: number, cursor?: string): Promise<AdminProviderRecord[]>;
  createProvider(
    data: Record<string, unknown> & { encryptedApiKey: string },
  ): Promise<AdminProviderRecord>;
  updateProvider(id: string, data: Record<string, unknown>): Promise<AdminProviderRecord>;
  listModels(limit: number, cursor?: string): Promise<AdminModelRecord[]>;
  createModel(data: Record<string, unknown>): Promise<AdminModelRecord>;
  updateModel(id: string, data: Record<string, unknown>): Promise<AdminModelRecord>;
  listAudits(query: {
    limit: number;
    cursor?: string | undefined;
    action?: string | undefined;
    severity?: AuditSeverity | undefined;
    userId?: string | undefined;
    organizationId?: string | undefined;
  }): Promise<AdminAuditRecord[]>;
  recordAudit(data: {
    userId: string;
    action: string;
    resource: string;
    resourceId: string;
    requestId?: string | undefined;
    ipAddress?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<void>;
  listUsers?(limit: number, cursor?: string, search?: string): Promise<AdminUserRecord[]>;
  getPlatformHealth?(): Promise<Record<string, unknown>>;
  getPlatformUsage?(): Promise<Record<string, number>>;
}

const providerSelect = {
  id: true,
  name: true,
  slug: true,
  baseUrl: true,
  apiVersion: true,
  status: true,
  priority: true,
  timeoutMs: true,
  maxRetries: true,
  supportsStreaming: true,
  supportsImages: true,
  supportsEmbeddings: true,
  supportsAudio: true,
  supportsVision: true,
  healthStatus: true,
  healthCheckedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class PrismaAdminRepository implements IAdminRepository {
  async listUsers(limit: number, cursor?: string, search?: string): Promise<AdminUserRecord[]> {
    return prisma.user.findMany({
      where: search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              { username: { contains: search, mode: 'insensitive' } },
              { fullName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {},
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        role: true,
        status: true,
        emailVerified: true,
        lastLoginAt: true,
        createdAt: true,
        _count: { select: { organizationMemberships: true, apiKeys: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  async getPlatformHealth(): Promise<Record<string, unknown>> {
    await prisma.$queryRaw`SELECT 1`;
    const [healthy, degraded, down, unknown] = await Promise.all([
      prisma.provider.count({ where: { healthStatus: 'HEALTHY' } }),
      prisma.provider.count({ where: { healthStatus: 'DEGRADED' } }),
      prisma.provider.count({ where: { healthStatus: 'DOWN' } }),
      prisma.provider.count({ where: { healthStatus: 'UNKNOWN' } }),
    ]);
    return {
      status: down > 0 ? 'DEGRADED' : 'HEALTHY',
      database: 'HEALTHY',
      providers: { healthy, degraded, down, unknown },
      checkedAt: new Date().toISOString(),
    };
  }

  async getPlatformUsage(): Promise<Record<string, number>> {
    const [users, organizations, requests, tokens, cost, activeKeys] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.organization.count({ where: { deletedAt: null, isActive: true } }),
      prisma.usage.count(),
      prisma.usage.aggregate({ _sum: { totalTokens: true } }),
      prisma.usage.aggregate({ _sum: { estimatedCost: true } }),
      prisma.apiKey.count({ where: { status: 'ACTIVE', deletedAt: null } }),
    ]);
    return {
      users,
      organizations,
      requests,
      tokens: tokens._sum.totalTokens ?? 0,
      cost: Number(cost._sum.estimatedCost ?? 0),
      activeKeys,
    };
  }

  async listProviders(limit: number, cursor?: string): Promise<AdminProviderRecord[]> {
    return prisma.provider.findMany({
      select: providerSelect,
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  async createProvider(
    data: Record<string, unknown> & { encryptedApiKey: string },
  ): Promise<AdminProviderRecord> {
    return prisma.provider.create({ data: data as never, select: providerSelect });
  }

  async updateProvider(id: string, data: Record<string, unknown>): Promise<AdminProviderRecord> {
    return prisma.provider.update({ where: { id }, data, select: providerSelect });
  }

  async listModels(limit: number, cursor?: string): Promise<AdminModelRecord[]> {
    const records = await prisma.aIModel.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return records.map((record) => ({
      ...record,
      inputPricePerMillion: record.inputPricePerMillion.toNumber(),
      outputPricePerMillion: record.outputPricePerMillion.toNumber(),
    }));
  }

  async createModel(data: Record<string, unknown>): Promise<AdminModelRecord> {
    const record = await prisma.aIModel.create({ data: data as never });
    return {
      ...record,
      inputPricePerMillion: record.inputPricePerMillion.toNumber(),
      outputPricePerMillion: record.outputPricePerMillion.toNumber(),
    };
  }

  async updateModel(id: string, data: Record<string, unknown>): Promise<AdminModelRecord> {
    const record = await prisma.aIModel.update({ where: { id }, data });
    return {
      ...record,
      inputPricePerMillion: record.inputPricePerMillion.toNumber(),
      outputPricePerMillion: record.outputPricePerMillion.toNumber(),
    };
  }

  async listAudits(query: {
    limit: number;
    cursor?: string | undefined;
    action?: string | undefined;
    severity?: AuditSeverity | undefined;
    userId?: string | undefined;
    organizationId?: string | undefined;
  }): Promise<AdminAuditRecord[]> {
    return prisma.auditLog.findMany({
      where: {
        ...(query.action ? { action: query.action } : {}),
        ...(query.severity ? { severity: query.severity } : {}),
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      },
      select: {
        id: true,
        userId: true,
        apiKeyId: true,
        organizationId: true,
        action: true,
        resource: true,
        resourceId: true,
        ipAddress: true,
        requestId: true,
        metadata: true,
        severity: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
  }

  async recordAudit(data: {
    userId: string;
    action: string;
    resource: string;
    resourceId: string;
    requestId?: string | undefined;
    ipAddress?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<void> {
    await prisma.auditLog.create({
      data: {
        ...data,
        requestId: data.requestId ?? null,
        ipAddress: data.ipAddress ?? null,
        metadata: (data.metadata as object) ?? {},
      },
    });
  }
}
