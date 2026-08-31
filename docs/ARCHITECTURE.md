# RoundCraft architecture

## Decision

RoundCraft is a monorepo with two independently deployable applications:

- `apps/web`: Next.js candidate experience on Vercel.
- `apps/api`: one FastAPI modular monolith on Cloud Run `asia-south1`.

Shared browser contracts and configuration live in `packages/`. Supabase owns product identity and durable data. Agora owns the live voice path. This keeps the latency-sensitive interview loop in Agora without forcing product data, panel logic, or assessment into infrastructure that does not provide those features.

## System map

```text
Candidate browser
  ├─ HTTPS ───────────────► Next.js on Vercel
  │                           └─ authenticated API calls
  ├─ RTC audio/video ─────► one shared Agora RTC/RTM channel
  └─ RTM events ◄─────────►   ├─ 2–5 ConvoAI panel agents
                              ├─ distinct agent and avatar publisher UIDs
                              ├─ managed STT/TTS, interruption, and turn state
                              └─ panel-bound custom LLM SSE calls
                                      │
                                      ▼
FastAPI on Cloud Run
  ├─ Panel Director and persona prompts
  ├─ JD/resume ingestion and retrieval
  ├─ role-scoped tools and audit records
  ├─ evidence-linked assessment
  └─ Agora token, webhook, and lifecycle endpoints
      │
      ├─ Supabase Auth, Postgres, pgvector, Realtime, Storage
      ├─ external LLM/embedding provider only where Agora has a gap
      └─ optional web search provider
```

## Live interview flow

1. The candidate selects two to five interviewers from immutable defaults, edits a fork, or creates a custom profile.
2. The candidate may upload a JD. The API stores the private original in Supabase Storage, extracts/indexes its text, then returns editable recommendations for panel roles, prompts, rubric weights, difficulty, tools, and domain context. Without a JD, curated PM defaults are used.
3. Starting an interview snapshots the configuration, creates one unguessable channel, issues a short-lived candidate token, allocates distinct agent/avatar UIDs, and concurrently starts one Agora agent plus one optional avatar for every panelist. Any partial start is stopped before the session is marked failed.
4. The browser joins the shared channel once and renders the returned participant roster. Agora carries candidate audio and panel audio/video; each agent uses manual speech boundaries so RoundCraft owns the floor.
5. A candidate turn reaches the panel dispatch endpoint. The silent Panel Director applies repetition, coverage, tool, and floor rules and may select any panelist, including the current one. Sequences such as 1 → 3 → 1 are valid.
6. The API interrupts every non-selected agent, marks the selected participant as pending, and injects the candidate text through Agora `agent_think`. A stateless signed call is used when the original Cloud Run instance no longer holds the SDK session object.
7. Only the panel-bound custom LLM request matching the pending participant may continue. The selected panelist may run one allowlisted tool; its audit/evidence is persisted before the response is streamed to Agora-managed TTS and that panelist's avatar.
8. Agora RTM and signed webhooks update transcripts, agent state, and the durable participant mapping. Explicit barge-in interrupts the current agent, with a stateless REST fallback.
9. On stop, the API attempts to leave every agent even if one leave fails, reconciles persisted turns with Agora history, calculates evidence-backed rubric scores, and generates replay drills. Unsupported criteria become `insufficient_evidence`; there is no human-review queue.

## Ownership boundaries

| Capability | Owner |
|---|---|
| Audio transport, STT, TTS, barge-in, live turn/state events | Agora RTC, RTM, Conversational AI |
| Candidate identity and row-level authorization | Supabase Auth and RLS |
| Panel arbitration, prompts, moods, behavior, difficulty | FastAPI |
| JD/resume/company documents and vector retrieval | Supabase Storage, Postgres, pgvector |
| Calculator, web search, evidence bookmark, replay creation | FastAPI role-scoped tools |
| Durable transcript, claims, tool audit, assessment, reports | Supabase Postgres |
| Frontend and product flows | Next.js on Vercel |

## Durable data

| Data | Store | Notes |
|---|---|---|
| Users and sessions | Supabase Auth | JWT verified by API; browser never receives service-role credentials. |
| Prompt templates | Postgres | Built-ins are immutable and versioned; edits create user-owned forks. |
| Interview and panel snapshots | Postgres | Preserves the exact configuration used for a report. |
| Live panel participants | Postgres | Maps panelist IDs to distinct agent/avatar UIDs, runtime agent IDs, provider/fallback mode, and webhook state. |
| JD, resume, reports, optional media | Private Supabase Storage | Signed URLs and owner-scoped policies only. |
| Extracted document chunks | Postgres + pgvector | Uploaded text is untrusted content, never system instructions. |
| Transcript turns | Postgres | Keyed by interview and Agora `turn_id`, including interrupted status. |
| Tools and evidence | Postgres | Every scored item links to transcript and optionally tool evidence. |
| Agora webhooks | Postgres | HMAC verified and idempotent by notice ID. |

## Security boundary

- Browser-visible configuration is limited to `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_AGORA_APP_ID`, `NEXT_PUBLIC_DEMO_MODE`, `NEXT_PUBLIC_SUPABASE_URL`, and the RLS-constrained `NEXT_PUBLIC_SUPABASE_ANON_KEY`. `AGENT_BACKEND_URL` is server/build-only. App certificates, service-role keys, provider keys, webhook secrets, and database URLs remain server-side.
- The custom LLM endpoint verifies `AGORA_LLM_BEARER_SECRET`, a dedicated credential distinct from webhook HMAC and Agora project credentials. Webhooks verify the signature over the raw body and deduplicate retries.
- RLS protects candidate-owned rows and Storage objects; API access does not replace database policies.
- JD/resume contents are not sent to web search. Retrieved text is delimited as data and cannot change system instructions or tool permissions.
- Tools use strict schemas, role allowlists, timeouts, output limits, and audit rows. Calculations are deterministic and never use `eval`.
- Cloud Run is public only at the network layer because Agora needs HTTPS callbacks. Product endpoints still require JWTs or service-specific credentials.

## Scale and failure behavior

Cloud Run keeps one warm instance and scales to 20 instances with concurrency 40. One FastAPI service is intentional: the interview director, tool registry, and assessment share one transactional model and do not need separate services yet. Dispatch and interruption have stateless Agora fallbacks, so correctness does not depend on a request reaching the instance that started the agents. A panel consumes two to five Agora agent slots and up to five avatar-vendor sessions; staging must verify both concurrency quotas and multi-avatar behavior. Agora REST history is not treated as durable memory; transcript events are persisted continuously and reconciled after stop. If assessment fails, its idempotent report operation can retry without restarting the Agora panel.
