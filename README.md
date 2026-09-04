# RoundCraft

RoundCraft is a full mock-interview product covering 18 hiring tracks, from software engineering and data science to design, aerospace, operations, finance, and core engineering. It runs one Agora Conversational AI session in a shared RTC/RTM channel and presents two to five configurable, logical interviewer roles. A silent Panel Director chooses the role, prompt, voice, and tools for every candidate turn, so panelists can speak in any contextual order without duplicate audible agents or a handoff chain.

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

## Interview tracks

An interview is defined by its panel, rubric, and tools, so a hiring track is a
**role pack** that supplies all three. Eighteen ship with the product, curated
from the [Placement JD 2025-2026 catalogue](https://ajithsaip.github.io/Placement_JD_2025_2026/)
so the tracks match what graduates are actually hired for:

| Track | Panel | Editor |
| --- | --- | --- |
| Product Management | Hiring Manager, Product Sense, Analytics | — |
| Software Engineering | Engineering Manager, Staff Engineer, Systems Architect | Python, Java, C++, JS/TS, Go, Rust, C#, SQL |
| Data Science & Analytics | DS Lead, Product Analyst, Business Stakeholder | SQL, Python, R |
| Machine Learning & AI | ML Manager, Research Scientist, Applied Scientist | Python, SQL, C++ |
| Quantitative Finance | Desk Head, Quant Researcher, Quant Developer | Python, C++, SQL |
| Consulting & Business Analysis | Partner, Engagement Manager, Client Executive | — |
| Hardware & VLSI | Design Manager, RTL Lead, Verification Lead | Verilog, SystemVerilog, VHDL, C++, Python |
| Embedded Systems | Firmware Manager, Embedded Engineer, Hardware Lead | C, C++, Python, Rust, Verilog |
| Cloud & DevOps | Platform Manager, SRE, Infrastructure Engineer | Bash, Python, YAML, Go, SQL |
| Core & Mechanical Engineering | Plant Manager, Design Engineer, Graduate Lead | — |
| UI/UX & Product Design | Design Manager, Product Designer, UX Researcher | — |
| Data Engineering | Data Platform Manager, Data Engineer, Analytics Engineer | Python, SQL, Scala, Java |
| Cybersecurity | Security Manager, Application Security Engineer, SOC Lead | Python, Bash, SQL, JavaScript |
| Electrical & Electronics | Electrical Systems Lead, Electronics Design Engineer, Validation Engineer | — |
| Aerospace & Robotics | Robotics Systems Lead, GNC Engineer, Robotics Software Engineer | C++, C, Python, MATLAB |
| Operations & Management | Operations Leader, Process Excellence Manager, Business Leader | — |
| Finance & Risk | Finance Manager, Financial Analyst, Risk Manager | — |
| Civil, Chemical & Materials | Engineering Manager, Design or Process Engineer, Safety Lead | — |

A pack is a starting point, never a lock: the panel, rubric, prompts, and tools
it seats all stay editable in setup, and an uploaded JD refines the selected
track without silently replacing it.

### The shared editor

On a coding track the room gains a Code control. Opening it drops the panel to a
strip and hands the stage to an editor whose contents are pushed to the session
as the candidate types, then given to the speaking panelist as delimited
untrusted context. The room opens it automatically only after an interviewer
states an explicit coding task, keeps that task pinned, and surfaces progressive
`Hint:` responses separately. The panel can therefore challenge the code while
it is being written rather than after it is described.

The editor is built into the product rather than installed: syntax highlighting
is a tested tokenizer rendering React elements, so nothing the candidate types
can escape into the page. **Code is read, not run** — there is no sandbox and no
execution.

### Inviting a human interviewer

A live session can mint a signed invite link. The guest opens `/join/<token>`,
joins the same Agora channel, and gets the live transcript, a read-only view of
the editor, and an optional microphone control. They may speak directly, send a
private note the candidate reads, or queue a question for the AI panel to ask
next in its own voice. A queued human question outranks the director's objective
for exactly one turn. The guest connection renews its short-lived Agora token,
sends bounded presence heartbeats, and leaves the candidate roster after a
disconnect.

The invite is a bearer credential, so it names one session, expires in six hours,
and is signed with a key derived under its own domain label — a leaked link
cannot be replayed against anything else.

## Known limitations

These are current, deliberate, and stated so the product is not read as claiming more than it does.

- **Live avatars are not the baseline.** Avatar vendors are optional and off unless configured. Every logical panelist falls back to an animated identity tile, then to audio only.
- **Document retrieval is lexical, not semantic.** JD and transcript search ranks by term overlap. The schema is pgvector-ready, but embedding-based ranking is not implemented.
- **One physical Agora agent, not several.** Two to five panelists are logical identities inside a single session. Older documents describing one agent per interviewer are out of date.
- **Direct guest microphone audio is not assessment evidence.** The candidate hears it live, but the Agora agent remains subscribed to the candidate so another speaker cannot drive its turn detector. For a transcript-linked, scored human question, the guest uses **Ask the panel**, which places the question in the next AI turn.
- **Contradiction detection is deterministic and numeric.** It compares before/after metrics the candidate restates. It does not catch qualitative contradictions such as reversing a claim of ownership, and it never infers a contradiction from a low score.
- **There is no human-review queue.** This is autonomous practice. Unsupported criteria become `insufficient_evidence` and are converted into replay drills instead of being escalated.
- **Assessment depends on an external model.** If the provider is unavailable the report generation endpoint returns 503 with `Retry-After` rather than producing an unsupported score.
- **Semantic end-of-speech is not yet validated against live production audio.** `AGORA_END_OF_SPEECH_MODE=vad` restores fixed-silence turn taking without a redeploy.
- **The calculator returns full decimal precision.** Values are rounded for display only; the audited tool result keeps the exact figure.
- **The shared editor does not execute code.** The panel reads the buffer and
  challenges it; there is no runner, no test harness, and no sandbox.
- **Syntax highlighting is heuristic.** A compact tokenizer covers comments,
  strings, numbers, and keywords. It is not a parser and does not resolve types
  or scope.
- **One invited human interviewer per session, and the invite is the credential.** Anyone
  holding the link can join until it expires; there is no per-guest identity.
- **The guest follows by transcript polling, not a live socket.** Their view can
  trail the room by a couple of seconds.
- **Free-tier API hosting can cold start.** The first request after an idle period is slow, which matters for a live demo.

RoundCraft is practice-only software. It is not a hiring decision, and it must never be used to assist a candidate during a real interview.

## Architecture and deployment

- [System architecture](docs/ARCHITECTURE.md)
- [CI/CD and operations](docs/DEPLOYMENT.md)
- [Render service setup](deploy/render/README.md)
- [Vercel project setup](deploy/vercel/README.md)

## Product rules

- An interview belongs to one of 18 hiring tracks. Product Management is the default; every track is defined by its panel, rubric, prompts, tools, and optional coding profile rather than by a hardcoded profession.
- Candidates may optionally upload a JD. JD-based recommendations are always editable and never silently applied.
- Built-in interviewer prompts are immutable. Editing one creates a new custom version.
- A panel has two to five logical interviewer identities backed by one Agora voice agent, with exactly one audible speaker at a time.
- Optional avatar mode decorates the shared active speaker through an external provider supported by Agora AgentKit. Every logical panelist still has an animated identity-tile fallback, then audio-only fallback.
- There is no automated human-review or escalation workflow. Missing support is represented as `insufficient_evidence` and converted into replay drills. A human interviewer may join a live session by invite, but they participate in the interview rather than reviewing its output.
- Every scored assessment item links to transcript or tool evidence.
