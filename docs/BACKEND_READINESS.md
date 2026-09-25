# Backend Readiness

> Current code status: feature-complete staging candidate. Public production approval still
> requires the external staging and operations evidence in `RELEASE_CHECKLIST.md`.

## Latest completion work

- Active organization context is embedded in issued tokens and re-resolved server-side for API-key and usage routes.
- API-key management and analytics are scoped to the active organization; writes require an organization manager.
- Model pricing drives usage cost, a Redis-backed queue, daily aggregates, credit deductions, spending limits, and threshold audit alerts.
- Models resolve to providers; providers hot-reload after admin changes and periodic health probes update the admin view.
- Pending organization invitations are tokenized, hashed at rest, delivered by webhook, and accepted by the intended account.
- Admin users, platform health/usage, protected metrics, Dashboard/Gateway images, Kubernetes resources, backups, and alerts are included.
- The Dashboard uses a same-origin session bridge so rotating refresh tokens remain in hardened
  HttpOnly cookies. Refresh work is coalesced within and coordinated across browser tabs, and browser
  E2E covers cold reload, expired/concurrent refresh recovery, profile recovery, API-key creation,
  navigation, and logout.

## Current status

The platform is a deployment candidate for staging. It is not yet approved for public production
traffic until the environment verification and operational items below are completed.

### Implemented runtime controls

- Fastify 5 Gateway with structured request logging and secret redaction.
- JWT authentication, session rotation/revocation, RBAC, and API key lifecycle management.
- OpenAI-compatible chat completions with JSON and SSE responses through 9Router.
- OpenAI-compatible embeddings, image generation, speech, and multipart transcription endpoints
  with per-feature API-key permissions, quota checks, cancellation, and usage capture.
- Retry with exponential backoff, per-provider circuit breakers, and priority-ordered fallback for
  transient provider failures.
- Public OpenAI-compatible model catalog backed by active PostgreSQL records and a validated,
  fail-open Redis cache with configurable TTL.
- JWT-protected, active-organization-scoped usage time series, summary breakdowns, and cursor-paginated request
  history with bounded date ranges and no client PII in responses.
- JWT/RBAC-protected self-service profile reads and updates, password changes, email verification,
  and enumeration-safe password resets with audit logging and full session revocation.
- Redis-backed, purpose-bound account tokens stored only as SHA-256 digests and consumed atomically
  once, with an authenticated HTTPS webhook for outbound account email delivery.
- Organization/team membership with owner/admin/member roles, active-organization selection,
  cursor-paginated membership management, last-owner protection, and organization audit events.
  New accounts receive a personal organization atomically; the migration backfills existing users,
  API keys, usage rows, and audit events into their personal organization.
- Organization billing accounts, credit ledger, invoices, external checkout creation, and
  HMAC-authenticated idempotent purchase webhooks.
- Admin-only provider/model management and audit-log search. Provider credentials are encrypted
  with AES-256-GCM and are never returned by the API. Active provider records are synchronized into
  the runtime registry after admin changes, with periodic health probes and priority fallback.
- Redis-queued, PostgreSQL-backed usage records, daily organization aggregates, model-price cost
  calculation, credit charging, and API-key/organization quota enforcement.
- Redis-backed sliding-window login protection, enforced per normalized email and source IP.
- Real readiness checks for PostgreSQL (`SELECT 1`) and Redis (`PING`) with bounded timeouts.
- Configurable CORS allowlist, Helmet security headers, 1 MiB default body limit, and sanitized 500
  responses.
- Graceful shutdown of HTTP, Redis, and Prisma connections.
- Production environment validation that rejects missing, reused, short, or placeholder secrets.
- Dashboard startup validation rejects invalid ports, non-HTTP endpoints, and non-HTTPS production
  origins; its CSP limits API connections to the configured Gateway origin and production enables
  HSTS.
- Standalone production package generation with compiled workspace packages and Prisma Client.
- Multi-stage, non-root Gateway and Dashboard images plus a production Compose stack with a
  one-shot migration job.
