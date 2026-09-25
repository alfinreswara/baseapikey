import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const MOCK_API_KEY = ['sk', 'live', 'e2e', 'secret'].join('_');

function send(response: ServerResponse, body: unknown, statusCode = 200): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

const usageItem = {
  id: '33333333-3333-4333-8333-333333333333',
  apiKeyId: '22222222-2222-4222-8222-222222222222',
  provider: 'nine-router',
  model: 'gpt-demo',
  endpoint: '/v1/chat/completions',
  requestId: 'request-demo',
  promptTokens: 24,
  completionTokens: 18,
  totalTokens: 42,
  estimatedCost: 0.0012,
  latencyMs: 218,
  statusCode: 200,
  status: 'SUCCESS',
  createdAt: new Date().toISOString(),
};

let currentAccessToken = 'access-login';
let currentRefreshToken = 'refresh-login';
let refreshCalls = 0;

const server = createServer((request, response) => {
  void (async () => {
    response.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:3101');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1:3100');
    if (url.pathname === '/health/live') return send(response, { status: 'ok' });
    if (url.pathname === '/__expire-access') {
      currentAccessToken = 'expired-on-server';
      return send(response, { success: true });
    }
    if (url.pathname === '/__stats') {
      return send(response, { refreshCalls });
    }
    if (url.pathname === '/v1/auth/login') {
      const credentials = await readJson(request);
      if (credentials['email'] !== 'admin@example.com') {
        return send(
          response,
          { success: false, error: { message: 'Invalid email or password' } },
          401,
        );
      }
      currentAccessToken = 'access-login';
      currentRefreshToken = 'refresh-login';
      return send(response, {
        success: true,
        data: {
          accessToken: 'access-login',
          refreshToken: 'refresh-login',
          expiresIn: '15m',
          tokenType: 'Bearer',
          user: {
            id: '11111111-1111-4111-8111-111111111111',
            email: 'admin@example.com',
            username: 'admin',
            fullName: 'Admin Example',
            role: 'ADMIN',
          },
        },
      });
    }
    if (url.pathname === '/v1/auth/refresh') {
      refreshCalls += 1;
      const input = await readJson(request);
      if (input['refreshToken'] !== currentRefreshToken) {
        return send(
          response,
          { success: false, error: { message: 'Refresh token reuse detected' } },
          401,
        );
      }
      const rotatedAccessToken = `access-refreshed-${refreshCalls}`;
      const rotatedRefreshToken = `refresh-rotated-${refreshCalls}`;
      currentAccessToken = rotatedAccessToken;
      currentRefreshToken = rotatedRefreshToken;
      await new Promise((resolve) => setTimeout(resolve, 75));
      return send(response, {
        success: true,
        data: {
          accessToken: rotatedAccessToken,
          refreshToken: rotatedRefreshToken,
          expiresIn: '15m',
          tokenType: 'Bearer',
        },
      });
    }
    if (url.pathname === '/v1/auth/logout') {
      response.writeHead(204);
      response.end();
      return;
    }
    const protectedPath = url.pathname.startsWith('/api/v1/') || url.pathname === '/v1/api-keys';
    const authorization = request.headers.authorization;
    if (protectedPath && authorization !== `Bearer ${currentAccessToken}`) {
      return send(response, { success: false, error: { message: 'Unauthorized' } }, 401);
    }
    if (url.pathname === '/api/v1/me') {
      return send(response, {
        success: true,
        data: {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'admin@example.com',
          username: 'admin',
          fullName: 'Admin Example',
          role: 'ADMIN',
          status: 'ACTIVE',
          emailVerified: true,
        },
      });
    }
    if (url.pathname === '/api/v1/me/organizations') {
      return send(response, {
        success: true,
        data: [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            name: 'Example Team',
            slug: 'example-team',
            plan: 'PRO',
            role: 'OWNER',
            isCurrent: true,
          },
        ],
      });
    }
    if (url.pathname === '/v1/models') {
      return send(response, {
        object: 'list',
        data: [
          {
            id: 'gpt-demo',
            display_name: 'GPT Demo',
            owned_by: 'nine-router',
            category: 'CHAT',
            context_window: 128000,
            pricing: { input: 1.5, output: 6 },
            capabilities: { streaming: true },
            provider: { name: 'Nine Router', slug: 'nine-router' },
          },
        ],
      });
    }
    if (url.pathname === '/api/v1/usage/summary') {
      return send(response, {
        totals: {
          requests: 42,
          successfulRequests: 40,
          failedRequests: 2,
          promptTokens: 1200,
          completionTokens: 800,
          totalTokens: 2000,
          cost: 1.25,
        },
      });
    }
    if (url.pathname === '/api/v1/usage/history') {
      return send(response, { data: [usageItem], pagination: { hasMore: false } });
    }
    if (url.pathname === '/api/v1/usage') {
      return send(response, [
        {
          date: new Date().toISOString().slice(0, 10),
          requests: 42,
          successfulRequests: 40,
          failedRequests: 2,
          tokens: 2000,
          cost: 1.25,
          averageLatencyMs: 218,
        },
      ]);
    }
    if (url.pathname === '/v1/api-keys' && request.method === 'POST') {
      const input = await readJson(request);
      return send(
        response,
        {
          success: true,
          data: {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            name: input['name'],
            apiKey: MOCK_API_KEY,
            createdAt: new Date().toISOString(),
            expiresAt: null,
          },
        },
        201,
      );
    }
    if (url.pathname === '/v1/api-keys') {
      return send(response, {
        success: true,
        data: [
          {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            name: 'Production app',
            keyPrefix: MOCK_API_KEY.substring(0, 16),
            permissions: ['chat:completions'],
            status: 'ACTIVE',
            lastUsedAt: null,
          },
        ],
      });
    }
    if (url.pathname.endsWith('/members')) {
      return send(response, {
        success: true,
        data: [
          {
            userId: '11111111-1111-4111-8111-111111111111',
            email: 'admin@example.com',
            username: 'admin',
            fullName: 'Admin Example',
            role: 'OWNER',
            status: 'ACTIVE',
            joinedAt: new Date().toISOString(),
          },
        ],
      });
    }
    if (url.pathname.endsWith('/billing/transactions')) {
      return send(response, { success: true, data: [] });
    }
    if (url.pathname.endsWith('/billing/invoices')) {
      return send(response, { success: true, data: [] });
    }
    if (url.pathname.endsWith('/billing')) {
      return send(response, {
        success: true,
        data: { creditBalanceCents: 2500, currency: 'USD', status: 'ACTIVE' },
      });
    }
    if (url.pathname === '/api/v1/admin/providers') {
      return send(response, {
        success: true,
        data: [
          {
            name: 'Nine Router',
            slug: 'nine-router',
            healthStatus: 'HEALTHY',
            priority: 100,
            healthCheckedAt: new Date().toISOString(),
          },
        ],
      });
    }
    if (url.pathname === '/api/v1/admin/audit-logs') {
      return send(response, { success: true, data: [] });
    }
    if (url.pathname === '/api/v1/admin/health') {
      return send(response, { success: true, data: { status: 'HEALTHY', database: 'healthy' } });
    }
    if (url.pathname === '/api/v1/admin/usage') {
      return send(response, {
        success: true,
        data: { users: 12, organizations: 4, requests: 2400 },
      });
    }
    send(response, { success: false, error: { message: `Unhandled ${url.pathname}` } }, 404);
  })().catch((error: unknown) => {
    send(response, { success: false, error: { message: String(error) } }, 500);
  });
});

server.listen(3100, '127.0.0.1', () => {
  console.log('Dashboard E2E mock gateway listening at http://127.0.0.1:3100');
});

function shutdown(): void {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
