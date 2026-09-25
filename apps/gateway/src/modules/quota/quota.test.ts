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

import { MonthlyBudgetExceededError, TokenQuotaExceededError } from './errors/quota.errors';
import { requireQuota } from './middleware/quota.middleware';
import { QuotaValidator } from './quota.validator';
import { QuotaService } from './services/quota.service';
import { MockQuotaRepository } from './testing/mock-quota.repository';

export async function runQuotaTests(): Promise<void> {
  console.log('🧪 Starting API Key Quotas & Limits (P04-T08) Unit & Integration Tests...');

  const mockUserRepo = new MockUserRepository();
  const mockApiKeyRepo = new MockApiKeyRepository();
  const mockQuotaRepo = new MockQuotaRepository();
  const passwordService = new PasswordService();

  const quotaService = new QuotaService(mockQuotaRepo);

  // Create User
  const user = await mockUserRepo.create({
    email: 'quotauser@example.com',
    username: 'quotauser',
    fullName: 'Quota User',
    passwordHash: await passwordService.hash('Password123!'),
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
  });

  // Create API Key for User
  const { plaintextKey, keyPrefix } = generateApiKey();
  const keyHash = await passwordService.hash(plaintextKey);

  const apiKeyRecord = await mockApiKeyRepo.createKey({
    userId: user.id,
    name: 'Quota Test Key',
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

  // Protected route with API Key Authentication and Quota middleware
  const apiKeyAuthMiddleware = authenticateApiKey(mockApiKeyRepo, mockUserRepo, passwordService);

  app.post(
    '/v1/chat/completions',
    {
      preHandler: [
        apiKeyAuthMiddleware,
        requireApiKeyPermission(API_KEY_PERMISSIONS.CHAT_COMPLETIONS),
        requireQuota(quotaService),
      ],
    },
    async (_req, reply) => {
      void reply.status(200).send({ success: true, message: 'Request allowed by quota' });
    },
  );

  await app.ready();

  // ===========================================================================
  // 1. Default Quota Initialization & Initial Request
  // ===========================================================================
  {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: `Bearer ${plaintextKey}`,
      },
      payload: { model: 'gpt-4o' },
    });

    assert.equal(res.statusCode, 200);

    const q = await quotaService.getOrCreateQuota(apiKeyRecord.id);
    assert.equal(q.requestsPerMinute, 60);
    assert.equal(q.requestsPerDay, 10000);
    assert.equal(q.tokensPerDay, 5000000);
    assert.equal(q.monthlyBudgetUsd, 100);
    assert.equal(q.currentRequestsMinute, 1);
    assert.equal(q.currentRequestsDay, 1);

    console.log('  ✅ Default quota initialization & first request passed');
  }

  // ===========================================================================
  // 2. Requests Per Minute Limit Enforcement (HTTP 429)
  // ===========================================================================
  {
    // Set requestsPerMinute limit to 2 for testing
    await mockQuotaRepo.updateQuota(apiKeyRecord.id, { requestsPerMinute: 2 });

    // Request 2 (allowed)
    const res2 = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: `Bearer ${plaintextKey}`,
      },
    });
    assert.equal(res2.statusCode, 200);

    // Request 3 (exceeds limit 2/min -> HTTP 429)
    const res3 = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: `Bearer ${plaintextKey}`,
      },
    });
    assert.equal(res3.statusCode, 429, 'Exceeding requests per minute must return 429');
    const json3 = JSON.parse(res3.payload);
    assert.equal(json3.error.code, 'RATE_LIMIT_EXCEEDED');

    // Restore limit
    await mockQuotaRepo.updateQuota(apiKeyRecord.id, { requestsPerMinute: 60 });
    console.log('  ✅ Requests per minute limit enforcement (HTTP 429) passed');
  }

  // ===========================================================================
  // 3. Requests Per Day Limit Enforcement (HTTP 429)
  // ===========================================================================
  {
    await mockQuotaRepo.updateQuota(apiKeyRecord.id, { requestsPerDay: 2 });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: `Bearer ${plaintextKey}`,
      },
    });

    assert.equal(res.statusCode, 429, 'Exceeding requests per day must return 429');
    const json = JSON.parse(res.payload);
    assert.equal(json.error.code, 'DAILY_LIMIT_EXCEEDED');

    // Restore limit
    await mockQuotaRepo.updateQuota(apiKeyRecord.id, { requestsPerDay: 10000 });
    console.log('  ✅ Requests per day limit enforcement (HTTP 429) passed');
  }

  // ===========================================================================
  // 4. Tokens Per Day Limit Enforcement (HTTP 429)
  // ===========================================================================
  {
    await mockQuotaRepo.updateQuota(apiKeyRecord.id, { tokensPerDay: 1000 });
    await quotaService.recordUsageQuota(apiKeyRecord.id, 0, 950, 0);

    await assert.rejects(
      async () => {
        await quotaService.checkAndEnforceQuota(apiKeyRecord.id, 100, 0);
      },
      TokenQuotaExceededError,
      'Exceeding token limit must throw TokenQuotaExceededError',
    );

    // Restore limit
    await mockQuotaRepo.updateQuota(apiKeyRecord.id, { tokensPerDay: 5000000 });
    console.log('  ✅ Tokens per day limit enforcement (TokenQuotaExceededError) passed');
  }

  // ===========================================================================
  // 5. Monthly Budget Limit Enforcement (HTTP 429)
  // ===========================================================================
  {
    await mockQuotaRepo.updateQuota(apiKeyRecord.id, { monthlyBudgetUsd: 50.0 });
    await quotaService.recordUsageQuota(apiKeyRecord.id, 0, 0, 49.5);

    await assert.rejects(
      async () => {
        await quotaService.checkAndEnforceQuota(apiKeyRecord.id, 0, 1.0);
      },
      MonthlyBudgetExceededError,
      'Exceeding monthly budget must throw MonthlyBudgetExceededError',
    );

    // Restore limit
    await mockQuotaRepo.updateQuota(apiKeyRecord.id, { monthlyBudgetUsd: 100.0 });
    console.log('  ✅ Monthly budget limit enforcement (MonthlyBudgetExceededError) passed');
  }

  // ===========================================================================
  // 6. Quota Reset Logic Test
  // ===========================================================================
  {
    await mockQuotaRepo.updateQuota(apiKeyRecord.id, { requestsPerMinute: 1 });

    // Manually set resetMinuteAt to 2 minutes in the past
    const record = await mockQuotaRepo.findByApiKeyId(apiKeyRecord.id);
    assert.ok(record);
    record.resetMinuteAt = new Date(Date.now() - 120000);

    // Check quota (triggers minute reset)
    const refreshedQuota = await quotaService.checkAndEnforceQuota(apiKeyRecord.id);
    assert.equal(refreshedQuota.currentRequestsMinute, 0, 'Minute counter must reset to 0');

    console.log('  ✅ Minute counter reset logic passed');
  }

  // ===========================================================================
  // 7. QuotaValidator Unit Tests
  // ===========================================================================
  {
    assert.throws(() => {
      QuotaValidator.validateCreate({
        apiKeyId: '00000000-0000-0000-0000-000000000000',
        requestsPerMinute: -5,
        requestsPerDay: 100,
        tokensPerDay: 100,
        monthlyBudgetUsd: 10,
      });
    }, /requestsPerMinute must be greater than 0/);

    console.log('  ✅ QuotaValidator validation tests passed');
  }

  console.log('🎉 All API Key Quotas & Limits (P04-T08) Tests passed successfully!\n');
}

if (process.argv[1]?.endsWith('quota.test.ts')) {
  void runQuotaTests();
}
