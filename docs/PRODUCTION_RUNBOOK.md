# Production Runbook

## Release flow

1. Require the CI and CodeQL branch checks on `main`, protect the GitHub `release` environment with
   reviewers, and confirm every item in `RELEASE_CHECKLIST.md` has evidence. The check
   **Prisma Migration Check** is required: it runs the billing integration tests of the credit
   reservation against a real PostgreSQL, never against a mock. The tests fail when the database
   is missing, so a green check always means the tests really ran.
2. Run the **Build Release Images** workflow from `main` with a new semantic version and
   `publish=false`. Review both image vulnerability scans and the retained CycloneDX SBOMs.
3. Re-run the same version with `publish=true` after approval. Record the published image digests,
   BuildKit provenance/SBOM attestations, workflow URL, and source commit; deploy by digest rather
   than by a mutable tag.
4. Pin the published artifacts in `infrastructure/k8s/overlays/production/kustomization.yaml`. That
   overlay is the only place that names the release, and it pins the Gateway, the Dashboard, and the
   migration job to the same release identifier. Validate it with
   `node scripts/validate-k8s-release.mjs` before every rollout.
5. Run `prisma migrate deploy` as a one-shot job against a sanitized production copy, then take the
   production snapshot and execute the migration job before rolling out Gateway pods.
6. Deploy one canary Gateway replica, verify `/health/ready`, `/metrics`, login, model listing, and a
   low-cost inference request.
7. Roll out the remaining Gateway and Dashboard replicas and watch error rate, latency, Redis queue
   depth, provider health, and billing events.
8. Keep the previous image digest available until the release has completed its observation window.

The workflow only builds and optionally publishes images; it deliberately does not deploy to a
cluster. Cluster credentials, namespaces, domains, and promotion policy must be supplied by the
operator. Never publish a version that was already used for different image content.

The Kubernetes manifests live in `infrastructure/k8s`. `infrastructure/k8s/base` holds the shared
resources, `infrastructure/k8s/overlays/production` pins the released artifacts, and
`infrastructure/k8s/overlays/monitoring` holds the optional Prometheus resources. Apply the
production overlay, never the base:

```bash
kubectl kustomize infrastructure/k8s/overlays/production
kubectl apply -k infrastructure/k8s/overlays/production
```

The base is not deployable on its own: the image references in the base manifests are placeholders
that the overlay replaces with the released tag or digest. Create `baseapikey-secrets` from a secret
manager, replace the example hosts in `infrastructure/k8s/base/platform.yaml`, and configure managed
PostgreSQL and Redis before applying the manifests.

## Graceful shutdown

The runtime images are distroless. They contain no shell, and the Node binary lives at
`/nodejs/bin/node` instead of `PATH`, so no `preStop` hook can run a shell command. Kubernetes
sends SIGTERM to the Node process instead, and both services own their termination sequence.

The Gateway runs four bounded phases:

1. **Drain** (`SHUTDOWN_DRAIN_DELAY_MS`, 10 seconds): readiness reports the instance as not ready
   while liveness stays healthy, and every new request is answered with `503 SERVER_SHUTTING_DOWN`.
   The health and metrics endpoints stay reachable for the kubelet and Prometheus. The requests that
   are already running, including the SSE streams, may finish their work.
2. **Background work**: the provider health monitor stops and the usage worker flushes the Redis
   queue.
3. **Server close**: the HTTP server stops accepting connections and waits for the running requests.
   When they do not finish in time, the in-flight upstream requests are aborted. The provider
   stream then fails with an abort error, the handler writes an SSE error event, and the response
   ends. A stream is therefore never cut off silently by the forced process exit. If the requests
   still do not end, the remaining sockets are destroyed.
4. **Resources**: the Redis and PostgreSQL connections are closed.

`SHUTDOWN_TIMEOUT_MS` is the total budget of that sequence and must stay below
`terminationGracePeriodSeconds` of the workloads, otherwise Kubernetes sends SIGKILL while requests
are still running. The current manifests use a 10 second drain window, a 30 second budget, and a 45
second grace period. Every phase is bounded on its own, so an unresponsive Redis or provider cannot
block the shutdown longer than the budget.

The exit code reports the result: `0` when the shutdown was clean, `1` when a request had to be
aborted or a step failed. A `1` during a rollout therefore points at a request that did not finish
in time and has to be investigated.

