import assert from 'node:assert/strict';

import { ApiKeyStatus, UserRole, UserStatus } from '@baseapikey/database';
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

export async function runApiKeyRevocationTests(): Promise<void> {
  console.log('🧪 Starting API Key Revocation (P04-T06) Unit & Integration Tests...');

  const mockUserRepo = new MockUserRepository();
  const mockSessionRepo = new MockSessionRepository();
  const mockApiKeyRepo = new MockApiKeyRepository();

  const authConfig = loadAuthConfig();
  const jwtService = new JwtService(authConfig);
  const passwordService = new PasswordService();

  // Create User 1
  const user1 = await mockUserRepo.create({
    email: 'revuser1@example.com',
    username: 'revuser1',
    fullName: 'Rev User One',
    passwordHash: await passwordService.hash('Password123!'),
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
  });

  // Create User 2 (for cross-user revocation tests)
  const user2 = await mockUserRepo.create({
    email: 'revuser2@example.com',
    username: 'revuser2',
    fullName: 'Rev User Two',
    passwordHash: await passwordService.hash('Password123!'),
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
  });

  const tokenUser1 = jwtService.generateAccessToken({
    userId: user1.id,
    email: user1.email,
    role: user1.role,
    sessionId: 'sess_rev1_test',
  });

  const tokenUser2 = jwtService.generateAccessToken({
    userId: user2.id,
    email: user2.email,
    role: user2.role,
    sessionId: 'sess_rev2_test',
  });

  await mockSessionRepo.createSession({
    id: 'sess_rev1_test',
    userId: user1.id,
    refreshTokenHash: 'hash1',
    expiresAt: new Date(Date.now() + 86400000),
  });

  await mockSessionRepo.createSession({
    id: 'sess_rev2_test',
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
    '/v1/protected/data',
    {
      preHandler: [
        apiKeyAuthMiddleware,
        requireApiKeyPermission(API_KEY_PERMISSIONS.CHAT_COMPLETIONS),
      ],
    },
    async (_req, reply) => {
      void reply.send({ success: true, message: 'Protected data accessed' });
    },
  );

  await app.ready();

  // ===========================================================================
  // 1. Create API Key for User 1
  // ===========================================================================
  let createdKeyId = '';
  let plaintextKey = '';

  {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
      payload: {
        name: 'Key To Be Revoked',
      },
    });

    assert.equal(res.statusCode, 201);
    const json = JSON.parse(res.payload);
    createdKeyId = json.data.id;
    plaintextKey = json.data.apiKey;
  }

  // Confirm API key authenticates successfully before revocation
  {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected/data',
      headers: {
        authorization: `Bearer ${plaintextKey}`,
      },
    });
    assert.equal(res.statusCode, 200);
    console.log('  ✅ API key authenticates successfully before revocation');
  }

  // ===========================================================================
  // 2. Revoke API Key (POST /v1/api-keys/:id/revoke)
  // ===========================================================================
  {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/api-keys/${createdKeyId}/revoke`,
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
    });

    assert.equal(res.statusCode, 200, 'POST /v1/api-keys/:id/revoke must return HTTP 200');
    const json = JSON.parse(res.payload);
    assert.equal(json.success, true);
    assert.equal(json.message, 'API key revoked successfully.');

    // Verify key in repository is permanently marked REVOKED with deletedAt timestamp
    const dbKey = await mockApiKeyRepo.findById(createdKeyId);
    assert.ok(dbKey);
    assert.equal(dbKey.status, ApiKeyStatus.REVOKED);
    assert.ok(dbKey.deletedAt);

    // Verify AuditLog entry recorded
    const auditLog = mockApiKeyRepo.auditLogs.find(
      (l) => l.action === 'API_KEY_REVOKE' && l.resourceId === createdKeyId,
    );
    assert.ok(auditLog, 'AuditLog must record API_KEY_REVOKE event');
    console.log('  ✅ POST /v1/api-keys/:id/revoke (Successful revocation & AuditLog) passed');
  }

  // ===========================================================================
  // 3. Revoked Key Authentication Rejection (Middleware Check)
  // ===========================================================================
  {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/protected/data',
      headers: {
        authorization: `Bearer ${plaintextKey}`,
      },
    });

    assert.equal(res.statusCode, 401, 'Revoked API key MUST be rejected with 401 Unauthorized');
    const json = JSON.parse(res.payload);
    assert.equal(json.success, false);
    console.log('  ✅ Revoked API key blocked by authentication middleware (401) passed');
  }

  // ===========================================================================
  // 4. Revoked Key Cannot Be Rotated (HTTP 400)
  // ===========================================================================
  {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/api-keys/${createdKeyId}/rotate`,
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
    });

    assert.equal(res.statusCode, 400, 'Revoked key cannot be rotated');
    const json = JSON.parse(res.payload);
    assert.equal(json.error.code, 'API_KEY_ALREADY_REVOKED');
    console.log('  ✅ Revoked API key rotation rejection (400) passed');
  }

  // ===========================================================================
  // 5. Revoked Key Cannot Be Updated (HTTP 400)
  // ===========================================================================
  {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/api-keys/${createdKeyId}`,
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
      payload: {
        name: 'Attempted Update',
      },
    });

    assert.equal(res.statusCode, 400, 'Revoked key cannot be updated');
    const json = JSON.parse(res.payload);
    assert.equal(json.error.code, 'API_KEY_ALREADY_REVOKED');
    console.log('  ✅ Revoked API key update rejection (400) passed');
  }

  // ===========================================================================
  // 6. Revoked Key Cannot Have Permissions Updated (HTTP 400)
  // ===========================================================================
  {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/api-keys/${createdKeyId}/permissions`,
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
      payload: {
        permissions: [API_KEY_PERMISSIONS.MODELS_LIST],
      },
    });

    assert.equal(res.statusCode, 400, 'Revoked key cannot have permissions updated');
    const json = JSON.parse(res.payload);
    assert.equal(json.error.code, 'API_KEY_ALREADY_REVOKED');
    console.log('  ✅ Revoked API key permissions update rejection (400) passed');
  }

  // ===========================================================================
  // 7. Re-revoking an Already Revoked Key Rejection (HTTP 400)
  // ===========================================================================
  {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/api-keys/${createdKeyId}/revoke`,
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
    });

    assert.equal(res.statusCode, 400, 'Re-revoking already revoked key must return 400');
    const json = JSON.parse(res.payload);
    assert.equal(json.error.code, 'API_KEY_ALREADY_REVOKED');
    console.log('  ✅ Re-revoking already revoked key rejection (400) passed');
  }

  // ===========================================================================
  // 8. Cross-User Revocation Rejection (HTTP 403)
  // ===========================================================================
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
    const json = JSON.parse(res.payload);
    user2KeyId = json.data.id;
  }

  {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/api-keys/${user2KeyId}/revoke`,
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
    });

    assert.equal(res.statusCode, 403, 'Cross-user revocation must return 403 Forbidden');
    const json = JSON.parse(res.payload);
    assert.equal(json.error.code, 'API_KEY_FORBIDDEN');
    console.log('  ✅ Cross-user revocation rejection (403) passed');
  }

  console.log('🎉 All API Key Revocation (P04-T06) Tests passed successfully!\n');
}

if (process.argv[1]?.endsWith('api-key-revocation.test.ts')) {
  void runApiKeyRevocationTests();
}
