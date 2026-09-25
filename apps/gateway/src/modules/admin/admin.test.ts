import assert from 'node:assert/strict';

import { ModelCategory, ProviderHealthStatus, ProviderStatus } from '@baseapikey/database';

import type { IModelCatalogCache } from '../models/cache/model-catalog.cache';

import { ProviderEncryptionNotConfiguredError } from './errors/admin.errors';
import type { IAdminRepository } from './repositories/admin.repository';
import { AdminService } from './services/admin.service';
import { ProviderSecretService } from './services/provider-secret.service';

const now = new Date('2026-09-19T00:00:00.000Z');
let encryptedCredential = '';
let cacheInvalidations = 0;
const repository: IAdminRepository = {
  listProviders: async () => [],
  createProvider: async (data) => {
    encryptedCredential = data.encryptedApiKey;
    return {
      id: 'provider-id',
      name: String(data['name']),
      slug: String(data['slug']),
      baseUrl: String(data['baseUrl']),
      apiVersion: null,
      status: ProviderStatus.ACTIVE,
      priority: 100,
      timeoutMs: 60_000,
      maxRetries: 2,
      supportsStreaming: true,
      supportsImages: false,
      supportsEmbeddings: false,
      supportsAudio: false,
      supportsVision: false,
      healthStatus: ProviderHealthStatus.UNKNOWN,
      healthCheckedAt: null,
      createdAt: now,
      updatedAt: now,
    };
  },
  updateProvider: async () => {
    throw new Error('not used');
  },
  listModels: async () => [],
  createModel: async (data) => ({
    id: 'model-id',
    providerId: String(data['providerId']),
    name: String(data['name']),
    slug: String(data['slug']),
    displayName: String(data['displayName']),
    category: ModelCategory.CHAT,
    contextWindow: Number(data['contextWindow']),
    maxOutputTokens: Number(data['maxOutputTokens']),
    inputPricePerMillion: Number(data['inputPricePerMillion']),
    outputPricePerMillion: Number(data['outputPricePerMillion']),
    supportsStreaming: true,
    supportsVision: false,
    supportsFunctionCalling: false,
    supportsJsonMode: false,
    supportsReasoning: false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }),
  updateModel: async () => {
    throw new Error('not used');
  },
  listAudits: async () => [],
  recordAudit: async () => undefined,
};
const cache: IModelCatalogCache = {
  get: async () => null,
  set: async () => undefined,
  invalidate: async () => {
    cacheInvalidations += 1;
  },
};

async function run(): Promise<void> {
  assert.throws(
    () => new ProviderSecretService().encrypt('secret'),
    ProviderEncryptionNotConfiguredError,
  );
  const encryptionKey = Buffer.alloc(32, 7).toString('base64');
  const service = new AdminService(repository, new ProviderSecretService(encryptionKey), cache);
  const result = await service.createProvider(
    'admin-id',
    {
      name: 'Provider',
      slug: 'provider',
      baseUrl: 'https://provider.example/v1',
      apiKey: 'plaintext-secret',
    },
    {},
  );
  assert.match(encryptedCredential, /^v1\./);
  assert.equal(encryptedCredential.includes('plaintext-secret'), false);
  assert.equal(
    new ProviderSecretService(encryptionKey).decrypt(encryptedCredential),
    'plaintext-secret',
  );
  assert.equal('encryptedApiKey' in result, false);
  assert.equal(result['credentialConfigured'], true);
  assert.equal(cacheInvalidations, 1);
  console.log('✅ Admin credential encryption, redaction, and cache invalidation tests passed');
}

void run();
