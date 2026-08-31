# Vercel project

Create one Vercel project with these settings:

| Setting | Value |
|---|---|
| Root Directory | `apps/web` |
| Framework | Next.js |
| Node.js | 22 |
| Install Command | `pnpm install --frozen-lockfile` |
| Build Command | `pnpm build` |
| Production Branch | `main` |

Configure the required rows separately for Preview and Production:

| Variable | Value | Scope and exposure |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `https://roundcraft-api.onrender.com` | Required; browser-visible |
| `NEXT_PUBLIC_AGORA_APP_ID` | Agora App ID for that environment | Required; browser-visible, not a secret |
| `NEXT_PUBLIC_DEMO_MODE` | `false` outside local/demo builds | Required; browser-visible |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL for that environment | Required; browser-visible, not a secret |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key protected by RLS | Required; browser-visible, never a secret key. The legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is also accepted |
| `AGENT_BACKEND_URL` | `https://roundcraft-api.onrender.com` | Required; server/build only; used by Next.js rewrites |
| `NEXT_PUBLIC_DEV_AUTH_USER_ID` | Same UUID as API `DEV_AUTH_USER_ID` | Optional local/demo only; browser-visible, omit from Production |

Never put Agora certificates, Supabase secret/service-role credentials, provider keys, or other secrets in a `NEXT_PUBLIC_*` variable. Production values must use public HTTPS origins, a valid Agora App ID, `NEXT_PUBLIC_DEMO_MODE=false`, matching API origins, and a browser-safe Supabase publishable or anon key.

Connect the Git repository to the Vercel project and leave automatic deployments enabled. Vercel creates Preview deployments for non-production branches and deploys commits that reach `main` to Production. GitHub's `CI / Required` check remains the merge gate; GitHub Actions does not need a Vercel token, organization ID, or project ID.

After changing a build-time variable, redeploy the latest `main` commit from the Vercel dashboard because existing Next.js bundles keep the values present at build time. Use the project's Production Deployments page for status and Instant Rollback.
