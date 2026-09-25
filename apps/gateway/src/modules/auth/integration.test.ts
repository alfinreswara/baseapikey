import { UserRole, UserStatus } from '@baseapikey/database';

import { setupAuthTestSuite } from './testing/auth-test-utils';
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

async function runAuthenticationIntegrationTests(): Promise<void> {
  console.log('🧪 Running Comprehensive Authentication Integration Test Suite...\n');

  const suite = await setupAuthTestSuite();

  try {
    // -------------------------------------------------------------------------
    // 1. REGISTRATION INTEGRATION TEST CASES
    // -------------------------------------------------------------------------
    console.log('▶ [Group 1] User Registration Workflow Tests');
    {
      suite.cleanup();

      // 1.1 Successful Registration
      const regRes = await suite.app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          email: 'alice@example.com',
          username: 'alice_user',
          fullName: 'Alice Walker',
          password: 'Password123!@#',
        },
      });

      if (regRes.statusCode !== 201) {
        throw new Error(`Registration failed: ${regRes.statusCode} - ${regRes.body}`);
      }
      const regBody = JSON.parse(regRes.body);
      if (!regBody.success || !regBody.data.id || regBody.data.email !== 'alice@example.com') {
        throw new Error('Registration response structure invalid');
      }

      // 1.2 Duplicate Email Rejection (409)
      const dupEmailRes = await suite.app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          email: 'ALICE@example.com',
          username: 'alice_user2',
          fullName: 'Alice Duplicate',
          password: 'Password123!@#',
        },
      });
      if (dupEmailRes.statusCode !== 409) {
        throw new Error(`Expected 409 for duplicate email, got ${dupEmailRes.statusCode}`);
      }

      // 1.3 Duplicate Username Rejection (409)
      const dupUsernameRes = await suite.app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          email: 'alice2@example.com',
          username: 'alice_user',
          fullName: 'Alice Duplicate Username',
          password: 'Password123!@#',
        },
      });
      if (dupUsernameRes.statusCode !== 409) {
        throw new Error(`Expected 409 for duplicate username, got ${dupUsernameRes.statusCode}`);
      }

      // 1.4 Invalid Password Format (400)
      const invalidPwRes = await suite.app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          email: 'bob@example.com',
          username: 'bob_user',
          fullName: 'Bob Smith',
          password: 'weak',
        },
      });
      if (invalidPwRes.statusCode !== 400) {
        throw new Error(`Expected 400 for weak password, got ${invalidPwRes.statusCode}`);
      }

      // 1.5 Invalid Email Format (400)
      const invalidEmailRes = await suite.app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          email: 'not-an-email',
          username: 'charlie_user',
          fullName: 'Charlie Brown',
          password: 'Password123!@#',
        },
      });
      if (invalidEmailRes.statusCode !== 400) {
        throw new Error(`Expected 400 for invalid email, got ${invalidEmailRes.statusCode}`);
      }

      console.log('  ✅ Registration test cases passed');
    }

    // -------------------------------------------------------------------------
    // 2. LOGIN INTEGRATION TEST CASES
    // -------------------------------------------------------------------------
    console.log('▶ [Group 2] User Login Workflow Tests');
    {
      suite.cleanup();

      // Register test user
      await suite.app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          email: 'user.login@example.com',
          username: 'login_user',
          fullName: 'Login User',
          password: 'Password123!@#',
        },
      });

      // 2.1 Successful Login
      const loginRes = await suite.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: {
          email: 'user.login@example.com',
          password: 'Password123!@#',
        },
      });
      if (loginRes.statusCode !== 200) {
        throw new Error(`Login failed with status ${loginRes.statusCode}: ${loginRes.body}`);
      }
      const loginBody = JSON.parse(loginRes.body);
      if (!loginBody.data.accessToken || !loginBody.data.refreshToken) {
        throw new Error('Login response missing tokens');
      }

      // 2.2 Wrong Password
      const wrongPwRes = await suite.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: {
          email: 'user.login@example.com',
          password: 'WrongPassword123!',
        },
      });
      if (wrongPwRes.statusCode !== 401) {
        throw new Error(`Expected 401 for wrong password, got ${wrongPwRes.statusCode}`);
      }

      // 2.3 Unknown Email
      const unknownEmailRes = await suite.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: {
          email: 'nonexistent@example.com',
          password: 'Password123!@#',
        },
      });
      if (unknownEmailRes.statusCode !== 401) {
        throw new Error(`Expected 401 for unknown email, got ${unknownEmailRes.statusCode}`);
      }

      // 2.4 Suspended User Rejection
      const suspendedPwHash = await suite.passwordService.hash('Password123!@#');
      const suspendedUser = await suite.userRepository.create({
        email: 'suspended@example.com',
        username: 'suspended_user',
        fullName: 'Suspended User',
        passwordHash: suspendedPwHash,
        status: UserStatus.SUSPENDED,
      });

      const suspendedRes = await suite.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: {
          email: suspendedUser.email,
          password: 'Password123!@#',
        },
      });
      if (suspendedRes.statusCode !== 401) {
        throw new Error(`Expected 401 for suspended user, got ${suspendedRes.statusCode}`);
      }

      // 2.5 Deleted User Rejection
      const deletedUser = await suite.userRepository.create({
        email: 'deleted@example.com',
        username: 'deleted_user',
        fullName: 'Deleted User',
        passwordHash: suspendedPwHash,
      });
      deletedUser.deletedAt = new Date();

      const deletedRes = await suite.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: {
          email: deletedUser.email,
          password: 'Password123!@#',
        },
      });
      if (deletedRes.statusCode !== 401) {
        throw new Error(`Expected 401 for deleted user, got ${deletedRes.statusCode}`);
      }

      console.log('  ✅ Login test cases passed');
    }

    // -------------------------------------------------------------------------
    // 3. JWT AUTHENTICATION TEST CASES
    // -------------------------------------------------------------------------
    console.log('▶ [Group 3] JWT Authentication Lifecycle Tests');
    {
      suite.cleanup();

      const pwHash = await suite.passwordService.hash('Password123!@#');
      const user = await suite.userRepository.create({
        email: 'jwt.user@example.com',
        username: 'jwt_user',
        fullName: 'JWT User',
        passwordHash: pwHash,
      });

      // 3.1 Valid Access Token
      const validToken = suite.jwtService.generateAccessToken({
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      const validRes = await suite.app.inject({
        method: 'GET',
        url: '/v1/auth/me',
        headers: { authorization: `Bearer ${validToken}` },
      });
      if (validRes.statusCode !== 200) {
        throw new Error(`Expected 200 for valid JWT, got ${validRes.statusCode}`);
      }

      // 3.2 Expired Access Token
      const expiredToken = signJwt(
        {
          sub: user.id,
          email: user.email,
          role: user.role,
          apiVersion: 'v1',
          tokenVersion: 1,
          type: 'access',
          exp: Math.floor(Date.now() / 1000) - 100, // expired in past
        },
        process.env['JWT_ACCESS_SECRET']!,
        '15m',
      );

      const expiredRes = await suite.app.inject({
        method: 'GET',
        url: '/v1/auth/me',
        headers: { authorization: `Bearer ${expiredToken}` },
      });
      if (expiredRes.statusCode !== 401) {
        throw new Error(`Expected 401 for expired token, got ${expiredRes.statusCode}`);
      }

      // 3.3 Invalid Signature
      const wrongSecretToken = signJwt(
        {
          sub: user.id,
          email: user.email,
          role: user.role,
          apiVersion: 'v1',
          tokenVersion: 1,
          type: 'access',
        },
        'wrong-secret-minimum-32-characters-long-secret-key-123',
        '15m',
      );

      const wrongSigRes = await suite.app.inject({
        method: 'GET',
        url: '/v1/auth/me',
        headers: { authorization: `Bearer ${wrongSecretToken}` },
      });
      if (wrongSigRes.statusCode !== 401) {
        throw new Error(`Expected 401 for invalid signature, got ${wrongSigRes.statusCode}`);
      }

      // 3.4 Tampered Token
      const tamperedToken = `${validToken}tampered`;
      const tamperedRes = await suite.app.inject({
        method: 'GET',
        url: '/v1/auth/me',
        headers: { authorization: `Bearer ${tamperedToken}` },
      });
      if (tamperedRes.statusCode !== 401) {
        throw new Error(`Expected 401 for tampered token, got ${tamperedRes.statusCode}`);
      }

      console.log('  ✅ JWT Authentication test cases passed');
    }

    // -------------------------------------------------------------------------
    // 4. REFRESH TOKEN & ROTATION TEST CASES
    // -------------------------------------------------------------------------
    console.log('▶ [Group 4] Refresh Token & Rotation Tests');
    {
      suite.cleanup();

      const pwHash = await suite.passwordService.hash('Password123!@#');
      const user = await suite.userRepository.create({
        email: 'refresh.user@example.com',
        username: 'refresh_user',
        fullName: 'Refresh User',
        passwordHash: pwHash,
      });

      const loginRes = await suite.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: {
          email: user.email,
          password: 'Password123!@#',
        },
      });
      const loginBody = JSON.parse(loginRes.body);
      const initialRefreshToken = loginBody.data.refreshToken;

      // 4.1 Successful Refresh & Token Rotation
      const refreshRes = await suite.app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken: initialRefreshToken },
      });
      if (refreshRes.statusCode !== 200) {
        throw new Error(
          `Expected 200 on refresh, got ${refreshRes.statusCode}: ${refreshRes.body}`,
        );
      }
      const refreshBody = JSON.parse(refreshRes.body);
      if (!refreshBody.data.accessToken || !refreshBody.data.refreshToken) {
        throw new Error('Refresh response missing rotated tokens');
      }

      // 4.2 Replay Attack / Token Reuse Detection
      const reuseRes = await suite.app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken: initialRefreshToken },
      });
      if (reuseRes.statusCode !== 401) {
        throw new Error(`Expected 401 for refresh token reuse attempt, got ${reuseRes.statusCode}`);
      }

      // 4.3 Expired Refresh Token
      const expiredRefresh = signJwt(
        {
          sub: user.id,
          email: user.email,
          role: user.role,
          type: 'refresh',
          exp: Math.floor(Date.now() / 1000) - 100,
        },
        process.env['JWT_REFRESH_SECRET']!,
        '7d',
      );
      const expiredRefreshRes = await suite.app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken: expiredRefresh },
      });
      if (expiredRefreshRes.statusCode !== 401) {
        throw new Error(
          `Expected 401 for expired refresh token, got ${expiredRefreshRes.statusCode}`,
        );
      }

      // 4.4 Revoked Session Refresh Attempt
      const revokedSession = await suite.sessionRepository.createSession({
        userId: user.id,
        refreshTokenHash: 'revoked_token_hash',
        expiresAt: new Date(Date.now() + 3600000),
      });
      await suite.sessionRepository.revokeSession(revokedSession.id);

      const revokedSessionToken = suite.jwtService.generateRefreshToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        sessionId: revokedSession.id,
      });

      const revokedRefreshRes = await suite.app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken: revokedSessionToken },
      });
      if (revokedRefreshRes.statusCode !== 401) {
        throw new Error(
          `Expected 401 for revoked session refresh, got ${revokedRefreshRes.statusCode}`,
        );
      }

      // 4.5 Invalid Refresh Token Format
      const invalidRefreshRes = await suite.app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken: 'invalid-refresh-token' },
      });
      if (invalidRefreshRes.statusCode !== 401 && invalidRefreshRes.statusCode !== 400) {
        throw new Error(
          `Expected 401/400 for invalid refresh token, got ${invalidRefreshRes.statusCode}`,
        );
      }

      console.log('  ✅ Refresh token & rotation test cases passed');
    }

    // -------------------------------------------------------------------------
    // 5. LOGOUT INTEGRATION TEST CASES
    // -------------------------------------------------------------------------
    console.log('▶ [Group 5] Logout & Session Revocation Tests');
    {
      suite.cleanup();

      const pwHash = await suite.passwordService.hash('Password123!@#');
      const user = await suite.userRepository.create({
        email: 'logout.user@example.com',
        username: 'logout_user',
        fullName: 'Logout User',
        passwordHash: pwHash,
      });

      const loginRes = await suite.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: user.email, password: 'Password123!@#' },
      });
      const loginBody = JSON.parse(loginRes.body);
      const accessToken = loginBody.data.accessToken;
      const refreshToken = loginBody.data.refreshToken;

      // 5.1 Logout Current Session
      const logoutRes = await suite.app.inject({
        method: 'POST',
        url: '/v1/auth/logout',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { refreshToken },
      });
      if (logoutRes.statusCode !== 204) {
        throw new Error(`Expected 204 for logout, got ${logoutRes.statusCode}`);
      }

      // 5.2 Revoked Token Cannot Refresh
      const refreshAfterLogoutRes = await suite.app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken },
      });
      if (refreshAfterLogoutRes.statusCode !== 401) {
        throw new Error(
          `Expected 401 when refreshing logged out session token, got ${refreshAfterLogoutRes.statusCode}`,
        );
      }

      // 5.3 Logout All Sessions
      const loginRes2 = await suite.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: user.email, password: 'Password123!@#' },
      });
      const loginBody2 = JSON.parse(loginRes2.body);

      const logoutAllRes = await suite.app.inject({
        method: 'POST',
        url: '/v1/auth/logout-all',
        headers: { authorization: `Bearer ${loginBody2.data.accessToken}` },
      });
      if (logoutAllRes.statusCode !== 204) {
        throw new Error(`Expected 204 for logout-all, got ${logoutAllRes.statusCode}`);
      }

      console.log('  ✅ Logout test cases passed');
    }

    // -------------------------------------------------------------------------
    // 6. AUTHENTICATION MIDDLEWARE & ROUTE PROTECTION
    // -------------------------------------------------------------------------
    console.log('▶ [Group 6] Middleware & Route Protection Tests');
    {
      suite.cleanup();

      const pwHash = await suite.passwordService.hash('Password123!@#');
      const user = await suite.userRepository.create({
        email: 'mw.user@example.com',
        username: 'mw_user',
        fullName: 'MW User',
        passwordHash: pwHash,
      });

      const validToken = suite.jwtService.generateAccessToken({
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      // 6.1 Protected Endpoint Success
      const successRes = await suite.app.inject({
        method: 'GET',
        url: '/v1/auth/me',
        headers: { authorization: `Bearer ${validToken}` },
      });
      if (successRes.statusCode !== 200) {
        throw new Error(`Expected 200 for protected endpoint, got ${successRes.statusCode}`);
      }

      // 6.2 Missing Authorization Header
      const missingHeaderRes = await suite.app.inject({
        method: 'GET',
        url: '/v1/auth/me',
      });
      if (missingHeaderRes.statusCode !== 401) {
        throw new Error(`Expected 401 for missing auth header, got ${missingHeaderRes.statusCode}`);
      }

      // 6.3 Invalid Bearer Token
      const invalidBearerRes = await suite.app.inject({
        method: 'GET',
        url: '/v1/auth/me',
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      });
      if (invalidBearerRes.statusCode !== 401) {
        throw new Error(
          `Expected 401 for invalid Bearer format, got ${invalidBearerRes.statusCode}`,
        );
      }

      // 6.4 Unauthorized Request (garbage token)
      const unauthRes = await suite.app.inject({
        method: 'GET',
        url: '/v1/auth/me',
        headers: { authorization: 'Bearer invalid.jwt.structure' },
      });
      if (unauthRes.statusCode !== 401) {
        throw new Error(`Expected 401 for unauthorized token, got ${unauthRes.statusCode}`);
      }

      console.log('  ✅ Middleware & route protection test cases passed');
    }

    // -------------------------------------------------------------------------
    // 7. ROLE-BASED ACCESS CONTROL (RBAC) TEST CASES
    // -------------------------------------------------------------------------
    console.log('▶ [Group 7] Role-Based Access Control (RBAC) Tests');
    {
      suite.cleanup();

      const pwHash = await suite.passwordService.hash('Password123!@#');
      const regularUser = await suite.userRepository.create({
        email: 'user.rbac@example.com',
        username: 'user_rbac',
        fullName: 'User RBAC',
        passwordHash: pwHash,
        role: UserRole.USER,
      });

      const adminUser = await suite.userRepository.create({
        email: 'admin.rbac@example.com',
        username: 'admin_rbac',
        fullName: 'Admin RBAC',
        passwordHash: pwHash,
        role: UserRole.ADMIN,
      });

      const userToken = suite.jwtService.generateAccessToken({
        userId: regularUser.id,
        email: regularUser.email,
        role: regularUser.role,
      });

      const adminToken = suite.jwtService.generateAccessToken({
        userId: adminUser.id,
        email: adminUser.email,
        role: adminUser.role,
      });

      // 7.1 USER accessing USER endpoint
      const userRes = await suite.app.inject({
        method: 'GET',
        url: '/v1/user/apikeys',
        headers: { authorization: `Bearer ${userToken}` },
      });
      if (userRes.statusCode !== 200) {
        throw new Error(`Expected 200 for USER accessing USER endpoint, got ${userRes.statusCode}`);
      }

      // 7.2 USER denied ADMIN endpoint (403)
      const userDeniedRes = await suite.app.inject({
        method: 'GET',
        url: '/v1/admin/system',
        headers: { authorization: `Bearer ${userToken}` },
      });
      if (userDeniedRes.statusCode !== 403) {
        throw new Error(
          `Expected 403 for USER accessing ADMIN endpoint, got ${userDeniedRes.statusCode}`,
        );
      }

      // 7.3 ADMIN accessing ADMIN endpoint
      const adminRes = await suite.app.inject({
        method: 'GET',
        url: '/v1/admin/system',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      if (adminRes.statusCode !== 200) {
        throw new Error(
          `Expected 200 for ADMIN accessing ADMIN endpoint, got ${adminRes.statusCode}`,
        );
      }

      console.log('  ✅ RBAC test cases passed');
    }

    // -------------------------------------------------------------------------
    // 8. SESSION MANAGEMENT API TEST CASES
    // -------------------------------------------------------------------------
    console.log('▶ [Group 8] Session Management API Tests');
    {
      suite.cleanup();

      const pwHash = await suite.passwordService.hash('Password123!@#');
      const user1 = await suite.userRepository.create({
        email: 'sess.user1@example.com',
        username: 'sess_user1',
        fullName: 'Sess User 1',
        passwordHash: pwHash,
      });

      const user2 = await suite.userRepository.create({
        email: 'sess.user2@example.com',
        username: 'sess_user2',
        fullName: 'Sess User 2',
        passwordHash: pwHash,
      });

      const expiresAt = new Date(Date.now() + 3600000);
      const user1Sess1 = await suite.sessionRepository.createSession({
        userId: user1.id,
        refreshTokenHash: 'hash_u1_s1',
        deviceName: 'MacBook Pro',
        expiresAt,
      });

      const user1Sess2 = await suite.sessionRepository.createSession({
        userId: user1.id,
        refreshTokenHash: 'hash_u1_s2',
        deviceName: 'iPhone',
        expiresAt,
      });

      const user2Sess1 = await suite.sessionRepository.createSession({
        userId: user2.id,
        refreshTokenHash: 'hash_u2_s1',
        deviceName: 'Windows PC',
        expiresAt,
      });

      const user1Token = suite.jwtService.generateAccessToken({
        userId: user1.id,
        email: user1.email,
        role: user1.role,
        sessionId: user1Sess1.id,
      });

      // 8.1 List Sessions
      const listRes = await suite.app.inject({
        method: 'GET',
        url: '/v1/auth/sessions',
        headers: { authorization: `Bearer ${user1Token}` },
      });
      if (listRes.statusCode !== 200) {
        throw new Error(`Expected 200 on list sessions, got ${listRes.statusCode}`);
      }
      const listBody = JSON.parse(listRes.body);
      if (!Array.isArray(listBody.data) || listBody.data.length !== 2) {
        throw new Error(`Expected 2 active sessions for user1, got ${listBody.data?.length}`);
      }

      // 8.2 Get Session Details
      const detailRes = await suite.app.inject({
        method: 'GET',
        url: `/v1/auth/sessions/${user1Sess2.id}`,
        headers: { authorization: `Bearer ${user1Token}` },
      });
      if (detailRes.statusCode !== 200) {
        throw new Error(`Expected 200 for session detail, got ${detailRes.statusCode}`);
      }

      // 8.3 Revoke Session
      const revokeRes = await suite.app.inject({
        method: 'DELETE',
        url: `/v1/auth/sessions/${user1Sess2.id}`,
        headers: { authorization: `Bearer ${user1Token}` },
      });
      if (revokeRes.statusCode !== 200) {
        throw new Error(`Expected 200 on session revoke, got ${revokeRes.statusCode}`);
      }

      // 8.4 Prevent Access to Another User's Session (403)
      const crossAccessRes = await suite.app.inject({
        method: 'GET',
        url: `/v1/auth/sessions/${user2Sess1.id}`,
        headers: { authorization: `Bearer ${user1Token}` },
      });
      if (crossAccessRes.statusCode !== 403) {
        throw new Error(
          `Expected 403 for cross-user session access, got ${crossAccessRes.statusCode}`,
        );
      }

      console.log('  ✅ Session Management API test cases passed');
    }

    // -------------------------------------------------------------------------
    // 9. AUDIT LOG VERIFICATION TEST CASES
    // -------------------------------------------------------------------------
    console.log('▶ [Group 9] Audit Log Events Verification Tests');
    {
      suite.cleanup();

      // Step A: Registration -> AUTH_REGISTER
      const regRes = await suite.app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          email: 'audit.user@example.com',
          username: 'audit_user',
          fullName: 'Audit User',
          password: 'Password123!@#',
        },
      });
      if (regRes.statusCode !== 201) throw new Error('Audit test registration failed');

      // Step B: Login -> AUTH_LOGIN_SUCCESS
      const loginRes = await suite.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: 'audit.user@example.com', password: 'Password123!@#' },
      });
      if (loginRes.statusCode !== 200) throw new Error('Audit test login failed');
      const loginData = JSON.parse(loginRes.body).data;

      // Step C: Refresh -> AUTH_TOKEN_REFRESH
      const refreshRes = await suite.app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken: loginData.refreshToken },
      });
      if (refreshRes.statusCode !== 200) throw new Error('Audit test refresh failed');
      const refreshData = JSON.parse(refreshRes.body).data;

      // Step D: Session Revoke -> AUTH_SESSION_REVOKE
      const createSess = await suite.sessionRepository.createSession({
        userId: loginData.user.id,
        refreshTokenHash: 'audit_dummy_hash',
        expiresAt: new Date(Date.now() + 3600000),
      });

      const revokeRes = await suite.app.inject({
        method: 'DELETE',
        url: `/v1/auth/sessions/${createSess.id}`,
        headers: { authorization: `Bearer ${refreshData.accessToken}` },
      });
      if (revokeRes.statusCode !== 200) throw new Error('Audit test session revoke failed');

      // Step E: Logout -> AUTH_LOGOUT
      const logoutRes = await suite.app.inject({
        method: 'POST',
        url: '/v1/auth/logout',
        headers: { authorization: `Bearer ${refreshData.accessToken}` },
        payload: { refreshToken: refreshData.refreshToken },
      });
      if (logoutRes.statusCode !== 204) throw new Error('Audit test logout failed');

      // Verify Recorded Audit Log Events
      const auditActions = suite.userRepository.auditLogs.map((a) => a.action);

      const requiredActions = [
        'AUTH_REGISTER',
        'AUTH_LOGIN_SUCCESS',
        'AUTH_REFRESH_SUCCESS',
        'AUTH_SESSION_REVOKE',
        'AUTH_LOGOUT_SUCCESS',
      ];

      for (const reqAction of requiredActions) {
        if (!auditActions.includes(reqAction)) {
          throw new Error(`Missing expected audit log action: ${reqAction}`);
        }
      }

      console.log('  ✅ Audit log verification passed for all authentication lifecycle events');
    }

    console.log('\n🎉 ALL Comprehensive Authentication Integration Tests Completed Successfully!');
  } finally {
    suite.cleanup();
  }
}

runAuthenticationIntegrationTests().catch((err) => {
  console.error('❌ Authentication Integration Test Failure:', err);
  process.exit(1);
});
