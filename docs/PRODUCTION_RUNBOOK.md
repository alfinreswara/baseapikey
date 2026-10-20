# Production Runbook

## Release flow

1. Require the CI and CodeQL branch checks on `main`, protect the GitHub `release` environment with
   reviewers, and confirm every item in `RELEASE_CHECKLIST.md` has evidence.
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

## Database migration

The migration job runs the Prisma CLI from the Gateway image with a read only root filesystem. That
layout was verified against the released runtime layout: the CLI and the schema engine only read the
schema, the migration files, and the engine binaries. The single write attempt of the CLI is its
engine version cache under `$HOME/.cache/prisma`; it fails harmlessly on a read only filesystem and
does not stop the migration. The job is bound to `activeDeadlineSeconds`, so a database that accepts
the connection but never answers cannot block a rollout forever.

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
