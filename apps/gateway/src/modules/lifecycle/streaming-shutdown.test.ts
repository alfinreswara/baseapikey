import assert from 'node:assert/strict';

import { UserRole, UserStatus } from '@baseapikey/database';
import {
  ProviderError,
  ProviderRegistry,
  type IProviderAdapter,
  type ProviderCapabilities,
  type ProviderHealthStatus,
  type ProviderModel,
  type ProviderRequest,
  type ProviderRequestOptions,
  type ProviderResponse,
  type ProviderStreamChunk,
} from '@baseapikey/shared';

import { buildApp } from '../../app';
import { MockApiKeyRepository } from '../api-keys/testing/mock-api-key.repository';
import { PasswordService } from '../auth/services/password.service';
import { MockUserRepository } from '../auth/testing/auth-test-utils';
import { HealthService } from '../health/health.service';
import { QuotaService } from '../quota/services/quota.service';
import { MockQuotaRepository } from '../quota/testing/mock-quota.repository';

import { ServiceLifecycle } from './service-lifecycle';
import { ShutdownCoordinator } from './shutdown';

const API_KEY = 'sk_live_streaming_shutdown_key_0000000000000000';
const PASSWORD_SERVICE = new PasswordService();

/**
 * Provider whose stream either ends after two chunks or never ends and only
 * reacts to the abort signal, like a real upstream that stops responding.
 */
class StreamProvider implements IProviderAdapter {
  public abortObserved = false;
  public readonly chatStarted: Promise<void>;
  public readonly streamStarted: Promise<void>;
  private resolveChatStarted!: () => void;
  private resolveStreamStarted!: () => void;

  constructor(private readonly mode: 'finite' | 'endless') {
    this.chatStarted = new Promise<void>((resolve) => {
      this.resolveChatStarted = resolve;
    });
    this.streamStarted = new Promise<void>((resolve) => {
      this.resolveStreamStarted = resolve;
    });
  }

  getName(): string {
    return '9router';
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsChat: true,
      supportsStreaming: true,
      supportsModels: true,
    };
  }

  async chat(
    request: ProviderRequest,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResponse> {
    this.resolveChatStarted();
    if (options?.signal?.aborted) {
      // A request that was aborted before the provider was called would fail
      // in production. The abort must only happen on a real disconnect.
      throw new Error('The provider request was aborted before it started');
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
    return {
      id: 'chatcmpl-stream-shutdown',
      object: 'chat.completion',
      created: 1700000000,
      model: request.model,
      provider: this.getName(),
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'done' },
          finish_reason: 'stop',
        },
      ],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    };
  }

  async chatCompletion(
    request: ProviderRequest,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResponse | AsyncIterable<ProviderStreamChunk>> {
    return this.chat(request, options);
  }

  async listModels(_options?: ProviderRequestOptions): Promise<ProviderModel[]> {
    return [
      {
        id: 'demo',
        object: 'model',
        created: 1700000000,
        owned_by: this.getName(),
        provider: this.getName(),
        context_length: 8_000,
      },
    ];
  }

  async healthCheck(_options?: ProviderRequestOptions): Promise<ProviderHealthStatus> {
    return { status: 'healthy', provider: this.getName(), checkedAt: new Date() };
  }

  async streamChat(
    request: ProviderRequest,
    options?: ProviderRequestOptions,
  ): Promise<AsyncIterable<ProviderStreamChunk>> {
    const signal = options?.signal;
    const mode = this.mode;
    const slug = this.getName();
    const markStreamStarted = this.resolveStreamStarted;
    const markAborted = () => {
      this.abortObserved = true;
    };

    if (signal) {
      signal.addEventListener('abort', markAborted, { once: true });
    }

    return (async function* () {
      markStreamStarted();
      yield {
        id: 'chatcmpl-stream-shutdown',
        object: 'chat.completion.chunk',
        created: 1700000000,
        model: request.model,
        provider: slug,
        choices: [
          { index: 0, delta: { role: 'assistant', content: 'first' }, finish_reason: null },
        ],
      };

      if (mode === 'finite') {
        yield {
          id: 'chatcmpl-stream-shutdown',
          object: 'chat.completion.chunk',
          created: 1700000000,
          model: request.model,
          provider: slug,
          choices: [{ index: 0, delta: { content: 'second' }, finish_reason: 'stop' }],
        };
        return;
      }

      // The upstream never answers again. Only the abort signal ends the
      // stream, exactly like a hanging provider connection.
      await new Promise<void>((resolve) => {
        if (signal?.aborted) {
          resolve();
          return;
        }
        signal?.addEventListener(
          'abort',
          () => {
            resolve();
          },
          { once: true },
        );
      });

      throw new ProviderError({
        code: 'PROVIDER_STREAM_ABORTED',
        message: 'The provider stream was aborted',
        statusCode: 499,
        category: 'TIMEOUT',
        isRetryable: false,
        providerSlug: slug,
      });
    })();
  }
}

