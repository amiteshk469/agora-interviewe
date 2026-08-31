# RoundCraft: Agora Capability and Interviewer Tooling Plan

Last verified: 30 August 2026 (IST)

This document separates official Agora facilities from RoundCraft-owned product logic. It is an implementation reference, not a claim that Agora natively supplies a coordinated interview panel.

## Architectural decision

Use a cascaded Agora voice pipeline (STT -> custom OpenAI-compatible LLM endpoint -> TTS), with RTC for the live audio room and RTM/Signaling for transcripts and runtime events. The custom LLM endpoint contains the silent Panel Director, role routing, evidence graph, adaptive questioning, and tool policy. Keep the structured assessor as a separate silent application service so scoring data never leaks into speech.

Keep two to five interviewer personas logically active, but allow exactly one audible speaker at a time. Every completed candidate turn is offered to eligible panelists in parallel. They return structured bids; the Panel Director chooses the next contribution. This is non-linear arbitration, not fixed handoff.

Do not base the design on an undocumented assumption that five Agora voice agents can speak concurrently in one channel. Validate multi-agent/channel behavior early. The safe baseline is one audible Agora speaking pipeline with app-owned panel personas. Agora's custom-LLM first-packet metadata can change supported TTS voice parameters and response interruptibility for the director-selected panelist; verify the chosen TTS vendor's exact voice controls.

## Official requirement-to-capability map

| Official requirement | Agora facility we use | RoundCraft must own |
| --- | --- | --- |
| Real-time, interruptible voice | RTC voice channel; VAD/AIVAD interruption; interruptible/keyword/uninterruptible modes; explicit Interrupt API; manual start/end-of-speech controls | Per-panelist interruption policy, floor pre-emption rules, recovery after interruption |
| Multiple roles/personalities | Agent `system_messages`; runtime instruction updates; per-response TTS metadata where supported; official Agent Handoff pattern | Two-to-five panel configurations, private prompts, role-specific rubrics, non-linear bidding/director |
| Shared candidate context | Running history; live RTM transcripts; post-session history and turn events | Durable evidence graph, open threads, claims, contradictions, rubric coverage, concise context injection |
| Adaptive follow-ups | Custom LLM endpoint; hidden instruction injection with Think API; runtime instruction updates | Follow-up policy, depth/difficulty adaptation, relevance scoring, stop conditions |
| Controlled turn-taking | Agent listening/thinking/speaking events; interruption callbacks; Speak/Think/Interrupt APIs | Single-floor lock, bid ranking, fairness/cooldowns, candidate priority, no-overlap invariant |
| Scenario and role-play | Custom system instructions; RAG; image messages to a vision-capable LLM | PM case library, role-play state, case datasets, timers, interviewer-specific objectives |
| Difficulty adjustment | Runtime instruction updates or hidden Think instructions | Candidate performance model, difficulty ladder, evidence threshold, anti-whiplash rules |
| Vague/contradictory-answer detection | Transcript and message history transport | Claim extraction, contradiction detector, unresolved-thread queue, later challenge selection |
| Transcript-linked evidence | Live transcripts with user/agent identity, turn IDs and interruption state; history webhooks; turn analytics | Immutable transcript storage, evidence IDs, quote spans, source/tool-result links, report citations |
| Structured assessment | Agora transports and archives the conversation; custom LLM supports structured response configuration | Separate schema-validated evaluator, versioned JSON rubric, per-panelist scores, confidence, evidence sufficiency, consensus/disagreement |
| Clear AI disclosure | Greeting message and spoken TTS | Persistent UI disclosure, consent/recording controls, report disclosure |
| Contextual memory | `max_history`, history retrieval/webhooks; cross-session memory recipe pattern | Database-backed session and cross-session memory with retention/consent controls |
| Meaningful tool/API use | Agora-managed MCP tools, or tools inside a custom LLM endpoint; dynamic tool-set recipe | Real tool registry, authorization, citations, audit trail, product actions |
| Human escalation, where appropriate | Agora can support an escalation announcement or injected event | Not applicable to RoundCraft: this is an autonomous candidate-practice product with no human reviewer in its operating model. Uncertainty becomes another probe, an `insufficient evidence` result, or a replay drill. |
| Production observability | RTM callbacks, metrics/errors, agent lifecycle and history/turn webhooks | Monitoring UI, durable logs, alerting, retries, correlation IDs |

