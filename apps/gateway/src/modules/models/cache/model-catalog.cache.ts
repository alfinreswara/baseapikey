import { ModelCatalogSchema, type ModelCatalogItemDto } from '../dto/model-catalog.dto';

export const MODEL_CATALOG_CACHE_KEY = 'model:catalog';

export interface IModelCatalogCache {
  get(): Promise<ModelCatalogItemDto[] | null>;
  set(models: ModelCatalogItemDto[], ttlSeconds: number): Promise<void>;
  invalidate(): Promise<void>;
}

export interface RedisModelCatalogClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  del(key: string): Promise<number>;
}

export class RedisModelCatalogCache implements IModelCatalogCache {
  constructor(private readonly redis: RedisModelCatalogClient) {}

  async get(): Promise<ModelCatalogItemDto[] | null> {
    const cached = await this.redis.get(MODEL_CATALOG_CACHE_KEY);
    if (cached === null) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(cached);
      const result = ModelCatalogSchema.safeParse(parsed);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }

  async set(models: ModelCatalogItemDto[], ttlSeconds: number): Promise<void> {
    await this.redis.set(MODEL_CATALOG_CACHE_KEY, JSON.stringify(models), { EX: ttlSeconds });
  }

  async invalidate(): Promise<void> {
    await this.redis.del(MODEL_CATALOG_CACHE_KEY);
  }
}

export class NoopModelCatalogCache implements IModelCatalogCache {
  async get(): Promise<null> {
    return null;
  }

  async set(_models: ModelCatalogItemDto[], _ttlSeconds: number): Promise<void> {}

  async invalidate(): Promise<void> {}
}
