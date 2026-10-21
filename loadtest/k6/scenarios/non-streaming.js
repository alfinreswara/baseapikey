// Scenario 2: non streaming chat completions.
//
// Measures the gateway overhead without the streaming path. The upstream is
// the stub, so the test does not spend any provider credit.
import { CONFIG, thresholds } from '../lib/config.js';
import { postChat } from '../lib/helpers.js';

export const options = {
  scenarios: {
    non_streaming: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 40,
      maxVUs: 200,
      stages: [
        { target: 116, duration: '30s' },
        { target: 300, duration: '60s' },
        { target: 0, duration: '10s' },
      ],
    },
  },
  thresholds: thresholds({ p95: 500, p99: 1500, failedRate: 0.01 }),
};

export default function () {
  postChat();
  if (!CONFIG.baseUrl) {
    throw new Error('BASE_URL is not configured');
  }
}
