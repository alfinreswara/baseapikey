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
import { ProviderError } from '@baseapikey/shared';

/**
 * Mock Implementation of IProviderAdapter to verify contract & interface compliance
 */
class MockProviderAdapter implements IProviderAdapter {
  private readonly capabilities: ProviderCapabilities = {
    supportsChat: true,
    supportsStreaming: true,
    supportsModels: true,
    supportsTools: true,
    supportsVision: false,
  };

  getName(): string {
    return 'mock-provider';
  }

  getCapabilities(): ProviderCapabilities {
    return this.capabilities;
  }

  async chat(
    request: ProviderRequest,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResponse> {
    if (options?.signal?.aborted) {
      throw new ProviderError({
        code: 'PROVIDER_TIMEOUT',
        message: 'Request aborted by client',
        statusCode: 408,
        category: 'TIMEOUT',
        isRetryable: true,
        providerSlug: this.getName(),
      });
    }

    if (!request.model) {
      throw ProviderError.fromHttpStatus(400, 'Model is required', this.getName());
    }

    return {
      id: 'chatcmpl-mock123',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      provider: this.getName(),
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: `Echo: ${(request.messages[0]?.content as string) || ''}`,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
    };
  }

  async streamChat(
    request: ProviderRequest,
    options?: ProviderRequestOptions,
  ): Promise<AsyncIterable<ProviderStreamChunk>> {
    if (options?.signal?.aborted) {
      throw new ProviderError({
        code: 'PROVIDER_TIMEOUT',
        message: 'Request aborted by client',
        statusCode: 408,
        category: 'TIMEOUT',
        isRetryable: true,
        providerSlug: this.getName(),
      });
    }

    const providerName = this.getName();
    const model = request.model;

    return (async function* () {
      yield {
        id: 'chatcmpl-chunk1',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model,
        provider: providerName,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: 'Hello' },
            finish_reason: null,
          },
        ],
      };

      yield {
        id: 'chatcmpl-chunk2',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model,
        provider: providerName,
        choices: [
          {
            index: 0,
            delta: { content: ' world!' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          promptTokens: 10,
          completionTokens: 3,
          totalTokens: 13,
        },
      };
    })();
  }

  async chatCompletion(
    request: ProviderRequest,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResponse | AsyncIterable<ProviderStreamChunk>> {
    if (request.stream) {
      return this.streamChat(request, options);
    }
    return this.chat(request, options);
  }

  async listModels(_options?: ProviderRequestOptions): Promise<ProviderModel[]> {
    return [
      {
        id: 'mock-gpt-4o',
        object: 'model',
        created: 1700000000,
        owned_by: 'mock-org',
        provider: this.getName(),
        context_length: 128000,
        capabilities: this.capabilities,
      },
    ];
  }

  async healthCheck(_options?: ProviderRequestOptions): Promise<ProviderHealthStatus> {
    return {
      status: 'healthy',
      provider: this.getName(),
      latencyMs: 15,
      checkedAt: new Date(),
    };
  }
}

export async function runProviderInterfaceTests(): Promise<void> {
  console.log('🧪 Starting Provider Interface & Abstraction (P05-T01) Unit Tests...');
  const adapter = new MockProviderAdapter();

  // Test 1: Provider Name & Capabilities
  assert.equal(adapter.getName(), 'mock-provider');
  const caps = adapter.getCapabilities();
  assert.equal(caps.supportsChat, true);
  assert.equal(caps.supportsStreaming, true);
  assert.equal(caps.supportsModels, true);
  assert.equal(caps.supportsTools, true);
  assert.equal(caps.supportsVision, false);
  console.log('  ✅ Provider Name and Capabilities verified');

  // Test 2: Chat Request & Response Representation
  const request: ProviderRequest = {
    model: 'mock-gpt-4o',
    messages: [{ role: 'user', content: 'Hello test' }],
    temperature: 0.7,
    max_tokens: 100,
  };

  const response = await adapter.chat(request);
  assert.equal(response.object, 'chat.completion');
  assert.equal(response.model, 'mock-gpt-4o');
  assert.equal(response.provider, 'mock-provider');
  assert.equal(response.choices.length, 1);
  assert.equal(response.choices[0]?.message.content, 'Echo: Hello test');
  assert.equal(response.usage?.totalTokens, 15);
  console.log('  ✅ Non-streaming chat completion request/response verified');

  // Test 3: Streaming Responses Representation
  const stream = await adapter.streamChat({ ...request, stream: true });
  const chunks: ProviderStreamChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]?.choices[0]?.delta.content, 'Hello');
  assert.equal(chunks[1]?.choices[0]?.delta.content, ' world!');
  assert.equal(chunks[1]?.choices[0]?.finish_reason, 'stop');
  console.log('  ✅ Streaming chat completion chunks verified');

  // Test 4: Model Catalog Representation
  const models = await adapter.listModels();
  assert.equal(models.length, 1);
  assert.equal(models[0]?.id, 'mock-gpt-4o');
  assert.equal(models[0]?.context_length, 128000);
  console.log('  ✅ Model catalog representation verified');

  // Test 5: Health Check Probe
  const health = await adapter.healthCheck();
  assert.equal(health.status, 'healthy');
  assert.equal(health.provider, 'mock-provider');
  assert.ok(health.latencyMs && health.latencyMs > 0);
  console.log('  ✅ Provider Health check probe verified');

  // Test 6: Normalized Error Mapping & Categories
  const authErr = ProviderError.fromHttpStatus(401, 'Unauthorized API key', 'mock-provider');
  assert.equal(authErr.category, 'AUTHENTICATION_ERROR');
  assert.equal(authErr.isRetryable, false);

  const rateLimitErr = ProviderError.fromHttpStatus(429, 'Rate limit exceeded', 'mock-provider');
  assert.equal(rateLimitErr.category, 'RATE_LIMIT');
  assert.equal(rateLimitErr.isRetryable, true);

  const unavailableErr = ProviderError.fromHttpStatus(503, 'Service unavailable', 'mock-provider');
  assert.equal(unavailableErr.category, 'PROVIDER_UNAVAILABLE');
  assert.equal(unavailableErr.isRetryable, true);

  const notFoundErr = ProviderError.fromHttpStatus(404, 'Model not found', 'mock-provider');
  assert.equal(notFoundErr.category, 'MODEL_NOT_FOUND');
  assert.equal(notFoundErr.isRetryable, false);
  console.log('  ✅ ProviderError normalization and retryability rules verified');

  // Test 7: Request Cancellation via AbortSignal
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    async () => {
      await adapter.chat(request, { signal: controller.signal });
    },
    (err: unknown) => {
      return err instanceof ProviderError && err.category === 'TIMEOUT' && err.isRetryable === true;
    },
  );
  console.log('  ✅ Request cancellation via AbortSignal verified');

  console.log('🎉 All Provider Interface (P05-T01) Tests passed successfully!\n');
}

if (process.argv[1]?.endsWith('provider.test.ts')) {
  void runProviderInterfaceTests();
}
