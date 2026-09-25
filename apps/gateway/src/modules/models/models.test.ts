import assert from 'node:assert/strict';

import { NotFoundError } from '@baseapikey/shared';

import { buildApp } from '../../app';

import {
  MODEL_CATALOG_CACHE_KEY,
  type IModelCatalogCache,
  RedisModelCatalogCache,
  type RedisModelCatalogClient,
} from './cache/model-catalog.cache';
import type { ModelCatalogItemDto } from './dto/model-catalog.dto';
import type {
  IModelCatalogRepository,
  ModelCatalogRecord,
} from './repositories/model-catalog.repository';
import { ModelCatalogService } from './services/model-catalog.service';

const MODEL_CREATED_AT = new Date('2026-01-02T03:04:05.000Z');

function createModel(overrides: Partial<ModelCatalogRecord> = {}): ModelCatalogRecord {
  return {
    id: '8bb48a39-91e8-4cf1-9ed5-02bf9ccf2f32',
    modelId: 'gpt-5-mini',
    displayName: 'GPT-5 Mini',
    category: 'CHAT',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
    supportsStreaming: true,
    supportsVision: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    supportsReasoning: false,
    createdAt: MODEL_CREATED_AT,
    provider: {
      id: '00af9309-f934-43e0-8a1e-6ea4b2dd94d5',
      name: '9Router AI Gateway',
      slug: '9router',
    },
    ...overrides,
  };
}

class MockModelCatalogRepository implements IModelCatalogRepository {
  calls = 0;

  constructor(public models: ModelCatalogRecord[]) {}

  async findActiveModels(): Promise<ModelCatalogRecord[]> {
    this.calls += 1;
    return this.models;
  }
}

class MockModelCatalogCache implements IModelCatalogCache {
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

class MockRedisClient implements RedisModelCatalogClient {
  storedValue: string | null = null;
  lastKey: string | null = null;
  lastTtl: number | null = null;

  async get(key: string): Promise<string | null> {
    this.lastKey = key;
    return this.storedValue;
  }

  async set(key: string, value: string, options: { EX: number }): Promise<string> {
    this.lastKey = key;
    this.storedValue = value;
    this.lastTtl = options.EX;
    return 'OK';
  }

  async del(key: string): Promise<number> {
    this.lastKey = key;
    this.storedValue = null;
    return 1;
  }
}

async function runModelCatalogTests(): Promise<void> {
  console.log('🧪 Starting Model Catalog Tests...');

  const repository = new MockModelCatalogRepository([createModel()]);
  const cache = new MockModelCatalogCache();
  const service = new ModelCatalogService(repository, cache, 300);

  const firstResult = await service.listModels();
  assert.equal(repository.calls, 1);
  assert.equal(cache.setCalls, 1);
  assert.equal(cache.lastTtl, 300);
  assert.deepEqual(firstResult[0], {
    id: 'gpt-5-mini',
    object: 'model',
    created: Math.floor(MODEL_CREATED_AT.getTime() / 1000),
    owned_by: '9router',
    display_name: 'GPT-5 Mini',
    category: 'CHAT',
    context_window: 128_000,
    max_output_tokens: 8_192,
    pricing: {
      currency: 'USD',
      unit: 'million_tokens',
      input: 0.15,
      output: 0.6,
    },
    capabilities: {
      streaming: true,
      vision: true,
      function_calling: true,
      json_mode: true,
      reasoning: false,
    },
    provider: {
      id: '00af9309-f934-43e0-8a1e-6ea4b2dd94d5',
      name: '9Router AI Gateway',
      slug: '9router',
    },
  });

  const secondResult = await service.listModels();
  assert.deepEqual(secondResult, firstResult);
  assert.equal(repository.calls, 1, 'cache hit must avoid another database query');
  console.log('  ✅ Active model details are normalized and served from the 5-minute cache');

  assert.equal((await service.getModel('gpt-5-mini')).id, 'gpt-5-mini');
  assert.equal((await service.resolveModel('gpt-5-mini')).provider.slug, '9router');
  await assert.rejects(() => service.getModel('missing-model'), NotFoundError);
  await service.invalidateCache();
  assert.equal(cache.invalidateCalls, 1);
  console.log('  ✅ Model lookup, provider resolution, and cache invalidation are supported');

  const failingCache = new MockModelCatalogCache();
  failingCache.failReads = true;
  failingCache.failWrites = true;
  const fallbackRepository = new MockModelCatalogRepository([createModel()]);
  const fallbackService = new ModelCatalogService(fallbackRepository, failingCache);
  assert.equal((await fallbackService.listModels()).length, 1);
  assert.equal(fallbackRepository.calls, 1);
  console.log('  ✅ Redis failures fail open to PostgreSQL without taking down the catalog');

  const redisClient = new MockRedisClient();
  const redisCache = new RedisModelCatalogCache(redisClient);
  await redisCache.set(firstResult, 300);
  assert.equal(redisClient.lastKey, MODEL_CATALOG_CACHE_KEY);
  assert.equal(redisClient.lastTtl, 300);
  assert.deepEqual(await redisCache.get(), firstResult);
  redisClient.storedValue = '{not-valid-json';
  assert.equal(await redisCache.get(), null);
  console.log(
    '  ✅ Redis cache uses model:catalog, validates payloads, and rejects corrupt entries',
  );

  const routeRepository = new MockModelCatalogRepository([createModel()]);
  const routeCache = new MockModelCatalogCache();
  const app = buildApp({
    modelCatalogRepository: routeRepository,
    modelCatalogCache: routeCache,
  });
  await app.ready();

  try {
    const response = await app.inject({ method: 'GET', url: '/v1/models' });
    assert.equal(response.statusCode, 200);
    assert.equal(
      response.headers['cache-control'],
      'public, max-age=60, stale-while-revalidate=300',
    );
    const body = response.json<{ object: string; data: ModelCatalogItemDto[] }>();
    assert.equal(body.object, 'list');
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0]?.id, 'gpt-5-mini');
    assert.equal(body.data[0]?.pricing.input, 0.15);
    assert.equal(response.headers['www-authenticate'], undefined);
    console.log('  ✅ GET /v1/models is public and returns an OpenAI-compatible model list');
  } finally {
    await app.close();
  }

  console.log('🎉 All Model Catalog Tests passed successfully!\n');
}

if (process.argv[1]?.endsWith('models.test.ts')) {
  void runModelCatalogTests();
}
