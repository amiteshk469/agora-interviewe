# Panel conversation refresh

## What runs where

The frontend joins one Agora room. The main Agora AgentKit session listens to the candidate UID, handles ASR, turn detection and TTS, and calls the backend's custom-LLM endpoint. A capability coordinator selects an interviewer. That interviewer runs with its own prompt, role expertise, labelled shared transcript, CV/JD context and a server-enforced tool list. Interviewer-to-interviewer consultation is a separate, private model call; only the actor holding the floor produces the main AI voice.

This is a bounded actor runtime on the existing Agora AgentKit/custom-LLM integration, not five independent audible Agora bots and not a new LangGraph dependency. Each request reconstructs its actor from the saved session configuration. State, peer notes, coding tasks and audit records are persisted in the existing database/JSON state.

Tools are selected through provider-native function calling, not keyword matching. Calls are validated and audited by the backend. Coding-capable role packs can publish a task and hints without a human host; polling delivers the task to both candidate flows. Publishing never clears the candidate's existing buffer. Peer consultation is non-recursive and limited to one peer per turn. Model turns have bounded tool rounds and timeouts; the older streaming path remains as recovery.

## Human interviewer input

Agora's current [start-agent reference](https://docs.agora.io/en/api-reference/api-ref/conversational-ai/join) supports one remote RTC UID per conversational session. A second, silent Agora session subscribes to the invited human interviewer's UID. Its server callback is bound to a private listener key. It records human speech as interviewer turns, then notifies the primary panel with an opaque event reference. The primary callback resolves that reference server-side and can respond to the human or yield when the human is asking the candidate a question.

- Human speech does not enter the candidate claims/evidence pipeline.
- The browser filters the silent listener out of the candidate ASR toolkit because that toolkit assumes incoming ASR belongs to the local user.
- Listener provisioning and dispatch use leases; callbacks are deduplicated, keys are not returned to the browser, and leaving invalidates the key before the listener is stopped.
- **Cost:** an invited human listener adds one Agora conversational session while active, plus model calls for coordination/consultation. This is not a free multi-user ASR feature.
- Currently one invited human interviewer seat is supported. Multiple simultaneous human interviewer seats require a separate extension.

## Conversation controls

