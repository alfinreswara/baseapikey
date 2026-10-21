import assert from 'node:assert/strict';

import {
  ProviderRegistry,
  type IProviderAdapter,
  type ProviderCapabilities,
} from '@baseapikey/shared';

import { buildApp } from '../../app';
import { MockApiKeyRepository } from '../api-keys/testing/mock-api-key.repository';
import { PasswordService } from '../auth/services/password.service';
import { MockUserRepository } from '../auth/testing/auth-test-utils';
import { QuotaService } from '../quota/services/quota.service';
import { MockQuotaRepository } from '../quota/testing/mock-quota.repository';

import { ModelCatalogService } from './services/model-catalog.service';
import { ModelPolicyService } from './services/model-policy.service';
import { MockModelCatalogCache } from './testing/mock-model-catalog.cache';
import { MockModelCatalogRepository } from './testing/mock-model-catalog.repository';

const API_KEY = 'sk_live_modelpolicyvalidationkey000000000';

class CountingProvider implements IProviderAdapter {
  public calls = 0;

  getName(): string {
    return '9router';
  }

  getCapabilities(): ProviderCapabilities {
    return { supportsChat: true, supportsStreaming: true, supportsModels: true };
  }

  async chat(): Promise<never> {
    this.calls += 1;
    throw new Error('The provider must not be called for a rejected request');
  }

  async chatCompletion(): Promise<never> {
    this.calls += 1;
    throw new Error('The provider must not be called for a rejected request');
  }

  async streamChat(): Promise<never> {
    this.calls += 1;
    throw new Error('The provider must not be called for a rejected request');
  }

  async listModels(): Promise<never> {
    this.calls += 1;
    throw new Error('The provider must not be called for a rejected request');
  }

  async healthCheck(): Promise<never> {
    this.calls += 1;
    throw new Error('The provider must not be called for a rejected request');
  }
}

function catalogEntry(overrides: {
  modelId: string;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  isFree?: boolean;
  providerSlug?: string;
}) {
  return {
    id: `model-${overrides.modelId}`,
    modelId: overrides.modelId,
    displayName: overrides.modelId,
    category: 'CHAT' as const,
    contextWindow: 8_000,
    maxOutputTokens: 4_000,
    inputPricePerMillion: overrides.inputPricePerMillion ?? 3,
    outputPricePerMillion: overrides.outputPricePerMillion ?? 15,
    isFree: overrides.isFree ?? false,
    supportsStreaming: true,
    supportsVision: false,
    supportsFunctionCalling: false,
    supportsJsonMode: false,
    supportsReasoning: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    provider: {
      id: 'provider-1',
      name: '9Router',
      slug: overrides.providerSlug ?? '9router',
    },
  };
}

async function runModelPolicyTests(): Promise<void> {
  console.log('🧪 Starting Model Policy Tests...');

  const repository = new MockModelCatalogRepository([
    catalogEntry({ modelId: 'priced-model' }),
    catalogEntry({ modelId: 'unpriced-model', inputPricePerMillion: 0, outputPricePerMillion: 0 }),
    catalogEntry({
      modelId: 'free-model',
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
      isFree: true,
    }),
    catalogEntry({ modelId: 'other-provider-model', providerSlug: 'other-provider' }),
  ]);
  const catalog = new ModelCatalogService(repository, new MockModelCatalogCache(), 300);
  const policy = new ModelPolicyService(catalog);

  // 1. A registered model with a valid price.
  const priced = await policy.resolve('priced-model');
  assert.equal(priced.modelId, 'priced-model');
  assert.equal(priced.providerSlug, '9router');
  assert.equal(priced.inputPricePerMillion, 3);
  assert.equal(priced.outputPricePerMillion, 15);
  assert.equal(priced.isFree, false);
  console.log('  ✅ A registered model with a valid price is resolved');

  // 2. An unknown model is rejected.
  await assert.rejects(
    () => policy.resolve('unknown-model'),
    (error: unknown) =>
      (error as { code?: string }).code === 'MODEL_NOT_AVAILABLE' &&
      (error as { statusCode?: number }).statusCode === 400,
  );
  console.log('  ✅ An unknown model is rejected');

  // 3. A model without a configured price is rejected.
  await assert.rejects(
    () => policy.resolve('unpriced-model'),
    (error: unknown) => (error as { code?: string }).code === 'MODEL_PRICING_NOT_CONFIGURED',
  );
  console.log('  ✅ A model without a configured price is rejected');

  // 4. A model that is explicitly configured as free is accepted.
  const free = await policy.resolve('free-model');
  assert.equal(free.isFree, true);
  console.log('  ✅ A model that is explicitly free is accepted');

  // 5. A provider that does not match the mapping of the model is rejected.
  await assert.rejects(
    () => policy.resolve('other-provider-model', '9router'),
    (error: unknown) => (error as { code?: string }).code === 'MODEL_PROVIDER_MISMATCH',
  );
  console.log('  ✅ A provider that does not match the model mapping is rejected');

  // 6. The request is rejected before the provider is called.
  const userRepo = new MockUserRepository();
  const apiKeyRepo = new MockApiKeyRepository();
  const user = await userRepo.create({
    email: 'model-policy@example.com',
    username: 'modelpolicy',
    fullName: 'Model Policy',
    passwordHash: 'hash',
  });
  await apiKeyRepo.createKey({
    id: 'key-model-policy',
    userId: user.id,
    name: 'Model Policy Key',
    keyHash: await new PasswordService().hash(API_KEY),
    keyPrefix: API_KEY.substring(0, 16),
    permissions: ['chat:completions'],
  });

  const provider = new CountingProvider();
  const registry = new ProviderRegistry();
  registry.register(provider);

  const app = buildApp({
    userRepository: userRepo,
    apiKeyRepository: apiKeyRepo,
    providerRegistry: registry,
    quotaService: new QuotaService(new MockQuotaRepository()),
    modelCatalogRepository: repository,
    modelCatalogCache: new MockModelCatalogCache(),
    modelPolicyResolver: policy,
  });
  await app.ready();

  try {
    const rejected = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${API_KEY}` },
      payload: {
        model: 'unknown-model',
        messages: [{ role: 'user', content: 'hi' }],
      },
    });
    assert.equal(rejected.statusCode, 400);
    const rejectedBody = JSON.parse(rejected.body);
    assert.equal(rejectedBody.error.code, 'MODEL_NOT_AVAILABLE');
    assert.equal(provider.calls, 0, 'The provider must not be called for a rejected request');
    console.log('  ✅ An unknown model is rejected before the provider is called');

    const unpriced = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${API_KEY}` },
      payload: {
        model: 'unpriced-model',
        messages: [{ role: 'user', content: 'hi' }],
      },
    });
    assert.equal(unpriced.statusCode, 400);
    assert.equal(JSON.parse(unpriced.body).error.code, 'MODEL_PRICING_NOT_CONFIGURED');
    assert.equal(provider.calls, 0, 'The provider must not be called for a rejected request');
    console.log('  ✅ A model without a price is rejected before the provider is called');
  } finally {
    await app.close();
  }

  console.log('🎉 All Model Policy Tests passed successfully!\n');
}

void runModelPolicyTests();
