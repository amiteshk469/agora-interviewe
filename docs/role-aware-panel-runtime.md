# Role-aware panel runtime

Research and implementation review: 2026-09-05. This document distinguishes
implemented changes from work that still requires implementation or live validation.

## Research decisions

- [Agora's Join reference](https://docs-md.agora.io/en/conversational-ai/rest-api/agent/join.md)
  currently limits `remote_rtc_uids` to one UID. A single conversational agent
  must not be assumed to transcribe every human in an RTC channel.
- [LangGraph workflows and agents](https://docs.langchain.com/oss/python/langgraph/workflows-agents)
  supports explicit state, conditional edges and tool cycles. We use its graph
  runtime for the interviewer actor, retaining SQL as the durable conversation store.
- [Amazon's interview loop](https://www.amazon.jobs/content/en/how-we-hire/interview-loop)
  assigns different areas to interviewers. Its
  [SDE preparation](https://www.amazon.jobs/content/en/how-we-hire/sde-ii-interview-prep)
  distinguishes technical and behavioral assessment.
- [Microsoft's technical interview guidance](https://careers.microsoft.com/v2/global/en/hiring-tips/technical-interviewing.html)
  values clarification, planning and problem-solving. A clarification request is
  not an answer that should trigger a demand for measurable impact.

These are employer examples, not a universal Indian hiring process. Configure
the JD, seniority, competencies and interview stages for each employer. Use
behavioral examples where relevant, coding/design exercises for technical roles,
and domain scenarios for other roles. Do not force STAR, tradeoffs or numerical
results onto greetings, readiness checks or every technical answer.

## Current execution

1. Candidate microphone travels over Agora RTC to the main conversational agent.
2. The human interviewer has a separate silent Agora listener bound to their RTC
   UID. Its authenticated callback saves an interviewer turn, not candidate evidence.
3. An opaque server-resolved event forwards that turn to the main agent. Spoken
   claims such as “I am the interviewer” cannot change a participant's role.
4. The coordinator reads the labelled shared transcript, the actual last generated
   question, capabilities, question counts and peer notes. It selects an expert
   or yields when the human interviewer is asking the candidate a question.
5. The selected expert runs a LangGraph: `interviewer -> authorized_tools ->
   interviewer`, or finishes directly. Maximum three model calls and two tool
   rounds. Server-side allowlists remain authoritative.
6. Available tools include document search, enabled web search, calculator,
   coding task/hint publishing and private peer consultation. Coding tools preserve
   the candidate's existing code. Only the selected expert produces speech.
7. Agora performs TTS and playback. The candidate UI requests word-mode captions
   with RTC audio timestamps. Generated text and actually heard audio are distinct;
   the latter still needs live verification.
8. SQL stores transcript, tool audit and shared memory. Assessments cite candidate
   evidence; human questions are never candidate evidence. No new model key or
   database migration is introduced by this branch.

The coordinator remains application orchestration around the LangGraph actor,
not a claim that every part of the application is a LangGraph supervisor. AI
panelists are distinct configured actors sharing one audible Agora output, not
five independently speaking RTC agents.

## Corrections on this branch

- Coordinator receives recent labelled conversation, not only the latest sentence.
- The stored last question is generated interviewer text, not a private routing objective.
- Readiness/audio checks, clarification and requests to change question have explicit
  prompt rules and context-aware fallback routing.
- An actor failure no longer launches another full model pipeline. It reports a
  failure instead of inventing a generic evidence probe. This removes one source
  of compounded latency; it is not a measured end-to-end latency guarantee.
- Unsupported text injection fails visibly. Failed human dispatch preserves speech,
  exposes an error and permits a deduplicated retry.
- Candidate transcript panel includes a separately labelled human-interviewer
  section, fetched incrementally from the authenticated transcript endpoint.
- Failed host audio subscriptions surface in the room UI instead of console only.
- Recruiter report UI omits practice gaps, evidence drills and student re-run actions.

## Membership rules and unfinished work

The current schema has one candidate seat and one human interviewer seat. A second
person using the same link can reuse that UID. It is NOT a multi-interviewer invitation
system. The intended next design is one candidate plus individually identified human
interviewers and the AI panel. That needs per-invitation participant credentials,
distinct RTC UIDs, presence and role-scoped controls, listener lifecycle for each
human, an updated roster, and disconnect/duplicate-join tests. Do not invite several
people using the existing shared interviewer credential.

Still not verified/fixed by this branch:

- End-to-end recruiter audio reception in the deployed Render/Agora environment.
- Word-synchronized captions in the host console (it still polls persisted turns).
- Multiple human interviewers and recruiter-to-co-interviewer invitations.
- Production latency percentiles, packet-loss recovery and browser autoplay behavior.
- A two-browser microphone/camera test covering recruiter-created and candidate-created rooms.

## Deployment and acceptance

Both API and web need this branch; API installs the updated locked LangGraph dependencies.
CI/CD configuration and secrets are unchanged. `roundcraft_custom` and a publicly
reachable authenticated custom-LLM callback are necessary for this orchestration;
Agora-managed preview bypasses it and does not support the human listener here.

Before release, test readiness, audio checks, a substantive answer, clarification,
one hint, question change, recruiter-to-agent speech, recruiter-to-candidate speech,
coding task publication, transcript attribution, reconnect and report generation.
Use two actual browser participants; mocks cannot certify audio delivery.
