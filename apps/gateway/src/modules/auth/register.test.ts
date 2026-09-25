import { UserRole, UserStatus } from '@baseapikey/database';

import { buildApp } from '../../app';

import type {
  CreateUserData,
  IUserRepository,
  RecordAuditLogData,
} from './repositories/user.repository';
import { RegisterService } from './services/register.service';

process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] || 'postgresql://postgres:postgres@localhost:5432/baseapikey';
process.env['REDIS_URL'] = process.env['REDIS_URL'] || 'redis://localhost:6379';
process.env['NINE_ROUTER_API_KEY'] = process.env['NINE_ROUTER_API_KEY'] || 'test-nine-router-key';
process.env['JWT_ACCESS_SECRET'] =
  process.env['JWT_ACCESS_SECRET'] || 'test-jwt-access-secret-minimum-32-chars-long';
process.env['JWT_REFRESH_SECRET'] =
  process.env['JWT_REFRESH_SECRET'] || 'test-jwt-refresh-secret-minimum-32-chars-long';
process.env['JWT_ACCESS_EXPIRES_IN'] = process.env['JWT_ACCESS_EXPIRES_IN'] || '15m';
process.env['JWT_REFRESH_EXPIRES_IN'] = process.env['JWT_REFRESH_EXPIRES_IN'] || '7d';

class InMemoryUserRepository implements IUserRepository {
  private users: Array<{
    id: string;
    email: string;
    username: string;
    fullName: string;
    passwordHash: string;
    role: UserRole;
    status: UserStatus;
    emailVerified: boolean;
    createdAt: Date;
    updatedAt: Date;
    avatarUrl: string | null;
    lastLoginAt: Date | null;
    deletedAt: Date | null;
  }> = [];

  async findById(id: string) {
    return this.users.find((u) => u.id === id) ?? null;
  }

  async findByEmail(email: string) {
    return this.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  async findByUsername(username: string) {
    return this.users.find((u) => u.username.toLowerCase() === username.toLowerCase()) ?? null;
  }

  async create(data: CreateUserData) {
    const user = {
      id: `usr_${Math.random().toString(36).slice(2, 9)}`,
      email: data.email,
      username: data.username,
      fullName: data.fullName,
      passwordHash: data.passwordHash,
      role: data.role ?? UserRole.USER,
      status: data.status ?? UserStatus.ACTIVE,
      emailVerified: data.emailVerified ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
      avatarUrl: null,
      lastLoginAt: null,
      deletedAt: null,
    };
    this.users.push(user);
    return user;
  }

  async updateLastLogin(userId: string, lastLoginAt: Date) {
    const user = this.users.find((u) => u.id === userId);
    if (!user) throw new Error('User not found');
    user.lastLoginAt = lastLoginAt;
    user.updatedAt = new Date();
    return user;
  }

  async recordAuditLog(_data: RecordAuditLogData) {
    // no-op for register tests
  }
}

async function runRegisterTests() {
  console.log('🧪 Starting User Registration Unit & Integration Tests...');

  // Service Level Unit Tests
  const repo = new InMemoryUserRepository();
  const service = new RegisterService(repo);

  const validPayload = {
    email: 'testuser@example.com',
    username: 'testuser123',
    fullName: 'Test User',
    password: 'ValidPassword123!',
  };

  const user = await service.register(validPayload);
  if (!user.id || user.email !== validPayload.email || user.username !== validPayload.username) {
    throw new Error('RegisterService failed to create user correctly');
  }

  // Verify passwordHash is NOT present in response DTO
  if ('passwordHash' in user || 'password' in user) {
    throw new Error('Security Violation: Password data returned in response object');
  }
  console.log('  ✅ Service registration & security verification passed');

  // Test duplicate email at Service level
  try {
    await service.register({
      ...validPayload,
      username: 'anotherusername',
    });
    throw new Error('Expected duplicate email ConflictError');
  } catch (err: unknown) {
    if (!(err instanceof Error) || !err.message.includes('Email already exists')) {
      throw err;
    }
  }
  console.log('  ✅ Service duplicate email check passed');

  // Test duplicate username at Service level
  try {
    await service.register({
      ...validPayload,
      email: 'anotheremail@example.com',
    });
    throw new Error('Expected duplicate username ConflictError');
  } catch (err: unknown) {
    if (!(err instanceof Error) || !err.message.includes('Username already exists')) {
      throw err;
    }
  }
  console.log('  ✅ Service duplicate username check passed');

  // HTTP Integration Tests via Fastify inject with in-memory repository dependency injection
  const app = buildApp({ userRepository: repo });

  // Test 1: Successful HTTP Registration
  const httpResponse = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: {
      email: 'httpuser@example.com',
      username: 'httpuser',
      fullName: 'HTTP Test User',
      password: 'StrongPassword123!',
    },
  });

  if (httpResponse.statusCode !== 201) {
    throw new Error(
      `Expected HTTP status 201, got ${httpResponse.statusCode}: ${httpResponse.body}`,
    );
  }

  const responseBody = JSON.parse(httpResponse.body) as {
    success: boolean;
    data: { id: string; email: string; username: string; passwordHash?: string };
  };

  if (!responseBody.success || !responseBody.data.id || responseBody.data.passwordHash) {
    throw new Error('Invalid HTTP response body or password hash leaked in HTTP response');
  }
  console.log('  ✅ HTTP POST /v1/auth/register success test passed');

  // Test 2: HTTP Duplicate Email Rejection (409)
  const duplicateEmailResp = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: {
      email: 'httpuser@example.com',
      username: 'differentuser',
      fullName: 'Different User',
      password: 'StrongPassword123!',
    },
  });

  if (duplicateEmailResp.statusCode !== 409) {
    throw new Error(
      `Expected 409 Conflict for duplicate email, got ${duplicateEmailResp.statusCode}`,
    );
  }
  console.log('  ✅ HTTP Duplicate email 409 Conflict test passed');

  // Test 3: HTTP Duplicate Username Rejection (409)
  const duplicateUsernameResp = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: {
      email: 'differentemail@example.com',
      username: 'httpuser',
      fullName: 'Different User',
      password: 'StrongPassword123!',
    },
  });

  if (duplicateUsernameResp.statusCode !== 409) {
    throw new Error(
      `Expected 409 Conflict for duplicate username, got ${duplicateUsernameResp.statusCode}`,
    );
  }
  console.log('  ✅ HTTP Duplicate username 409 Conflict test passed');

  // Test 4: Invalid Password (too short, missing uppercase, missing special char)
  const invalidPasswordResp = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: {
      email: 'weakpass@example.com',
      username: 'weakpassuser',
      fullName: 'Weak Pass User',
      password: 'weakpassword',
    },
  });

  if (invalidPasswordResp.statusCode !== 400) {
    throw new Error(`Expected 400 for weak password, got ${invalidPasswordResp.statusCode}`);
  }
  console.log('  ✅ HTTP Invalid password validation test passed');

  // Test 5: Invalid Email Format
  const invalidEmailResp = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: {
      email: 'not-an-email',
      username: 'invalidemailuser',
      fullName: 'Invalid Email User',
      password: 'StrongPassword123!',
    },
  });

  if (invalidEmailResp.statusCode !== 400) {
    throw new Error(`Expected 400 for invalid email, got ${invalidEmailResp.statusCode}`);
  }
  console.log('  ✅ HTTP Invalid email validation test passed');

  console.log('🎉 All User Registration Tests passed successfully!');
}

runRegisterTests().catch((err) => {
  console.error('❌ User Registration Tests failed:', err);
  process.exit(1);
});
