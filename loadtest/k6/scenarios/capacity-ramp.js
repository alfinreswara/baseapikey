// Scenario A: the gateway capacity test.
//
// The upstream is the stub, so the test measures the overhead of the gateway
// itself without spending any provider credit.
//
// The level is selected with PROFILE (low, medium, high, extreme). The levels
// are run one after another, starting with the lowest one, and each run
// reports its own thresholds.
//
//   PROFILE=low     k6 run loadtest/k6/scenarios/capacity-ramp.js
//   PROFILE=medium  k6 run loadtest/k6/scenarios/capacity-ramp.js
//   PROFILE=high    k6 run loadtest/k6/scenarios/capacity-ramp.js
//   PROFILE=extreme k6 run loadtest/k6/scenarios/capacity-ramp.js
import { CONFIG, profile, thresholds } from '../lib/config.js';
import { getMetrics, getReadiness, postChat, postChatStream } from '../lib/helpers.js';

const selected = profile();

export const options = {
  scenarios: {
    capacity: {
      executor: 'ramping-arrival-rate',
      startRate: Math.max(1, Math.round(selected.rate / 4)),
      timeUnit: '1s',
      preAllocatedVUs: Math.max(10, Math.round(selected.vus / 2)),
      maxVUs: selected.vus * 2,
      stages: [
        { target: Math.round(selected.rate / 2), duration: '30s' },
        { target: selected.rate, duration: selected.duration },
        { target: 0, duration: '20s' },
      ],
    },
  },
  thresholds: thresholds({ p95: 800, p99: 2500, failedRate: 0.01 }),
};

export function setup() {
  const readiness = getReadiness();
  if (readiness.status !== 200) {
    throw new Error(
      `The target ${CONFIG.baseUrl} is not ready (status ${readiness.status}). ` +
        'The load test refuses to run against an unhealthy instance.',
    );
  }
}

export default function () {
  // A tenth of the traffic is streaming, the rest is a normal completion.
  if (Math.random() < 0.1) {
    postChatStream();
    return;
  }
  postChat();
}

export function handleSummary(data) {
  const metrics = getMetrics();
  const lines = [
    '',
    `=== capacity profile ${selected.name} (target ${selected.rate} rps) ===`,
    `requests: ${data.metrics.http_reqs?.values?.count ?? 0}`,
    `error rate: ${(data.metrics.http_req_failed?.values?.rate ?? 0) * 100}%`,
    `p95: ${data.metrics.http_req_duration?.values?.['p(95)'] ?? 'n/a'} ms`,
    `p99: ${data.metrics.http_req_duration?.values?.['p(99)'] ?? 'n/a'} ms`,
    `checks: ${(data.metrics.checks?.values?.rate ?? 0) * 100}%`,
    '',
  ];
  if (metrics.status === 200) {
    const active = String(metrics.body)
      .split('\n')
      .filter((line) => line.startsWith('baseapikey_active_requests'))
      .join('; ');
    lines.push(`gateway active requests: ${active}`);
  }
  lines.push('');
  return {
    stdout: lines.join('\n'),
    'loadtest-summary.json': JSON.stringify(data, null, 2),
  };
}
