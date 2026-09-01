# NIXO Deployment

Environments: `development`, `testing`, `staging`, `production` (`NIXO_ENV`). They do not share cookies, stores, or secrets.

## CI

GitHub Actions workflow `.github/workflows/ci.yml` (contents: read only) runs lint, typecheck, tests, and `scripts/secret-scan.mjs`. `npm audit` is informational. Production credentials are not injected into CI.

Local: `npm run ci`

## Release catalog

Staff → `/app/admin` → انتشار (`/api/deploy`) و آمادگی (`/api/prod`). یخ‌زدگی `PROD_FREEZE` Promote Production را رد می‌کند.

1. Staging release (rolling / blue-green / canary) records artifact checksum.
2. Production needs password + `DEPLOY_PRODUCTION`. Emergency uses `EMERGENCY_DEPLOY` but still requires secret scan.
3. Rollback uses `ROLLBACK`. Sessions and background jobs are not wiped.
4. Health: `/api/health?probe=live|ready`. Unready instances must not receive traffic.
5. Feature flags never replace authorization. Kill switch only hides optional product slices.

## Containers and process

- `Dockerfile` non-root image, healthcheck on ready probe.
- `docker-compose.yml` memory/CPU limits, stop grace, json logs.
- `deploy/nixo.service` restart burst limit (anti restart-loop).
- `deploy/k8s.yaml` rolling update, readiness/liveness, preStop drain.
- `deploy/k8s-scale.yaml` HPA, PDB, worker Deployment, NetworkPolicy.
- `deploy/iac/nixo.tf` Terraform contract (no secrets).
- `deploy/nginx.conf.example` health-aware upstream.

## Runbooks

- Failed ready probe: keep previous replica; do not promote.
- Error spike after release: auto-rollback window 15 minutes or staff Rollback.
- Queue/search/notify workers: jobs persist in the JSON store across process restart.
- WebSockets: ready probe fails during SIGTERM so the balancer drains; cookies stay valid.
- CDN: hashed `/_next/static` assets; icons immutable; APIs `private, no-store`.
- Security patch: same CI + Production Approval; emergency path still audits.

نسخه است روی `/api/version` و `X-NIXO-App-Version`. راهنمای Developer: `/docs/deploy`.
