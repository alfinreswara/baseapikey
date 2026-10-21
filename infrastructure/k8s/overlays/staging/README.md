# BaseAPIKey staging environment

The staging environment is separated from production by its own namespace
(`baseapikey-staging`), its own configuration, its own TLS material, and its
own release artifact. It never reads or writes a production resource.

```bash
# Review the manifests before they reach the cluster.
kubectl kustomize infrastructure/k8s/overlays/staging

# Validate the release configuration without a cluster.
node scripts/validate-k8s-release.mjs
node scripts/validate-k8s-release.mjs --rendered <rendered-staging.yaml>
```

## Values that the project owner has to provide

| Value                          | Where it belongs                               | Status                                |
| ------------------------------ | ---------------------------------------------- | ------------------------------------- |
| Staging API host               | `overlays/staging/kustomization.yaml`          | `REPLACE_WITH_STAGING_API_HOST`       |
| Staging Dashboard host         | `overlays/staging/kustomization.yaml`          | `REPLACE_WITH_STAGING_DASHBOARD_HOST` |
| `baseapikey-staging-secrets`   | Secret manager, namespace `baseapikey-staging` | Not part of this repository           |
| `baseapikey-staging-tls`       | Certificate management, namespace staging      | Not part of this repository           |
| Staging PostgreSQL and Redis   | Managed services                               | Not part of this repository           |
| Provider credentials (9Router) | `baseapikey-staging-secrets`                   | Not part of this repository           |
| Payment sandbox credentials    | `baseapikey-staging-secrets`                   | Not part of this repository           |

The release validation refuses a rendered manifest that still contains a
placeholder, so a staging rollout cannot start with an unresolved host.

## Required secret keys

The staging namespace needs a `baseapikey-secrets` Secret with the same keys
as the production Secret, filled with staging values:

`DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`NINE_ROUTER_API_KEY`, `NINE_ROUTER_BASE_URL`, `PROVIDER_ENCRYPTION_KEY`,
`ACCOUNT_EMAIL_WEBHOOK_URL`, `ACCOUNT_EMAIL_WEBHOOK_SECRET`,
`BILLING_PROVIDER_NAME`, `BILLING_PROVIDER_URL`, `BILLING_PROVIDER_API_KEY`,
`BILLING_WEBHOOK_SECRET`, `METRICS_TOKEN`, `CORS_ORIGIN`,
`DASHBOARD_PUBLIC_URL`, `GATEWAY_PUBLIC_URL`, `ERROR_REPORTING_WEBHOOK_URL`,
`ERROR_REPORTING_WEBHOOK_SECRET`.

`DASHBOARD_PUBLIC_URL` and `GATEWAY_PUBLIC_URL` have to point at the staging
hosts, and `CORS_ORIGIN` has to allow the staging Dashboard origin only.

The staging environment applies the same secret rules as production: the
Gateway refuses to start when a secret is missing, shorter than 32 characters,
or one of the documented example values. The public URLs have to use HTTPS and
the secrets have to be different from each other.

## Image

The overlay pins the release candidate `v0.1.0`. The release workflow
publishes that tag and a commit derived tag (`sha-<commit>`) for the published
commit, for example `sha-acfdd30` for the commit that the staging validation
used. The image has to exist in the registry before the overlay is applied:

```bash
gh workflow run "Build Release Images" -f version=v0.1.0 -f publish=true
```

Do not reuse a version tag for different image content, and prefer the
published digest over the tag for a repeatable rollout. The promotion path
from staging to production uses the same artifact: record the digest of the
staging rollout and pin the production overlay to that digest.

## Rollout

```bash
# 1. Migration against the staging database.
kubectl apply -k infrastructure/k8s/overlays/staging
kubectl -n baseapikey-staging logs job/baseapikey-migrate

# 2. Watch the workloads become ready.
kubectl -n baseapikey-staging get deploy,pod,ingress

# 3. Verify the service.
kubectl -n baseapikey-staging port-forward svc/gateway 3000:80
curl -fsS http://127.0.0.1:3000/health/ready
```

The staging Prometheus resources are applied separately and watch the staging
namespace:

```bash
kubectl apply -k infrastructure/k8s/overlays/monitoring-staging
```

## Rollback

The migrations are forward only. The rollback of a staging rollout is
therefore:

1. Stop the rollout.
2. Restore the previous image reference in the overlay and apply it again.
3. Keep the database as it is, the migrations are additive and the previous
   application ignores the new tables and columns.

A destructive database rollback is not part of the staging procedure. Take a
snapshot before the migration if the data has to be restored.
