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

## Technology stack

| Layer | Choice |
|---|---|
| Real-time voice | Agora RTC, RTM, and Conversational AI - one agent session per interview |
| Speech to text | Deepgram `nova-3`, Agora-managed |
| Text to speech | MiniMax `speech_2_6_turbo`, per-turn voice selected by the director |
| Turn taking | Agora VAD barge-in with semantic end-of-speech and pause detection |
| Language model | OpenAI-compatible endpoint behind the RoundCraft custom LLM gateway |
| Web search | Firecrawl, role-allowlisted and never sent candidate documents |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind, deployed on Vercel |
| Backend | FastAPI, Pydantic, SQLAlchemy, Python 3.12+, deployed on Render |
| Data and auth | Supabase - Auth, Postgres with RLS, private Storage |
| Tooling | pnpm workspaces, uv, Ruff, mypy, pytest, Vitest, ESLint, GitHub Actions |

## Known limitations

These are current, deliberate, and stated so the product is not read as claiming more than it does.

- **Live avatars are not the baseline.** Avatar vendors are optional and off unless configured. Every logical panelist falls back to an animated identity tile, then to audio only.
- **Document retrieval is lexical, not semantic.** JD and transcript search ranks by term overlap. The schema is pgvector-ready, but embedding-based ranking is not implemented.
- **One physical Agora agent, not several.** Two to five panelists are logical identities inside a single session. Older documents describing one agent per interviewer are out of date.
- **Contradiction detection is deterministic and numeric.** It compares before/after metrics the candidate restates. It does not catch qualitative contradictions such as reversing a claim of ownership, and it never infers a contradiction from a low score.
- **There is no human-review queue.** This is autonomous practice. Unsupported criteria become `insufficient_evidence` and are converted into replay drills instead of being escalated.
- **Assessment depends on an external model.** If the provider is unavailable the report generation endpoint returns 503 with `Retry-After` rather than producing an unsupported score.
- **Semantic end-of-speech is not yet validated against live production audio.** `AGORA_END_OF_SPEECH_MODE=vad` restores fixed-silence turn taking without a redeploy.
- **The calculator returns full decimal precision.** Values are rounded for display only; the audited tool result keeps the exact figure.
- **Free-tier API hosting can cold start.** The first request after an idle period is slow, which matters for a live demo.

RoundCraft is practice-only software. It is not a hiring decision, and it must never be used to assist a candidate during a real interview.

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
