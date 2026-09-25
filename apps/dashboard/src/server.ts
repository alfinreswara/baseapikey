import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';

type DashboardNodeEnv = 'development' | 'staging' | 'production' | 'test';

interface DashboardRuntimeEnv {
  nodeEnv: DashboardNodeEnv;
  port: number;
  host: string;
  publicUrl: string;
  gatewayUrl: string;
}

function parseHttpUrl(name: string, value: string, requireHttps: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${name} must use HTTP or HTTPS`);
  }
  if (requireHttps && url.protocol !== 'https:') {
    throw new Error(`${name} must use HTTPS in production`);
  }
  return url.toString().replace(/\/$/, '');
}

export function parseDashboardRuntimeEnv(
  input: Record<string, string | undefined> = process.env,
): DashboardRuntimeEnv {
  const rawNodeEnv = input['NODE_ENV'] ?? 'development';
  if (!['development', 'staging', 'production', 'test'].includes(rawNodeEnv)) {
    throw new Error('NODE_ENV must be development, staging, production, or test');
  }
  const nodeEnv = rawNodeEnv as DashboardNodeEnv;
  const port = Number(input['DASHBOARD_PORT'] ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('DASHBOARD_PORT must be an integer between 1 and 65535');
  }
  const host = input['DASHBOARD_HOST']?.trim() || '0.0.0.0';
  const requireHttps = nodeEnv === 'production';
  return {
    nodeEnv,
    port,
    host,
    publicUrl: parseHttpUrl(
      'DASHBOARD_PUBLIC_URL',
      input['DASHBOARD_PUBLIC_URL'] ?? 'http://localhost:3001',
      requireHttps,
    ),
    gatewayUrl: parseHttpUrl(
      'GATEWAY_PUBLIC_URL',
      input['GATEWAY_PUBLIC_URL'] ?? 'http://localhost:3000',
      requireHttps,
    ),
  };
}

const runtimeEnv = parseDashboardRuntimeEnv();
const port = runtimeEnv.port;
const host = runtimeEnv.host;
const publicDir = join(__dirname, '..', 'public');
const SESSION_BODY_LIMIT = 64 * 1024;
const REFRESH_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

interface DashboardServerOptions {
  gatewayUrl?: string;
  publicUrl?: string;
  production?: boolean;
}

class SessionRequestError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

function secureHeaders(response: ServerResponse, gatewayUrl: string, production: boolean): void {
  const gatewayOrigin = new URL(gatewayUrl).origin;
  response.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; connect-src 'self' ${gatewayOrigin}; img-src 'self' data: https:; style-src 'self'; script-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
  );
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (production) {
    response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

export function resolvePublicPath(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname).split('?')[0] ?? '/';
  } catch {
    return null;
  }
  const relative = normalize(decoded)
    .replace(/^(\.\.[/\\])+/, '')
    .replace(/^[/\\]+/, '');
  const candidate = join(publicDir, relative || 'index.html');
  if (candidate !== publicDir && !candidate.startsWith(`${publicDir}/`)) return null;
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return join(publicDir, 'index.html');
}

export function dashboardConfig(): string {
  return `window.__BASEAPIKEY_CONFIG__=${JSON.stringify({ gatewayUrl: runtimeEnv.gatewayUrl })};`;
}

function refreshCookieName(production: boolean): string {
  return production ? '__Host-bak_refresh_token' : 'bak_refresh_token';
}

function serializeRefreshCookie(name: string, token: string, secure: boolean): string {
  const attributes = [
    `${name}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Strict',
    `Max-Age=${token ? REFRESH_COOKIE_MAX_AGE_SECONDS : 0}`,
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

function setRefreshCookie(response: ServerResponse, token: string, production: boolean): void {
  response.setHeader(
    'Set-Cookie',
    serializeRefreshCookie(refreshCookieName(production), token, production),
  );
}

function clearRefreshCookies(response: ServerResponse): void {
  response.setHeader('Set-Cookie', [
    serializeRefreshCookie('bak_refresh_token', '', false),
    serializeRefreshCookie('__Host-bak_refresh_token', '', true),
  ]);
}

function readRefreshCookie(request: IncomingMessage): string | null {
  const cookies = new Map<string, string>();
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }
  return cookies.get('__Host-bak_refresh_token') ?? cookies.get('bak_refresh_token') ?? null;
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > SESSION_BODY_LIMIT) {
      throw new SessionRequestError(413, 'Request payload is too large');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

function assertTrustedOrigin(
  request: IncomingMessage,
  publicUrl: string,
  production: boolean,
): void {
  if (!production || !request.headers.origin) return;
  let expectedOrigin: string;
  let requestOrigin: string;
  try {
    expectedOrigin = new URL(publicUrl).origin;
    requestOrigin = new URL(request.headers.origin).origin;
  } catch {
    throw new SessionRequestError(403, 'Untrusted request origin');
  }
  if (expectedOrigin !== requestOrigin) {
    throw new SessionRequestError(403, 'Untrusted request origin');
  }
}

function sanitizeTokenResponse(rawBody: string): { body: string; refreshToken: string } {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new SessionRequestError(502, 'Gateway returned an invalid authentication response');
  }
  if (!payload || typeof payload !== 'object') {
    throw new SessionRequestError(502, 'Gateway returned an invalid authentication response');
  }
  const envelope = payload as Record<string, unknown>;
  const tokenContainer =
    envelope['data'] && typeof envelope['data'] === 'object'
      ? (envelope['data'] as Record<string, unknown>)
      : envelope;
  const refreshToken = tokenContainer['refreshToken'];
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
    throw new SessionRequestError(502, 'Gateway did not return a refresh token');
  }
  delete tokenContainer['refreshToken'];
  return { body: JSON.stringify(envelope), refreshToken };
}

