# Deployment and operations

## Production topology

| Component | Platform | Release gate |
|---|---|---|
| Next.js frontend | Vercel | GitHub `CI` succeeds, then the staged production deployment is smoke-tested and promoted |
| FastAPI backend | Render (`roundcraft-api.onrender.com`) | Render's `checksPass` trigger waits for GitHub `CI`, then `/health/ready` must pass its database and catalog checks |
| Auth, Postgres, Storage | Supabase | Migrations are applied before dependent API changes merge; readiness fails closed when the required prompt catalog is absent |
| Voice and video agents | Agora | Real staging-channel verification before production credentials are enabled |

Production must use an always-on Render plan. A sleeping API adds cold-start delay to Agora callbacks and live interviews.

## GitHub configuration

Protect `main` with the single `CI / Required` check. CI detects changed paths and runs only the applicable web, API, shared-package, and database jobs. Pull requests use demo mode and dummy Agora credentials; they never consume production quota or secrets.

Create a protected GitHub Environment named `production` for Vercel releases:

| Kind | Name | Purpose |
|---|---|---|
| Secret | `VERCEL_TOKEN` | Vercel CLI deployment and rollback |
| Variable | `VERCEL_ORG_ID` | Vercel account/team selection |
| Variable | `VERCEL_PROJECT_ID` | Vercel project selection |

Render deployment needs no GitHub secret, deploy hook, GCP identity, or service-account key. Render reads the linked `main` branch and deploys only after checks pass.
Changes to `render.yaml` also run a secret-free schema check against Render's official Blueprint schema inside the required API CI job.

## Frontend release

`.github/workflows/deploy-web.yml` runs after successful `main` CI or by a manual dispatch pinned to the current `main` tip. A dispatch from another branch or tag fails before release tests:

1. Re-check shared packages and the web application at the exact release commit.
2. Pull Vercel Production settings.
3. Reject missing values, demo mode, non-public or placeholder URLs and Agora IDs, privileged credentials in browser variables, URL paths such as `/v1`, and a mismatch between `NEXT_PUBLIC_API_BASE_URL` and `AGENT_BACKEND_URL`.
4. Build a staged Production deployment with pinned Vercel CLI `59.10.0`.
5. Smoke test the candidate, then wait for the configured backend `/health/ready` endpoint to report the same release commit.
6. Promote that exact deployment without rebuilding only after both checks pass.

The required Vercel values and project settings are documented in `deploy/vercel/README.md`.

## Backend release

`render.yaml` and `deploy/render/Dockerfile` are the backend deployment contract:

1. Render deploys every verified `main` commit so its reported release SHA stays coordinated with the Vercel candidate, including frontend-only releases.
2. `autoDeployTrigger: checksPass` waits for GitHub CI on the linked branch; the required API job also validates the Blueprint schema.
3. Render builds the locked Python 3.12 image and starts Uvicorn on the injected `PORT`.
4. Render sends `/health/ready` checks to the new instance. Production readiness verifies Postgres connectivity and all 12 active built-in templates from migration `202609010001`; traffic is not routed when the schema or catalog is missing.
5. The previous successful deploy remains available for rollback in Render's Events page.

Before connecting the Blueprint to an existing service, match its exact service name. The Blueprint intentionally omits region, plan, and instance count so the existing Render settings remain authoritative. Secrets use `sync: false` and are supplied only in the Render dashboard. The canonical Render and Vercel origins, Agora callback, and matching CORS allowlist are fixed in the Blueprint; update them together when a domain changes. Production startup validates public HTTPS API, web, Supabase, Agora callback, and Groq URLs; a PostgreSQL database; Agora App ID, certificate, callback bearer, and webhook secret; Supabase server secret; Groq key and model; and explicit HTTPS CORS origins containing `WEB_BASE_URL`.

## Database migrations

Render does not receive a Supabase management credential. Apply backward-compatible migrations before merging an API change that needs them:

```bash
supabase db push --dry-run --db-url "$SUPABASE_DB_URL"
supabase db push --db-url "$SUPABASE_DB_URL"
```

Use additive changes first. Remove old columns or tables only after the previous Render deploy no longer needs them. Rollbacks never reverse database migrations automatically. The readiness gate limits blast radius but does not apply migrations: a missing catalog intentionally leaves the new Render revision unhealthy until the migration is applied.

## Rollback

- Web: run `Roll back web production`, type `ROLLBACK`, and optionally provide a Vercel deployment URL/ID.
- API: in the Render service's Events page, choose a recent successful deploy and select **Rollback**. Dashboard rollback also disables auto-deploy until the incident is resolved; re-enable `checksPass` afterward.

## Release verification

Run locally:

```bash
pnpm verify
docker build --file deploy/render/Dockerfile apps/api
```

Then verify two-role and five-role staging panels: one physical Agora agent, one audible interviewer, non-linear 1 → 3 → 1 role selection, interruption, RTM transcript correlation, single-agent cleanup, and evidence-linked reporting. Repeat without an avatar key to verify animated identity-tile and audio fallback.
