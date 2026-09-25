import assert from 'node:assert/strict';

import type {
  IProviderAdapter,
  ProviderCapabilities,
  ProviderHealthStatus,
  ProviderModel,
  ProviderRequest,
  ProviderRequestOptions,
  ProviderResponse,
  ProviderStreamChunk,
} from '@baseapikey/shared';
import { ProviderRegistry, ProviderRegistryError } from '@baseapikey/shared';

class DummyAdapter implements IProviderAdapter {
  constructor(
    private readonly slug: string,
    private readonly caps: ProviderCapabilities = {
      supportsChat: true,
      supportsStreaming: true,
      supportsModels: true,
    },
  ) {}

  getName(): string {
    return this.slug;
  }

  getCapabilities(): ProviderCapabilities {
    return this.caps;
  }

  async chat(
    _request: ProviderRequest,
    _options?: ProviderRequestOptions,
  ): Promise<ProviderResponse> {
    return {
      id: 'chatcmpl-dummy',
      object: 'chat.completion',
      created: 1700000000,
      model: 'dummy-model',
      provider: this.slug,
      choices: [],
    };
  }

  async streamChat(
    _request: ProviderRequest,
    _options?: ProviderRequestOptions,
  ): Promise<AsyncIterable<ProviderStreamChunk>> {
    return (async function* () {})();
  }

  async chatCompletion(
    request: ProviderRequest,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResponse | AsyncIterable<ProviderStreamChunk>> {
    return this.chat(request, options);
  }

  async listModels(_options?: ProviderRequestOptions): Promise<ProviderModel[]> {
    return [];
  }

  async healthCheck(_options?: ProviderRequestOptions): Promise<ProviderHealthStatus> {
    return {
      status: 'healthy',
      provider: this.slug,
      checkedAt: new Date(),
    };
  }
}

export async function runProviderRegistryTests(): Promise<void> {
  console.log('🧪 Starting Provider Registry (P05-T02) Unit Tests...');
  const registry = new ProviderRegistry();

  // Test 1: Register provider successfully & Retrieve by ID
  const providerA = new DummyAdapter('openai-mock', {
    supportsChat: true,
    supportsStreaming: true,
    supportsModels: true,
    supportsVision: true,
  });

  registry.register(providerA, { environment: 'test' });
  assert.equal(registry.has('openai-mock'), true);
  assert.equal(registry.get('openai-mock'), providerA);

  const lookupRes = registry.lookup('openai-mock');
  assert.equal(lookupRes.found, true);
  assert.equal(lookupRes.provider, providerA);
  assert.equal(lookupRes.registration?.metadata?.['environment'], 'test');
  console.log('  ✅ Register provider successfully and retrieve by ID passed');

  // Test 2: List registered providers
  const providerB = new DummyAdapter('anthropic-mock', {
    supportsChat: true,
    supportsStreaming: false,
    supportsModels: true,
    supportsTools: true,
  });

  registry.register(providerB);
  const allProviders = registry.list();
  assert.equal(allProviders.length, 2);
  assert.ok(allProviders.includes(providerA));
  assert.ok(allProviders.includes(providerB));

  const allRegistrations = registry.listRegistrations();
  assert.equal(allRegistrations.length, 2);
  console.log('  ✅ Register multiple providers independently & List registered passed');

  // Test 3: Find providers by capability
  const streamingProviders = registry.getByCapability('streaming');
  assert.equal(streamingProviders.length, 1);
  assert.equal(streamingProviders[0]?.getName(), 'openai-mock');

  const visionProviders = registry.getByCapability('supportsVision');
  assert.equal(visionProviders.length, 1);
  assert.equal(visionProviders[0]?.getName(), 'openai-mock');

  const chatProviders = registry.getByCapability('chat');
  assert.equal(chatProviders.length, 2);
  console.log('  ✅ Find providers by capability passed');

  // Test 4: Reject duplicate provider ID
  assert.throws(
    () => {
      registry.register(new DummyAdapter('openai-mock'));
    },
    (err: unknown) => {
      return (
        err instanceof ProviderRegistryError &&
        err.code === 'DUPLICATE_PROVIDER_REGISTRATION' &&
        err.statusCode === 409
      );
    },
  );
  console.log('  ✅ Reject duplicate provider ID (HTTP 409) passed');

  // Test 5: Reject invalid provider contract
  const invalidProvider1 = {} as unknown as IProviderAdapter;
  assert.throws(
    () => {
      registry.register(invalidProvider1);
    },
    (err: unknown) => {
      return (
        err instanceof ProviderRegistryError &&
        err.code === 'INVALID_PROVIDER_CONTRACT' &&
        err.statusCode === 400
      );
    },
  );

  const invalidProvider2 = {
    getName: () => '',
  } as unknown as IProviderAdapter;

  assert.throws(
    () => {
      registry.register(invalidProvider2);
    },
    (err: unknown) => {
      return (
        err instanceof ProviderRegistryError &&
        err.code === 'INVALID_PROVIDER_CONTRACT' &&
        err.statusCode === 400
      );
    },
  );
  console.log('  ✅ Reject invalid provider contract (HTTP 400) passed');

  // Test 6: Unknown provider returns appropriate error
  assert.equal(registry.has('non-existent'), false);
  assert.equal(registry.lookup('non-existent').found, false);

  assert.throws(
    () => {
      registry.get('non-existent');
    },
    (err: unknown) => {
      return (
        err instanceof ProviderRegistryError &&
        err.code === 'PROVIDER_NOT_FOUND' &&
        err.statusCode === 404
      );
    },
  );
  console.log('  ✅ Unknown provider lookup throws ProviderRegistryError (HTTP 404) passed');

  // Test 7: Unregister provider
  const unregistered = registry.unregister('openai-mock');
  assert.equal(unregistered, true);
  assert.equal(registry.has('openai-mock'), false);
  assert.equal(registry.list().length, 1);
  console.log('  ✅ Unregister provider passed');

  console.log('🎉 All Provider Registry (P05-T02) Tests passed successfully!\n');
}

if (process.argv[1]?.endsWith('provider-registry.test.ts')) {
  void runProviderRegistryTests();
}
