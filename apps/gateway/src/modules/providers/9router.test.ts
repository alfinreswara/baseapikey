import assert from 'node:assert/strict';

import type { ProviderRequest, ProviderStreamChunk } from '@baseapikey/shared';
import { ProviderError, ProviderRegistry } from '@baseapikey/shared';

import {
  NineRouterProvider,
  mapFromNineRouterModel,
  mapFromNineRouterResponse,
  mapToNineRouterRequest,
  registerNineRouter,
} from './9router';

const TEST_API_KEY = 'sk-9router-test-secret-key-12345';
const TEST_BASE_URL = 'https://mock.9router.test/v1';

export async function runNineRouterTests(): Promise<void> {
  console.log('🧪 Starting 9Router Provider Adapter (P05-T03) Unit Tests...');

  const originalFetch = globalThis.fetch;

  try {
    // Test 1: Initialization failure on missing API key
    assert.throws(
      () => {
        new NineRouterProvider({ apiKey: '' });
      },
      (err: unknown) => {
        return (
          err instanceof ProviderError &&
          err.code === 'MISSING_PROVIDER_API_KEY' &&
          err.category === 'AUTHENTICATION_ERROR' &&
          !err.message.includes(TEST_API_KEY)
        );
      },
    );
    console.log('  ✅ Missing API key initialization failure passed');

    // Test 2: Provider name and capabilities
    const provider = new NineRouterProvider({
      apiKey: TEST_API_KEY,
      baseUrl: TEST_BASE_URL,
    });

    assert.equal(provider.getName(), '9router');
    const caps = provider.getCapabilities();
    assert.equal(caps.supportsChat, true);
    assert.equal(caps.supportsStreaming, true);
    assert.equal(caps.supportsModels, true);
    console.log('  ✅ Provider Name and Capabilities verified');

    // Test 3: Request transformation
    const normRequest: ProviderRequest = {
      model: 'llama-3.1-70b',
      messages: [{ role: 'user', content: 'Hello 9Router' }],
      temperature: 0.7,
      max_tokens: 150,
      stream: false,
    };

    const wireReq = mapToNineRouterRequest(normRequest);
    assert.equal(wireReq.model, 'llama-3.1-70b');
    assert.equal(wireReq.messages[0]?.role, 'user');
    assert.equal(wireReq.messages[0]?.content, 'Hello 9Router');
    assert.equal(wireReq.temperature, 0.7);
    assert.equal(wireReq.max_tokens, 150);
    assert.equal(wireReq.stream, false);
    console.log('  ✅ Request transformation verified');

    // Test 4: Response transformation
    const wireRes = {
      id: '9r-cmpl-123',
      object: 'chat.completion',
      created: 1700000000,
      model: 'llama-3.1-70b',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello human!' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };

    const normRes = mapFromNineRouterResponse(wireRes, '9router');
    assert.equal(normRes.id, '9r-cmpl-123');
    assert.equal(normRes.provider, '9router');
    assert.equal(normRes.choices[0]?.message.content, 'Hello human!');
    assert.equal(normRes.usage?.totalTokens, 15);
    console.log('  ✅ Response transformation verified');

    // Test 5: Model transformation
    const wireModel = {
      id: 'llama-3.1-70b',
      object: 'model',
      owned_by: 'meta',
      context_length: 128000,
    };
    const normModel = mapFromNineRouterModel(wireModel, '9router');
    assert.equal(normModel.id, 'llama-3.1-70b');
    assert.equal(normModel.provider, '9router');
    assert.equal(normModel.context_length, 128000);
    console.log('  ✅ Model transformation verified');

    // Test 6: Successful non-streaming chat request with mocked fetch
    let capturedHeaders: Record<string, string> | undefined;
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify(wireRes), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const chatRes = await provider.chat(normRequest);
    assert.equal(chatRes.id, '9r-cmpl-123');
    assert.equal(chatRes.choices[0]?.message.content, 'Hello human!');
    assert.equal(capturedHeaders?.['Authorization'], `Bearer ${TEST_API_KEY}`);
    console.log('  ✅ Successful chat request with mocked fetch passed');

    // Test 7: Successful streaming chat request
    const sseBody =
      'data: {"id":"chunk-1","object":"chat.completion.chunk","created":1700000000,"model":"llama-3.1-70b","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}\n\n' +
      'data: {"id":"chunk-2","object":"chat.completion.chunk","created":1700000000,"model":"llama-3.1-70b","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":"stop"}]}\n\n' +
      'data: [DONE]\n\n';

    globalThis.fetch = (async () => {
      return new Response(sseBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as typeof fetch;

    const stream = await provider.streamChat(normRequest);
    const chunks: ProviderStreamChunk[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    assert.equal(chunks.length, 2);
    assert.equal(chunks[0]?.choices[0]?.delta.content, 'Hello');
    assert.equal(chunks[1]?.choices[0]?.delta.content, '!');
    assert.equal(chunks[1]?.choices[0]?.finish_reason, 'stop');
    console.log('  ✅ Successful SSE streaming chat passed');

    // Test 8: List models
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [wireModel],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const models = await provider.listModels();
    assert.equal(models.length, 1);
    assert.equal(models[0]?.id, 'llama-3.1-70b');
    console.log('  ✅ List models passed');

    // Test 9: Health check
    const health = await provider.healthCheck();
    assert.equal(health.status, 'healthy');
    assert.equal(health.provider, '9router');
    console.log('  ✅ Health check probe passed');

    // Test 10: Error mapping (401 Auth error)
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({ error: { message: 'Invalid API Key', type: 'authentication_error' } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    await assert.rejects(
      async () => {
        await provider.chat(normRequest);
      },
      (err: unknown) => {
        return (
          err instanceof ProviderError &&
          err.category === 'AUTHENTICATION_ERROR' &&
          err.statusCode === 401 &&
          !JSON.stringify(err).includes(TEST_API_KEY)
        );
      },
    );
    console.log('  ✅ 401 Authentication error mapping & security redacting passed');

    // Test 11: Error mapping (429 Rate limit)
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({ error: { message: 'Rate limit exceeded', type: 'rate_limit_error' } }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    await assert.rejects(
      async () => {
        await provider.chat(normRequest);
      },
      (err: unknown) => {
        return (
          err instanceof ProviderError &&
          err.category === 'RATE_LIMIT' &&
          err.statusCode === 429 &&
          err.isRetryable === true
        );
      },
    );
    console.log('  ✅ 429 Rate limit error mapping passed');

    // Test 12: Request cancellation via AbortSignal
    const abortController = new AbortController();
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise((_, reject) => {
        if (signal?.aborted) {
          reject(new Error('Aborted'));
          return;
        }
        signal?.addEventListener('abort', () => {
          reject(new Error('Aborted'));
        });
      });
    }) as typeof fetch;

    const chatPromise = provider.chat(normRequest, { signal: abortController.signal });
    abortController.abort();

    await assert.rejects(chatPromise, (err: unknown) => {
      return err instanceof ProviderError && err.code === 'PROVIDER_CANCELLED';
    });
    console.log('  ✅ Request cancellation via AbortSignal passed');

    // Test 13: Registry Integration via registerNineRouter
    const registry = new ProviderRegistry();
    const registeredInstance = registerNineRouter(registry, {
      apiKey: TEST_API_KEY,
      baseUrl: TEST_BASE_URL,
    });

    assert.equal(registry.has('9router'), true);
    assert.equal(registry.get('9router'), registeredInstance);
    console.log('  ✅ Registry integration via registerNineRouter passed');

    console.log('🎉 All 9Router Provider Adapter (P05-T03) Tests passed successfully!\n');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

if (process.argv[1]?.endsWith('9router.test.ts')) {
  void runNineRouterTests();
}
