// Smoke test for the BaseAPIKey load test targets.
//
// The k6 scenarios cannot run without the k6 binary. This script exercises
// the same targets, payloads, and headers with plain Node, so the target
// definitions can be verified before a load test is started.
//
//   BASE_URL=http://127.0.0.1:3310 API_KEY=... node loadtest/smoke/node-smoke.mjs
//
// It never creates a paid transaction and it refuses a target that looks like
// production.
import http from 'node:http';

const BASE_URL = process.env['BASE_URL'] ?? 'http://127.0.0.1:3310';
// The key of the target. It is never part of the repository, the operator
// exports it.
const API_KEY = process.env['API_KEY'];
if (!API_KEY) {
  throw new Error(
    'API_KEY is required. Export the API key of the target, it is never part of the repository.',
  );
}
const MODEL = process.env['MODEL'] ?? 'demo-model';
const METRICS_TOKEN =
  process.env['METRICS_TOKEN'] ?? 'staging-metrics-token-minimum-32-characters-long';
const STUB_CONTROL = process.env['STUB_CONTROL'] ?? 'http://127.0.0.1:55450';

const PRODUCTION_HOST_PATTERN = /(^|[.\-])prod([.\-]|$)|production/i;

let failures = 0;

function check(name, passed, detail = '') {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
  if (!passed) failures += 1;
}

function guardTarget() {
  guardHost('BASE_URL', BASE_URL);
  // The control endpoint of the stub is written to with a POST. It is a
  // local test double, the smoke test refuses to write to a host that looks
  // like a production host.
  guardHost('STUB_CONTROL', STUB_CONTROL);
}

function guardHost(name, target) {
  const parsed = new URL(target);
  if (
    PRODUCTION_HOST_PATTERN.test(parsed.hostname) &&
    process.env['ALLOW_EXTERNAL_TARGET'] !== '1'
  ) {
    throw new Error(
      `Refusing to use ${name} "${parsed.hostname}": it looks like a production host. ` +
        'Set ALLOW_EXTERNAL_TARGET=1 only for an explicitly approved target.',
    );
  }
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    json = undefined;
  }
  return { status: response.status, headers: response.headers, text, json };
}

function chatPayload(extra = {}) {
  return { model: MODEL, messages: [{ role: 'user', content: 'load test' }], ...extra };
}

async function setStubMode(mode) {
  try {
    await fetch(`${STUB_CONTROL}/control/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
  } catch (error) {
    console.log(`note: the stub control endpoint is not reachable: ${error.message}`);
  }
}

async function run() {
  guardTarget();

  // 1: authentication and API key validation
  const missing = await request('/v1/chat/completions', {
    method: 'POST',
    body: chatPayload(),
  });
  check(
    'scenario 1: a request without an API key is rejected with 401',
    missing.status === 401,
    `status=${missing.status}`,
  );

  const invalid = await request('/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer sk_live_wrong000' },
    body: chatPayload(),
  });
  check(
    'scenario 1: a request with an invalid API key is rejected with 401',
    invalid.status === 401,
    `status=${invalid.status}`,
  );

  // 2: non streaming chat completion
  const chat = await request('/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: chatPayload(),
  });
  check(
    'scenario 2: a chat completion answers with 200 and a completion',
    chat.status === 200 && Boolean(chat.json?.choices?.[0]?.message?.content),
    `status=${chat.status}`,
  );

  // 3: SSE streaming
  const stream = await request('/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: chatPayload({ stream: true }),
  });
  const events = stream.text.split('\n\n').filter((line) => line.startsWith('data: '));
  check(
    'scenario 3: the stream delivers the events and the DONE event',
    stream.status === 200 &&
      String(stream.headers.get('content-type')).includes('text/event-stream') &&
      events.length >= 3 &&
      stream.text.includes('data: [DONE]'),
    `status=${stream.status} events=${events.length}`,
  );

  // 4: rate limiting
  const logins = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    logins.push(
      await request('/v1/auth/login', {
        method: 'POST',
        body: { email: 'staging-user@example.com', password: 'StagingPassword123!' },
      }),
    );
  }
  const limited = logins.filter((entry) => entry.status === 429);
  check(
    'scenario 4: the login limiter answers with 429 once the window is exhausted',
    limited.length > 0,
    `limited=${limited.length} of ${logins.length}`,
  );

  // 5: an upstream failure
  await setStubMode('error');
  const failed = await request('/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: chatPayload(),
  });
  check(
    'scenario 5: an upstream failure becomes a structured 5xx response',
    failed.status >= 500 && Boolean(failed.json?.error?.code),
    `status=${failed.status} code=${failed.json?.error?.code}`,
  );
  check(
    'scenario 5: the error body does not contain the upstream payload',
    !failed.text.includes('stub upstream failure'),
  );
  await setStubMode('ok');

  // 6: a slow upstream
  await setStubMode('slow');
  const started = Date.now();
  const slow = await request('/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: chatPayload(),
  });
  const elapsed = Date.now() - started;
  check(
    'scenario 6: a slow upstream is answered within the provider timeout',
    slow.status === 200 && elapsed < 35_000,
    `status=${slow.status} elapsed=${elapsed}ms`,
  );
  const readiness = await request('/health/ready');
  check(
    'scenario 6: the readiness stays healthy while the upstream is slow',
    readiness.status === 200,
    `status=${readiness.status}`,
  );
  await setStubMode('ok');

  // 7: the database and the cache paths
  const models = await request('/v1/models');
  check('scenario 7: the model catalog answers with 200', models.status === 200);
  const metrics = await request('/metrics', {
    headers: { Authorization: `Bearer ${METRICS_TOKEN}` },
  });
  check(
    'scenario 7: the metrics endpoint answers with 200 and the counters',
    metrics.status === 200 && metrics.text.includes('baseapikey_http_requests_total'),
    `status=${metrics.status}`,
  );

  // 8: the usage and the billing consistency
  const marker = `loadtest-smoke-${Date.now()}`;
  const tracked = await request('/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'User-Agent': marker },
    body: chatPayload(),
  });
  check('scenario 8: the tracked request is accepted', tracked.status === 200);
  console.log(
    `note: the usage row of the marker "${marker}" has to be verified with ` +
      'loadtest/verify/verify-usage-billing.mjs',
  );

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll load test targets are reachable and behave as expected.');
}

await run();
