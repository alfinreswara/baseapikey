import assert from 'node:assert/strict';

import { UserRole, UserStatus } from '@baseapikey/database';
import { AppError } from '@baseapikey/shared';
import fastify, { LogController } from 'fastify';

import { authenticateApiKey } from '../api-keys/middleware/api-key-auth.middleware';
import { API_KEY_PERMISSIONS } from '../api-keys/permissions/permission.constants';
import { requireApiKeyPermission } from '../api-keys/permissions/permission.middleware';
import { MockApiKeyRepository } from '../api-keys/testing/mock-api-key.repository';
import { generateApiKey } from '../api-keys/utils/api-key-generator.util';
import { PasswordService } from '../auth/services/password.service';
import { MockUserRepository } from '../auth/testing/auth-test-utils';

import { registerUsageTrackingHook } from './middleware/usage.middleware';
import { AsyncUsageRecorder } from './services/usage-recorder';
import { UsageTrackingService } from './services/usage-tracking.service';
import { MockUsageRepository } from './testing/mock-usage.repository';

export async function runUsageTrackingTests(): Promise<void> {
  console.log('🧪 Starting API Key Usage Tracking (P04-T07) Unit & Integration Tests...');

  const mockUserRepo = new MockUserRepository();
  const mockApiKeyRepo = new MockApiKeyRepository();
  const mockUsageRepo = new MockUsageRepository();

  const passwordService = new PasswordService();

  const usageService = new UsageTrackingService(mockUsageRepo, mockApiKeyRepo);
  const usageRecorder = new AsyncUsageRecorder(usageService);

  // Setup event listener to capture asynchronous events
  let recordedEventCount = 0;
  usageRecorder.onEvent((_evt) => {
    recordedEventCount++;
  });

  // Create User
  const user = await mockUserRepo.create({
    email: 'usageuser@example.com',
    username: 'usageuser',
    fullName: 'Usage User',
    passwordHash: await passwordService.hash('Password123!'),
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
  });

  // Create API Key for User
  const { plaintextKey, keyPrefix } = generateApiKey();
  const keyHash = await passwordService.hash(plaintextKey);

  const apiKeyRecord = await mockApiKeyRepo.createKey({
    userId: user.id,
    name: 'Tracking Test Key',
    keyHash,
    keyPrefix,
    permissions: [API_KEY_PERMISSIONS.CHAT_COMPLETIONS],
  });

  // Initialize Fastify app
  const app = fastify({ logController: new LogController({ disableRequestLogging: true }) });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      void reply.status(error.statusCode).send(error.toJSON());
      return;
    }
    void reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Internal server error',
      },
    });
  });

  // Register usage tracking hook
  registerUsageTrackingHook(app, usageRecorder);

  // Protected Gateway route requiring API Key auth & chat:completions permission
  const apiKeyAuthMiddleware = authenticateApiKey(mockApiKeyRepo, mockUserRepo, passwordService);

  app.post(
    '/v1/chat/completions',
    {
      preHandler: [
        apiKeyAuthMiddleware,
        requireApiKeyPermission(API_KEY_PERMISSIONS.CHAT_COMPLETIONS),
      ],
    },
    async (req, reply) => {
      // Attach mock AI usage metadata to request context
      req.usageMetadata = {
        provider: 'openai',
        model: 'gpt-4o',
        promptTokens: 50,
        completionTokens: 25,
        totalTokens: 75,
        estimatedCost: 0.0015,
      };

      void reply.status(200).send({
        id: 'chatcmpl-123',
        object: 'chat.completion',
        choices: [{ message: { role: 'assistant', content: 'Hello World' } }],
      });
    },
  );

  // Route that throws permission error (HTTP 403)
  app.post(
    '/v1/embeddings',
    {
      preHandler: [
        apiKeyAuthMiddleware,
        requireApiKeyPermission(API_KEY_PERMISSIONS.EMBEDDINGS_CREATE),
      ],
    },
    async (_req, reply) => {
      void reply.status(200).send({ success: true });
    },
  );

  await app.ready();

  // ===========================================================================
  // 1. Successful Request Usage Recording (HTTP 200)
  // ===========================================================================
  {
    const initialLastUsedAt = apiKeyRecord.lastUsedAt;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: `Bearer ${plaintextKey}`,
      },
      payload: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Say hello' }],
      },
    });

    assert.equal(res.statusCode, 200);

    // Wait briefly for setImmediate background usage recording to finish
    await new Promise((resolve) => setTimeout(resolve, 50));

    const records = await mockUsageRepo.findByApiKeyId(apiKeyRecord.id);
    assert.equal(records.length, 1, 'Usage repository must contain 1 record');

    const rec = records[0];
    assert.ok(rec);
    assert.equal(rec.userId, user.id);
    assert.equal(rec.apiKeyId, apiKeyRecord.id);
    assert.equal(rec.provider, 'openai');
    assert.equal(rec.model, 'gpt-4o');
    assert.equal(rec.endpoint, '/v1/chat/completions');
    assert.equal(rec.promptTokens, 50);
    assert.equal(rec.completionTokens, 25);
    assert.equal(rec.totalTokens, 75);
    assert.equal(rec.estimatedCost, 0.0015);
    assert.equal(rec.statusCode, 200);
    assert.ok(rec.latencyMs >= 0);

    // Verify ApiKey.lastUsedAt updated
    const dbKey = await mockApiKeyRepo.findById(apiKeyRecord.id);
    assert.ok(dbKey?.lastUsedAt);
    assert.notEqual(dbKey?.lastUsedAt, initialLastUsedAt);

    console.log('  ✅ Successful request usage recording & lastUsedAt update passed');
  }

  // ===========================================================================
  // 2. Failed Request Usage Recording (HTTP 403 Permission Denied)
  // ===========================================================================
  {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/embeddings',
      headers: {
        authorization: `Bearer ${plaintextKey}`,
      },
      payload: {
        input: 'Test string',
      },
    });

    assert.equal(res.statusCode, 403);

    // Wait briefly for setImmediate background usage recording
    await new Promise((resolve) => setTimeout(resolve, 50));

    const records = await mockUsageRepo.findByApiKeyId(apiKeyRecord.id);
    assert.equal(records.length, 2, 'Usage repository must now contain 2 records');

    const failedRec = records.find((r) => r.statusCode === 403);
    assert.ok(failedRec, 'Failed request must be recorded in Usage Repository');
    assert.equal(failedRec.userId, user.id);
    assert.equal(failedRec.apiKeyId, apiKeyRecord.id);
    assert.equal(failedRec.statusCode, 403);

    console.log('  ✅ Failed request usage recording (HTTP 403) passed');
  }

  // ===========================================================================
  // 3. UsageTrackingService & AsyncRecorder Event Verification
  // ===========================================================================
  {
    assert.equal(recordedEventCount, 2, 'AsyncUsageRecorder must have emitted 2 events');

    const userUsage = await usageService.getUsageByUserId(user.id);
    assert.equal(userUsage.length, 2);
    assert.equal(userUsage[0]?.status, 'FAILED');
    assert.equal(userUsage[1]?.status, 'SUCCESS');

    console.log('  ✅ UsageTrackingService querying & Event notification passed');
  }

  console.log('🎉 All API Key Usage Tracking (P04-T07) Tests passed successfully!\n');
}

if (process.argv[1]?.endsWith('usage-tracking.test.ts')) {
  void runUsageTrackingTests();
}