The Dashboard uses the same sequence without the provider phase: it drains, answers new session
requests with `503`, closes the HTTP server after the running requests, and exits.

## Model catalogue and pricing

The catalogue of the models is the only source of truth for the routing and the
price of a request:

- a model that is not in the catalogue is rejected with `MODEL_NOT_AVAILABLE`
  before the request reaches a provider,
- a model without a price is rejected with `MODEL_PRICING_NOT_CONFIGURED`,
  unless an administrator marked it as free with the `isFree` flag of the
  admin model API,
- the provider of a request has to be the provider of the catalogue entry,
  otherwise the request is rejected with `MODEL_PROVIDER_MISMATCH`. A client
  can not route around the mapping and the accounting by sending another
  provider,
- the cost of a request is computed from the price of the catalogue and the
  token counts of the provider response. A client never supplies a price.

The catalogue is therefore part of the deployment: populate it before the
traffic is accepted, otherwise every request is rejected. The models are
managed with `POST /api/v1/admin/models`, the price of a model is
`inputPricePerMillion` and `outputPricePerMillion`, and a model that is
explicitly free carries `isFree: true`.

## Credit reservation and settlement

Every request that can cost money reserves the credit of the organization
before it is forwarded to a provider. The reservation is the authorization of
the request: a request without a reservation never reaches a provider.

- The reservation holds the upper bound of the cost of the request. The bound
  of the prompt is the size of the body, a token can not be shorter than a
  byte. The bound of the answer is the maximum number of the output tokens of
  the model. The bound is only used for the reservation, the settlement uses
  the real usage.
- The reservation is atomic. The row of the billing account is locked, the
  available credit and the spending limit are checked, and the held credit is
  increased with a relative update. The available credit is the balance, the
  unbilled usage and the credit that is held for the running requests.
- The spending limit counts the settled cost of the period plus the credit
  that is held for the running requests. The two are never added twice, the
  unsettled usage is covered by its reservation.
- The reservation has a status: `RESERVED`, `SETTLED`, `RELEASED` or
  `EXPIRED`. Every transition is a conditional update, so it happens exactly
  once. The settlement of the reservation and the ledger entry are written in
  the same transaction as the deduction of the balance.
- A request that never reached the provider releases its reservation, the
  credit becomes available again.
- A request that failed after the provider was called keeps its reservation.
  The credit of a request that may still have been processed by the provider
  is only returned after the deadline of the reservation has passed. The
  deadline is the lease of the reservation, it is renewed while the request is
  running and it is never derived from an arbitrary age.
- A reservation of a process that stopped is recovered by the startup
  recovery and by the periodic recovery. A late settlement of a recovered
  reservation still charges the real cost, the unique constraint of the
  ledger decides.
- The idempotency key of a request identifies its reservation, its usage event
  and its ledger entry. A retry of the request, of the delivery queue or of
  the settlement never reserves, records or charges twice.

### The lease of a reservation and the deadline of a request

The deadline of a reservation is **not** a proof that the request stopped. The
timeout of a provider bounds a single provider call, a request can call a
fallback provider and every call can be retried, so the request can outlive
the deadline of its reservation. The gateway therefore keeps two independent
clocks:

| Clock                        | Value      | Meaning                                                                                                                    |
| ---------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| `REQUEST_DEADLINE_MS`        | 300 000 ms | The deadline of the whole request. The provider call is aborted when it is reached, a request never runs without a bound.  |
| The lease of the reservation | 120 000 ms | The deadline of the reservation. It is renewed every `RESERVATION_RENEWAL_INTERVAL_MS` (30 000 ms) while the request runs. |

The two clocks answer different questions:

- the lease answers **"may the credit be returned?"**. While the request runs,
  the lease is renewed, so the periodic recovery never releases the credit of a
  running request. The recovery checks the deadline again in the conditional
  update, so a lease that was renewed between the read and the update wins the
  race,
- the deadline answers **"how long may the request run?"**. It bounds the
  request, so a lease can not be renewed forever and the credit of a request
  is never held forever.

The lease ends with the request:

- a request that ends normally is settled with its real cost,
- a request that failed after the provider was called keeps its reservation.
  The lease is not renewed any more, the credit is returned when the deadline
  passes,
- a process that dies does not renew the lease any more, the credit is
  returned when the deadline passes. A reservation is never held forever.

