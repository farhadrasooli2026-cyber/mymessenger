# Branch and review

- `main` is the production-track branch. Do not push secrets or `.env.local`.
- Feature work uses `cursor/*` or `feature/*`. Release cuts use `release/x.y.z`.
- Commits should say what changed and why. Sensitive changes need review before merge.
- CI must be green: lint, `tsc`, tests, secret scan.

# Secrets

Production pepper, data key, session secret, TURN credentials, and backup key live in the host secret store or `EnvironmentFile`, never in git or CI logs.
