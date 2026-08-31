# RoundCraft

RoundCraft is a full mock-interview product for Product Management candidates. It runs one Agora Conversational AI session in a shared RTC/RTM channel and presents two to five configurable, logical interviewer roles. A silent Panel Director chooses the role, prompt, voice, and tools for every candidate turn, so panelists can speak in any contextual order without duplicate audible agents or a handoff chain.

## Repository layout

```text
apps/web            Next.js candidate product and Agora RTC/RTM client
apps/api            FastAPI application, Panel Director, tools, and assessment
packages/contracts  Shared API and live-session contracts
packages/config     Browser-safe configuration helpers
supabase            Postgres migrations, RLS, storage policies, and seed data
config              Human-readable service map with environment references
.github/workflows   CI checks for web, API, shared packages, and migrations
```

The frontend deploys to Vercel. The backend deploys independently to Render. Supabase provides Auth, Postgres, pgvector, Realtime, and private Storage.

## Local configuration

1. Copy `.env.example` to `.env` and fill server-only values.
2. Copy browser-safe values into `apps/web/.env.local`.
3. Never place `AGORA_APP_CERTIFICATE`, service-role credentials, or provider keys in a `NEXT_PUBLIC_*` variable.

For Vercel, configure all six runtime/build values documented in [deploy/vercel/README.md](deploy/vercel/README.md), including the two public Supabase values and server-only `AGENT_BACKEND_URL`.

The optional `config/services.example.yaml` is a readable map of base URLs and the names of the environment variables that hold credentials.

## Development

```bash
pnpm install --frozen-lockfile
uv sync --locked --all-extras --project apps/api
pnpm dev
```

Frontend: `http://localhost:3000`  
Backend: `http://localhost:8000`  
OpenAPI: `http://localhost:8000/docs`

## Architecture and deployment

- [System architecture](docs/ARCHITECTURE.md)
- [CI/CD and operations](docs/DEPLOYMENT.md)
- [Render service setup](deploy/render/README.md)
- [Vercel project setup](deploy/vercel/README.md)

## Product rules

- Product profession is Product Management.
- Candidates may optionally upload a JD. JD-based recommendations are always editable and never silently applied.
- Built-in interviewer prompts are immutable. Editing one creates a new custom version.
- A panel has two to five logical interviewer identities backed by one Agora voice agent, with exactly one audible speaker at a time.
- Optional avatar mode decorates the shared active speaker through an external provider supported by Agora AgentKit. Every logical panelist still has an animated identity-tile fallback, then audio-only fallback.
- There is no human-review or escalation workflow. Missing support is represented as `insufficient_evidence` and converted into replay drills.
- Every scored assessment item links to transcript or tool evidence.