interface TestContext {
  url: string;
  lifecycle: ServiceLifecycle;
  healthService: HealthService;
  provider: StreamProvider;
  close: () => Promise<void>;
}

async function startGateway(mode: 'finite' | 'endless'): Promise<TestContext> {
  const userRepo = new MockUserRepository();
  const apiKeyRepo = new MockApiKeyRepository();
  const lifecycle = new ServiceLifecycle();
  const healthService = new HealthService('gateway', '0.1.0', 'test');

  const user = await userRepo.create({
    email: 'stream-shutdown@example.com',
    username: 'streamuser',
    fullName: 'Stream User',
    passwordHash: 'hash',
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
  });

  await apiKeyRepo.createKey({
    id: 'key-stream-shutdown',
    userId: user.id,
    name: 'Stream Shutdown Key',
    keyHash: await PASSWORD_SERVICE.hash(API_KEY),
    keyPrefix: API_KEY.substring(0, 16),
    permissions: ['chat:completions'],
    expiresAt: null,
  });

  const provider = new StreamProvider(mode);
  const registry = new ProviderRegistry();
  registry.register(provider);

  const app = buildApp({
    userRepository: userRepo,
    apiKeyRepository: apiKeyRepo,
    providerRegistry: registry,
    healthService,
    lifecycle,
    quotaService: new QuotaService(new MockQuotaRepository()),
    usageRecorder: { record: () => undefined },
  });

  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    lifecycle,
    healthService,
    provider,
    close: async () => {
      await app.close();
    },
  };
}

function createCoordinator(
  context: Pick<TestContext, 'lifecycle' | 'healthService'>,
  options: { drainDelayMs: number; timeoutMs: number } & {
    onTimeout?: () => void;
    closeServer?: () => Promise<void>;
  },
): ShutdownCoordinator {
  return new ShutdownCoordinator({
    hooks: {
      markNotReady: () => {
        context.lifecycle.beginDrain();
        context.healthService.markShuttingDown();
      },
      stopBackgroundWork: async () => undefined,
      closeServer: options.closeServer ?? (async () => undefined),
      closeResources: async () => undefined,
      abortInFlightRequests: () => context.lifecycle.abortInFlight('Gateway is shutting down'),
    },
    drainDelayMs: options.drainDelayMs,
    timeoutMs: options.timeoutMs,
    forceGraceMs: 500,
    resourceReserveMs: 1_000,
    logger: { info: () => undefined, error: () => undefined },
    ...(options.onTimeout ? { onTimeout: options.onTimeout } : {}),
  });
}

async function readSseStream(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let body = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    body += decoder.decode(value, { stream: true });
  }
  return body;
}

