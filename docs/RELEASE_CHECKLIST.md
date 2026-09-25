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

## Staging gates

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

## Operations gates

- [ ] TLS, CORS, trusted proxies, secret manager, network policy, and least-privilege runtime are configured.
- [ ] PostgreSQL PITR, Redis persistence, and off-cluster encrypted backups are enabled.
- [ ] A successful restore drill is recorded.
- [ ] Logs, protected metrics, dashboards, alerts, and on-call routing are live.
- [ ] Rollback uses the previous immutable image and has been rehearsed.
- [ ] Published image digests, source commit, workflow URL, SBOMs, and provenance are recorded.
- [ ] Domains, image references, resource limits, HPA, PDB, and ingress no longer contain examples.

Production approval requires evidence for every item; local unit tests alone are not approval.
