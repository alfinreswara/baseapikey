import { toCursorPage, type CursorPage } from '../../common/pagination';
import type { IModelCatalogCache } from '../../models/cache/model-catalog.cache';
import type {
  AuditQueryDto,
  CreateModelDto,
  CreateProviderDto,
  UpdateModelDto,
  UpdateProviderDto,
} from '../dto/admin.dto';
import type {
  AdminAuditRecord,
  AdminModelRecord,
  AdminProviderRecord,
  IAdminRepository,
} from '../repositories/admin.repository';

import type { ProviderSecretService } from './provider-secret.service';

export interface AdminRequestMetadata {
  requestId?: string | undefined;
  ipAddress?: string | undefined;
}

export class AdminService {
  constructor(
    private readonly repository: IAdminRepository,
    private readonly secretService: ProviderSecretService,
    private readonly modelCache: IModelCatalogCache,
    private readonly providersChanged?: (() => Promise<void>) | undefined,
  ) {}

  async listProviders(
    limit: number,
    cursor?: string,
  ): Promise<CursorPage<Record<string, unknown> & { id: string }>> {
    const records = await this.repository.listProviders(limit, cursor);
    return toCursorPage(
      records.map((record) => this.providerDto(record)),
      limit,
    );
  }

  async createProvider(
    actorId: string,
    dto: CreateProviderDto,
    metadata: AdminRequestMetadata,
  ): Promise<Record<string, unknown> & { id: string }> {
    const { apiKey, ...values } = dto;
    const record = await this.repository.createProvider({
      ...values,
      encryptedApiKey: this.secretService.encrypt(apiKey),
    });
    await this.audit(actorId, 'PROVIDER_CREATE', 'Provider', record.id, metadata, {
      slug: record.slug,
    });
    await this.modelCache.invalidate();
    await this.providersChanged?.();
    return this.providerDto(record);
  }

  async updateProvider(
    actorId: string,
    id: string,
    dto: UpdateProviderDto,
    metadata: AdminRequestMetadata,
  ): Promise<Record<string, unknown> & { id: string }> {
    const { apiKey, ...values } = dto;
    const record = await this.repository.updateProvider(id, {
      ...values,
      ...(apiKey !== undefined ? { encryptedApiKey: this.secretService.encrypt(apiKey) } : {}),
    });
    await this.audit(actorId, 'PROVIDER_UPDATE', 'Provider', id, metadata, {
      fields: Object.keys(dto),
    });
    await this.modelCache.invalidate();
    await this.providersChanged?.();
    return this.providerDto(record);
  }

  async listModels(
    limit: number,
    cursor?: string,
  ): Promise<CursorPage<Record<string, unknown> & { id: string }>> {
    const records = await this.repository.listModels(limit, cursor);
    return toCursorPage(
      records.map((record) => this.modelDto(record)),
      limit,
    );
  }

  async createModel(
    actorId: string,
    dto: CreateModelDto,
    metadata: AdminRequestMetadata,
  ): Promise<Record<string, unknown> & { id: string }> {
    const record = await this.repository.createModel(dto);
    await this.audit(actorId, 'MODEL_CREATE', 'AIModel', record.id, metadata, {
      providerId: record.providerId,
      slug: record.slug,
    });
    await this.modelCache.invalidate();
    return this.modelDto(record);
  }

  async updateModel(
    actorId: string,
    id: string,
    dto: UpdateModelDto,
    metadata: AdminRequestMetadata,
  ): Promise<Record<string, unknown> & { id: string }> {
    const record = await this.repository.updateModel(id, dto);
    await this.audit(actorId, 'MODEL_UPDATE', 'AIModel', id, metadata, {
      fields: Object.keys(dto),
    });
    await this.modelCache.invalidate();
    return this.modelDto(record);
  }

  async listAudits(
    query: AuditQueryDto,
  ): Promise<CursorPage<Record<string, unknown> & { id: string }>> {
    const records = await this.repository.listAudits(query);
    return toCursorPage(
      records.map((record) => this.auditDto(record)),
      query.limit,
    );
  }

  async listUsers(
    limit: number,
    cursor?: string,
    search?: string,
  ): Promise<CursorPage<Record<string, unknown> & { id: string }>> {
    if (!this.repository.listUsers) throw new Error('Admin user repository is unavailable');
    const records = await this.repository.listUsers(limit, cursor, search);
    return toCursorPage(
      records.map((record) => ({
        ...record,
        organizationCount: record._count.organizationMemberships,
        apiKeyCount: record._count.apiKeys,
        _count: undefined,
        lastLoginAt: record.lastLoginAt?.toISOString() ?? null,
        createdAt: record.createdAt.toISOString(),
      })),
      limit,
    );
  }

  async getPlatformHealth(): Promise<Record<string, unknown>> {
    if (!this.repository.getPlatformHealth)
      throw new Error('Admin health repository is unavailable');
    return this.repository.getPlatformHealth();
  }

  async getPlatformUsage(): Promise<Record<string, number>> {
    if (!this.repository.getPlatformUsage) throw new Error('Admin usage repository is unavailable');
    return this.repository.getPlatformUsage();
  }

  private async audit(
    userId: string,
    action: string,
    resource: string,
    resourceId: string,
    request: AdminRequestMetadata,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.repository.recordAudit({
      userId,
      action,
      resource,
      resourceId,
      ...request,
      metadata,
    });
  }

  private providerDto(provider: AdminProviderRecord): Record<string, unknown> & { id: string } {
    return {
      ...provider,
      credentialConfigured: true,
      healthCheckedAt: provider.healthCheckedAt?.toISOString() ?? null,
      createdAt: provider.createdAt.toISOString(),
      updatedAt: provider.updatedAt.toISOString(),
    };
  }

  private modelDto(model: AdminModelRecord): Record<string, unknown> & { id: string } {
    return {
      ...model,
      createdAt: model.createdAt.toISOString(),
      updatedAt: model.updatedAt.toISOString(),
    };
  }

  private auditDto(audit: AdminAuditRecord): Record<string, unknown> & { id: string } {
    return { ...audit, createdAt: audit.createdAt.toISOString() };
  }
}
