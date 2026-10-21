# Release Checklist

## Automated gates

- [ ] Workspace type-check, lint, tests, and builds pass.
- [ ] Dashboard browser E2E passes for login, cold reload/profile recovery, concurrent refresh,
      key creation, navigation, and logout.
- [ ] Prisma schema validates and every migration applies to an empty database.
- [ ] Migrations apply cleanly to a sanitized copy of the current production database.
- [ ] Gateway and Dashboard container images build with the release tag.
- [ ] Production dependency audit has no unaccepted high or critical finding.
- [ ] CodeQL has no unresolved release-blocking JavaScript/TypeScript finding.
- [ ] Repository secret and infrastructure configuration scans pass.
- [ ] Gateway and Dashboard image scans have no unaccepted high or critical finding.
- [ ] CycloneDX SBOMs exist for both release images and are retained with the release evidence.
- [ ] The release dry run (`publish=false`) passes before the protected publication run.
- [ ] The `release` environment exists and requires a reviewer before a publication run.
- [ ] The image of the tested commit is published and its digest is recorded.
- [ ] `node scripts/validate-k8s-release.mjs` passes and the rendered production overlay contains
      one shared release identifier for the Gateway, the Dashboard, and the migration job.

## Staging gates

- [ ] The staging overlay renders, the release validation passes, and the staging namespace
      holds no production resource.
- [ ] The migration job applied all migrations to the staging database and the schema matches
      the Prisma models.
- [ ] The API key authentication, a chat completion, and a streaming response were verified
      against the staging database.
- [ ] The model catalogue is populated, every model has a price or is explicitly free, and a
      request for an unknown or unpriced model is rejected before the provider is called.
- [ ] The billing concurrency tests pass against the staging database:
      `pnpm --filter @baseapikey/gateway test:concurrency`.
- [ ] The credit reservation tests pass against the staging database:
      `pnpm --filter @baseapikey/gateway test:reservation`.
- [ ] The expired credit reservations of a stopped instance are recovered after a restart and
      the instance stays unready until the recovery succeeded.
- [ ] The credit of a running request is never released early: the lease of the reservation is
      renewed while the request runs, and `REQUEST_DEADLINE_MS` bounds the request.
- [ ] The CI check **Prisma Migration Check** is green on `main`, it runs the billing integration
      tests against a real PostgreSQL.
- [ ] The release pipeline tests pass: `pnpm run test:release`. They prove that the release tag is
      created after the scan of every published platform.
- [ ] The dry run of the release (`publish=false`) scanned `linux/amd64` and `linux/arm64`, and the
      scan reported no finding of HIGH or CRITICAL.
- [ ] The release run (`publish=true`) created the version tag and the commit tag from the digest of
      the scanned image, and the scan tag `scan-<commit>` was removed.
- [ ] A client disconnect releases the upstream request, and an upstream failure is reported as
      an error response.
- [ ] A cache outage keeps the instance alive, the readiness reports the cache as unavailable,
      and the liveness stays healthy.
- [ ] A SIGTERM during a running stream ends the stream deterministically and the process exits
      before the termination grace period.

- [ ] Registration, login, refresh rotation, logout, and organization switching work.
- [ ] API keys are isolated by active organization and member roles are enforced.
- [ ] JSON and SSE chat calls work against the real provider.
- [ ] Embeddings, images, speech, and transcription work for configured models.
- [ ] Provider retry, circuit breaker, priority fallback, health checks, and hot reload are forced and observed.
- [ ] Token cost, Redis queue processing, daily aggregate, credit ledger, spending limit, and threshold alerts reconcile.
- [ ] Checkout and signed payment webhooks survive retries, duplicates, invalid signatures, and provider timeouts.
- [ ] Email verification, password reset, and organization invitation emails arrive and expire correctly.
- [ ] PostgreSQL and Redis outage behavior, recovery, and readiness probes are verified.
- [ ] Streaming cancellation, graceful shutdown, and usage queue drain are verified under load.
- [ ] SIGTERM removes the pod from the Service through readiness, in-flight requests finish, and the
      process exits before `terminationGracePeriodSeconds` expires.
- [ ] A streaming request over a real connection receives the SSE events and the `DONE` event, and a
      client disconnect releases the upstream request.
- [ ] A stream that is still running during the rollout ends with an error event instead of a
      truncated response.

## Operations gates

- [ ] TLS, CORS, trusted proxies, secret manager, network policy, and least-privilege runtime are configured.
- [ ] PostgreSQL PITR, Redis persistence, and off-cluster encrypted backups are enabled.
- [ ] A successful restore drill is recorded.
- [ ] Logs, protected metrics, dashboards, alerts, and on-call routing are live.
- [ ] Rollback uses the previous immutable image and has been rehearsed.
- [ ] Published image digests, source commit, workflow URL, SBOMs, and provenance are recorded.
- [ ] Domains, image references, resource limits, HPA, PDB, and ingress no longer contain examples.

Production approval requires evidence for every item; local unit tests alone are not approval.