- Kubernetes deployments, services, ingress, HPA, PDB, network policy, migration job, backup
  CronJob, ServiceMonitor, and alert rules.
- CI quality gates for tests, type checking, linting, builds, container builds, browser E2E,
  production dependency audit, CodeQL, repository secret detection, infrastructure policy scans,
  high/critical image vulnerability scans, CycloneDX SBOM generation, and applying every Prisma
  migration to an empty PostgreSQL database.
- A manual `main`-only release workflow builds versioned amd64/arm64 Gateway and Dashboard images,
  emits BuildKit provenance and SBOM attestations, scans the result before acceptance, and publishes
  to GHCR only when explicitly requested through the protected `release` environment.

## Required production configuration

Do not commit production values. Supply at least:

```dotenv
POSTGRES_PASSWORD=<strong database password>
NINE_ROUTER_API_KEY=<provider API key>
JWT_ACCESS_SECRET=<unique random value, at least 32 characters>
JWT_REFRESH_SECRET=<different unique random value, at least 32 characters>
ACCOUNT_EMAIL_WEBHOOK_URL=https://mailer.example.com/account-events
ACCOUNT_EMAIL_WEBHOOK_SECRET=<unique random value, at least 32 characters>
PROVIDER_ENCRYPTION_KEY=<base64-encoded 32-byte key; generate with openssl rand -base64 32>
BILLING_PROVIDER_URL=https://payments.example.com/api
BILLING_PROVIDER_API_KEY=<payment provider API key>
BILLING_WEBHOOK_SECRET=<unique random value, at least 32 characters>
CORS_ORIGIN=https://dashboard.example.com
```

When the Gateway runs behind an ingress or reverse proxy, set `TRUST_PROXY` to the trusted proxy CIDR
list. Do not use `true` on an untrusted network because client IP headers could be spoofed.

Optional tuning variables are documented in `.env.example`, including Redis connection timeout,
login attempt limits, readiness timeout, model catalog cache TTL, database pool size, and maximum
request size. Account verification and reset token lifetimes plus the email webhook timeout are also
configurable.

## Staging approval checklist

These checks require real infrastructure and cannot be proven by mocked unit tests:

1. Build `infrastructure/docker/Dockerfile.gateway` in CI or on a host with Docker.
2. Start `infrastructure/docker/docker-compose.prod.yml` with staging secrets.
3. Confirm the migration job applies every migration successfully to a clean database and an
   existing upgraded database.
4. Verify `/health/live` and `/health/ready`, including a forced PostgreSQL and Redis outage.
5. Seed active and inactive model records, verify `/v1/models` only returns active models, then
   confirm Redis cache hits, expiry, and database fallback during a cache outage.
6. Populate representative usage volume, verify user and API-key isolation for all usage analytics
   endpoints, and confirm indexed 30-day queries remain below the latency target.
7. Run real 9Router JSON and SSE requests and reconcile tokens/costs against stored usage rows.
8. Load-test login throttling, quota concurrency, stream cancellation, and graceful termination.
9. Configure TLS termination, a managed secret store, database backups, Redis persistence, log
   shipping, metrics, alerts, and rollback procedures.
10. Exercise verification and reset delivery against the real email webhook, confirm Redis expiry
    and one-time consumption, and verify all sessions are rejected after a password change/reset.
11. Verify CI, CodeQL, secret/config scans, image scans, and generated SBOM artifacts before using
    the manually approved release workflow to publish an image.
12. Exercise payment checkout and signed webhook delivery against the selected payment provider,
    including duplicate event delivery and provider timeout behavior.
13. Force transient 9Router failures and verify retry, circuit opening, cooldown recovery, and
    fallback behavior with real configured providers.

## Remaining production approval work

Items 4–8 of the backend product backlog are implemented. Public production approval still depends
on the staging checks above, real payment/provider credentials, load and failure testing, monitored
off-cluster backups, and an exercised operational rollback procedure. Pending email invitations
for people without an existing account remain a product enhancement; the current organization API
adds registered users by email.
