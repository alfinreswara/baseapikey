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
import {
  API_KEY_PERMISSIONS,
  DEFAULT_API_KEY_PERMISSIONS,
} from './permissions/permission.constants';
import { requireApiKeyPermission } from './permissions/permission.middleware';
import { MockApiKeyRepository } from './testing/mock-api-key.repository';

export async function runApiKeyPermissionsTests(): Promise<void> {
  console.log('🧪 Starting API Key Permissions (P04-T04) Unit & Integration Tests...');

  const mockUserRepo = new MockUserRepository();
  const mockSessionRepo = new MockSessionRepository();
  const mockApiKeyRepo = new MockApiKeyRepository();

  const authConfig = loadAuthConfig();
  const jwtService = new JwtService(authConfig);
  const passwordService = new PasswordService();

  // Create User 1
  const user1 = await mockUserRepo.create({
    email: 'permuser1@example.com',
    username: 'permuser1',
    fullName: 'Perm User One',
    passwordHash: await passwordService.hash('Password123!'),
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
  });

  // Create User 2 (for cross-user isolation tests)
  const user2 = await mockUserRepo.create({
    email: 'permuser2@example.com',
    username: 'permuser2',
    fullName: 'Perm User Two',
    passwordHash: await passwordService.hash('Password123!'),
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
  });

  const tokenUser1 = jwtService.generateAccessToken({
    userId: user1.id,
    email: user1.email,
    role: user1.role,
    sessionId: 'sess_perm1_test',
  });

  const tokenUser2 = jwtService.generateAccessToken({
    userId: user2.id,
    email: user2.email,
    role: user2.role,
    sessionId: 'sess_perm2_test',
  });

  await mockSessionRepo.createSession({
    id: 'sess_perm1_test',
    userId: user1.id,
    refreshTokenHash: 'hash1',
    expiresAt: new Date(Date.now() + 86400000),
  });

  await mockSessionRepo.createSession({
    id: 'sess_perm2_test',
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

  // Register dummy AI gateway routes to test PermissionMiddleware (requireApiKeyPermission)
  const apiKeyAuthMiddleware = authenticateApiKey(mockApiKeyRepo, mockUserRepo, passwordService);

  app.post(
    '/v1/chat/completions',
    {
      preHandler: [
        apiKeyAuthMiddleware,
        requireApiKeyPermission(API_KEY_PERMISSIONS.CHAT_COMPLETIONS),
      ],
    },
    async (_req, reply) => {
      void reply.send({ success: true, message: 'Chat completion allowed' });
    },
  );

  app.post(
    '/v1/images/generations',
    {
      preHandler: [
        apiKeyAuthMiddleware,
        requireApiKeyPermission(API_KEY_PERMISSIONS.IMAGES_GENERATE),
      ],
    },
    async (_req, reply) => {
      void reply.send({ success: true, message: 'Image generation allowed' });
    },
  );

  await app.ready();

  // ===========================================================================
  // 1. Verify Default Permissions on Creation
  // ===========================================================================
  let createdKey1Id = '';
  let plaintextKey1 = '';

  {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
      payload: {
        name: 'Default Perms Key',
      },
    });

    assert.equal(res.statusCode, 201);
    const json = JSON.parse(res.payload);
    createdKey1Id = json.data.id;
    plaintextKey1 = json.data.apiKey;

    // Verify key in repository has default permissions
    const dbKey = await mockApiKeyRepo.findById(createdKey1Id);
    assert.ok(dbKey);
    assert.deepEqual(dbKey.permissions, DEFAULT_API_KEY_PERMISSIONS);
    console.log('  ✅ Default permissions on creation verified');
  }

  // ===========================================================================
  // 2. PermissionMiddleware Tests (requireApiKeyPermission)
  // ===========================================================================
  // Test 2.1: Key has chat:completions permission -> request succeeds
  {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: `Bearer ${plaintextKey1}`,
      },
    });

    assert.equal(res.statusCode, 200);
    const json = JSON.parse(res.payload);
    assert.equal(json.success, true);
    console.log('  ✅ PermissionMiddleware allowed valid permission request (200)');
  }

  // Test 2.2: Key lacks images:generate permission -> rejected with 403 Forbidden
  {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/images/generations',
      headers: {
        authorization: `Bearer ${plaintextKey1}`,
      },
    });

    assert.equal(res.statusCode, 403);
    const json = JSON.parse(res.payload);
    assert.equal(json.success, false);
    assert.equal(json.error.code, 'API_KEY_PERMISSION_DENIED');
    console.log('  ✅ PermissionMiddleware blocked missing permission request (403)');
  }

  // ===========================================================================
  // 3. PATCH /v1/api-keys/:id/permissions (Update Permissions)
  // ===========================================================================
  {
    const newPermissions = [
      API_KEY_PERMISSIONS.CHAT_COMPLETIONS,
      API_KEY_PERMISSIONS.IMAGES_GENERATE,
      API_KEY_PERMISSIONS.AUDIO_TRANSCRIBE,
    ];

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/api-keys/${createdKey1Id}/permissions`,
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
      payload: {
        permissions: newPermissions,
      },
    });

    assert.equal(res.statusCode, 200, 'PATCH /v1/api-keys/:id/permissions must return 200');
    const json = JSON.parse(res.payload);
    assert.equal(json.success, true);
    assert.deepEqual(json.data.permissions, newPermissions);

    // Verify AuditLog record
    const auditLog = mockApiKeyRepo.auditLogs.find(
      (l) => l.action === 'API_KEY_UPDATE_PERMISSIONS' && l.resourceId === createdKey1Id,
    );
    assert.ok(auditLog, 'AuditLog must record API_KEY_UPDATE_PERMISSIONS event');
    console.log('  ✅ PATCH /v1/api-keys/:id/permissions (Update permissions & AuditLog) passed');
  }

  // Test 3.1: Verify image generation endpoint now works with updated permission!
  {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/images/generations',
      headers: {
        authorization: `Bearer ${plaintextKey1}`,
      },
    });

    assert.equal(res.statusCode, 200);
    console.log('  ✅ Endpoint allowed after granting new permission (200)');
  }

  // ===========================================================================
  // 4. Validation Errors (Reject Invalid Permissions)
  // ===========================================================================
  {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/api-keys/${createdKey1Id}/permissions`,
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
      payload: {
        permissions: ['invalid:permission_name'],
      },
    });

    assert.equal(res.statusCode, 400, 'Invalid permission string must return 400 Bad Request');
    const json = JSON.parse(res.payload);
    assert.equal(json.success, false);
    console.log('  ✅ Reject invalid permission string (400) passed');
  }

  // ===========================================================================
  // 5. Cross-User Isolation (403 Forbidden)
  // ===========================================================================
  {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/api-keys/${createdKey1Id}/permissions`,
      headers: {
        authorization: `Bearer ${tokenUser2}`,
      },
      payload: {
        permissions: [API_KEY_PERMISSIONS.MODELS_LIST],
      },
    });

    assert.equal(res.statusCode, 403, 'Cross-user permission update must return 403 Forbidden');
    console.log('  ✅ Cross-user permission update rejection (403) passed');
  }

  // ===========================================================================
  // 6. Revoked Key Update Rejection
  // ===========================================================================
  {
    // Revoke key first
    await app.inject({
      method: 'DELETE',
      url: `/v1/api-keys/${createdKey1Id}`,
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
    });

    // Attempt to update permissions on revoked key
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/api-keys/${createdKey1Id}/permissions`,
      headers: {
        authorization: `Bearer ${tokenUser1}`,
      },
      payload: {
        permissions: [API_KEY_PERMISSIONS.MODELS_LIST],
      },
    });

    assert.equal(res.statusCode, 400, 'Updating permissions of revoked key must return 400');
    const json = JSON.parse(res.payload);
    assert.equal(json.error.code, 'API_KEY_ALREADY_REVOKED');
    console.log('  ✅ Revoked key permission update rejection (400) passed');
  }

  console.log('🎉 All API Key Permissions (P04-T04) Tests passed successfully!\n');
}

if (process.argv[1]?.endsWith('api-key-permissions.test.ts')) {
  void runApiKeyPermissionsTests();
}