## Agora facilities we should deliberately showcase

1. **Live transcripts and runtime state**: show who is listening, thinking, speaking, or interrupted; persist final turns rather than scoring partial transcript fragments.
2. **Natural barge-in**: candidate interrupts a panelist; the spoken output stops and the UI marks the turn as interrupted.
3. **Explicit floor control**: the director uses agent state plus Interrupt, Think, or Speak to pre-empt, inject context, or deliver a concise announcement.
4. **Dynamic instructions**: change panel behavior or difficulty without restarting the interview.
5. **Post-session history and turn analytics**: ingest webhook events `103 agent history` and `112 turns finished`; correlate on `agent_id`, `channel`, `turn_id`, and labels.
6. **Tool calling**: run the core tool loop inside the custom LLM endpoint and show every call/result in RoundCraft's audit timeline. Agora's managed-LLM MCP path is available, but adding a second orchestration path only for a badge would add unnecessary failure modes.
7. **RAG and multimodal cases**: ground panelists in uploaded resumes, job descriptions, company briefs, and PM case material; optionally send a chart or product screenshot to a vision-capable LLM.
8. **Speaker Lock as an optional reliability mode**: lock to the candidate's voice in noisy rooms. Do not enable it when the interview intentionally includes another live human.

## Interviewer tool registry

All tools return structured JSON containing `tool_call_id`, `session_id`, `requested_by_role`, `turn_id`, `status`, `latency_ms`, and an auditable result. External factual results also include `sources`, `retrieved_at`, and `confidence`.

### Tier 1: required for the judged product

| Tool | Purpose | Roles allowed | Policy |
| --- | --- | --- | --- |
| `knowledge.search` | RAG over resume, JD, PM rubric, uploaded company/product pack, and case documents | Product Sense, Execution, Strategy, Behavioral, Director | Read-only; quote document/chunk IDs; never invent missing content |
| `web.search` | Verify current market facts, product claims, benchmarks, or definitions | Product Sense, Strategy, Analytics | Search only when freshness matters; return source URLs/dates; prefer official/primary sources |
| `calculator.evaluate` | Percentages, funnels, conversion, growth, unit economics, estimation arithmetic, unit conversion | Analytics, Execution, Strategy | Deterministic decimal math; no arbitrary code; record expression and result |
| `case_data.query` | Query the session's supplied table/CSV/JSON case dataset | Analytics, Execution | Read-only parameterized SQL or dataframe operations; dataset-scoped |
| `transcript.get_evidence` | Retrieve exact final transcript turns/spans for a claim or score | All panelists, Assessor | Final transcript only; preserve turn IDs and timestamps |
| `memory.get_open_threads` | Read unresolved claims, contradictions, covered rubrics, and candidate facts | All panelists, Director | Shared structured state, not an unbounded raw transcript dump |
| `evidence.record` | Store a claim, support, counter-evidence, uncertainty, and rubric link | All panelists, Assessor | Append-only; no silent overwrites |
| `panel.bid` | Propose `ask`, `challenge`, `clarify`, `deepen`, `redirect`, or `revisit` | Interviewer personas | Internal typed interface, not a general external tool; Panel Director decides; never directly speaks |
| `assessment.save` | Persist the versioned final scorecard and evidence map | Assessor/Director | Schema-validated; scores without evidence are rejected |
| `replay.create_drill` | Create a targeted follow-up practice drill from weak evidence | Assessor | The visible meaningful action for the demo; candidate can accept/edit |
| `assessment.mark_insufficient_evidence` | Record that the session did not support a reliable judgement for a rubric item | Assessor | Must include missing evidence and create either another live probe or a replay-drill objective; never fabricate a confident score |

### Tier 2: high-value product expansion

| Tool | Purpose | Notes |
| --- | --- | --- |
| `source.open` | Open and extract the exact primary source selected by `web.search` | Prevent scoring from snippets alone |
| `code.run_analysis` | Sandboxed Python for complex case analysis or chart generation | Optional; strict CPU/time/memory limits, no secrets, network disabled by default |
| `chart.inspect` | Analyze a candidate-uploaded chart, wireframe, or product screenshot | Uses Agora image messaging plus a vision-capable LLM |
| `fact.verify` | Compose search/calculator/source checks into a supported/unsupported/uncertain result | Store all source and calculation evidence |
| `timer.get` | Read section/session time remaining | Director and panelists use it to shorten or deepen questions |
| `privacy.redact` | Detect and redact PII from exports | Preserve a protected original only under explicit retention policy |
| `prompt.moderate` | Validate custom interviewer prompts and behavior settings | Block unsafe, discriminatory, deceptive, or assessment-manipulating prompts |
| `report.export` | Produce a shareable assessment/replay report | User-confirmed external sharing only |

