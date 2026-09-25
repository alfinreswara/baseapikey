import { NotFoundError } from '@baseapikey/shared';

import type { IModelCatalogCache } from '../cache/model-catalog.cache';
import type { ModelCatalogItemDto, ModelCatalogQueryDto } from '../dto/model-catalog.dto';
import type {
  IModelCatalogRepository,
  ModelCatalogRecord,
} from '../repositories/model-catalog.repository';

export interface ModelCatalogLogger {
  debug(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
}

const noopLogger: ModelCatalogLogger = {
  debug: () => undefined,
  warn: () => undefined,
};

export class ModelCatalogService {
  private refreshPromise: Promise<ModelCatalogItemDto[]> | null = null;

  constructor(
    private readonly repository: IModelCatalogRepository,
    private readonly cache: IModelCatalogCache,
    private readonly cacheTtlSeconds = 300,
    private readonly logger: ModelCatalogLogger = noopLogger,
  ) {
    if (!Number.isSafeInteger(cacheTtlSeconds) || cacheTtlSeconds <= 0) {
      throw new Error('Model catalog cache TTL must be a positive integer');
    }
  }

  async listModels(query?: ModelCatalogQueryDto): Promise<ModelCatalogItemDto[]> {
    const models = await this.loadModels();
    if (!query) return models;
    const needle = query.q?.toLowerCase();
    const filtered = models.filter(
      (model) =>
        (!needle ||
          `${model.id} ${model.display_name} ${model.owned_by}`.toLowerCase().includes(needle)) &&
        (!query.category || model.category === query.category) &&
        (!query.provider || model.provider.slug === query.provider),
    );
    const direction = query.order === 'desc' ? -1 : 1;
    return filtered.sort((left, right) => {
      switch (query.sort) {
        case 'price_input':
          return (left.pricing.input - right.pricing.input) * direction;
        case 'price_output':
          return (left.pricing.output - right.pricing.output) * direction;
        case 'context':
          return (left.context_window - right.context_window) * direction;
        case 'name':
          return left.display_name.localeCompare(right.display_name) * direction;
      }
    });
  }

  private async loadModels(): Promise<ModelCatalogItemDto[]> {
    try {
      const cached = await this.cache.get();
      if (cached !== null) {
        this.logger.debug(
          { cacheKey: 'model:catalog', modelCount: cached.length },
          'Model catalog cache hit',
        );
        return cached;
      }
    } catch (error) {
      this.logger.warn(
        { err: error, cacheKey: 'model:catalog' },
        'Model catalog cache read failed',
      );
    }

    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.loadAndCacheModels();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  async getModel(modelId: string): Promise<ModelCatalogItemDto> {
    const normalizedModelId = modelId.trim();
    const model = (await this.loadModels()).find((item) => item.id === normalizedModelId);
    if (!model) {
      throw new NotFoundError('Model', normalizedModelId);
    }
    return model;
  }

  async resolveModel(modelId: string): Promise<ModelCatalogItemDto> {
    return this.getModel(modelId);
  }

  async invalidateCache(): Promise<void> {
    try {
      await this.cache.invalidate();
    } catch (error) {
      this.logger.warn(
        { err: error, cacheKey: 'model:catalog' },
        'Model catalog cache invalidation failed',
      );
    }
  }

  private async loadAndCacheModels(): Promise<ModelCatalogItemDto[]> {
    const records = await this.repository.findActiveModels();
    const models = records.map((record) => this.toDto(record));

    try {
      await this.cache.set(models, this.cacheTtlSeconds);
      this.logger.debug(
        { cacheKey: 'model:catalog', modelCount: models.length, ttlSeconds: this.cacheTtlSeconds },
        'Model catalog cache refreshed',
      );
    } catch (error) {
      this.logger.warn(
        { err: error, cacheKey: 'model:catalog' },
        'Model catalog cache write failed',
      );
    }

    return models;
  }

  private toDto(record: ModelCatalogRecord): ModelCatalogItemDto {
    return {
      id: record.modelId,
      object: 'model',
      created: Math.floor(record.createdAt.getTime() / 1000),
      owned_by: record.provider.slug,
      display_name: record.displayName,
      category: record.category,
      context_window: record.contextWindow,
      max_output_tokens: record.maxOutputTokens,
      pricing: {
        currency: 'USD',
        unit: 'million_tokens',
        input: record.inputPricePerMillion,
        output: record.outputPricePerMillion,
      },
      capabilities: {
        streaming: record.supportsStreaming,
        vision: record.supportsVision,
        function_calling: record.supportsFunctionCalling,
        json_mode: record.supportsJsonMode,
        reasoning: record.supportsReasoning,
      },
      provider: record.provider,
    };
  }
}