- Balanced: semantic pause tolerance 400ms / maximum wait 2s; optional sparse neutral acknowledgments after sustained speech; silence prompt after 25s of agent silence.
- Let me finish: semantic pause tolerance 900ms / maximum wait 6s; no mid-answer acknowledgment; silence prompt after 50s.
- Acknowledgments are fixed neutral text, limited to once per minute on the server. The client suppresses them while the human interviewer or AI is speaking. Agora [speak](https://docs.agora.io/en/api-reference/api-ref/conversational-ai/speak) uses IGNORE priority, so a busy agent can discard one rather than replace its answer. This is not a guarantee of arbitrary simultaneous semantic challenges or a complete full-duplex conversation model.
- Greeting is scheduled on candidate joining, with 1200ms delay. Silence recovery uses TTS directly, not a fake candidate message.
- Soft rain is a local, optional, looped recording with volume control and speech ducking. It is not mixed into the published microphone track. Source and CC0 license: `apps/web/public/audio/LICENSE.md`. Headphones are recommended to avoid physical speaker-to-microphone leakage.

## Deployment

No CI/CD workflow changes, new vendor keys or database migration are required for this branch.

Backend (Render): `AGORA_LIVE_LLM_MODE=roundcraft_custom`, existing `AGORA_CUSTOM_LLM_URL` pointing to this backend's `/llm/chat/completions`, existing `AGORA_LLM_BEARER_SECRET`, Agora App ID/certificate, and the existing `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`. The selected OpenAI-compatible model must support native function calling. `PANEL_REASONING_ENABLED=true` is the default; `false` is the recovery switch for the older deterministic routing/streaming path. It disables native actor tools, not human input capture.

Agora-managed OpenAI preview bypasses the custom-LLM runtime and cannot provide these application-side coordinator/tools/listener guarantees. This branch does not silently change production environment variables. Deploy the backend and frontend together, then start a new interview; old session snapshots do not gain all new controls.

Frontend (Vercel): no additional secret. Continue using the existing backend URL and public Supabase configuration. Never put vendor secret keys in NEXT_PUBLIC variables.

## Release verification

Automated coverage includes role-bound human input, duplicate callbacks, listener cleanup, private keys, silent yielding, model-selected tools, forbidden tool rejection, coding delivery and preserved code, pause modes, acknowledgment cooldown/auth, and RTC transcript filtering. Production audio quality and end-to-end Agora human listening still require a two-device live test; mocks do not certify those paths.

Verification on this branch: `pnpm verify` passed (206 backend tests, 113 frontend tests, 7 shared tests, lint, type checks and production build). A synthetic function-calling request to the locally configured Qwen model returned the expected tool call in 0.58 seconds. That single request is a compatibility check, not an end-to-end latency benchmark. Local Agora callback configuration is incomplete, so no live Agora interview was launched from this checkout.

Before release: start a fresh candidate interview; confirm the greeting, both conversation modes, candidate interruptions, optional rain, and one full assessment. Join as a human on a second device; ask the candidate a question and ensure the AI yields, then address an AI panelist and ensure it responds. Ask the AI to open a coding task in an AI-only software interview. Confirm code survives task/hint updates, camera on/off, leaving and report creation.

## Landing artwork

Design-taste guidance shaped a restrained, faceless landing page with separate candidate and recruiter entry points. Existing routes, logo and theme tokens are preserved. Artwork is original AI-generated abstract sculpture, not a product screenshot or a depiction of real panelists.

Output: `apps/web/public/brand/conversation-sculpture.png`.

Dark-mode output: `apps/web/public/brand/conversation-sculpture-dark.png`. Both assets use the built-in image-generation tool. The follow-up appearance pass preserves the accepted structure and copy. The artwork has no card border, background or shadow; intersecting edge masks blend both image variants into the hero. Restrained coral lighting continues through the audience sections, curved linework through the interview and closing sections, and a fading grid behind the evidence section. These are static, marketing-scoped CSS treatments with no new client JavaScript. Desktop light/dark and 390px mobile were visually checked, with no horizontal overflow or captured console errors.

Dark edit prompt: “Use case: lighting-weather. Edit target: the provided RoundCraft abstract conversation sculpture. Create its matching dark-mode website asset. Preserve EXACTLY the composition, five abstract acoustic forms, their positions, shapes, sizes, the open coral circular ring, thin coral connecting ribbon and camera angle. Change ONLY lighting and backdrop. Replace the white floor/background with very deep charcoal #141616, seamless to all four image edges. Premium mysterious studio illumination: warm soft coral light close to the ring, restrained metallic highlights on acoustic forms, quiet realistic shadows, very faint atmospheric haze around the sculptural objects. Keep every object clearly readable against dark background. Softly lit, not neon, no bright glow, no stars, no new shapes, no new objects. No text, people, faces, heads, silhouettes, symbols or watermark. Same square crop and generous empty margins as original.”

Generation prompt: “Use case: stylized-concept. Asset: minimalist RoundCraft interview platform website hero artwork, not a UI screenshot. Create one exquisite, quiet, architectural 3D illustration of an abstract conversation: five small matte charcoal rounded acoustic forms arranged loosely around an open coral-red circular conversation table, viewed obliquely from above, with fine tactile brushed-metal edges and very soft natural shadows. These are strictly abstract objects, not heads, not people, not faces, no human silhouettes or avatars. One uninterrupted thin coral ribbon curves from one acoustic form to another across the open table, suggesting shared dialogue. Compact sculptural composition centered, all objects fully inside frame, generous uncluttered negative space. Off-white neutral background #f5f6f7, coral red #c63e30 and charcoal only. Sophisticated industrial design editorial studio photography, restrained and minimalist, beautiful subtle realism, no gradients or neon, no text, no symbols, no badges, no watermark. Square high quality composition suitable for 550px wide hero visual.”
