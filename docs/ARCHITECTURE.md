# RoundCraft architecture

## Decision

RoundCraft is a monorepo with two independently deployable applications:

- `apps/web`: Next.js candidate experience on Vercel.
- `apps/api`: one FastAPI modular monolith on Render.

Shared browser contracts and configuration live in `packages/`. Supabase owns product identity and durable data. Agora owns the live voice path. This keeps the latency-sensitive interview loop in Agora without forcing product data, panel logic, or assessment into infrastructure that does not provide those features.

## System map

```text
Candidate browser
  ├─ HTTPS ───────────────► Next.js on Vercel
  │                           └─ authenticated API calls
  ├─ RTC audio/video ─────► one shared Agora RTC/RTM channel
  └─ RTM events ◄─────────►   ├─ one ConvoAI voice agent
                              ├─ 2-5 logical panel identities
                              ├─ managed STT/TTS, VAD, barge-in, and turn state
                              └─ director-aware custom LLM SSE calls
                                      │
                                      ▼
FastAPI on Render
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
3. Starting an interview snapshots the configuration, creates one unguessable channel, issues a short-lived candidate token, allocates the shared publisher plus logical tile identities, and starts exactly one Agora AgentKit session. A failed start is stopped before the product session is marked failed.
4. The browser joins the channel once and renders the logical participant roster. Agora carries candidate audio and the active interviewer output; automatic VAD and barge-in keep the agent listening without client-side speech-boundary choreography.
5. Each candidate turn reaches the custom LLM gateway once. The silent Panel Director applies expertise, evidence-gap, repetition, coverage, and pending-speaker rules, then may select any panelist, including the current one. Sequences such as 1 → 3 → 1 are valid.
6. The selected role's immutable invariants, editable prompt, knowledge, behavior, difficulty, and allowlisted tools are assembled into that turn's system instruction. First-packet metadata selects the role's MiniMax voice while Agora keeps one physical speaking session.
7. Eligible roles may use JD/transcript knowledge search, deterministic calculation, or configured current-information search. Tool inputs and outputs are audited before their bounded context is added to the response.
8. Agora RTM and signed webhooks update transcripts, interruption state, and the durable logical-participant mapping. An optional forced-dispatch endpoint uses `agent_think` for controlled drills without changing the normal automatic-VAD path.
9. On stop, the API leaves the shared agent once, reconciles persisted turns with Agora history, calculates transcript-linked rubric scores, and generates replay drills. Unsupported criteria become `insufficient_evidence`; there is no human-review queue.

## Ownership boundaries

| Capability | Owner |
|---|---|
| Audio transport, STT, TTS, barge-in, live turn/state events | Agora RTC, RTM, Conversational AI |
| Candidate identity and row-level authorization | Supabase Auth and RLS |
| Panel arbitration, prompts, moods, behavior, difficulty | FastAPI |
| JD/resume/company documents and vector retrieval | Supabase Storage, Postgres, pgvector |
| JD/transcript search, calculator, current-information search | FastAPI role-scoped live tools |
| Evidence linking and replay creation | FastAPI assessment pipeline |
| Durable transcript, claims, tool audit, assessment, reports | Supabase Postgres |
| Frontend and product flows | Next.js on Vercel |

## Durable data

| Data | Store | Notes |
|---|---|---|
| Users and sessions | Supabase Auth | JWT verified by API; browser never receives service-role credentials. |
| Prompt templates | Postgres | Built-ins are immutable and versioned; edits create user-owned forks. |
| Interview and panel snapshots | Postgres | Preserves the exact configuration used for a report. |
| Live panel participants | Postgres | Maps logical panelist IDs to the shared runtime agent, reserved media identities, provider/fallback mode, and webhook state. |
| JD, resume, reports, optional media | Private Supabase Storage | Signed URLs and owner-scoped policies only. |
| Extracted document chunks | Postgres + pgvector | Uploaded text is untrusted content, never system instructions. |
| Transcript turns | Postgres | Keyed by interview and Agora `turn_id`, including interrupted status. |
| Tools and evidence | Postgres | Every scored item links to transcript and optionally tool evidence. |
| Agora webhooks | Postgres | HMAC verified and idempotent by notice ID. |

## Security boundary

- Browser-visible configuration is limited to `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_AGORA_APP_ID`, `NEXT_PUBLIC_DEMO_MODE`, `NEXT_PUBLIC_SUPABASE_URL`, and the RLS-constrained `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The legacy anon variable remains accepted during migration. `AGENT_BACKEND_URL` is server/build-only. App certificates, Supabase secret keys, provider keys, webhook secrets, and database URLs remain server-side.
- The custom LLM endpoint verifies `AGORA_LLM_BEARER_SECRET`, a dedicated credential distinct from webhook HMAC and Agora project credentials. Webhooks verify the signature over the raw body and deduplicate retries.
- RLS protects candidate-owned rows and Storage objects; API access does not replace database policies.
- JD/resume contents are not sent to web search. Retrieved text is delimited as data and cannot change system instructions or tool permissions.
- Tools use strict schemas, role allowlists, timeouts, output limits, and audit rows. Calculations are deterministic and never use `eval`.
- Render is public only at the network layer because Agora needs HTTPS callbacks. Product endpoints still require JWTs or service-specific credentials.

## Scale and failure behavior

Render deploys only after CI passes and routes a new instance after `/health/ready` succeeds. Production uses an always-on plan; region, plan, and instance count remain controlled by the existing Render service. One FastAPI service is intentional: the interview director, tool registry, and assessment share one transactional model and do not need separate services yet. Forced dispatch and interruption have stateless Agora fallbacks, so correctness does not depend on a request reaching the instance that started the agent. Each live interview consumes one Agora Agent session and, only when configured, one external avatar-vendor session for the active speaker; all logical panelists have animated identity-tile fallbacks. Agora REST history is not treated as durable memory; transcript events are persisted continuously and reconciled after stop. If assessment fails, its idempotent report operation can retry without restarting the Agora session.
