// Shared helpers for the BaseAPIKey load tests.
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

import { CONFIG } from './config.js';

export const chatErrors = new Counter('chat_errors');
export const sseEvents = new Counter('sse_events');
export const sseCompleted = new Counter('sse_completed');
export const rateLimited = new Counter('rate_limited');
export const upstreamErrors = new Counter('upstream_errors');
export const usageEvents = new Counter('usage_events');
export const gatewayOverhead = new Trend('gateway_overhead_ms', true);

export function authHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${CONFIG.apiKey}`,
    ...extra,
  };
}

export function chatPayload(extra = {}) {
  return JSON.stringify({
    model: CONFIG.model,
    messages: [{ role: 'user', content: 'load test' }],
    ...extra,
  });
}

/** A chat completion without streaming. */
export function postChat(extraHeaders = {}, extraBody = {}) {
  const response = http.post(`${CONFIG.baseUrl}/v1/chat/completions`, chatPayload(extraBody), {
    headers: authHeaders(extraHeaders),
    tags: { name: 'chat' },
  });
  const ok = check(response, {
    'chat returns 200': (r) => r.status === 200,
    'chat returns a completion': (r) => {
      if (r.status !== 200) return false;
      try {
        return Boolean(r.json('choices[0].message.content'));
      } catch (error) {
        return false;
      }
    },
  });
  if (!ok) chatErrors.add(1);
  return response;
}

/**
 * A streaming chat completion. The reader consumes the SSE events until the
 * DONE event, and the duration of the stream is measured separately from the
 * response time of the headers.
 */
export function postChatStream(extraHeaders = {}) {
  const response = http.post(
    `${CONFIG.baseUrl}/v1/chat/completions`,
    chatPayload({ stream: true }),
    { headers: authHeaders(extraHeaders), tags: { name: 'chat-stream' } },
  );
  if (response.status !== 200) {
    chatErrors.add(1);
    check(response, { 'stream returns 200': () => false });
    return { response, events: 0, done: false };
  }
  let events = 0;
  let done = false;
  for (const line of response.body.split('\n\n')) {
    if (!line.startsWith('data: ')) continue;
    events += 1;
    if (line.includes('[DONE]')) done = true;
  }
  sseEvents.add(events);
  if (done) sseCompleted.add(1);
  check(response, {
    'stream returns an event stream': (r) =>
      String(r.headers['Content-Type']).includes('text/event-stream'),
    'stream delivers the DONE event': () => done,
  });
  return { response, events, done };
}

/** A request without an API key, used by the authentication scenario. */
export function postChatWithoutKey() {
  const response = http.post(`${CONFIG.baseUrl}/v1/chat/completions`, chatPayload(), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'chat-no-key' },
  });
  check(response, {
    'a request without a key is rejected with 401': (r) => r.status === 401,
  });
  return response;
}

/** A request with an invalid API key. */
export function postChatWithInvalidKey() {
  const response = http.post(`${CONFIG.baseUrl}/v1/chat/completions`, chatPayload(), {
    headers: {
      'Content-Type': 'application/json',
      // A well formed key that does not belong to the target.
      Authorization: 'Bearer sk_live_wrong000',
    },
    tags: { name: 'chat-invalid-key' },
  });
  check(response, {
    'a request with an invalid key is rejected with 401': (r) => r.status === 401,
  });
  return response;
}

/** A login attempt, used by the rate limiting scenario. */
export function postLogin(email, password = 'StagingPassword123!') {
  const response = http.post(
    `${CONFIG.baseUrl}/v1/auth/login`,
    JSON.stringify({ email, password }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } },
  );
  if (response.status === 429) rateLimited.add(1);
  return response;
}

/** Reads the gateway metrics, used by the database and cache scenario. */
export function getMetrics() {
  const response = http.get(`${CONFIG.baseUrl}/metrics`, {
    headers: { Authorization: `Bearer ${readEnvMetricToken()}` },
    tags: { name: 'metrics' },
  });
  return response;
}

function readEnvMetricToken() {
  const token = __ENV['METRICS_TOKEN'];
  return token === undefined || token === ''
    ? 'staging-metrics-token-minimum-32-characters-long'
    : token;
}

/** The health endpoints, used to observe the readiness during a load test. */
export function getReadiness() {
  return http.get(`${CONFIG.baseUrl}/health/ready`, { tags: { name: 'health-ready' } });
}
