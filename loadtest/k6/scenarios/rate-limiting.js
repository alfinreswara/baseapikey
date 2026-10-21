// Scenario 4: rate limiting.
//
// The login endpoint is protected by the sliding window limiter in the cache.
// The scenario sends more attempts than the configured window allows and
// verifies that the limiter answers with 429 instead of letting every attempt
// reach the password hashing.
import { check } from 'k6';

import { thresholds } from '../lib/config.js';
import { postLogin } from '../lib/helpers.js';

const EMAIL = 'staging-user@example.com';

export const options = {
  scenarios: {
    rate_limiting: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 20,
      maxVUs: 80,
      stages: [
        { target: 30, duration: '30s' },
        { target: 60, duration: '60s' },
        { target: 0, duration: '10s' },
      ],
    },
  },
  thresholds: {
    ...thresholds({ p95: 800, p99: 3000, failedRate: 0.2 }),
    // The limiter has to answer, and it has to answer with 429 once the
    // window is exhausted. A rate limit response is not a failure.
    rate_limited: ['count>0'],
  },
};

export default function () {
  const response = postLogin(EMAIL);
  check(response, {
    'the login endpoint answers with a known status': (r) => [200, 401, 429].includes(r.status),
    'a limited login carries the retry hint': (r) =>
      r.status !== 429 || r.headers['Retry-After'] !== undefined,
  });
}
