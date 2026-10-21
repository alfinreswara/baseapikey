// Scenario 7: concurrent load on the database and the cache.
//
// The scenario mixes the read paths that hit the database (the model catalog,
// the metrics endpoint) with the write path of the usage queue. The metrics
// endpoint is sampled during the run so the connection counts and the request
// counters can be compared with the observed latency.
import http from 'k6/http';
import { check } from 'k6';

import { CONFIG, thresholds } from '../lib/config.js';
import { getMetrics, postChat } from '../lib/helpers.js';

export const options = {
  scenarios: {
    database_and_cache: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 30,
      maxVUs: 150,
      stages: [
        { target: 60, duration: '30s' },
        { target: 250, duration: '60s' },
        { target: 0, duration: '15s' },
      ],
    },
  },
  thresholds: thresholds({ p95: 800, p99: 2500, failedRate: 0.01 }),
};

export default function () {
  const roll = Math.random();
  if (roll < 0.2) {
    const models = http.get(`${CONFIG.baseUrl}/v1/models`, { tags: { name: 'models' } });
    check(models, { 'the model catalog answers': (r) => r.status === 200 });
    return;
  }
  if (roll < 0.3) {
    const metrics = getMetrics();
    check(metrics, { 'the metrics endpoint answers': (r) => r.status === 200 });
    return;
  }
  postChat();
}
