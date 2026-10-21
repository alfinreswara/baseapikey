// Scenario 3: SSE streaming.
//
// A streaming response holds a connection for the whole stream, so the
// connection count and the memory of the gateway are the interesting numbers
// here. The stream has to deliver the events and the DONE event.
import { thresholds } from '../lib/config.js';
import { postChatStream } from '../lib/helpers.js';

export const options = {
  scenarios: {
    sse_streaming: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 25,
      maxVUs: 150,
      stages: [
        { target: 50, duration: '30s' },
        { target: 200, duration: '60s' },
        { target: 0, duration: '15s' },
      ],
    },
  },
  thresholds: thresholds({ p95: 2000, p99: 5000, failedRate: 0.01 }),
};

export default function () {
  postChatStream();
}