The renewal fails when the reservation is not reserved any more, for example
because the recovery took it. The request is then stopped, a request that is
served without a guaranteed credit can not be billed reliably. A renewal that
fails because the database is unreachable is retried, the request keeps its
credit as long as the lease is alive.

`RESERVATION_RENEWAL_INTERVAL_MS` has to be shorter than the lease, the
gateway rejects a configuration that breaks the guarantee.

### The recovery of the expired reservations

The gateway recovers the reservations whose request can no longer be running:

- the recovery runs **before the server accepts a request**. The instance stays
  unready until the recovery succeeded, so a paid request is never served with
  a stale billing state. A failed recovery does not stop the instance, the
  readiness stays false and the periodic recovery retries the work. The
  balance itself is never wrong, a failed recovery only keeps the credit of the
  affected organizations reserved, so the instance stays out of the rotation
  instead of crashing,
- the periodic recovery runs every `RESERVATION_RECOVERY_INTERVAL_MS` (60
  seconds by default). The timer does not keep the process alive and it is
  stopped with the other background work during the shutdown,
- the recovery is safe with several instances. The transition of a reservation
  is a conditional update, only the instance that changes the status returns
  the held credit. The credit of a reservation is therefore never returned
  twice and no settlement is duplicated,
- only the reservations whose deadline has passed are recovered. The deadline
  is derived from the maximum lifetime of a request, the credit of a request
  that is still running is never released, not even when a new instance of the
  gateway starts,
- every recovered reservation is recorded in the audit trail of the
  organization with the action `BILLING_RESERVATION_EXPIRED`, the reason of
  the released credit stays visible.

The unit of the reservation is the micro dollar, the same unit as the
unbilled usage accumulator. One cent are ten thousand micros. The catalogue
prices are US dollars per million tokens, the ledger stores the exact cost in
micros next to the rounded amount in cents, so no rounding can lose a cost.

## Credit balance and the spending limit

The credit of an organization is deducted in one transaction, while the row of
the billing account is locked:

- the balance is decremented with a relative and conditional update, it can
  never become negative and it can never overwrite the update of another
  charge,
- the spending limit is checked while the account is locked,
- the ledger entry uses the id of the usage event as its idempotency key. The
  unique constraint of the database rejects a second entry, so a retry of the
  delivery queue never charges the balance twice,
- a usage event that can not be charged stays visible as an unpaid usage
  event, and the rejection is recorded in the audit trail with the action
  `BILLING_CHARGE_REJECTED`.

The prices of the modalities that are not billed per token are part of the
catalogue as well: `pricePerImage`, `pricePerCharacter` and
`pricePerMegabyte`. The server measures the unit it bills, the number of the
images, the number of the characters of the speech input and the size of the
transcribed audio. A model without a price for its modality is rejected before
the provider is called, it is never served for free. The unit of the price has
to match the billing unit of the provider, the administrator owns that
configuration.

A request that needs a credit reservation before it is served is not
implemented yet. The reservation would reserve the upper bound of the request
(the price of the catalogue multiplied by the maximum number of the tokens of
the request), settle it with the real cost once the provider reported the
tokens, and release the unused part when the request failed or was
cancelled. Until then the pre-request check is a fast fail, the charge is the
authoritative one, and the requests that are served in the window between the
check and the charge are visible as unpaid usage events.

## Database migration

The migration job runs the Prisma CLI from the Gateway image with a read only root filesystem. That
layout was verified against the released runtime layout: the CLI and the schema engine only read the
schema, the migration files, and the engine binaries. The single write attempt of the CLI is its
engine version cache under `$HOME/.cache/prisma`; it fails harmlessly on a read only filesystem and
does not stop the migration. The job is bound to `activeDeadlineSeconds`, so a database that accepts
the connection but never answers cannot block a rollout forever.

## Staging environment

The staging environment is a separate overlay of the same base manifests. It
uses the namespace `baseapikey-staging`, its own configuration, its own TLS
material, and its own release artifact. It never reads or writes a production
resource.

```bash
# Review the manifests before they reach the cluster.
kubectl kustomize infrastructure/k8s/overlays/staging

# Validate the release configuration without a cluster.
node scripts/validate-k8s-release.mjs
node scripts/validate-k8s-release.mjs --rendered <rendered-staging.yaml>
```