## Role-specific tool sets

Use dynamic tool sets so every persona does not receive every capability.

- **Panel Director**: internal state, timer, bid review, memory and interruption/floor-control. The director does not independently score, and floor-control functions are not exposed to ordinary interviewer prompts.
- **Product Sense interviewer**: knowledge search, web/source search, transcript evidence, evidence record.
- **Execution/Analytics interviewer**: calculator, case-data query, optional code analysis, transcript evidence, evidence record.
- **Strategy/Growth interviewer**: knowledge search, web/source search, calculator, evidence record.
- **Behavioral/Recruiter interviewer**: memory, transcript evidence, evidence record. External web is disabled by default.
- **Assessor**: transcript evidence, evidence graph, calculator for deterministic rubric aggregation, assessment save, insufficient-evidence marking and replay drill. The assessor remains silent during the interview.

## Tool-use rules

1. Panelists request tools; the Panel Director/tool policy approves them according to role, interview phase, and candidate consent.
2. Never use web search to decide whether a subjective PM opinion is "correct." Use it only to verify factual claims or provide explicitly live context.
3. If a score depends on arithmetic, use the calculator and attach the expression/result to the evidence.
4. Do not send raw resumes, private candidate details, or proprietary uploaded documents to web search.
5. Show a short `Checking sources...`, `Calculating...`, or `Reviewing the case data...` state during tool latency.
6. External/mutating actions require explicit confirmation. Read-only search and calculation do not.
7. A tool failure must produce an honest fallback; it must not be converted into a confident factual answer.
8. Limit tool loops: one primary tool plan per interviewer contribution, bounded retries, hard timeout, and director cancellation.
9. Tool results, transcript evidence, scores, and replay drills are linked by stable IDs.
10. Custom prompts may shape expertise, mood, and behavior, but cannot override safety, AI disclosure, privacy, evidence, or floor-control policies.

## Prompt configuration model

RoundCraft resolves interviewer instructions in layers, from highest to lowest authority:

1. Non-editable platform policy: safety, AI disclosure, privacy, evidence integrity, assessment boundaries, and the single-speaker floor lock.
2. Session contract: profession, target role/seniority, interview duration, selected competencies, and panel composition.
3. RoundCraft role template: the professionally designed default interviewer prompt, rubric, behavior, and knowledge defaults.
4. Student customization: either no change, an edited personal copy of the default, or a newly authored prompt and structured settings.
5. Live Panel Director context: current transcript evidence, open threads, difficulty, remaining time, and the selected objective for the next turn.

The prompt library must support `use as is`, `duplicate and edit`, `create new`, `preview behavior`, `save version`, and `restore default`. Editing a default always creates a personal copy; built-in templates are immutable. Store structured settings separately from advanced free text so the UI remains approachable and the runtime can validate the final merged configuration.

## Recommended search and calculation implementation

- Implement `web.search` through a replaceable adapter. Brave Search is a good first provider because its official API returns URLs/snippets, supports freshness and country/language filtering, and offers an LLM-context path. Never expose the API key in the browser.
- Implement `calculator.evaluate` locally with a strict expression parser and decimal arithmetic. This is faster, deterministic, and more auditable than asking an LLM or a general search API to calculate.
- Add sandboxed Python only after deterministic calculation and case-data queries work. A managed isolated runtime such as E2B is an option, but is not necessary for the core judged flow.
- Implement tools behind an authenticated server-side tool gateway. Because the Panel Director lives in our custom LLM endpoint, it executes the tool loop and returns only the selected spoken response to Agora. Agora does not see these internal calls, so RoundCraft must log and display them. The tools may use MCP internally for portability, but this is not required for the judged path.

## Per-turn control flow

