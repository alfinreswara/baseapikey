import assert from 'node:assert/strict';

import { UserRole, UserStatus } from '@baseapikey/database';
import { AppError } from '@baseapikey/shared';
import fastify, { LogController } from 'fastify';

import { loadAuthConfig } from '../auth/auth.config';
import { JwtService } from '../auth/services/jwt.service';
import { PasswordService } from '../auth/services/password.service';
import { MockSessionRepository, MockUserRepository } from '../auth/testing/auth-test-utils';

import { apiKeyRoutes } from './api-keys.routes';
import { authenticateApiKey } from './middleware/api-key-auth.middleware';
import { API_KEY_PERMISSIONS } from './permissions/permission.constants';
import { requireApiKeyPermission } from './permissions/permission.middleware';
import { MockApiKeyRepository } from './testing/mock-api-key.repository';

export async function runApiKeyRotationTests(): Promise<void> {
  console.log('🧪 Starting API Key Rotation (P04-T05) Unit & Integration Tests...');

  const mockUserRepo = new MockUserRepository();
  const mockSessionRepo = new MockSessionRepository();
  const mockApiKeyRepo = new MockApiKeyRepository();

  const authConfig = loadAuthConfig();
  const jwtService = new JwtService(authConfig);
  const passwordService = new PasswordService();

  // Create User 1
  const user1 = await mockUserRepo.create({
    email: 'rotuser1@example.com',
    username: 'rotuser1',
    fullName: 'Rot User One',
    passwordHash: await passwordService.hash('Password123!'),
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
  });

  // Create User 2 (for cross-user rotation tests)
  const user2 = await mockUserRepo.create({
    email: 'rotuser2@example.com',
    username: 'rotuser2',
    fullName: 'Rot User Two',
    passwordHash: await passwordService.hash('Password123!'),
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
  });

  const tokenUser1 = jwtService.generateAccessToken({
    userId: user1.id,
    email: user1.email,
    role: user1.role,
    sessionId: 'sess_rot1_test',
  });

  const tokenUser2 = jwtService.generateAccessToken({
    userId: user2.id,
    email: user2.email,
    role: user2.role,
    sessionId: 'sess_rot2_test',
  });

  await mockSessionRepo.createSession({
    id: 'sess_rot1_test',
    userId: user1.id,
    refreshTokenHash: 'hash1',
    expiresAt: new Date(Date.now() + 86400000),
  });

  await mockSessionRepo.createSession({
    id: 'sess_rot2_test',
    userId: user2.id,
    refreshTokenHash: 'hash2',
    expiresAt: new Date(Date.now() + 86400000),
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

  void app.register(apiKeyRoutes, {
    apiKeyRepository: mockApiKeyRepo,
    sessionRepository: mockSessionRepo,
    jwtService,
    passwordService,
  });

  // Dummy route protected by API key authentication middleware
  const apiKeyAuthMiddleware = authenticateApiKey(mockApiKeyRepo, mockUserRepo, passwordService);
  app.get(
    '/v1/protected/ping',
    {
      preHandler: [
        apiKeyAuthMiddleware,
        requireApiKeyPermission(API_KEY_PERMISSIONS.CHAT_COMPLETIONS),
      ],
    },
    async (_req, reply) => {
      void reply.send({ success: true, message: 'Pong' });
    },
  );

  await app.ready();

  // ===========================================================================
  // 1. Create API Key for User 1
  // ===========================================================================
  let createdKeyId = '';
  let originalPlaintextKey = '';
  let originalKeyHash = '';

  {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
      payload: {
        name: 'Key To Be Rotated',
      },
    });

    assert.equal(res.statusCode, 201);
    const json = JSON.parse(res.payload);
    createdKeyId = json.data.id;
    originalPlaintextKey = json.data.apiKey;

    const dbKey = await mockApiKeyRepo.findById(createdKeyId);
    assert.ok(dbKey);
    originalKeyHash = dbKey.keyHash;
  }

  // Confirm original key authenticates successfully
  {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected/ping',
      headers: {
        authorization: `Bearer ${originalPlaintextKey}`,
      },
    });
    assert.equal(res.statusCode, 200);
    console.log('  ✅ Original API key authenticated successfully');
  }

  // ===========================================================================
  // 2. Rotate API Key (POST /v1/api-keys/:id/rotate)
  // ===========================================================================
  let newPlaintextKey = '';

  {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/api-keys/${createdKeyId}/rotate`,
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
    });

    assert.equal(res.statusCode, 200, 'POST /v1/api-keys/:id/rotate must return HTTP 200');
    const json = JSON.parse(res.payload);
    assert.equal(json.success, true);
    assert.equal(json.data.id, createdKeyId);
    assert.equal(json.data.name, 'Key To Be Rotated');
    assert.ok(json.data.apiKey);
    assert.ok(json.data.apiKey.startsWith('sk_live_'));
    assert.notEqual(
      json.data.apiKey,
      originalPlaintextKey,
      'New API key must differ from original key',
    );
    assert.ok(json.data.rotatedAt);

    newPlaintextKey = json.data.apiKey;

    // Verify key in repository updated hash and prefix
    const dbKey = await mockApiKeyRepo.findById(createdKeyId);
    assert.ok(dbKey);
    assert.notEqual(dbKey.keyHash, originalKeyHash, 'Database keyHash MUST be replaced');

    // Verify AuditLog record
    const auditLog = mockApiKeyRepo.auditLogs.find(
      (l) => l.action === 'API_KEY_ROTATE' && l.resourceId === createdKeyId,
    );
    assert.ok(auditLog, 'AuditLog must record API_KEY_ROTATE event');
    console.log('  ✅ POST /v1/api-keys/:id/rotate (Successful rotation & AuditLog) passed');
  }

  // ===========================================================================
  // 3. Old API Key Invalidation & New API Key Verification
  // ===========================================================================
  // Test 3.1: Old API key fails authentication immediately (HTTP 401)
  {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected/ping',
      headers: {
        authorization: `Bearer ${originalPlaintextKey}`,
      },
    });

    assert.equal(res.statusCode, 401, 'Rotated (old) API key MUST return 401 Unauthorized');
    const json = JSON.parse(res.payload);
    assert.equal(json.success, false);
    assert.equal(json.error.code, 'INVALID_API_KEY');
    console.log('  ✅ Old API key rejected immediately (401) passed');
  }

  // Test 3.2: New API key authenticates successfully (HTTP 200)
  {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected/ping',
      headers: {
        authorization: `Bearer ${newPlaintextKey}`,
      },
    });

    assert.equal(res.statusCode, 200, 'New rotated API key MUST authenticate successfully');
    const json = JSON.parse(res.payload);
    assert.equal(json.success, true);
    console.log('  ✅ New API key authenticated successfully (200) passed');
  }

  // ===========================================================================
  // 4. Cross-User Rotation Rejection (HTTP 403)
  // ===========================================================================
  {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/api-keys/${createdKeyId}/rotate`,
      headers: {
        authorization: `Bearer ${tokenUser2}`,
      },
    });

    assert.equal(res.statusCode, 403, 'Cross-user rotation must return 403 Forbidden');
    const json = JSON.parse(res.payload);
    assert.equal(json.success, false);
    assert.equal(json.error.code, 'API_KEY_FORBIDDEN');
    console.log('  ✅ Cross-user rotation rejection (403) passed');
  }

  // ===========================================================================
  // 5. Revoked Key Rotation Rejection (HTTP 400)
  // ===========================================================================
  {
    // Revoke key
    await app.inject({
      method: 'DELETE',
      url: `/v1/api-keys/${createdKeyId}`,
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
    });

    // Attempt to rotate revoked key
    const res = await app.inject({
      method: 'POST',
      url: `/v1/api-keys/${createdKeyId}/rotate`,
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
    });

    assert.equal(res.statusCode, 400, 'Rotating revoked key must return 400 Bad Request');
    const json = JSON.parse(res.payload);
    assert.equal(json.success, false);
    assert.equal(json.error.code, 'API_KEY_ALREADY_REVOKED');
    console.log('  ✅ Revoked key rotation rejection (400) passed');
  }

  // ===========================================================================
  // 6. Expired Key Rotation Rejection (HTTP 401 / 400)
  // ===========================================================================
  {
    // Create an expired key in mock repository directly
    const expiredKeyRecord = await mockApiKeyRepo.createKey({
      userId: user1.id,
      name: 'Expired Key',
      keyHash: 'hash_expired',
      keyPrefix: 'sk_live_exp12345',
      expiresAt: new Date(Date.now() - 10000),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/api-keys/${expiredKeyRecord.id}/rotate`,
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
    });

    assert.equal(res.statusCode, 401, 'Rotating expired key must return 401 API_KEY_EXPIRED');
    const json = JSON.parse(res.payload);
    assert.equal(json.error.code, 'API_KEY_EXPIRED');
    console.log('  ✅ Expired key rotation rejection (401) passed');
  }

  console.log('🎉 All API Key Rotation (P04-T05) Tests passed successfully!\n');
}

if (process.argv[1]?.endsWith('api-key-rotation.test.ts')) {
  void runApiKeyRotationTests();
}
