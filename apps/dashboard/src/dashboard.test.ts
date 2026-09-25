import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

process.env['NODE_ENV'] = 'test';

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function readBody(request: AsyncIterable<unknown>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString('utf8');
}

async function run(): Promise<void> {
  const { createDashboardServer, dashboardConfig, parseDashboardRuntimeEnv, resolvePublicPath } =
    await import('./server.js');
  const index = resolvePublicPath('/');
  assert.ok(index && existsSync(index));
  assert.match(readFileSync(index, 'utf8'), /BaseAPIKey/);
  const application = readFileSync(join(index, '..', 'app.js'), 'utf8');
  assert.match(application, /\/api\/v1\/usage\/summary/);
  assert.match(application, /group_by=day/);
  assert.match(application, /\/api\/session\/login/);
  assert.doesNotMatch(application, /localStorage\.getItem\('bak_refresh_token'\)/);
  assert.doesNotMatch(application, /state\.refreshToken/);
  assert.match(dashboardConfig(), /gatewayUrl/);
  assert.equal(resolvePublicPath('/../../etc/passwd')?.endsWith('index.html'), true);
  assert.equal(resolvePublicPath('/%E0%A4%A'), null);
  assert.throws(
    () =>
      parseDashboardRuntimeEnv({
        NODE_ENV: 'production',
        DASHBOARD_PUBLIC_URL: 'http://console.example.com',
        GATEWAY_PUBLIC_URL: 'https://api.example.com',
      }),
    /DASHBOARD_PUBLIC_URL must use HTTPS/,
  );
  assert.throws(
    () => parseDashboardRuntimeEnv({ NODE_ENV: 'test', DASHBOARD_PORT: '70000' }),
    /DASHBOARD_PORT/,
  );

  const received: Array<{ path: string; body: string; authorization?: string }> = [];
  const gateway = createServer((request, response) => {
    void (async () => {
      const body = await readBody(request);
      received.push({
        path: request.url ?? '',
        body,
        ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
      });
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/v1/auth/login') {
        response.end(
          JSON.stringify({
            success: true,
            data: {
              accessToken: 'access-login',
              refreshToken: 'refresh-login',
              user: { id: 'user-id', email: 'user@example.com' },
            },
          }),
        );
        return;
      }
      if (request.url === '/v1/auth/refresh') {
        const refreshInput = JSON.parse(body) as { refreshToken?: string };
        if (refreshInput.refreshToken === 'refresh-invalid') {
          response.statusCode = 401;
          response.end(
            JSON.stringify({ success: false, error: { message: 'Invalid refresh token' } }),
          );
          return;
        }
        if (refreshInput.refreshToken === 'refresh-transient') {
          response.statusCode = 503;
          response.end(
            JSON.stringify({ success: false, error: { message: 'Temporarily unavailable' } }),
          );
          return;
        }
        response.end(
          JSON.stringify({
            success: true,
            data: { accessToken: 'access-refreshed', refreshToken: 'refresh-rotated' },
          }),
        );
        return;
      }
      response.statusCode = 204;
      response.end();
    })();
  });
  const gatewayUrl = await listen(gateway);
  const dashboard = createDashboardServer({
    gatewayUrl,
    publicUrl: 'https://console.example.com',
    production: true,
  });
  const dashboardUrl = await listen(dashboard);

  try {
    const login = await fetch(`${dashboardUrl}/api/session/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://console.example.com',
      },
      body: JSON.stringify({ email: 'user@example.com', password: 'Password123!' }),
    });
    assert.equal(login.status, 200);
    const loginCookie = login.headers.get('set-cookie') ?? '';
    assert.match(loginCookie, /__Host-bak_refresh_token=refresh-login/);
    assert.match(loginCookie, /HttpOnly/);
    assert.match(loginCookie, /SameSite=Strict/);
    assert.match(loginCookie, /Secure/);
    assert.equal(
      login.headers.get('strict-transport-security'),
      'max-age=31536000; includeSubDomains',
    );
    assert.match(
      login.headers.get('content-security-policy') ?? '',
      /connect-src 'self' http:\/\/127\.0\.0\.1:\d+/,
    );
    const loginPayload = (await login.json()) as { data: Record<string, unknown> };
    assert.equal(loginPayload.data['accessToken'], 'access-login');
    assert.equal('refreshToken' in loginPayload.data, false);

    const refresh = await fetch(`${dashboardUrl}/api/session/refresh`, {
      method: 'POST',
      headers: {
        Cookie: '__Host-bak_refresh_token=refresh-login',
        Origin: 'https://console.example.com',
      },
    });
    assert.equal(refresh.status, 200);
    assert.match(refresh.headers.get('set-cookie') ?? '', /refresh-rotated/);
    const refreshPayload = (await refresh.json()) as { data: Record<string, unknown> };
    assert.equal(refreshPayload.data['accessToken'], 'access-refreshed');
    assert.equal('refreshToken' in refreshPayload.data, false);
    assert.deepEqual(JSON.parse(received[1]?.body ?? '{}'), { refreshToken: 'refresh-login' });

    const rejectedOrigin = await fetch(`${dashboardUrl}/api/session/refresh`, {
      method: 'POST',
      headers: {
        Cookie: '__Host-bak_refresh_token=refresh-login',
        Origin: 'https://attacker.example',
      },
    });
    assert.equal(rejectedOrigin.status, 403);
    assert.equal(received.length, 2);

    const invalidRefresh = await fetch(`${dashboardUrl}/api/session/refresh`, {
      method: 'POST',
      headers: {
        Cookie: '__Host-bak_refresh_token=refresh-invalid',
        Origin: 'https://console.example.com',
      },
    });
    assert.equal(invalidRefresh.status, 401);
    assert.match(invalidRefresh.headers.get('set-cookie') ?? '', /Max-Age=0/);

    const transientRefresh = await fetch(`${dashboardUrl}/api/session/refresh`, {
      method: 'POST',
      headers: {
        Cookie: '__Host-bak_refresh_token=refresh-transient',
        Origin: 'https://console.example.com',
      },
    });
    assert.equal(transientRefresh.status, 503);
    assert.equal(transientRefresh.headers.get('set-cookie'), null);

    const logout = await fetch(`${dashboardUrl}/api/session/logout`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer access-refreshed',
        Cookie: '__Host-bak_refresh_token=refresh-rotated',
        Origin: 'https://console.example.com',
      },
    });
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get('set-cookie') ?? '', /Max-Age=0/);
    assert.deepEqual(JSON.parse(received[4]?.body ?? '{}'), { refreshToken: 'refresh-rotated' });
    assert.equal(received[4]?.authorization, 'Bearer access-refreshed');
  } finally {
    await Promise.all([close(dashboard), close(gateway)]);
  }

  console.log('Dashboard smoke and secure-session tests passed');
}

void run();
