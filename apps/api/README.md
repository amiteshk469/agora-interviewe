# RoundCraft API

The API is an async FastAPI modular monolith. Supabase owns Auth, Postgres, and private
object storage. Agora owns the live RTC/RTM voice path and the agent lifecycle.

## Live panel topology

A product session allocates one candidate UID plus two to five distinct Agora agent UIDs
in a single RTC/RTM channel. Every agent also receives a distinct avatar publisher UID.
The API starts the group concurrently and rolls back every successful join if any member
fails, so a partially initialized panel is never marked live. Agent names include a random
suffix and retry once on a 409 collision.

`GET /v1/sessions/{session_id}/participants` returns the durable roster. The start and
owner-bound token-renewal responses also return `connection.panelists` with
`panelist_id`, `agent_uid`, `avatar_uid`, and `video_mode`. The silent director selects a
speaker through `POST /v1/sessions/{session_id}/panel/dispatch`; all other agents are
interrupted before the selected agent receives an Agora `agent_think` instruction. The
stateless `agent_think` path works across Cloud Run instances when the in-process session
handle is unavailable. Candidate barge-in uses `POST /v1/sessions/{session_id}/interrupt`.

Manual start/end-of-speech detection is configured for every panel agent so floor control
remains explicit. The custom LLM call is bound to both the product session and panelist;
an agent that does not hold the pending floor receives 409 and cannot speak.

Avatar support defaults to LiveAvatar and also permits Generic, Akool, and Anam adapters.
Configure a vendor-specific key (`AGORA_LIVEAVATAR_API_KEY`,
`AGORA_GENERIC_AVATAR_API_KEY`, `AGORA_AKOOL_API_KEY`, or `AGORA_ANAM_API_KEY`) or the
shared `AGORA_AVATAR_API_KEY` fallback, plus optional `AGORA_AVATAR_IDS` (a JSON map by
panelist ID or UI avatar alias) and vendor-specific base URL/IDs. If the selected provider is incomplete, the backend does
not send a partial avatar configuration to Agora: it returns `static` when a portrait URL
exists and `audio` otherwise. One panel consumes two to five Agora agent concurrency units
and, in avatar mode, the same number of vendor avatar sessions; validate both quotas in
staging before enabling five-person panels.

## Local setup

From the repository root:

```bash
supabase start
supabase db reset
cd apps/api
uv sync --all-extras
uv run uvicorn app.main:app --reload
```

`supabase db reset` applies every file in `supabase/migrations` and then
`supabase/seed.sql`. Production uses `supabase db push` before the API revision is
promoted. For the zero-config SQLite development default only, startup creates local
tables automatically. Production and Supabase environments never call `create_all()`.

The schema includes pgvector-ready JD chunks. Current `knowledge_search` is deliberately
lexical and returns bounded excerpts; embedding generation and semantic ranking remain an
adapter-ready follow-up, not a claimed runtime feature.

`AGORA_AREA=INDIA` maps to Agora's AP gateway. That selects the Open API gateway region;
it is not a data-residency or geofence guarantee. Use Agora's documented geofence controls
when residency is a requirement.

Tests replace Agora, Supabase Storage, avatar vendors, and the upstream LLM at their owned
network boundaries. They cover 2/5-person UID allocation, one-avatar-per-agent SDK wiring,
group rollback/cleanup, unique-name retry, owner-scoped roster and token renewal, manual
dispatch, stateless dispatch/interruption, floor authorization, and webhook correlation.
They do not claim a real RTC/avatar media round trip, cloud object upload, or model response.
Firecrawl Search is also adapter-tested rather than called with a live key. PDF and DOCX
extraction are implemented, while the fast test suite uploads TXT. Run the Supabase CLI
migration checks and an Agora staging-channel panel test before production promotion.

The exact quickstart routes (`/get_config`, `/startAgent`, `/stopAgent`) are available only
in development and test. Deployed product clients start a user-owned session and renew
its fixed channel/UID token with `POST /v1/sessions/{session_id}/token`; arbitrary channel
token minting is not exposed in production.

Candidate turns persisted from RTM/custom-LLM callbacks are reconciled with Agora event
103 history and automatically linked to conservative rubric evidence signals. A report can
only be generated after the session ends, and uncovered criteria remain explicitly marked
as insufficient evidence.
