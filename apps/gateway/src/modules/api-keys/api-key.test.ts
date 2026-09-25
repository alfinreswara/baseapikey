import assert from 'node:assert/strict';

import { buildApp } from '../../app';
import { loadAuthConfig } from '../auth/auth.config';
import { JwtService } from '../auth/services/jwt.service';
import { PasswordService } from '../auth/services/password.service';
import { MockSessionRepository, MockUserRepository } from '../auth/testing/auth-test-utils';

import { API_KEY_CONSTANTS } from './api-keys.constants';
import { ApiKeyService } from './services/api-key.service';
import { MockApiKeyRepository } from './testing/mock-api-key.repository';
import { generateApiKey } from './utils/api-key-generator.util';

async function runApiKeyTests(): Promise<void> {
  console.log('🧪 Starting API Key Generation (P04-T01) Unit & Integration Tests...');

  // ===========================================================================
  // 1. Utility Tests: generateApiKey
  // ===========================================================================
  {
    const key1 = generateApiKey();
    const key2 = generateApiKey();

    assert.ok(
      key1.plaintextKey.startsWith(API_KEY_CONSTANTS.PREFIX),
      'Plaintext key should start with sk_live_',
    );
    assert.ok(
      key1.keyPrefix.startsWith(API_KEY_CONSTANTS.PREFIX),
      'Key prefix should start with sk_live_',
    );
    assert.notEqual(
      key1.plaintextKey,
      key2.plaintextKey,
      'Consecutive generated API keys must be unique',
    );
    assert.ok(
      key1.plaintextKey.length >= 40,
      'Generated API key should have sufficient random length',
    );
    console.log('  ✅ generateApiKey utility unit tests passed');
  }

  // ===========================================================================
  // 2. Service Unit Tests: ApiKeyService
  // ===========================================================================
  {
    const mockRepo = new MockApiKeyRepository();
    const passwordService = new PasswordService();
    const apiKeyService = new ApiKeyService(mockRepo, passwordService, 2);

    const userId = 'usr_test_service_user';

    // Test 2.1: Successful creation
    const created1 = await apiKeyService.createApiKey(userId, { name: 'Development Key' });
    assert.ok(created1.id, 'Created API key response should contain id');
    assert.equal(created1.name, 'Development Key');
    assert.ok(created1.apiKey.startsWith('sk_live_'));
    assert.equal(created1.expiresAt, null);

    // Verify hash storage in repository
    const storedRecord = mockRepo.apiKeys.find((k) => k.id === created1.id);
    assert.ok(storedRecord, 'API key record must exist in repository');
    assert.notEqual(
      storedRecord.keyHash,
      created1.apiKey,
      'Repository MUST NOT store plaintext key',
    );
    assert.ok(
      await passwordService.verify(created1.apiKey, storedRecord.keyHash),
      'Stored hash must be valid Argon2id hash of the plaintext key',
    );

    // Verify audit log creation
    assert.equal(mockRepo.auditLogs.length, 1);
    assert.equal(mockRepo.auditLogs[0]?.action, 'API_KEY_CREATE');
    assert.equal(mockRepo.auditLogs[0]?.resource, 'ApiKey');

    // Test 2.2: Second creation up to max limit
    const created2 = await apiKeyService.createApiKey(userId, { name: 'Production Key' });
    assert.ok(created2.apiKey.startsWith('sk_live_'));
    assert.notEqual(created1.apiKey, created2.apiKey, 'API keys must be unique');

    // Test 2.3: Max API keys limit enforcement
    await assert.rejects(
      async () => {
        await apiKeyService.createApiKey(userId, { name: 'Excess Key' });
      },
      (err: unknown) => {
        if (err instanceof Error) {
          return err.message.includes('Maximum limit');
        }
        return false;
      },
      'Should throw MaxApiKeysExceededError when limit is reached',
    );

    console.log('  ✅ ApiKeyService unit tests passed');
  }

  // ===========================================================================
  // 3. HTTP Fastify Integration Tests: POST /v1/api-keys
  // ===========================================================================
  {
    const userRepository = new MockUserRepository();
    const sessionRepository = new MockSessionRepository();
    const apiKeyRepository = new MockApiKeyRepository();

    const authConfig = loadAuthConfig();
    const jwtService = new JwtService(authConfig);
    const passwordService = new PasswordService();

    const app = buildApp({
      userRepository,
      sessionRepository,
      apiKeyRepository,
    });

    // Setup authenticated user & valid session
    const user = await userRepository.create({
      email: 'apikeyuser@example.com',
      username: 'apikeyuser',
      fullName: 'API Key User',
      passwordHash: await passwordService.hash('Password123!@#'),
    });

    const sessionId = 'sess_apikey_test_123';
    await sessionRepository.createSession({
      id: sessionId,
      userId: user.id,
      refreshTokenHash: 'hash',
      expiresAt: new Date(Date.now() + 86400000),
    });

    const validAccessToken = jwtService.generateAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId,
    });

    // Test 3.1: Successful API Key creation (201 Created)
    const resSuccess = await app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers: {
        authorization: `Bearer ${validAccessToken}`,
      },
      payload: {
        name: 'My Service Key',
        expiresAt: null,
      },
    });

    assert.equal(resSuccess.statusCode, 201);
    const bodySuccess = JSON.parse(resSuccess.payload);
    assert.equal(bodySuccess.success, true);
    assert.ok(bodySuccess.data.id);
    assert.equal(bodySuccess.data.name, 'My Service Key');
    assert.ok(bodySuccess.data.apiKey.startsWith('sk_live_'));
    assert.equal(bodySuccess.data.expiresAt, null);

    // Test 3.2: Unauthenticated request rejection (401 Unauthorized)
    const resUnauth = await app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      payload: {
        name: 'Unauthorized Key',
      },
    });
    assert.equal(resUnauth.statusCode, 401);

    // Test 3.3: Invalid payload validation (400 Bad Request)
    const resInvalid = await app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers: {
        authorization: `Bearer ${validAccessToken}`,
      },
      payload: {
        name: '', // Empty name invalid
      },
    });
    assert.equal(resInvalid.statusCode, 400);

    // Test 3.4: Success with ISO expiresAt date
    const futureDateIso = new Date(Date.now() + 30 * 86400000).toISOString();
    const resWithExpiry = await app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers: {
        authorization: `Bearer ${validAccessToken}`,
      },
      payload: {
        name: 'Expiring Key',
        expiresAt: futureDateIso,
      },
    });

    assert.equal(resWithExpiry.statusCode, 201);
    const bodyWithExpiry = JSON.parse(resWithExpiry.payload);
    assert.equal(bodyWithExpiry.data.expiresAt, futureDateIso);

    console.log('  ✅ HTTP POST /v1/api-keys integration tests passed');
  }

  console.log('🎉 All API Key Generation (P04-T01) Tests passed successfully!\n');
}

void runApiKeyTests();
