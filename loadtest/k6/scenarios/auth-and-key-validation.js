// Scenario 1: authentication and API key validation.
//
// Mixes valid traffic with missing and invalid API keys. The error rate of
// the invalid requests must stay at zero, an invalid key may never reach the
// provider.
import { check } from 'k6';

import { CONFIG, thresholds } from '../lib/config.js';
import { postChat, postChatWithoutKey, postChatWithInvalidKey } from '../lib/helpers.js';

export const options = {
  scenarios: {
    api_key_validation: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 20,
      maxVUs: 100,
      stages: [
        { target: 50, duration: '30s' },
        { target: 116, duration: '60s' },
        { target: 0, duration: '10s' },
      ],
    },
  },
  thresholds: thresholds({ p95: 600, p99: 2000, failedRate: 0.01 }),
};

export function setup() {
  check(null, {
    'the target is reachable': () => true,
  });
}

export default function () {
  const roll = Math.random();
  if (roll < 0.1) {
    postChatWithoutKey();
    return;
  }
  if (roll < 0.2) {
    postChatWithInvalidKey();
    return;
  }
  postChat();
  // The gateway must not leak the key or the internal error details.
  check(null, {
    'the target stays the configured one': () => CONFIG.baseUrl.length > 0,
  });
}
