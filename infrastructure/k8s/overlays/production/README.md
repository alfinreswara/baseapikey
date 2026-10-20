# BaseAPIKey production overlay

This overlay is the single place where the released container artifacts are
pinned. The Gateway, the Dashboard, and the migration job always resolve to
the same release, so the migration job can never run a schema version that
differs from the running application.

## What has to be provided before a deployment

| Value                     | Where it belongs                               | Status                                  |
| ------------------------- | ---------------------------------------------- | --------------------------------------- |
| Release version or digest | `images:` in `kustomization.yaml`              | Set to `v0.1.0`, replace before release |
| Cluster credentials       | Operator environment                           | Not part of this repository             |
| `baseapikey-secrets`      | Secret manager, see `base/secret.example.yaml` | Not part of this repository             |
| Ingress hosts             | `base/platform.yaml`                           | Still example hosts, replace them       |
| PostgreSQL and Redis      | Managed services                               | Not part of this repository             |

## Publish the release artifacts

```bash
# From main, with the semantic version of the release.
gh workflow run "Build Release Images" -f version=v0.1.0 -f publish=false
gh workflow run "Build Release Images" -f version=v0.1.0 -f publish=true
```

The workflow publishes `ghcr.io/alfinreswara/baseapikey-gateway` and
`ghcr.io/alfinreswara/baseapikey-dashboard` with the release tag and with a
`sha-<commit>` tag. Nothing is published automatically, so the images only
exist after the workflow ran with `publish=true`.

## Pin the release

Prefer the published digest, because a tag can be moved:

```yaml
images:
  - name: ghcr.io/alfinreswara/baseapikey-gateway
    newName: ghcr.io/alfinreswara/baseapikey-gateway
    digest: sha256:<digest of the published image>
```

The release tag works as well and must never be reused for different image
content:

```yaml
images:
  - name: ghcr.io/alfinreswara/baseapikey-gateway
    newName: ghcr.io/alfinreswara/baseapikey-gateway
    newTag: v0.1.0
```

## Render and apply

```bash
# Review the rendered manifests before they reach a cluster.
kubectl kustomize infrastructure/k8s/overlays/production

# Validate the release configuration without a cluster.
node scripts/validate-k8s-release.mjs
node scripts/validate-k8s-release.mjs --rendered <rendered-manifest.yaml>

# Apply the migration job first, then roll out the workloads.
kubectl apply -k infrastructure/k8s/overlays/production
```

The Prometheus resources are not part of this overlay because they need the
Prometheus Operator custom resource definitions:

```bash
kubectl apply -k infrastructure/k8s/overlays/monitoring
```
