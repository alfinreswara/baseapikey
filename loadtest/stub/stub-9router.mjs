// Stub of the 9Router upstream API for the BaseAPIKey load tests.
//
// The stub answers the endpoints that the provider adapter uses, so the
// capacity test measures the overhead of the gateway without spending any
// provider credit. The behaviour is selected with a mode that can be changed
// at runtime through the control endpoint.
//
//   node loadtest/stub/stub-9router.mjs
//   curl -X POST http://127.0.0.1:55450/control/mode -d '{"mode":"slow"}'
//
// Modes:
//   ok        the normal answer
//   slow      the answer is delayed by STUB_DELAY_MS
//   error     the upstream answers with HTTP 500
//   hanging   the stream never ends, only the abort ends the request
//
// The stub is a local test double. It binds to the loopback interface only,
// it never makes an outgoing request, and it never logs the body of a
// request or a credential.
import http from 'node:http';

const DEFAULT_PORT = 55450;
const MODES = Object.freeze(['ok', 'slow', 'error', 'hanging']);

const parsedPort = Number(process.env['STUB_PORT'] ?? DEFAULT_PORT);
const PORT =
  Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort < 65_536 ? parsedPort : DEFAULT_PORT;
const DELAY_MS = Number(process.env['STUB_DELAY_MS'] ?? 2000);

/**
 * The mode of the stub.
 *
 * Only the known modes are accepted. The control endpoint is reachable from
 * the loopback interface, a value that is not one of the known modes would
 * end up in the log of the stub and in the answers of the control endpoint.
 */
function isKnownMode(value) {
  return typeof value === 'string' && MODES.includes(value);
}

const requestedMode = process.env['STUB_MODE'];

const state = {
  mode: isKnownMode(requestedMode) ? requestedMode : 'ok',
  requests: 0,
  streams: 0,
  startedAt: Date.now(),
};

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(payload);
}

const server = http.createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => {
    body += chunk;
  });
  request.on('end', () => {
    const url = request.url ?? '';

    if (url === '/control/mode' && request.method === 'POST') {
      const requested = (() => {
        try {
          return JSON.parse(body || '{}').mode;
        } catch (error) {
          return undefined;
        }
      })();
      // Only a known mode is accepted. An unknown mode is refused, so a
      // caller can not write an arbitrary value into the state of the stub.
      if (!isKnownMode(requested)) {
        sendJson(response, 400, {
          error: { message: `unknown mode, use one of ${MODES.join(', ')}` },
        });
        return;
      }
      state.mode = requested;
      sendJson(response, 200, { mode: state.mode });
      return;
    }

    if (url === '/control/stats') {
      sendJson(response, 200, {
        mode: state.mode,
        requests: state.requests,
        streams: state.streams,
        uptimeMs: Date.now() - state.startedAt,
      });
      return;
    }

    if (url === '/health') {
      sendJson(response, 200, { status: 'ok' });
      return;
    }

    state.requests += 1;

    if (url.endsWith('/models')) {
      sendJson(response, 200, {
        object: 'list',
        data: [
          {
            id: 'demo-model',
            object: 'model',
            created: 1700000000,
            owned_by: 'stub-9router',
            context_window: 8192,
            max_output_tokens: 2048,
          },
        ],
      });
      return;
    }

    if (state.mode === 'error') {
      sendJson(response, 500, { error: { message: 'stub upstream failure' } });
      return;
    }

    if (url.endsWith('/chat/completions')) {
      const payload = body ? JSON.parse(body) : {};
      if (payload.stream === true) {
        streamChat(response, payload);
        return;
      }
      const answer = () =>
        sendJson(response, 200, {
          id: 'chatcmpl-stub',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: payload.model ?? 'demo-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Hello staging' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 },
        });
      if (state.mode === 'slow') {
        setTimeout(answer, DELAY_MS);
        return;
      }
      answer();
      return;
    }

    if (url.endsWith('/embeddings')) {
      sendJson(response, 200, {
        object: 'list',
        data: [{ object: 'embedding', index: 0, embedding: [0.01, 0.02, 0.03] }],
        model: 'demo-model',
        usage: { prompt_tokens: 5, total_tokens: 5 },
      });
      return;
    }

    sendJson(response, 404, { error: { message: `unknown stub path ${url}` } });
  });

  request.on('aborted', () => {
    response.destroy();
  });
});

function streamChat(response, payload) {
  state.streams += 1;
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const model = payload.model ?? 'demo-model';
  const chunks = [
    {
      id: 'chatcmpl-stub',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello' } }],
    },
    {
      id: 'chatcmpl-stub',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: { content: ' staging' } }],
    },
    {
      id: 'chatcmpl-stub',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    },
  ];

  let index = 0;
  const sendNext = () => {
    if (response.destroyed) return;
    if (index >= chunks.length) {
      response.write('data: [DONE]\n\n');
      response.end();
      return;
    }
    const chunk = chunks[index];
    index += 1;
    response.write(`data: ${JSON.stringify(chunk)}\n\n`);
    if (state.mode === 'hanging') return;
    if (state.mode === 'slow') {
      setTimeout(sendNext, DELAY_MS);
      return;
    }
    setTimeout(sendNext, 5);
  };
  sendNext();
}

// The stub binds to the loopback interface only. It is a local test double,
// the control endpoint must not be reachable from another host.
server.listen(PORT, '127.0.0.1', () => {
  const address = server.address();
  const bound = typeof address === 'object' && address !== null ? address.address : '127.0.0.1';
  const boundPort = typeof address === 'object' && address !== null ? address.port : PORT;
  // The line breaks are removed, a value of the request can not forge a log
  // entry of the stub.
  const mode = state.mode.replace(/\n|\r/g, '');
  console.log(`[stub-9router] listening on http://${bound}:${boundPort} (mode ${mode})`);
});
