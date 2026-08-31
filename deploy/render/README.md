# Render API service

The root `render.yaml` is the production contract for the existing `roundcraft-api` Render backend at `https://roundcraft-api.onrender.com`. It builds `apps/api` with `deploy/render/Dockerfile`, waits for GitHub checks, and routes a new deploy only after `/health/ready` succeeds.

Before connecting the Blueprint, generate a Blueprint from the existing service or change only `services[0].name` to its exact Render service name. A different name creates a second service. Do not attach a second Blueprint if another one already manages the service. The file deliberately omits region, plan, and instance count so syncing does not replace the existing service's commercial or regional choices.

Set every `sync: false` value in the Render dashboard. In particular:

- `DATABASE_URL` is the direct Supabase Postgres URL with the `postgresql+asyncpg://` SQLAlchemy scheme used by the API.
- `FIRECRAWL_API_KEY` enables the bounded, read-only current-information search tool used by eligible interviewer roles.
- Agora, Supabase secret, and LLM credentials stay only in Render.

`API_BASE_URL`, `WEB_BASE_URL`, `AGORA_CUSTOM_LLM_URL`, and `CORS_ORIGINS` are fixed in the Blueprint to `https://roundcraft-api.onrender.com` and `https://agora-interviewe-web.vercel.app`; change them together if either canonical domain changes. CORS must remain an explicit JSON array containing `WEB_BASE_URL`; wildcards, localhost, and example hosts are rejected. The generated `AGORA_LLM_BEARER_SECRET` is created once and retained. Production refuses to start with placeholder or incomplete Agora, Supabase, Groq, URL, database, or CORS settings. Existing optional avatar variables omitted from the Blueprint remain dashboard-managed. If current-information search should be disabled, set `WEB_SEARCH_ENABLED=false`; never remove the key while an active deploy still expects the tool.

Render deploys the linked `main` commit only after CI checks pass, so GitHub needs no Render API key or deploy-hook secret. The required API CI job validates the file against Render's official schema without authenticating to a Render workspace. Keep Supabase migrations backward-compatible and apply them with the Supabase CLI before merging an API change that requires the new schema:

```bash
supabase db push --dry-run --db-url "$SUPABASE_DB_URL"
supabase db push --db-url "$SUPABASE_DB_URL"
```

Use an always-on Render plan for live interviews; sleeping instances add unacceptable startup delay to Agora callbacks. `/health/ready` verifies database access and the complete active prompt catalog installed by migration `202609010001`; it does not apply that migration. It also reports Render's injected `RENDER_GIT_COMMIT`, which the Vercel release gate matches to the frontend release before promotion. After deployment, verify `/health/live`, `/health/ready`, and one authenticated staging interview.
