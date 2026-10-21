# BaseAPIKey load test suite

The suite measures the behaviour of the Gateway under load. It is kept outside
the application code: nothing in `apps/` or `packages/` depends on it.

```
loadtest/
├── README.md
├── k6/
│   ├── lib/
│   │   ├── config.js          the target, the profiles, the thresholds, the guard
│   │   └── helpers.js         the requests and the custom metrics
│   └── scenarios/
│       ├── auth-and-key-validation.js   scenario 1
│       ├── non-streaming.js             scenario 2
│       ├── sse-streaming.js             scenario 3
│       ├── rate-limiting.js             scenario 4
│       ├── provider-failure.js          scenario 5
│       ├── slow-upstream.js             scenario 6
│       ├── database-and-cache.js        scenario 7
│       ├── usage-and-billing.js         scenario 8
│       ├── capacity-ramp.js             scenario A, the capacity test
│       └── integration-sandbox.js       scenario B, the sandbox test
├── stub/
│   └── stub-9router.mjs       the stub upstream, no provider credit is used
├── smoke/
│   └── node-smoke.mjs         the same targets without k6
└── verify/
    └── verify-usage-billing.mjs  the usage and ledger check after a run
```

## Safety rules

- The default target is the local sandbox `http://127.0.0.1:3310`. No script
  contains a host name.
- A target whose host looks like a production host is refused unless
  `ALLOW_EXTERNAL_TARGET=1` is set explicitly.
- The scripts never create a paid transaction. The sandbox scenario refuses to
  start without `SANDBOX_PROVIDER=1` and has to be started by hand.
- The stub upstream answers every provider call locally, so the capacity test
  does not spend provider credit.
- The verification script only reads the database.

## Requirements

- [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) for the load
  tests. The scenarios are k6 scripts, `k6` is not a dependency of the
  project.
- A running Gateway that the test may use. For the capacity test that is the
  Gateway with the stub upstream as its provider.
- A PostgreSQL and a Redis for the scenarios that touch the data paths.

## Running the capacity test (scenario A)

The stub upstream answers the provider calls:

```bash
# Terminal 1: the stub upstream.
node loadtest/stub/stub-9router.mjs

# Terminal 2: the Gateway, pointed at the stub.
NINE_ROUTER_BASE_URL=http://127.0.0.1:55450/v1 node apps/gateway/dist/index.js
```

Then the levels, from the lowest to the highest. One level after the other,
never the highest one first:

```bash
PROFILE=low     k6 run loadtest/k6/scenarios/capacity-ramp.js
PROFILE=medium  k6 run loadtest/k6/scenarios/capacity-ramp.js
PROFILE=high    k6 run loadtest/k6/scenarios/capacity-ramp.js
PROFILE=extreme k6 run loadtest/k6/scenarios/capacity-ramp.js
```

The planning targets are the rates of the profiles:

| Profile   | Rate     | Virtual users | Duration |
| --------- | -------- | ------------- | -------- |
| `low`     | 116 rps  | 24            | 120 s    |
| `medium`  | 300 rps  | 60            | 180 s    |
| `high`    | 600 rps  | 120           | 180 s    |
| `extreme` | 1150 rps | 230           | 240 s    |

They are test targets, not a statement about the capacity of the application.

## Running a single scenario

```bash
BASE_URL=http://127.0.0.1:3310 API_KEY=... k6 run loadtest/k6/scenarios/sse-streaming.js
```

| Scenario                  | What it measures                                             |
| ------------------------- | ------------------------------------------------------------ |
| `auth-and-key-validation` | valid, missing, and invalid API keys, the rejection rate     |
| `non-streaming`           | the request path without a stream                            |
| `sse-streaming`           | the connection count and the delivery of the stream events   |
| `rate-limiting`           | the sliding window limiter of the login endpoint             |
| `provider-failure`        | the translation of an upstream error into a structured error |
| `slow-upstream`           | the behaviour while the upstream is slow                     |
| `database-and-cache`      | the read paths of the database and the metrics endpoint      |
| `usage-and-billing`       | the usage accounting of the requests                         |

## The modes of the stub upstream

```bash
curl -X POST http://127.0.0.1:55450/control/mode -d '{"mode":"error"}'
curl -X POST http://127.0.0.1:55450/control/mode -d '{"mode":"slow"}'
curl -X POST http://127.0.0.1:55450/control/mode -d '{"mode":"hanging"}'
curl -X POST http://127.0.0.1:55450/control/mode -d '{"mode":"ok"}'
```

`error` answers with HTTP 500, `slow` delays the answer by `STUB_DELAY_MS`,
`hanging` never finishes the stream.

## The sandbox test (scenario B)

The sandbox test talks to a real provider sandbox and may consume the credit
of the sandbox account. It never runs automatically:

```bash
SANDBOX_PROVIDER=1 BASE_URL=https://api.staging.example API_KEY=... \
  k6 run loadtest/k6/scenarios/integration-sandbox.js
```

## Verifying the accounting after a run

```bash
DATABASE_URL=postgresql://... WINDOW_MINUTES=10 EXPECTED_REQUESTS=1000 \
  node loadtest/verify/verify-usage-billing.mjs
```

The script compares the usage rows and the credit ledger: every usage event
has a unique request id, every priced usage has exactly one ledger entry, the
ledger has no duplicated idempotency key, and the balance of the account
matches its ledger.

## The targets without k6

The smoke test exercises the same endpoints, payloads, and headers with plain
Node, so the target definitions can be verified before a load test is started:

```bash
BASE_URL=http://127.0.0.1:3310 API_KEY=... node loadtest/smoke/node-smoke.mjs
```

## The thresholds

Every scenario defines the thresholds that turn a regression into a failed
run:

| Threshold           | Value                         | Meaning                               |
| ------------------- | ----------------------------- | ------------------------------------- |
| `http_req_failed`   | `rate < 0.01`                 | less than one percent failed requests |
| `http_req_duration` | `p(95) < 800`, `p(99) < 2500` | the latency of the gateway            |
| `checks`            | `rate > 0.99`                 | the assertions of the scenario        |

The streaming scenario uses `p(95) < 2000` and `p(99) < 5000`, the sandbox
scenario uses `p(95) < 8000` because a sandbox is slower and less predictable.

## What has to be observed besides the latency

The numbers of the scenarios are not enough. During a run the following has to
be collected:

- the CPU and the memory of the Gateway pods, and the restart count
- the number of the database connections and the slow queries
- the number of the Redis connections and the memory of the cache
- the number of the open connections of the Gateway, the streaming scenario
  holds a connection for the whole stream
- the error rate and the p95 and p99 latency per level
- the behaviour of the rate limiter: the 429 rate of the login endpoint
- the usage and the credit ledger after the run, with the verification script