async function runStreamingShutdownTests(): Promise<void> {
  console.log('🧪 Starting Streaming Shutdown Tests...');

  // 1. New requests are rejected while the instance drains, the health
  //    endpoints stay reachable.
  {
    const context = await startGateway('finite');
    try {
      const coordinator = createCoordinator(context, {
        drainDelayMs: 300,
        timeoutMs: 2_000,
      });
      const shutdown = coordinator.shutdown('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 50));
      const rejected = await fetch(`${context.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ model: 'demo', messages: [{ role: 'user', content: 'hi' }] }),
      });
      assert.equal(rejected.status, 503);
      const rejectedBody = (await rejected.json()) as { error?: { code?: string } };
      assert.equal(rejectedBody.error?.code, 'SERVER_SHUTTING_DOWN');

      const live = await fetch(`${context.url}/health/live`);
      assert.equal(live.status, 200);
      const ready = await fetch(`${context.url}/health/ready`);
      assert.equal(ready.status, 503);
      const shutdownResult = await shutdown;
      assert.equal(shutdownResult.status, 'clean');
      console.log('  ✅ New requests are rejected with 503 while the instance drains');
    } finally {
      await context.close();
    }
  }

  // 2. A request that is already running finishes normally.
  {
    const context = await startGateway('finite');
    try {
      const inFlight = fetch(`${context.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ model: 'demo', messages: [{ role: 'user', content: 'hi' }] }),
      });

      await context.provider.chatStarted;
      const coordinator = createCoordinator(context, {
        drainDelayMs: 300,
        timeoutMs: 2_000,
      });
      const shutdown = coordinator.shutdown('SIGTERM');
      const response = await inFlight;
      assert.equal(response.status, 200);
      const result = await shutdown;
      assert.equal(result.status, 'clean');
      console.log('  ✅ A request that is already running finishes during the drain');
    } finally {
      await context.close();
    }
  }

  // 3. A stream that ends before the deadline closes normally.
  {
    const context = await startGateway('finite');
    try {
      const response = await fetch(`${context.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({
          model: 'demo',
          messages: [{ role: 'user', content: 'hi' }],
          stream: true,
        }),
      });
      assert.equal(response.status, 200);
      const body = await readSseStream(response);
      assert.match(body, /data: \[DONE\]/);
      console.log('  ✅ A stream that ends before the deadline closes with the DONE event');
    } finally {
      await context.close();
    }
  }

  // 4. A stream that never ends is terminated deterministically: the shutdown
  //    aborts the upstream request, the stream ends with an error event, and
  //    the process does not wait forever.
  {
    const context = await startGateway('endless');
    try {
      const response = await fetch(`${context.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({
          model: 'demo',
          messages: [{ role: 'user', content: 'hi' }],
          stream: true,
        }),
      });
      assert.equal(response.status, 200);

      const streamEnded = readSseStream(response);
      await context.provider.streamStarted;

      const started = Date.now();
      const coordinator = createCoordinator(context, {
        drainDelayMs: 100,
        timeoutMs: 3_000,
        closeServer: () =>
          new Promise<void>((resolve) => {
            // The HTTP server only closes when the response ended.
            void streamEnded.then(() => resolve());
          }),
      });
      const result = await coordinator.shutdown('SIGTERM');
      const elapsed = Date.now() - started;

      assert.equal(result.status, 'forced');
      assert.equal(context.lifecycle.signal.aborted, true);
      assert.ok(elapsed < 5_000, `The shutdown must not wait forever, took ${elapsed}ms`);

      const body = await streamEnded;
      assert.match(body, /STREAM_ERROR|PROVIDER_STREAM_ABORTED/);
      assert.doesNotMatch(body, /data: \[DONE\]/);
      console.log('  ✅ A stream that never ends is aborted and ends with an error event');
    } finally {
      await context.close();
    }
  }

  // 5. A non-streaming request over a real connection reaches the provider
  //    without being aborted, and a client disconnect aborts the upstream
  //    request of a running stream.
  {
    const context = await startGateway('finite');
    try {
      const response = await fetch(`${context.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ model: 'demo', messages: [{ role: 'user', content: 'hi' }] }),
      });
      assert.equal(response.status, 200);
      const payload = (await response.json()) as { choices?: unknown[] };
      assert.equal(Array.isArray(payload.choices), true);
      console.log('  ✅ A non-streaming request is not aborted by the consumed request body');
    } finally {
      await context.close();
    }
  }

  {
    const context = await startGateway('endless');
    try {
      const controller = new AbortController();
      const pending = fetch(`${context.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({
          model: 'demo',
          messages: [{ role: 'user', content: 'hi' }],
          stream: true,
        }),
        signal: controller.signal,
      });
      await context.provider.streamStarted;
      controller.abort();
      await pending.catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(context.provider.abortObserved, true);
      console.log('  ✅ A client disconnect aborts the upstream request of the stream');
    } finally {
      await context.close();
    }
  }

  // 6. An unresponsive dependency does not make the shutdown wait forever.
  {
    const lifecycle = new ServiceLifecycle();
    let forced = false;
    const coordinator = new ShutdownCoordinator({
      hooks: {
        markNotReady: () => lifecycle.beginDrain(),
        stopBackgroundWork: () => new Promise<void>(() => undefined),
        closeServer: async () => undefined,
        closeResources: async () => undefined,
        abortInFlightRequests: () => lifecycle.abortInFlight('Gateway is shutting down'),
      },
      drainDelayMs: 50,
      timeoutMs: 2_000,
      forceGraceMs: 100,
      resourceReserveMs: 500,
      logger: { info: () => undefined, error: () => undefined },
      onTimeout: () => {
        forced = true;
      },
    });

    const started = Date.now();
    const result = await coordinator.shutdown('SIGTERM');
    const elapsed = Date.now() - started;

    assert.equal(result.status, 'forced');
    assert.equal(forced, false, 'The shutdown must finish before the forced exit');
    assert.ok(elapsed < 2_000, `The shutdown must not wait for the worker, took ${elapsed}ms`);
    console.log('  ✅ An unresponsive background worker does not block the shutdown');
  }

  console.log('🎉 All Streaming Shutdown Tests passed successfully!\n');
}

if (process.argv[1]?.endsWith('streaming-shutdown.test.ts')) {
  void runStreamingShutdownTests();
}