The overlay pins the commit derived tag of the tested commit, for example
`sha-b8b65ae`, the tag that the release workflow publishes for that commit.
The image has to be published before the overlay can be applied.

The values that only the project owner can provide are listed in
`infrastructure/k8s/overlays/staging/README.md`: the staging hosts, the
`baseapikey-staging-secrets` Secret, the `baseapikey-staging-tls` certificate,
the staging PostgreSQL and Redis, and the provider and payment sandbox
credentials. The release validation refuses a rendered manifest that still
contains a placeholder, so a rollout cannot start with an unresolved host.

The rollout order is the migration first, then the workloads:

```bash
kubectl apply -k infrastructure/k8s/overlays/staging
kubectl -n baseapikey-staging logs job/baseapikey-migrate
kubectl -n baseapikey-staging get deploy,pod,ingress
```

The staging Prometheus resources are applied separately and watch the staging
namespace:

```bash
kubectl apply -k infrastructure/k8s/overlays/monitoring-staging
```

The rollback of a staging rollout restores the previous image reference in the
overlay and applies it again. The migrations are forward only, so the database
is kept as it is.

## Required external configuration

- PostgreSQL with point-in-time recovery and tested restore credentials.
- Redis with persistence, authentication, TLS, and memory alerts.
- Real provider credentials and a 32-byte base64 provider-encryption key.
- HTTPS account/invitation email webhook.
- HTTPS payment checkout adapter and signed webhook secret.
- TLS certificates for the API and Dashboard domains.
- Prometheus scraping with the metrics bearer token and on-call alert routing.

## Dashboard session security

- Route browser login, refresh, and logout through the Dashboard's same-origin `/api/session/*`
  endpoints. Do not expose the Gateway refresh token response directly to browser JavaScript.
- Production requires an HTTPS `DASHBOARD_PUBLIC_URL`; the refresh cookie uses the `__Host-`
  prefix, `Secure`, `HttpOnly`, `SameSite=Strict`, and `Path=/`.
- Keep browser Web Locks and BroadcastChannel available in the supported browser policy so
  simultaneous 401 responses and multiple tabs share one refresh rotation instead of triggering
  token-reuse protection.
- Keep `GATEWAY_PUBLIC_URL` reachable from both the Dashboard server and browser for authenticated
  API calls, and restrict Gateway CORS to the exact Dashboard origin.
- If the Dashboard origin changes, update `DASHBOARD_PUBLIC_URL` and `CORS_ORIGIN` together before
  rollout, then verify login, automatic refresh after an expired access token, and logout.

## Database migration and rollback

All migrations are forward-only. Take a database snapshot before deployment. If application health
degrades:

1. Stop the rollout and restore the previous application image.
2. Do not reverse a migration blindly. Current migrations are additive, so the previous application can ignore new tables and columns.
3. For data corruption, isolate writes and restore the latest verified snapshot/PITR point into a new database before switching traffic.
4. Reconcile usage events and billing transactions using request IDs and idempotency keys.

## Provider incident

- The runtime retries transient errors, opens a circuit after repeated failures, and falls back by configured priority and capability.
- Provider health is probed periodically and persisted for the admin console.
- Disable an unhealthy provider through the admin API. Runtime registrations reload without a process restart.
- Confirm JSON/SSE responses, cancellations, token usage, and fallback behavior after recovery.

## Billing incident

- Payment webhooks are signature-checked and idempotent.
- Usage costs come from active model prices, are accumulated at micro-dollar precision, and are deducted from credits in cents.
- Spending alerts are written at 75%, 90%, and 100%; requests are blocked on a negative balance or reached monthly limit.
- Never edit balances directly. Use an auditable adjustment maintenance procedure.

## Usage queue recovery

Usage events are buffered in Redis at `baseapikey:usage:queue`. Failed records retry three times and
then move to `baseapikey:usage:dead-letter`.

1. Preserve a copy of the dead-letter list.
2. Fix the database or schema issue.
3. Replay validated envelopes without altering `requestId`.
4. Confirm usage IDs, credit idempotency keys, and daily aggregates do not duplicate.

## Backup verification

The sample Kubernetes CronJob writes daily custom-format PostgreSQL dumps and retains 14 days.
Production must also copy backups to encrypted off-cluster storage. Perform a restore drill at least
monthly and record recovery time and recovery point results.
