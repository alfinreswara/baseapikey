# BaseAPIKey

> Enterprise AI API Key Management & Proxy Gateway Platform

BaseAPIKey is an enterprise-grade AI proxy gateway providing unified API key management, model routing, rate limiting, usage tracking, budget control, and fallback routing for AI models.

---

## Workspace Architecture

BaseAPIKey is structured as a TypeScript monorepo using [Turborepo](https://turbo.build/repo) and [pnpm](https://pnpm.io/) workspaces.

```text
baseapikey/
├── apps/
│   ├── gateway/       # Fastify AI Proxy Gateway server
│   ├── dashboard/     # Lightweight TypeScript administrative console
│   └── docs-site/     # Mintlify documentation site
├── packages/
│   ├── config/        # Shared TSConfig, ESLint, & Prettier rules
│   ├── database/      # Prisma schema, client, seed, and migrations
│   ├── logger/        # Structured Pino logger with PII redaction
│   └── shared/        # Shared types, Zod env validation, & utilities
└── infrastructure/
    ├── docker/        # Docker Compose configuration (PostgreSQL, Redis)
    └── k8s/           # Kubernetes deployment manifests
```

---

## Development Scripts

| Command             | Description                                          |
| :------------------ | :--------------------------------------------------- |
| `pnpm dev`          | Starts all applications in development mode          |
| `pnpm build`        | Builds all monorepo applications and packages        |
| `pnpm lint`         | Runs ESLint across all workspace packages            |
| `pnpm lint:fix`     | Runs ESLint with automatic fixes across all packages |
| `pnpm typecheck`    | Runs TypeScript type checking (`tsc --noEmit`)       |
| `pnpm type-check`   | Alias for `pnpm typecheck`                           |
| `pnpm format`       | Formats all workspace files using Prettier           |
| `pnpm format:check` | Verifies code formatting across all workspace files  |
| `pnpm test`         | Runs test suites across all workspace packages       |

---

## Dashboard

The console runs on `http://localhost:3001` and reads the Gateway URL from
`GATEWAY_PUBLIC_URL` (default `http://localhost:3000`). It includes authentication,
organization switching, API-key management, usage analytics, model catalog, invitations, billing,
and admin operations. Refresh tokens are held only in a same-origin `HttpOnly`, `SameSite=Strict`
cookie managed by the Dashboard session bridge; browser JavaScript never receives or persists them.
Run `pnpm --filter @baseapikey/dashboard test:e2e` for the Chromium user-flow test.

## Deployment Candidate

The Gateway has a multi-stage, non-root production image and a production Compose stack with
PostgreSQL, Redis, a one-shot migration service, and dependency-aware health checks.

```bash
docker compose --env-file .env.production \
  -f infrastructure/docker/docker-compose.prod.yml up --build -d
```

Production secrets must be supplied through `.env.production` or a secret manager. JWT access and
refresh secrets must be different and at least 32 characters; provider credentials require a
base64-encoded 32-byte encryption key, and billing requires a signed webhook secret. See
[`docs/BACKEND_READINESS.md`](docs/BACKEND_READINESS.md) for implemented controls. Before public
production, complete [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md) and follow
[`docs/PRODUCTION_RUNBOOK.md`](docs/PRODUCTION_RUNBOOK.md).

Pull requests are gated by workspace checks, browser E2E, migration verification, dependency and
secret scans, infrastructure policy scanning, container vulnerability scanning, SBOM generation,
and CodeQL. Release images are built manually from `main` by `.github/workflows/release.yml`; start
with `publish=false`, then use the protected `release` environment to approve a versioned GHCR
publication.

---

## Git Workflow & Quality Gates

BaseAPIKey enforces automated quality gates via [Husky](https://typicode.github.io/husky/), [lint-staged](https://github.com/lint-staged/lint-staged), and [Commitlint](https://commitlint.js.org/).

### Pre-commit Hooks

Before any commit is accepted, `.husky/pre-commit` automatically:

1. Runs ESLint and Prettier auto-formatting on staged `.ts` and `.tsx` files via `lint-staged`.
2. Runs workspace-wide TypeScript type checking (`pnpm run type-check`).

If any check fails, the commit is aborted.

### Conventional Commits

All commit messages must adhere to the [Conventional Commits](https://www.conventionalcommits.org/) specification validated by `.husky/commit-msg`:

```text
<type>(<scope>): <short description>
```

#### Allowed Commit Types

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation changes
- `style`: Changes that do not affect code logic (formatting, missing semi-colons)
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `test`: Adding missing tests or correcting existing tests
- `chore`: Maintenance tasks, dependency updates, build/tooling changes

_Example:_ `feat(gateway): add request logging middleware`
