// Scenario B: the integration test against a provider sandbox.
//
// This scenario talks to a real provider sandbox. It may consume the credit of
// the sandbox account, therefore it never runs automatically: the operator has
// to set SANDBOX_PROVIDER=1 and the run has to be started by hand.
//
// The sandbox is expected to answer with the model catalog, a chat completion
// and a stream. A paid transaction is never created, the billing endpoints of
// the gateway are not part of this scenario.
import { check } from 'k6';

import { CONFIG, thresholds } from '../lib/config.js';
import { postChat, postChatStream } from '../lib/helpers.js';

if (__ENV['SANDBOX_PROVIDER'] !== '1') {
  throw new Error(
    'The sandbox scenario may consume provider credit. Set SANDBOX_PROVIDER=1 ' +
      'explicitly and only for an approved sandbox account.',
  );
}

export const options = {
  scenarios: {
    sandbox_integration: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { target: 2, duration: '20s' },
        { target: 5, duration: '40s' },
        { target: 0, duration: '10s' },
      ],
    },
  },
  // A sandbox is slower and less predictable than the stub, the thresholds
  // are therefore looser and focus on the errors.
  thresholds: thresholds({ p95: 8000, p99: 20000, failedRate: 0.05 }),
};

export function setup() {
  const response = postChat();
  check(response, {
    'the sandbox answers a chat completion': (r) => r.status === 200,
  });
  if (response.status !== 200) {
    throw new Error(
      `The sandbox did not answer a chat completion (status ${response.status}) ` +
        `on ${CONFIG.baseUrl}. The integration test stops here.`,
    );
  }
}

export default function () {
  if (Math.random() < 0.3) {
    postChatStream();
    return;
  }
  postChat();
}