async function requestGateway(
  gatewayUrl: string,
  path: string,
  body: string,
  authorization?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (authorization) headers['Authorization'] = authorization;
  return fetch(new URL(path, `${gatewayUrl.replace(/\/$/, '')}/`), {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(10_000),
  });
}

async function handleSessionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  options: Required<DashboardServerOptions>,
): Promise<void> {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    throw new SessionRequestError(405, 'Method not allowed');
  }
  assertTrustedOrigin(request, options.publicUrl, options.production);

  if (pathname === '/api/session/login') {
    const body = await readRequestBody(request);
    const upstream = await requestGateway(options.gatewayUrl, '/v1/auth/login', body);
    const upstreamBody = await upstream.text();
    if (!upstream.ok) {
      response.writeHead(upstream.status, {
        'Cache-Control': 'no-store',
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
      });
      response.end(upstreamBody);
      return;
    }
    const sanitized = sanitizeTokenResponse(upstreamBody);
    setRefreshCookie(response, sanitized.refreshToken, options.production);
    response.writeHead(upstream.status, {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    });
    response.end(sanitized.body);
    return;
  }

  const refreshToken = readRefreshCookie(request);
  if (pathname === '/api/session/refresh') {
    if (!refreshToken) throw new SessionRequestError(401, 'Refresh session is unavailable');
    const upstream = await requestGateway(
      options.gatewayUrl,
      '/v1/auth/refresh',
      JSON.stringify({ refreshToken }),
    );
    const upstreamBody = await upstream.text();
    if (!upstream.ok) {
      if ([400, 401, 403].includes(upstream.status)) clearRefreshCookies(response);
      response.writeHead(upstream.status, {
        'Cache-Control': 'no-store',
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
      });
      response.end(upstreamBody);
      return;
    }
    const sanitized = sanitizeTokenResponse(upstreamBody);
    setRefreshCookie(response, sanitized.refreshToken, options.production);
    response.writeHead(upstream.status, {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    });
    response.end(sanitized.body);
    return;
  }

  if (pathname === '/api/session/logout') {
    if (refreshToken) {
      try {
        await requestGateway(
          options.gatewayUrl,
          '/v1/auth/logout',
          JSON.stringify({ refreshToken }),
          request.headers.authorization,
        );
      } catch {
        // Clearing the browser session must still succeed when the gateway is unavailable.
      }
    }
    clearRefreshCookies(response);
    response.writeHead(204, { 'Cache-Control': 'no-store' });
    response.end();
    return;
  }

  throw new SessionRequestError(404, 'Session endpoint not found');
}

export function createDashboardServer(serverOptions: DashboardServerOptions = {}): Server {
  const options: Required<DashboardServerOptions> = {
    gatewayUrl: serverOptions.gatewayUrl ?? runtimeEnv.gatewayUrl,
    publicUrl: serverOptions.publicUrl ?? runtimeEnv.publicUrl,
    production: serverOptions.production ?? runtimeEnv.nodeEnv === 'production',
  };

  return createServer((request, response) => {
    void (async () => {
      secureHeaders(response, options.gatewayUrl, options.production);
      const requestUrl = new URL(request.url ?? '/', options.publicUrl);
      if (requestUrl.pathname.startsWith('/api/session/')) {
        await handleSessionRequest(request, response, requestUrl.pathname, options);
        return;
      }
      if (requestUrl.pathname === '/health') {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ status: 'ok', service: 'dashboard' }));
        return;
      }
      if (requestUrl.pathname === '/config.js') {
        response.writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/javascript; charset=utf-8',
        });
        response.end(dashboardConfig());
        return;
      }
      const filePath = resolvePublicPath(request.url ?? '/');
      if (!filePath) throw new SessionRequestError(400, 'Bad request');
      response.writeHead(200, {
        'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
        'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
      });
      const stream = createReadStream(filePath);
      stream.on('error', () => {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
      stream.pipe(response);
    })().catch((error: unknown) => {
      if (response.writableEnded) return;
      if (error instanceof SessionRequestError) {
        sendJson(response, error.statusCode, {
          success: false,
          error: { code: 'SESSION_REQUEST_FAILED', message: error.message },
        });
        return;
      }
      sendJson(response, 502, {
        success: false,
        error: {
          code: 'SESSION_GATEWAY_UNAVAILABLE',
          message: 'Authentication service unavailable',
        },
      });
    });
  });
}

if (process.env['NODE_ENV'] !== 'test') {
  createDashboardServer().listen(port, host, () => {
    console.log(`BaseAPIKey dashboard listening at http://${host}:${port}`);
  });
}