1. Agora receives candidate audio, transcribes it, and emits transcript/state events.
2. RoundCraft waits for the final candidate turn and stores it with its Agora turn ID.
3. The memory service extracts claims, evidence, uncertainty, contradictions, and covered rubrics.
4. Eligible interviewers independently return compact structured bids.
5. The Panel Director ranks bids using relevance, information gain, unresolved contradictions, rubric coverage, interruption urgency, cooldown, and remaining time.
6. If needed, the selected interviewer invokes one or more authorized read-only tools.
7. The director grants the floor to one panelist; Agora voices only that contribution.
8. Interruption callbacks can cancel the response, retain only spoken evidence, and reopen arbitration.
9. The assessor writes structured evidence continuously but produces the final score only after the session.

## Early technical validation gates

Before expanding UI breadth, prove these with real Agora credentials:

1. Candidate barge-in stops speech and emits an interruption event.
2. RTM final transcripts contain stable identifiers that can be persisted and linked to evidence.
3. The custom LLM endpoint can meet acceptable first-token latency while panel bidding runs in parallel.
4. Distinct interviewer voice/persona transitions can occur without overlapping audio or losing context.
5. Agora can reach the public custom LLM/MCP endpoints with authentication and rate limiting.
6. History and turn webhooks arrive after normal stop and are reconciled with live transcript storage.
7. A real search/calculation result appears in the live timeline and is linked to the later assessment.

## Current integration notes

- The official Dynamic Tool Sets example changes tools inside a custom LLM service; it does not prove that Agora dynamically re-registers MCP tools during a running session.
- Candidate barge-in is an Agora facility. One virtual interviewer interrupting another is a Panel Director behavior implemented through the floor lock and Agora's interrupt/speak controls.
- Agora short-term history is bounded and session-scoped. Persist final RTM turns continuously; use post-session history/turn webhooks for reconciliation rather than as the only evidence source.
- Custom LLM and MCP endpoints must be publicly reachable over HTTPS. Authenticate them, rate-limit them, keep token issuance protected, verify webhook signatures against the raw body, and process retries idempotently.
- The Agora Python Agents SDK release inspected during this research was v2.7.2 (26 August 2026), while the Agent Client Toolkit repository documented v2.9.1. Pin tested versions instead of copying the older Next.js starter dependency-for-dependency.

## Official references

- [EchoSphere overview and mandatory project expectations](https://www.commudle.com/communities/knotic/hackathons/echosphere)
- [Track 1: Coordinated AI Interview Panel](https://www.commudle.com/communities/knotic/hackathons/echosphere/tracks)
- [Start and stop an Agora voice agent](https://docs.agora.io/en/ai/build/start-stop-agent)
- [Display live transcripts](https://docs.agora.io/en/ai/build/transcripts)
- [Manual turn control](https://docs.agora.io/en/ai/best-practices/manual-turn-control)
- [Interruption handling recipe](https://recipes.agora.io/recipes/interruptions)
- [Interrupt API](https://docs.agora.io/en/api-reference/api-ref/conversational-ai/interrupt)
- [Speak API](https://docs.agora.io/en/api-reference/api-ref/conversational-ai/speak)
- [Think API](https://docs.agora.io/en/api-reference/api-ref/conversational-ai/think)
- [Update a running agent](https://docs.agora.io/en/api-reference/api-ref/conversational-ai/update)
- [Retrieve conversation history](https://docs.agora.io/en/ai/build/handle-runtime-events/retrieve-session-history)
- [Monitor agent runtime](https://docs.agora.io/en/ai/build/handle-runtime-events/monitor-agent-runtime)
- [Send images to an agent](https://docs.agora.io/en/ai/build/send-multimodal-messages)
- [Official Agent Handoff recipe](https://recipes.agora.io/recipes/agent-handoff)
- [Official MCP Tools recipe](https://recipes.agora.io/recipes/mcp-tools)
- [Official Tool Calling recipe](https://recipes.agora.io/recipes/tool-calling)
- [Custom LLM integration and first-packet metadata](https://docs.agora.io/en/ai/build/custom-model-integration/custom-llm)
- [Dynamic Instructions recipe](https://recipes.agora.io/recipes/dynamic-instructions)
- [Cross-session memory recipe](https://recipes.agora.io/recipes/cross-session-memory)
- [Official RAG recipe](https://recipes.agora.io/recipes/rag)
- [Official Voice AI recipe catalog](https://recipes.agora.io/)
- [Brave Search API documentation](https://api-dashboard.search.brave.com/app/documentation)
- [E2B isolated code interpreter documentation](https://e2b.dev/docs/sdk-reference/code-interpreter-js-sdk/v2.1.0/sandbox)
