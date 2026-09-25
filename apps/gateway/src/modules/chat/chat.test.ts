import assert from 'node:assert/strict';

import { UserRole, UserStatus } from '@baseapikey/database';
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
import { ProviderError, ProviderRegistry } from '@baseapikey/shared';

import { buildApp } from '../../app';
import { MockApiKeyRepository } from '../api-keys/testing/mock-api-key.repository';
import { PasswordService } from '../auth/services/password.service';
import { MockUserRepository } from '../auth/testing/auth-test-utils';
import { QuotaService } from '../quota/services/quota.service';
import { MockQuotaRepository } from '../quota/testing/mock-quota.repository';
import type { CreateUsageRecordDto } from '../usage/dto/usage.dto';
import type { IUsageRecorder } from '../usage/services/usage-recorder';

const createTestApiKey = (label: string): string => `sk_live_${label.padEnd(40, '0')}`;

class RecordingUsageRecorder implements IUsageRecorder {
  public readonly records: CreateUsageRecordDto[] = [];

  record(dto: CreateUsageRecordDto): void {
    this.records.push(dto);
  }
}

class MockChatProvider implements IProviderAdapter {
  public wasCancelled = false;

  constructor(
    private readonly slug = '9router',
    private readonly behavior: 'success' | 'error' = 'success',
    private readonly mockErr?: ProviderError,
    private readonly streamErrorTiming: 'before' | 'mid' = 'before',
  ) {}

