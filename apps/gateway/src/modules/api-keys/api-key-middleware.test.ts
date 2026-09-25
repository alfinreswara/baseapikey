import assert from 'node:assert/strict';

import { ApiKeyStatus, UserRole, UserStatus } from '@baseapikey/database';
import { AppError } from '@baseapikey/shared';
import fastify, { FastifyRequest, LogController } from 'fastify';

import { PasswordService } from '../auth/services/password.service';
import { MockUserRepository } from '../auth/testing/auth-test-utils';

import {
  authenticateApiKey,
  extractKeyPrefix,
  getRequestApiKey,
  requireApiKey,
} from './middleware/api-key-auth.middleware';
import { ApiKeyService } from './services/api-key.service';
import { MockApiKeyRepository } from './testing/mock-api-key.repository';
import { generateApiKey } from './utils/api-key-generator.util';

const createTestApiKey = (label: string): string => `sk_live_${label.padEnd(40, '0')}`;

async function runApiKeyMiddlewareTests(): Promise<void> {
  console.log(
    '🧪 Starting API Key Authentication Middleware (P04-T02) Unit & Integration Tests...',
  );

  const passwordService = new PasswordService();

  // ===========================================================================
  // 1. Helper Unit Tests: extractKeyPrefix
  // ===========================================================================
  {
    const generated = generateApiKey();
    const extracted = extractKeyPrefix(generated.plaintextKey);
    assert.equal(
      extracted,
      generated.keyPrefix,
      'Extracted keyPrefix must match generated keyPrefix',
    );

    assert.equal(extractKeyPrefix('invalid_key'), null, 'Invalid prefix must return null');
    assert.equal(extractKeyPrefix('sk_live_123'), null, 'Short payload must return null');
    console.log('  ✅ extractKeyPrefix helper unit tests passed');
  }

  // Setup mock repositories & services
  const mockUserRepo = new MockUserRepository();
  const mockApiKeyRepo = new MockApiKeyRepository();
  const apiKeyService = new ApiKeyService(mockApiKeyRepo, passwordService);

  // Seed test user
  const activeUser = await mockUserRepo.create({
    email: 'apikeyuser@example.com',
    username: 'apikeyuser',
    fullName: 'API Key User',
    passwordHash: await passwordService.hash('Password123!'),
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
  });

  const suspendedUser = await mockUserRepo.create({
    email: 'suspendeduser@example.com',
    username: 'suspendeduser',
    fullName: 'Suspended User',
    passwordHash: await passwordService.hash('Password123!'),
    role: UserRole.USER,
    status: UserStatus.SUSPENDED,
  });

  // Seed test API keys
  const validKeyResult = await apiKeyService.createApiKey(activeUser.id, {
    name: 'Active Valid Key',
  });

  const expiredKeyResult = await apiKeyService.createApiKey(activeUser.id, {
    name: 'Expired Key',
    expiresAt: new Date(Date.now() - 10000).toISOString(),
  });

  const suspendedUserKeyResult = await apiKeyService.createApiKey(suspendedUser.id, {
    name: 'Suspended User Key',
  });

  // Create a revoked key by setting deletedAt
  const revokedKeyPlaintext = createTestApiKey('revoked-key');
  const revokedKeyRecord = await mockApiKeyRepo.createKey({
    userId: activeUser.id,
    name: 'Revoked Key',
    keyHash: await passwordService.hash(revokedKeyPlaintext),
    keyPrefix: revokedKeyPlaintext.substring(0, 16),
  });
  revokedKeyRecord.deletedAt = new Date();
  revokedKeyRecord.status = ApiKeyStatus.REVOKED;

  // Build Fastify test app for middleware testing
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

  app.get(
    '/v1/protected-api',
    {
      preHandler: [
        authenticateApiKey(mockApiKeyRepo, mockUserRepo, passwordService),
        requireApiKey(),
      ],
    },
    async (request: FastifyRequest) => {
      const apiKeyCtx = getRequestApiKey(request);
      return {
        success: true,
        data: {
          user: request.user,
          apiKey: {
            id: apiKeyCtx.id,
            name: apiKeyCtx.name,
            keyPrefix: apiKeyCtx.keyPrefix,
            permissions: apiKeyCtx.permissions,
            expiresAt: apiKeyCtx.expiresAt,
            // Verify keyHash is undefined
            keyHash: (apiKeyCtx as unknown as Record<string, unknown>)['keyHash'],
          },
        },
      };
    },
  );

  // ===========================================================================
  // 2. Integration Test Cases
  // ===========================================================================

  // Test 2.1: Valid Bearer API Key Authentication
  {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected-api',
      headers: {
        authorization: `Bearer ${validKeyResult.apiKey}`,
      },
    });

    assert.equal(res.statusCode, 200, 'Valid API key must return HTTP 200');
    const json = JSON.parse(res.payload);
    assert.equal(json.success, true);
    assert.equal(json.data.user.userId, activeUser.id);
    assert.equal(json.data.user.email, activeUser.email);
    assert.equal(json.data.apiKey.id, validKeyResult.id);
    assert.equal(json.data.apiKey.keyPrefix, validKeyResult.apiKey.substring(0, 16));
    assert.equal(json.data.apiKey.keyHash, undefined, 'keyHash must NOT be exposed in context');
    console.log('  ✅ Valid Bearer API key authentication & context attachment passed');
  }

  // Test 2.2: Missing Authorization Header
  {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected-api',
    });

    assert.equal(res.statusCode, 401, 'Missing Authorization header must return HTTP 401');
    const json = JSON.parse(res.payload);
    assert.equal(json.error.code, 'MISSING_API_KEY');
    console.log('  ✅ Missing Authorization header rejected with 401 passed');
  }

  // Test 2.3: Malformed Header Format (not Bearer)
  {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected-api',
      headers: {
        authorization: `Basic ${validKeyResult.apiKey}`,
      },
    });

    assert.equal(res.statusCode, 401, 'Non-Bearer header format must return HTTP 401');
    const json = JSON.parse(res.payload);
    assert.equal(json.error.code, 'INVALID_API_KEY');
    console.log('  ✅ Malformed Authorization header format rejected with 401 passed');
  }

  // Test 2.4: Invalid / Unknown API Key
  {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected-api',
      headers: {
        authorization: `Bearer ${createTestApiKey('unknown-key')}`,
      },
    });

    assert.equal(res.statusCode, 401, 'Unknown API key must return HTTP 401');
    const json = JSON.parse(res.payload);
    assert.equal(json.error.code, 'INVALID_API_KEY');
    console.log('  ✅ Unknown / Invalid API key rejected with 401 passed');
  }

  // Test 2.5: Expired API Key Rejection
  {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected-api',
      headers: {
        authorization: `Bearer ${expiredKeyResult.apiKey}`,
      },
    });

    assert.equal(res.statusCode, 401, 'Expired API key must return HTTP 401');
    const json = JSON.parse(res.payload);
    assert.equal(json.error.code, 'API_KEY_EXPIRED');
    console.log('  ✅ Expired API key rejected with 401 passed');
  }

  // Test 2.6: Revoked API Key Rejection
  {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected-api',
      headers: {
        authorization: `Bearer ${revokedKeyPlaintext}`,
      },
    });

    assert.equal(res.statusCode, 401, 'Revoked API key must return HTTP 401');
    const json = JSON.parse(res.payload);
    assert.equal(json.error.code, 'API_KEY_REVOKED');
    console.log('  ✅ Revoked API key rejected with 401 passed');
  }

  // Test 2.7: Suspended User Account Rejection
  {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected-api',
      headers: {
        authorization: `Bearer ${suspendedUserKeyResult.apiKey}`,
      },
    });

    assert.equal(res.statusCode, 401, 'API key belonging to suspended user must return HTTP 401');
    const json = JSON.parse(res.payload);
    assert.equal(json.error.code, 'UNAUTHORIZED');
    console.log('  ✅ Suspended user account rejection with 401 passed');
  }

  // Test 2.8: Async lastUsedAt update
  {
    // Wait briefly for fire-and-forget promise to settle
    await new Promise((resolve) => setTimeout(resolve, 50));
    const activeKeyInRepo = mockApiKeyRepo.apiKeys.find((k) => k.id === validKeyResult.id);
    assert.ok(
      activeKeyInRepo?.lastUsedAt !== null,
      'lastUsedAt should be updated on successful auth',
    );
    console.log('  ✅ Asynchronous lastUsedAt update verification passed');
  }

  console.log('🎉 All API Key Authentication Middleware Tests passed successfully!');
}

runApiKeyMiddlewareTests().catch((err) => {
  console.error('❌ API Key Middleware Test Failed:', err);
  process.exit(1);
});
