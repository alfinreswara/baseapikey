import assert from 'node:assert/strict';

import {
  ProviderError,
  ProviderRegistry,
  type IProviderAdapter,
  type ProviderResponse,
} from '@baseapikey/shared';

import { ResilientProviderRouter } from './resilient-provider-router';

function provider(name: string, chat: IProviderAdapter['chat']): IProviderAdapter {
  return {
    getName: () => name,
    getCapabilities: () => ({ supportsChat: true, supportsStreaming: true, supportsModels: true }),
    chat,
    streamChat: async () => (async function* () {})(),
    chatCompletion: chat,
    listModels: async () => [],
    healthCheck: async () => ({ status: 'healthy', provider: name, checkedAt: new Date() }),
  };
}

function response(providerName: string): ProviderResponse {
  return {
    id: 'completion-id',
    object: 'chat.completion',
    created: 1,
    model: 'test-model',
    provider: providerName,
    choices: [],
  };
}

async function run(): Promise<void> {
  const registry = new ProviderRegistry();
  let primaryCalls = 0;
  let fallbackCalls = 0;
  registry.register(
    provider('primary', async () => {
      primaryCalls += 1;
      throw ProviderError.fromHttpStatus(503, 'temporarily unavailable', 'primary');
    }),
    { priority: 1 },
  );
  registry.register(
    provider('fallback', async () => {
      fallbackCalls += 1;
      return response('fallback');
    }),
    { priority: 2 },
  );
  const router = new ResilientProviderRouter(registry, {
    maxRetries: 1,
    baseDelayMs: 0,
    failureThreshold: 2,
    sleep: async () => undefined,
  });
  const result = await router.execute('primary', (adapter) =>
    adapter.chat({ model: 'test-model', messages: [{ role: 'user', content: 'hello' }] }),
  );
  assert.equal(primaryCalls, 2);
  assert.equal(fallbackCalls, 1);
  assert.equal(result.provider, 'fallback');
  assert.equal(router.isCircuitOpen('primary'), true);

  let invalidFallbackCalls = 0;
  const invalidRegistry = new ProviderRegistry();
  invalidRegistry.register(
    provider('invalid-primary', async () => {
      throw ProviderError.fromHttpStatus(400, 'invalid request', 'invalid-primary');
    }),
  );
  invalidRegistry.register(
    provider('should-not-run', async () => {
      invalidFallbackCalls += 1;
      return response('should-not-run');
    }),
  );
  const invalidRouter = new ResilientProviderRouter(invalidRegistry, { maxRetries: 2 });
  await assert.rejects(
    invalidRouter.execute('invalid-primary', (adapter) =>
      adapter.chat({ model: 'test-model', messages: [{ role: 'user', content: 'hello' }] }),
    ),
    (error: unknown) => error instanceof ProviderError && error.category === 'INVALID_REQUEST',
  );
  assert.equal(invalidFallbackCalls, 0);
  console.log('✅ Provider retry, circuit breaker, and fallback tests passed');
}

void run();
