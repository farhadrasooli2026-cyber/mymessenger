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
- `deploy/cdn/nixo-edge.conf` CDN cache for hashed static only; private APIs no-store.

## Runbooks

- Failed ready probe: keep previous replica; do not promote.
- Error spike after release: auto-rollback window 15 minutes or staff Rollback.
- Queue/search/notify workers: jobs persist in the JSON store across process restart.
- WebSockets: ready probe fails during SIGTERM so the balancer drains; cookies stay valid.
- CDN: hashed `/_next/static` assets; icons immutable; APIs `private, no-store`.
- Security patch: same CI + Production Approval; emergency path still audits.

نسخه است روی `/api/version` و `X-NIXO-App-Version`. راهنمای Developer: `/docs/deploy`.

## Render Environment Variables

Set these in the Render Dashboard → Environment. **Do not put real keys in Git.**

Required for a production web service:

```
NIXO_ENV=production
NIXO_DEMO_INBOX=false
NIXO_PEPPER=
NIXO_SESSION_SECRET=
NIXO_DATA_KEY=
NIXO_BACKUP_KEY=
NIXO_EMAIL_PROVIDER=resend
NIXO_EMAIL_FROM=NIXO <noreply@yourdomain>
NIXO_EMAIL_API_KEY=
NIXO_SMS_PROVIDER=twilio
NIXO_SMS_API_KEY=
NIXO_SMS_API_SECRET=
NIXO_SMS_FROM=
```

**Persistence:** set `DATABASE_URL` (Render Postgres) so accounts survive restart and redeploy. The app stores the signed document in table `nixo_store`. Without it, production health is unready unless `NIXO_ALLOW_FILE_STORE=1` and a persistent disk is mounted at `.data`.

Disk fallback: mount a persistent disk at `.data` so the JSON store survives deploys. Health: `/api/health?probe=ready`. OTP details: [`docs/OTP.md`](./OTP.md).

## Verify GitHub SHA vs Render

1. GitHub `main` HEAD: `git ls-remote https://github.com/farhadrasooli2026-cyber/mymessenger.git refs/heads/main`
2. After Render finishes a deploy of that branch, `GET https://<your-service>.onrender.com/api/version` must show the same `gitSha` as `RENDER_GIT_COMMIT` (Render injects this automatically).
3. `GET /api/health?probe=ready` must be 200 with `persist.driver: "postgres"`, `otp.email: true`, `otp.sms: true`. If `otp.emailSandbox: true`, Resend is still on `*.resend.dev` and can only deliver to the Resend account owner — verify your own domain in Resend.

`nixo.onrender.com` is an unrelated public site. Use the hostname of **this** Web Service from the Render dashboard.

