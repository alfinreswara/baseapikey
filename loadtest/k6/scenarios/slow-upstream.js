// Scenario 6: a slow upstream.
//
// The stub upstream delays its answer. The gateway has to keep answering with
// its own timeout, it must not accumulate unbounded connections, and the
// readiness probe has to stay healthy while the upstream is slow.
import { check } from 'k6';

import { thresholds } from '../lib/config.js';
import { getReadiness, postChat } from '../lib/helpers.js';

export const options = {
  scenarios: {
    slow_upstream: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 20,
      maxVUs: 100,
      stages: [
        { target: 25, duration: '30s' },
        { target: 100, duration: '60s' },
        { target: 0, duration: '15s' },
      ],
    },
  },
  thresholds: thresholds({ p95: 5000, p99: 15000, failedRate: 0.05 }),
};

export default function () {
  const response = postChat();
  check(response, {
    'a slow upstream still produces an answer or a timeout': (r) =>
      r.status === 200 || r.status >= 500,
  });
  const readiness = getReadiness();
  check(readiness, {
    'the readiness stays healthy while the upstream is slow': (r) => r.status === 200,
  });
}
