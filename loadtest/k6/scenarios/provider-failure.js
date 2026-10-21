// Scenario 5: upstream failures.
//
// The stub upstream answers with an error. The gateway has to translate it
// into a structured error response, it must not leak the upstream body, and
// it must stay available for the following requests.
import { check } from 'k6';

import { thresholds } from '../lib/config.js';
import { postChat } from '../lib/helpers.js';

export const options = {
  scenarios: {
    provider_failure: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 20,
      maxVUs: 100,
      stages: [
        { target: 50, duration: '30s' },
        { target: 150, duration: '60s' },
        { target: 0, duration: '10s' },
      ],
    },
  },
  thresholds: thresholds({ p95: 1500, p99: 4000, failedRate: 0.01 }),
};

export default function () {
  const response = postChat();
  check(response, {
    'an upstream failure becomes a 5xx': (r) => r.status >= 500,
    'the error body is structured': (r) => {
      try {
        return Boolean(r.json('error.code'));
      } catch (error) {
        return false;
      }
    },
    'the error body does not contain the upstream payload': (r) =>
      !String(r.body).includes('mock upstream failure'),
  });
}
