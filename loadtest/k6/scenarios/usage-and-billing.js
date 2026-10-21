// Scenario 8: consistency of the usage tracking and the billing.
//
// The scenario sends a marked request and records the marker in the usage
// event. After the run the usage rows and the credit ledger are compared
// with the sent requests, so that a duplicated or a missing accounting
// becomes visible. The comparison itself runs in the verification step of the
// load test, not in the load generator.
import { check } from 'k6';

import { thresholds } from '../lib/config.js';
import { postChat, usageEvents } from '../lib/helpers.js';

export const options = {
  scenarios: {
    usage_and_billing: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 20,
      maxVUs: 100,
      stages: [
        { target: 50, duration: '30s' },
        { target: 200, duration: '60s' },
        { target: 0, duration: '15s' },
      ],
    },
  },
  thresholds: thresholds({ p95: 700, p99: 2000, failedRate: 0.01 }),
};

export default function () {
  // The marker travels in the user agent, so the usage row can be traced back
  // to the request that produced it.
  const marker = `loadtest-${__VU}-${__ITER}`;
  const response = postChat({ 'User-Agent': marker });
  if (response.status === 200) {
    usageEvents.add(1);
  }
  check(response, {
    'the request is accepted for the accounting': (r) => r.status === 200,
  });
}