  getName(): string {
    return this.slug;
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
    _options?: ProviderRequestOptions,
  ): Promise<ProviderResponse> {
    if (this.behavior === 'error' && this.mockErr) {
      throw this.mockErr;
    }

    return {
      id: 'chatcmpl-mock-123',
      object: 'chat.completion',
      created: 1700000000,
      model: request.model,
      provider: this.slug,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: `Mocked AI response for model ${request.model}`,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        promptTokens: 12,
        completionTokens: 8,
        totalTokens: 20,
      },
    };
  }

  async streamChat(
    request: ProviderRequest,
    options?: ProviderRequestOptions,
  ): Promise<AsyncIterable<ProviderStreamChunk>> {
    const isError = this.behavior === 'error';
    const timing = this.streamErrorTiming;
    const mockErr = this.mockErr;
    const slug = this.slug;

    if (options?.signal?.aborted) {
      this.wasCancelled = true;
    }

    options?.signal?.addEventListener('abort', () => {
      this.wasCancelled = true;
    });

    if (isError && timing === 'before' && mockErr) {
      throw mockErr;
    }

    return (async function* () {
      yield {
        id: 'chatcmpl-stream-123',
        object: 'chat.completion.chunk',
        created: 1700000000,
        model: request.model,
        provider: slug,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant' },
            finish_reason: null,
          },
        ],
      };

      if (isError && timing === 'mid' && mockErr) {
        throw mockErr;
      }

      yield {
        id: 'chatcmpl-stream-123',
        object: 'chat.completion.chunk',
        created: 1700000000,
        model: request.model,
        provider: slug,
        choices: [
          {
            index: 0,
            delta: { content: 'Hello streaming!' },
            finish_reason: null,
          },
        ],
      };

      yield {
        id: 'chatcmpl-stream-123',
        object: 'chat.completion.chunk',
        created: 1700000000,
        model: request.model,
        provider: slug,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
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

export async function runChatCompletionTests(): Promise<void> {
  console.log('🧪 Starting Chat Completions API (P05-T04 & P05-T05) Unit & Integration Tests...');

  const passwordService = new PasswordService();
  const userRepo = new MockUserRepository();
  const apiKeyRepo = new MockApiKeyRepository();
  const quotaRepo = new MockQuotaRepository();
  const quotaService = new QuotaService(quotaRepo);
  const usageRecorder = new RecordingUsageRecorder();

  const user = await userRepo.create({
    email: 'chat-test@example.com',
    username: 'chattester',
    fullName: 'Chat Tester',
    passwordHash: 'hash',
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
  });

  const validKeyPlaintext = createTestApiKey('valid-chat-key');
  const validKeyHash = await passwordService.hash(validKeyPlaintext);

  const noPermKeyPlaintext = createTestApiKey('no-permission-chat-key');
  const noPermKeyHash = await passwordService.hash(noPermKeyPlaintext);

  const revokedKeyPlaintext = createTestApiKey('revoked-chat-key');
  const revokedKeyHash = await passwordService.hash(revokedKeyPlaintext);

  const expiredKeyPlaintext = createTestApiKey('expired-chat-key');
  const expiredKeyHash = await passwordService.hash(expiredKeyPlaintext);

  // 1. Valid API Key with chat:completions permission
  await apiKeyRepo.createKey({
    id: 'key-chat-valid',
    userId: user.id,
    name: 'Valid Chat Key',
    keyHash: validKeyHash,
    keyPrefix: validKeyPlaintext.substring(0, 16),
    permissions: ['chat:completions', 'models:list'],
    expiresAt: null,
  });

  // 2. Key lacking chat:completions permission
  await apiKeyRepo.createKey({
    id: 'key-chat-noperm',
    userId: user.id,
    name: 'No Perm Chat Key',
    keyHash: noPermKeyHash,
    keyPrefix: noPermKeyPlaintext.substring(0, 16),
    permissions: ['models:list'],
    expiresAt: null,
  });

  // 3. Revoked Key
  const revokedKeyRecord = await apiKeyRepo.createKey({
    id: 'key-chat-revoked',
    userId: user.id,
    name: 'Revoked Chat Key',
    keyHash: revokedKeyHash,
    keyPrefix: revokedKeyPlaintext.substring(0, 16),
    permissions: ['chat:completions'],
    expiresAt: null,
  });
  await apiKeyRepo.revokeKey(revokedKeyRecord.id);

  // 4. Expired Key
  await apiKeyRepo.createKey({
    id: 'key-chat-expired',
    userId: user.id,
    name: 'Expired Chat Key',
    keyHash: expiredKeyHash,
    keyPrefix: expiredKeyPlaintext.substring(0, 16),
    permissions: ['chat:completions'],
    expiresAt: new Date(Date.now() - 3600000),
  });

  const registry = new ProviderRegistry();
  const mockProvider = new MockChatProvider('9router', 'success');
  registry.register(mockProvider);

  const app = buildApp({
    userRepository: userRepo,
    apiKeyRepository: apiKeyRepo,
    providerRegistry: registry,
    quotaService,
    usageRecorder,
  });

  await app.ready();

  try {
    // Test 1: Authentication - Missing API Key
    const resAuthMissing = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'llama-3.1-70b',
        messages: [{ role: 'user', content: 'Hi' }],
      },
    });
    assert.equal(resAuthMissing.statusCode, 401);
    assert.equal(JSON.parse(resAuthMissing.body).error.code, 'MISSING_API_KEY');
    console.log('  ✅ Missing API key rejected (401) passed');

    // Test 2: Authentication - Invalid API Key
    const resAuthInvalid = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${createTestApiKey('invalid-chat-key')}` },
      payload: {
        model: 'llama-3.1-70b',
        messages: [{ role: 'user', content: 'Hi' }],
      },
    });
    assert.equal(resAuthInvalid.statusCode, 401);
    assert.equal(JSON.parse(resAuthInvalid.body).error.code, 'INVALID_API_KEY');
    console.log('  ✅ Invalid API key rejected (401) passed');

    // Test 3: Authentication - Revoked API Key
    const resAuthRevoked = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${revokedKeyPlaintext}` },
      payload: {
        model: 'llama-3.1-70b',
        messages: [{ role: 'user', content: 'Hi' }],
      },
    });
    assert.equal(resAuthRevoked.statusCode, 401);
    assert.equal(JSON.parse(resAuthRevoked.body).error.code, 'API_KEY_REVOKED');
    console.log('  ✅ Revoked API key rejected (401) passed');

    // Test 4: Authentication - Expired API Key
    const resAuthExpired = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${expiredKeyPlaintext}` },
      payload: {
        model: 'llama-3.1-70b',
        messages: [{ role: 'user', content: 'Hi' }],
      },
    });
    assert.equal(resAuthExpired.statusCode, 401);
    assert.equal(JSON.parse(resAuthExpired.body).error.code, 'API_KEY_EXPIRED');
    console.log('  ✅ Expired API key rejected (401) passed');

    // Test 5: Permission - Missing chat:completions permission
    const resNoPerm = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${noPermKeyPlaintext}` },
      payload: {
        model: 'llama-3.1-70b',
        messages: [{ role: 'user', content: 'Hi' }],
      },
    });
    assert.equal(resNoPerm.statusCode, 403);
    assert.equal(JSON.parse(resNoPerm.body).error.code, 'API_KEY_PERMISSION_DENIED');
    console.log('  ✅ Missing chat:completions permission rejected (403) passed');

    // Test 6: Validation - Missing model
    const resValNoModel = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${validKeyPlaintext}` },
      payload: {
        messages: [{ role: 'user', content: 'Hi' }],
      },
    });
    assert.equal(resValNoModel.statusCode, 400);
    assert.equal(JSON.parse(resValNoModel.body).error.code, 'VALIDATION_ERROR');
    console.log('  ✅ Missing model validation failure (400) passed');

    // Test 7: Validation - Empty messages array
    const resValEmptyMsg = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${validKeyPlaintext}` },
      payload: {
        model: 'llama-3.1-70b',
        messages: [],
      },
    });
    assert.equal(resValEmptyMsg.statusCode, 400);
    assert.equal(JSON.parse(resValEmptyMsg.body).error.code, 'VALIDATION_ERROR');
    console.log('  ✅ Empty messages validation failure (400) passed');

    // Test 8: Validation - Invalid message role
    const resValRole = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${validKeyPlaintext}` },
      payload: {
        model: 'llama-3.1-70b',
        messages: [{ role: 'invalid-role', content: 'Hi' }],
      },
    });
    assert.equal(resValRole.statusCode, 400);
    assert.equal(JSON.parse(resValRole.body).error.code, 'VALIDATION_ERROR');
    console.log('  ✅ Invalid message role validation failure (400) passed');

    // Test 9: Non-Streaming Chat Completion
    const resNonStream = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${validKeyPlaintext}` },
      payload: {
        model: 'llama-3.1-70b',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Explain quantum computing' },
        ],
        temperature: 0.7,
        max_tokens: 200,
        stream: false,
      },
    });

    assert.equal(resNonStream.statusCode, 200);
    const bodyNonStream = JSON.parse(resNonStream.body);
    assert.equal(bodyNonStream.object, 'chat.completion');
    assert.equal(bodyNonStream.model, 'llama-3.1-70b');
    assert.equal(bodyNonStream.choices.length, 1);
    assert.equal(bodyNonStream.choices[0].message.role, 'assistant');
    assert.equal(bodyNonStream.choices[0].finish_reason, 'stop');
    assert.equal(bodyNonStream.usage.prompt_tokens, 12);
    assert.equal(bodyNonStream.usage.completion_tokens, 8);
    assert.equal(bodyNonStream.usage.total_tokens, 20);
    const nonStreamUsage = usageRecorder.records.at(-1);
    assert.equal(nonStreamUsage?.provider, '9router');
    assert.equal(nonStreamUsage?.model, 'llama-3.1-70b');
    assert.equal(nonStreamUsage?.totalTokens, 20);
    console.log('  ✅ Non-Streaming Chat Completion request & response mapping passed');

    // --- P05-T05: Streaming (SSE) Tests ---

    // Test 10: Successful SSE Streaming Response
    const resStream = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${validKeyPlaintext}` },
      payload: {
        model: 'llama-3.1-70b',
        messages: [{ role: 'user', content: 'Tell me a story' }],
        stream: true,
      },
    });

    assert.equal(resStream.statusCode, 200);
    assert.equal(resStream.headers['content-type'], 'text/event-stream');
    assert.equal(resStream.headers['cache-control'], 'no-cache');
    assert.equal(resStream.headers['connection'], 'keep-alive');

    const streamBody = resStream.body;
    assert.equal(streamBody.includes('data: [DONE]'), true);

    // Verify [DONE] is sent exactly once
    const doneMatches = streamBody.match(/data: \[DONE\]/g);
    assert.equal(doneMatches?.length, 1);

    // Parse SSE chunks
    const lines = streamBody.split('\n\n').filter((l) => l.trim().startsWith('data: '));
    assert.equal(lines.length, 4); // 3 data chunks + 1 [DONE]

    const chunk1 = JSON.parse(lines[0]!.replace('data: ', ''));
    assert.equal(chunk1.object, 'chat.completion.chunk');
    assert.equal(chunk1.choices[0].delta.role, 'assistant');

    const chunk2 = JSON.parse(lines[1]!.replace('data: ', ''));
    assert.equal(chunk2.choices[0].delta.content, 'Hello streaming!');

    const chunk3 = JSON.parse(lines[2]!.replace('data: ', ''));
    assert.equal(chunk3.choices[0].finish_reason, 'stop');
    assert.equal(chunk3.usage.prompt_tokens, 10);

    const streamUsage = usageRecorder.records.at(-1);
    assert.equal(streamUsage?.provider, '9router');
    assert.equal(streamUsage?.model, 'llama-3.1-70b');
    assert.equal(streamUsage?.totalTokens, 15);

    const quotaAfterCompletions = await quotaRepo.findByApiKeyId('key-chat-valid');
    assert.equal(quotaAfterCompletions?.currentTokensDay, 35);

    console.log('  ✅ SSE streaming, usage tracking, and token quota accounting passed');

    // Test 11: Runtime quota middleware blocks requests on the real chat route.
    const limitingQuotaRepo = new MockQuotaRepository();
    const limitingQuota = await limitingQuotaRepo.createQuota({
      apiKeyId: 'key-chat-valid',
      requestsPerMinute: 1,
    });
    await limitingQuotaRepo.updateCounters(limitingQuota.apiKeyId, {
      requestsMinute: 1,
    });
    const appQuotaBlocked = buildApp({
      userRepository: userRepo,
      apiKeyRepository: apiKeyRepo,
      providerRegistry: registry,
      quotaService: new QuotaService(limitingQuotaRepo),
      usageRecorder: new RecordingUsageRecorder(),
    });
    await appQuotaBlocked.ready();
    try {
      const resQuotaBlocked = await appQuotaBlocked.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { authorization: `Bearer ${validKeyPlaintext}` },
        payload: {
          model: 'llama-3.1-70b',
          messages: [{ role: 'user', content: 'Hi' }],
        },
      });
      assert.equal(resQuotaBlocked.statusCode, 429);
      assert.equal(JSON.parse(resQuotaBlocked.body).error.code, 'RATE_LIMIT_EXCEEDED');
    } finally {
      await appQuotaBlocked.close();
    }
    console.log('  ✅ Runtime chat quota enforcement passed');

    // Test 12: Provider Error BEFORE Streaming Starts (HTTP status error response)
    const errRegistryBefore = new ProviderRegistry();
    errRegistryBefore.register(
      new MockChatProvider(
        '9router',
        'error',
        ProviderError.fromHttpStatus(429, 'Rate limit exceeded', '9router'),
        'before',
      ),
    );
    const appErrBefore = buildApp({
      userRepository: userRepo,
      apiKeyRepository: apiKeyRepo,
      providerRegistry: errRegistryBefore,
      quotaService,
      usageRecorder,
    });
    await appErrBefore.ready();

    const resErrBefore = await appErrBefore.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${validKeyPlaintext}` },
      payload: {
        model: 'llama-3.1-70b',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      },
    });
    assert.equal(resErrBefore.statusCode, 429);
    assert.equal(JSON.parse(resErrBefore.body).error.code, 'PROVIDER_RATE_LIMIT');
    console.log('  ✅ Provider stream error before first chunk returns HTTP status passed');

    // Test 13: Provider Error MID Streaming (SSE error event formatted)
    const errRegistryMid = new ProviderRegistry();
    errRegistryMid.register(
      new MockChatProvider(
        '9router',
        'error',
        ProviderError.fromHttpStatus(502, 'Bad gateway mid stream', '9router'),
        'mid',
      ),
    );
    const appErrMid = buildApp({
      userRepository: userRepo,
      apiKeyRepository: apiKeyRepo,
      providerRegistry: errRegistryMid,
      quotaService,
      usageRecorder,
    });
    await appErrMid.ready();

    const resErrMid = await appErrMid.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${validKeyPlaintext}` },
      payload: {
        model: 'llama-3.1-70b',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      },
    });
    assert.equal(resErrMid.statusCode, 200);
    assert.equal(resErrMid.headers['content-type'], 'text/event-stream');
    assert.equal(resErrMid.body.includes('Bad gateway mid stream'), true);
    assert.equal(
      resErrMid.body.includes('PROVIDER_UNAVAILABLE') || resErrMid.body.includes('STREAM_ERROR'),
      true,
    );
    console.log('  ✅ Provider stream error mid-stream returns SSE error chunk passed');

    // Test 14: Security Verification - API Key is never exposed in SSE stream or errors
    assert.equal(resStream.body.includes(validKeyPlaintext), false);
    assert.equal(resErrBefore.body.includes(validKeyPlaintext), false);
    assert.equal(resErrMid.body.includes(validKeyPlaintext), false);
    console.log('  ✅ Security verification: API key is never exposed in SSE stream passed');

    console.log('🎉 All Chat Completions API (P05-T04 & P05-T05) Tests passed successfully!\n');
  } finally {
    await app.close();
  }
}

if (process.argv[1]?.endsWith('chat.test.ts')) {
  void runChatCompletionTests();
}
