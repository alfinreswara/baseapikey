import { AuthModule } from './auth.module';
import { InvalidTokenError } from './errors/auth.errors';
import { passwordService } from './services/password.service';
import { hashPassword, verifyPassword } from './utils/argon2.util';
import { signJwt } from './utils/jwt.util';

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

async function runAuthFoundationTests() {
  console.log('🧪 Starting Auth Foundation Unit Tests...');

  // Test 1: Argon2 Password Hashing & Verification
  const testPassword = 'SecurePassword123!';
  const hash = await hashPassword(testPassword);
  if (!hash || typeof hash !== 'string') {
    throw new Error('hashPassword failed to return a string hash');
  }

  const isValid = await verifyPassword(hash, testPassword);
  if (!isValid) {
    throw new Error('verifyPassword failed for correct password');
  }

  const isInvalid = await verifyPassword(hash, 'WrongPassword!');
  if (isInvalid) {
    throw new Error('verifyPassword succeeded for incorrect password');
  }

  const serviceHash = await passwordService.hash(testPassword);
  const serviceValid = await passwordService.verify(testPassword, serviceHash);
  if (!serviceValid) {
    throw new Error('PasswordService verification failed');
  }
  console.log('  ✅ Argon2 Password Hashing & Verification passed');

  // Test 2: JWT Service & Auth Module
  const testConfig = {
    jwtAccessSecret: 'test_access_secret_key_32_chars_min_len!',
    jwtRefreshSecret: 'test_refresh_secret_key_32_chars_min_len!',
    jwtAccessExpiresIn: '5s',
    jwtRefreshExpiresIn: '10s',
  };

  const authModule = new AuthModule(testConfig);
  const userId = 'usr_12345';
  const email = 'user@example.com';
  const role = 'USER';

  const tokenPair = authModule.jwtService.generateTokenPair(userId, email, role);
  if (!tokenPair.accessToken || !tokenPair.refreshToken) {
    throw new Error('Failed to generate token pair');
  }

  const accessPayload = authModule.jwtService.verifyToken(tokenPair.accessToken, 'access');
  if (
    accessPayload.sub !== userId ||
    accessPayload.email !== email ||
    accessPayload.role !== role
  ) {
    throw new Error('Access token payload mismatch');
  }

  const refreshPayload = authModule.jwtService.verifyToken(tokenPair.refreshToken, 'refresh');
  if (refreshPayload.sub !== userId || refreshPayload.type !== 'refresh') {
    throw new Error('Refresh token payload mismatch');
  }

  // Test token type mismatch with valid signature
  const wrongTypeToken = signJwt(
    { sub: userId, email, role, type: 'refresh' },
    testConfig.jwtAccessSecret,
    '5s',
  );
  try {
    authModule.jwtService.verifyToken(wrongTypeToken, 'access');
    throw new Error('Expected invalid token type error, but succeeded');
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('Invalid token type')) {
      throw error;
    }
  }

  // Test invalid token signature
  try {
    authModule.jwtService.verifyToken('invalid.jwt.token', 'access');
    throw new Error('Expected InvalidTokenError, but succeeded');
  } catch (error) {
    if (!(error instanceof InvalidTokenError)) {
      throw error;
    }
  }

  console.log('  ✅ JWT Token Sign & Verify passed');
  console.log('🎉 All Auth Foundation Unit Tests passed successfully!');
}

runAuthFoundationTests().catch((err) => {
  console.error('❌ Auth Foundation Unit Tests failed:', err);
  process.exit(1);
});
