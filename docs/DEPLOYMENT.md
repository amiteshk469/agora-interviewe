# Deployment and operations

## Environments

Use three isolated environments:

| Environment | Frontend | API | Supabase | Agora |
|---|---|---|---|---|
| Local | Next.js dev server | FastAPI/uvicorn | local Supabase or dev project | demo mode or a dev App ID |
| Preview | Vercel Preview | shared non-production Cloud Run service | non-production project | dev App ID; mocked in pull-request CI |
| Production | promoted Vercel deployment | promoted Cloud Run revision in `asia-south1` | production project | production App ID |

Do not share Supabase service-role keys, Agora App Certificates, or provider keys across environments.

## GitHub configuration

Create a protected GitHub Environment named `production`. Require approval if the team wants a manual production gate.

### Secrets

| Name | Used by |
|---|---|
| `VERCEL_TOKEN` | Vercel CLI deployment and rollback |
| `SUPABASE_DB_URL` | migration dry-run and push; use a direct Postgres URI |

### Variables

| Name | Example |
|---|---|
| `GCP_PROJECT_ID` | `roundcraft-prod` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/123/locations/global/workloadIdentityPools/github/providers/roundcraft` |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | `github-deploy@roundcraft-prod.iam.gserviceaccount.com` |
| `GAR_REPOSITORY` | `roundcraft` |
| `CLOUD_RUN_SERVICE` | `roundcraft-api` |
| `VERCEL_ORG_ID` | Vercel team or account ID |
| `VERCEL_PROJECT_ID` | Vercel project ID |

GitHub authenticates to Google Cloud through Workload Identity Federation. Do not create or store a Google service-account JSON key.

Grant the GitHub deploy service account only Artifact Registry Writer, Cloud Run Admin on `roundcraft-api`, and Service Account User on the runtime service account. Bind the GitHub repository principal to that deploy account with Workload Identity User. The separate runtime account needs Secret Manager Secret Accessor only for the `roundcraft-*` secrets referenced by the service template.

## Required check

Protect `main` with the single `CI / Required` check. The workflow detects changed paths and runs only the applicable web, API, shared-package, and database jobs. The aggregator succeeds for intentionally skipped jobs and fails if any selected job fails or is cancelled.

Automated production workflows listen to the completed `CI` workflow on `main`, not directly to `push`. They run only when CI succeeds, check out the exact successful commit, and refuse an automated release if that commit is no longer the tip of `main`. Manual dispatch remains available, but it runs the same release verification before accessing production.

Pull-request checks set `NEXT_PUBLIC_DEMO_MODE=true` and dummy Agora credentials. They test application behavior without spending Agora quota or exposing production secrets. A real Agora voice smoke test belongs in a controlled non-production environment after merge.

Avatar deployments additionally require `AGORA_AVATAR_ENABLED`,
`AGORA_AVATAR_VENDOR`, a shared or vendor-specific avatar API key, and any provider-specific
avatar IDs/base URL. Keep every avatar key in Secret Manager. If it is absent or incomplete, the API safely
returns static-portrait/audio-only participants instead of sending an invalid avatar block.

## Release flow

### Web

`.github/workflows/deploy-web.yml` runs after successful `main` CI or by manual dispatch:

1. Re-run shared and web lint, type, and test checks against the release commit.
2. Install the locked workspace, pull Vercel Production settings, and fail if a required variable is absent or demo mode is enabled.
3. Build with pinned Vercel CLI `59.10.0`.
4. Deploy the prebuilt Production output with `--skip-domain`, creating a staged production candidate without changing the live alias.
5. Smoke test the candidate URL.
6. Promote that exact staged production deployment without rebuilding it.

Vercel project settings are documented in `deploy/vercel/README.md`.

The Vercel project requires `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_AGORA_APP_ID`, `NEXT_PUBLIC_DEMO_MODE`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and server-only `AGENT_BACKEND_URL`. Set each independently for Preview and Production. The two Supabase public values are safe to expose only with RLS enabled; never use a service-role key in Vercel browser configuration.

### API and database

`.github/workflows/deploy-api.yml` runs after successful `main` CI or by manual dispatch:

1. Re-run API lint, type, and test checks against the release commit.
2. Exchange GitHub's OIDC token for a short-lived Google credential and validate the deployed `AGORA_CUSTOM_LLM_URL`.
3. Build the API image from `deploy/cloud-run/Dockerfile` and publish the immutable release-SHA tag to Artifact Registry.
4. Deploy a tagged Cloud Run revision with zero production traffic and verify `/health/live` before changing the database.
5. Preview Supabase migrations with `db push --dry-run`, then push them.
6. Check `/health/live` and `/health/ready` through the candidate URL against the migrated schema.
7. Move 100 percent of traffic to the verified candidate tag.

Migrations must be backward-compatible with the currently serving API because the previous revision continues serving traffic while schema changes are applied. Use additive columns/tables first; remove old schema only after all serving revisions no longer depend on it.

## Rollback

Run `Roll back production` manually and type `ROLLBACK`:

- For web, optionally provide a known Vercel deployment URL/ID. Leaving it blank selects Vercel's previous production deployment.
- For API, provide an existing Cloud Run revision name. The workflow moves all traffic to it.

Rollback never reverses database migrations. Apply a forward corrective migration when schema repair is required; automatic down migrations risk data loss and may be incompatible with revisions that are still available.

## Local secrets

Copy `.env.example` to a local ignored file. The repository tracks only placeholders. Vercel Production/Preview variables live in Vercel, API runtime secrets live in Google Secret Manager, and deployment credentials live in the GitHub `production` environment.

Before release, verify:

```bash
pnpm verify
docker build --file deploy/cloud-run/Dockerfile apps/api
```

Then confirm the actual Agora flow in non-production with both a two-person and five-person
panel: every agent and avatar publisher joins with a distinct UID, all video tiles appear,
only the selected interviewer is audible, 1 → 3 → 1 selection works, candidate interruption
stops the current TTS/avatar, RTM transcripts and signed webhooks map to the right participant,
group stop removes every agent, and evidence appears in the final report. Repeat with the
avatar key intentionally absent to verify static/audio fallback. This live check is also where
Agora PCU limits and the chosen avatar vendor's concurrent-session limits must be validated.
