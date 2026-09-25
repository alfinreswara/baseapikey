import assert from 'node:assert/strict';

import { UserRole, UserStatus } from '@baseapikey/database';
import { AppError } from '@baseapikey/shared';
import fastify, { LogController } from 'fastify';

import { loadAuthConfig } from '../auth/auth.config';
import { JwtService } from '../auth/services/jwt.service';
import { PasswordService } from '../auth/services/password.service';
import { MockSessionRepository, MockUserRepository } from '../auth/testing/auth-test-utils';

import { apiKeyRoutes } from './api-keys.routes';
import { MockApiKeyRepository } from './testing/mock-api-key.repository';

export async function runApiKeyManagementTests(): Promise<void> {
  console.log('🧪 Starting API Key Management API (P04-T03) Integration Tests...');

  const mockUserRepo = new MockUserRepository();
  const mockSessionRepo = new MockSessionRepository();
  const mockApiKeyRepo = new MockApiKeyRepository();

  const authConfig = loadAuthConfig();
  const jwtService = new JwtService(authConfig);
  const passwordService = new PasswordService();

  // Create User 1
  const user1 = await mockUserRepo.create({
    email: 'user1@example.com',
    username: 'user1',
    fullName: 'User One',
    passwordHash: await passwordService.hash('Password123!'),
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
  });

  // Create User 2 (for cross-user isolation tests)
  const user2 = await mockUserRepo.create({
    email: 'user2@example.com',
    username: 'user2',
    fullName: 'User Two',
    passwordHash: await passwordService.hash('Password123!'),
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
  });

  // Mint access tokens
  const tokenUser1 = jwtService.generateAccessToken({
    userId: user1.id,
    email: user1.email,
    role: user1.role,
    sessionId: 'sess_user1_test',
  });

  const tokenUser2 = jwtService.generateAccessToken({
    userId: user2.id,
    email: user2.email,
    role: user2.role,
    sessionId: 'sess_user2_test',
  });

  // Seed active sessions in mock session repo
  await mockSessionRepo.createSession({
    id: 'sess_user1_test',
    userId: user1.id,
    refreshTokenHash: 'hash1',
    expiresAt: new Date(Date.now() + 86400000),
  });

  await mockSessionRepo.createSession({
    id: 'sess_user2_test',
    userId: user2.id,
    refreshTokenHash: 'hash2',
    expiresAt: new Date(Date.now() + 86400000),
  });

  // Initialize Fastify app with apiKeyRoutes
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

  void app.register(apiKeyRoutes, {
    apiKeyRepository: mockApiKeyRepo,
    sessionRepository: mockSessionRepo,
    jwtService,
    passwordService,
  });

  await app.ready();

  let createdKey1Id = '';
  let createdKey2Id = '';

  // ===========================================================================
  // 1. Create API Keys setup
  // ===========================================================================
  {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
      payload: {
        name: 'Production Key User 1',
      },
    });

    assert.equal(res.statusCode, 201);
    const json = JSON.parse(res.payload);
    assert.equal(json.success, true);
    createdKey1Id = json.data.id;
    assert.ok(createdKey1Id);
  }

  {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
      payload: {
        name: 'Staging Key User 1',
      },
    });

    assert.equal(res.statusCode, 201);
    const json = JSON.parse(res.payload);
    createdKey2Id = json.data.id;
    assert.ok(createdKey2Id);
  }

  // User 2 creates a key
  let user2KeyId = '';
  {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers: {
        authorization: `Bearer ${tokenUser2}`,
      },
      payload: {
        name: 'User 2 Key',
      },
    });

    assert.equal(res.statusCode, 201);
    const json = JSON.parse(res.payload);
    user2KeyId = json.data.id;
  }

  // ===========================================================================
  // 2. GET /v1/api-keys (List API Keys)
  // ===========================================================================
  {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/api-keys',
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
    });

    assert.equal(res.statusCode, 200, 'GET /v1/api-keys must return HTTP 200');
    const json = JSON.parse(res.payload);
    assert.equal(json.success, true);
    assert.ok(Array.isArray(json.data));
    assert.equal(json.data.length, 2, 'User 1 must see exactly 2 API keys');

    const key = json.data[0];
    assert.ok(key.id);
    assert.ok(key.name);
    assert.ok(key.keyPrefix);
    assert.ok(key.status);
    assert.equal(key.keyHash, undefined, 'keyHash MUST NOT be exposed in list endpoint');
    assert.equal(key.apiKey, undefined, 'plaintext apiKey MUST NOT be exposed in list endpoint');
    console.log('  ✅ GET /v1/api-keys (List user API keys) passed');
  }

  // ===========================================================================
  // 3. GET /v1/api-keys/:id (Get Single API Key Detail)
  // ===========================================================================
  {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/api-keys/${createdKey1Id}`,
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
    });

    assert.equal(res.statusCode, 200, 'GET /v1/api-keys/:id must return HTTP 200');
    const json = JSON.parse(res.payload);
    assert.equal(json.success, true);
    assert.equal(json.data.id, createdKey1Id);
    assert.equal(json.data.name, 'Production Key User 1');
    assert.equal(json.data.keyHash, undefined, 'keyHash MUST NOT be exposed');
    assert.equal(json.data.apiKey, undefined, 'plaintext apiKey MUST NOT be exposed');
    console.log('  ✅ GET /v1/api-keys/:id (View single API key detail) passed');
  }

  // Test 3.1: GET non-existent API key
  {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/api-keys/non_existent_key_id',
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
    });

    assert.equal(res.statusCode, 404, 'Non-existent API key must return 404 Not Found');
    const json = JSON.parse(res.payload);
    assert.equal(json.success, false);
    assert.equal(json.error.code, 'API_KEY_NOT_FOUND');
    console.log('  ✅ GET /v1/api-keys/:id (Non-existent 404) passed');
  }

  // Test 3.2: GET cross-user API key (Forbidden)
  {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/api-keys/${user2KeyId}`,
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
    });

    assert.equal(res.statusCode, 403, 'Cross-user access must return 403 Forbidden');
    const json = JSON.parse(res.payload);
    assert.equal(json.success, false);
    assert.equal(json.error.code, 'API_KEY_FORBIDDEN');
    console.log('  ✅ GET /v1/api-keys/:id (Cross-user 403 Forbidden) passed');
  }

  // ===========================================================================
  // 4. PATCH /v1/api-keys/:id (Update API Key)
  // ===========================================================================
  {
    const newExpiresAt = new Date(Date.now() + 864000000).toISOString();
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/api-keys/${createdKey1Id}`,
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
      payload: {
        name: 'Renamed Production Key',
        expiresAt: newExpiresAt,
      },
    });

    assert.equal(res.statusCode, 200, 'PATCH /v1/api-keys/:id must return HTTP 200');
    const json = JSON.parse(res.payload);
    assert.equal(json.success, true);
    assert.equal(json.data.name, 'Renamed Production Key');
    assert.equal(json.data.expiresAt, newExpiresAt);

    // Verify AuditLog record
    const auditLog = mockApiKeyRepo.auditLogs.find(
      (l) => l.action === 'API_KEY_UPDATE' && l.resourceId === createdKey1Id,
    );
    assert.ok(auditLog, 'AuditLog must record API_KEY_UPDATE event');
    console.log('  ✅ PATCH /v1/api-keys/:id (Update API key & AuditLog) passed');
  }

  // Test 4.1: PATCH with invalid payload
  {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/api-keys/${createdKey1Id}`,
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
      payload: {},
    });

    assert.equal(res.statusCode, 400, 'Empty update payload must return 400 Bad Request');
    console.log('  ✅ PATCH /v1/api-keys/:id (Invalid payload 400) passed');
  }

  // Test 4.2: PATCH cross-user API key
  {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/api-keys/${user2KeyId}`,
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
      payload: {
        name: 'Hacked Name',
      },
    });

    assert.equal(res.statusCode, 403, 'Cross-user update must return 403 Forbidden');
    console.log('  ✅ PATCH /v1/api-keys/:id (Cross-user update 403) passed');
  }

  // ===========================================================================
  // 5. DELETE /v1/api-keys/:id (Revoke API Key)
  // ===========================================================================
  {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/api-keys/${createdKey1Id}`,
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
    });

    assert.equal(res.statusCode, 200, 'DELETE /v1/api-keys/:id must return HTTP 200');
    const json = JSON.parse(res.payload);
    assert.equal(json.success, true);
    assert.equal(json.data.status, 'REVOKED');

    // Verify AuditLog record
    const auditLog = mockApiKeyRepo.auditLogs.find(
      (l) => l.action === 'API_KEY_REVOKE' && l.resourceId === createdKey1Id,
    );
    assert.ok(auditLog, 'AuditLog must record API_KEY_REVOKE event');
    console.log('  ✅ DELETE /v1/api-keys/:id (Revoke API key & AuditLog) passed');
  }

  // Test 5.1: DELETE already revoked key
  {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/api-keys/${createdKey1Id}`,
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
    });

    assert.equal(res.statusCode, 400, 'Revoking already revoked key must return 400 Bad Request');
    const json = JSON.parse(res.payload);
    assert.equal(json.success, false);
    assert.equal(json.error.code, 'API_KEY_ALREADY_REVOKED');
    console.log('  ✅ DELETE /v1/api-keys/:id (Already revoked 400) passed');
  }

  // Test 5.2: PATCH already revoked key
  {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/api-keys/${createdKey1Id}`,
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
      payload: {
        name: 'Try Update Revoked',
      },
    });

    assert.equal(res.statusCode, 400, 'Updating revoked key must return 400 Bad Request');
    const json = JSON.parse(res.payload);
    assert.equal(json.error.code, 'API_KEY_ALREADY_REVOKED');
    console.log('  ✅ PATCH /v1/api-keys/:id (Updating revoked key 400) passed');
  }

  // Test 5.3: DELETE cross-user API key
  {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/api-keys/${user2KeyId}`,
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
    });

    assert.equal(res.statusCode, 403, 'Cross-user revoke must return 403 Forbidden');
    console.log('  ✅ DELETE /v1/api-keys/:id (Cross-user revoke 403) passed');
  }

  // ===========================================================================
  // 6. Unauthenticated requests
  // ===========================================================================
  {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/api-keys',
    });
    assert.equal(res.statusCode, 401, 'Unauthenticated GET must return 401');
    console.log('  ✅ Unauthenticated request rejection 401 passed');
  }

  console.log('🎉 All API Key Management API (P04-T03) Tests passed successfully!\n');
}

if (process.argv[1]?.endsWith('api-key-management.test.ts')) {
  void runApiKeyManagementTests();
}
