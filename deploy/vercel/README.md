# Vercel project

Create one Vercel project with these settings:

| Setting | Value |
|---|---|
| Root Directory | `apps/web` |
| Framework | Next.js |
| Node.js | 22 |
| Install Command | `pnpm install --frozen-lockfile` |
| Build Command | `pnpm build` |

Configure the required rows separately for Preview and Production:

| Variable | Value | Scope and exposure |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | Public Cloud Run API origin, with no trailing `/v1` | Required; browser-visible |
| `NEXT_PUBLIC_AGORA_APP_ID` | Agora App ID for that environment | Required; browser-visible, not a secret |
| `NEXT_PUBLIC_DEMO_MODE` | `false` outside local/demo builds | Required; browser-visible |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL for that environment | Required; browser-visible, not a secret |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/publishable key protected by RLS | Required; browser-visible, never a service-role key |
| `AGENT_BACKEND_URL` | Public Cloud Run API origin used by Next.js rewrites | Required; server/build only |
| `NEXT_PUBLIC_DEV_AUTH_USER_ID` | Same UUID as API `DEV_AUTH_USER_ID` | Optional local/demo only; browser-visible, omit from Production |

Never put Agora certificates, Supabase service-role credentials, provider keys, or other secrets in a `NEXT_PUBLIC_*` variable.

After changing a build-time variable, create and promote a new deployment. Existing Next.js bundles keep the values present at build time.

Use the GitHub workflow as the production release authority. If the Vercel project is also connected directly to Git, disable automatic Production-branch deployments so a push cannot bypass candidate verification and promotion.

The GitHub deployment starts only after the `CI` workflow succeeds on `main` (or by manual dispatch), re-verifies the exact release commit and all required Production variables, uses the pinned Vercel CLI to create a prebuilt candidate deployment, smoke tests it, and promotes the exact candidate. Add `VERCEL_TOKEN` as a GitHub Environment secret, and add `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` as GitHub Environment variables.
