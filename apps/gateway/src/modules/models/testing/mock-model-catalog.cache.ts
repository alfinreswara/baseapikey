import type { IModelCatalogCache } from '../cache/model-catalog.cache';
import type { ModelCatalogItemDto } from '../dto/model-catalog.dto';

export class MockModelCatalogCache implements IModelCatalogCache {
  value: ModelCatalogItemDto[] | null = null;
  getCalls = 0;
  setCalls = 0;
  invalidateCalls = 0;
  lastTtl: number | null = null;
  failReads = false;
  failWrites = false;

  async get(): Promise<ModelCatalogItemDto[] | null> {
    this.getCalls += 1;
    if (this.failReads) throw new Error('Redis read failed');
    return this.value;
  }

  async set(models: ModelCatalogItemDto[], ttlSeconds: number): Promise<void> {
    this.setCalls += 1;
    if (this.failWrites) throw new Error('Redis write failed');
    this.value = models;
    this.lastTtl = ttlSeconds;
  }

  async invalidate(): Promise<void> {
    this.invalidateCalls += 1;
    this.value = null;
  }
}
