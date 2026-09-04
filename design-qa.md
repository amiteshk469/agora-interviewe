# RoundCraft Design QA

## Comparison target

- Source visual truth: `/Users/amitesh/Projects/agora/apps/web/public/design-reference/editorial-video-wall-revised.png`
- Browser-rendered implementation: `/Users/amitesh/Projects/agora/design-implementation-final-v3.jpg`
- Normalized implementation: `/Users/amitesh/Projects/agora/design-implementation-final-normalized.png`
- Full-view comparison evidence: `/Users/amitesh/Projects/agora/design-comparison-final.png`
- Focused logo comparison evidence: `/Users/amitesh/Projects/agora/design-comparison-logo.png`
- Mobile evidence: `/Users/amitesh/Projects/agora/design-implementation-mobile.jpg`
- Dark-theme evidence: `/Users/amitesh/Projects/agora/design-implementation-dark.jpg`

## Viewport and normalization

- Source pixels: 1486 × 1059.
- Browser CSS viewport: 1486 × 1059.
- Browser-reported device pixel ratio: 1.2.
- Raw browser screenshot pixels: 1486 × 1059.
- The in-app browser capture applied its 1.2 display scale inside the screenshot surface. For an equal-density comparison, the rendered 1238 × 882 content region was cropped and resized to 1486 × 1059. The source and normalized implementation were then joined without further scaling.
- Desktop state: light theme, guided demo, motion running, five interviewers, one selected speaker, transcript tab active.
- Responsive state: 390 × 844 CSS viewport, dark theme, all six video tiles present, no horizontal overflow.

## Full-view comparison evidence

The final equal-size comparison shows the same core composition as the source: narrow session rail, dominant photographic video wall, one enlarged selected speaker, three secondary panelists, a separate candidate strip, bottom question controls, and a transcript rail. Major column proportions, video hierarchy, vermilion live accent, pearl surface palette, dark overlays, radii, and elevation now align closely.

The implementation intentionally adds the Panel Director rationale and transcript/tool tabs because they expose required product behavior. The source's direct mic, camera, and barge controls are represented by the Agora connection control before joining and the full media controls after joining.

## Focused comparison evidence

The logo crop was reviewed separately because the user explicitly rejected the pointed red shape. The final implementation uses a newly generated participant-ring mark with a smooth red segment and no arrowhead. This is an intentional, user-directed improvement over the earlier implementation, and both light and dark raster assets were verified in the interface. The video subjects, state labels, and crops remain readable in the equal-size full-view artifact, so another focused crop was not needed.

## Required fidelity surfaces

- Fonts and typography: Geist is loaded locally with swap behavior. Weight, scale, line height, timestamps, and compact uppercase rail labels preserve the source hierarchy. No clipped or overlapping interface text was observed.
- Spacing and layout rhythm: the rails were narrowed, the video grid was expanded vertically, and the candidate/question regions now fill the review frame without hiding persistent controls. Twelve-pixel radii and restrained one-pixel borders are consistent.
- Colors and visual tokens: pearl white, cool charcoal, silver borders, translucent black video labels, and vermilion live states match the selected direction. Manual light and dark themes both render with appropriate native color scheme.
- Image quality and asset fidelity: five 1448 × 1086 panel portraits, one 1672 × 941 candidate portrait, generated brand marks, and the acoustic background asset render sharply. Agora remote video replaces the portrait per avatar UID when available.
- Copy and content: every visible state is direct and product-specific. One audible speaker, interruption behavior, transcript evidence, panel selection, tool activity, and privacy are explicit.
- Icons and controls: Lucide icons are used consistently with text or accessible labels. Destructive session ending has a confirmation dialog.
- Accessibility and motion: focus rings, skip link, semantic buttons/tabs, alt text, reduced-motion CSS, and a visible Pause motion control are present. Mobile transcript access uses an explicit drawer control.

## Comparison history

### Pass 1

- Earlier P2: the 12.5rem left rail and 20.5rem transcript rail made the video wall materially narrower than the source.
- Earlier P2: capped 200px video rows left a large unused lower region and weakened the photographic hierarchy.
- Fixes: changed wide-screen columns to 10.5rem / fluid / 16.75rem, introduced proportional video rows, enlarged the candidate strip, and used inset rounded rails.
- Post-fix evidence: `design-implementation-light-pass3.png` and `design-comparison-pass1.png`.

### Pass 2

- Earlier P2: the expanded video wall pushed the question card 21px below the viewport.
- Fix: reduced the wide-screen panel wall from 58vh to 56vh while preserving the source-like row ratio.
- Post-fix evidence: browser measurement showed the question card bottom at 1059.04px in a 1059px viewport; final browser capture keeps its controls visible.

### Pass 3

- Earlier P2: the generated red logo segment read as an arrow and the first dark variant lacked sufficient contrast.
- Fixes: regenerated the mark with a smooth concave red participant, created separate transparent light and dark assets, and rendered the correct asset by theme.
- Post-fix evidence: `design-comparison-logo.png` and `design-logo-dark-final.jpg`.

## Primary interactions tested

- Light and dark theme selection and persistence.
- Pause and resume panel motion; all portrait animations report paused and running states correctly.
- Independent inactive states change asynchronously across Listening, Thinking, Nodded, and Floor requested.
- Selected speaker changes non-linearly in demo mode.
- Transcript and Tool activity tabs.
- End interview dialog open and cancel.
- Mobile transcript drawer open and close.
- 390px mobile layout with all panelists and candidate visible and no horizontal overflow.
- Console checked after final desktop, dark, and mobile states: no errors or warnings.

## Findings

- No actionable P0, P1, or P2 differences remain.
- P3 follow-up polish: once live vendor avatars are available, tune provider-specific crop and idle-motion parameters against actual streams rather than portrait fallbacks.
- Live-only validation remains for Agora RTC/RTM media, concurrent avatar vendor rendering, platform quota, and webhook delivery; these are integration test gaps, not browser-visible design defects.

## Final result

final result: passed

---

# Dual-audience landing QA

## Comparison target

- Source visual truth path: `/Users/amitesh/Projects/agora/docs/qa/landing-reference.png`
- Implementation screenshot path: `/Users/amitesh/Projects/agora/docs/qa/landing-implementation-qa.jpg`
- Full-view comparison evidence: `/Users/amitesh/Projects/agora/docs/qa/landing-comparison-qa.jpg`
- Route and state: `/`, light theme, signed-out, dual candidate/recruiter landing state

## Viewport and normalization

- Source pixels: 1536 × 1024.
- Implementation CSS viewport: 907 × 705.
- Browser capture pixels: 907 × 705; the in-app-browser export was already normalized to the CSS viewport, so it was treated as a 1:1 capture.
- The source and implementation intentionally differ in viewport because the selected reference is a fixed 1536 × 1024 concept while the available in-app browser is 907 × 705. The comparison montage preserves each image's aspect ratio and fits both into equal 1100 × 735 evidence cells. Findings therefore concern hierarchy, composition, typography, assets, and visible responsiveness rather than pixel offsets.

## Full-view comparison evidence

The combined evidence preserves the selected concept's decisive qualities: a near-white editorial field, compact navigation, oversized black grotesk headline, a single vermilion acoustic path crossing the hero, restrained supporting copy, and low-chrome calls to action. The implementation adapts the concept to the expanded product by making the two valid journeys explicit—candidate practice and recruiter-led interviews—without introducing faces, generic SaaS card stacks, or competing decorative elements.

The source's central speech card was intentionally omitted. It described only the practice-panel journey and would obscure the dual-audience message at the narrower viewport; the live adaptive-panel behavior is explained immediately below and demonstrated in the later product sections.

## Focused region comparison evidence

A separate crop was not needed: the headline, generated acoustic asset, labels, navigation, supporting copy, and both primary actions are readable at full resolution in the combined input. The reference and implementation logo marks were also clearly visible at that scale.

## Required fidelity surfaces

- Fonts and typography: the implementation retains the reference's oversized, tightly tracked black display type and quieter UI/body hierarchy. At 907px the headline wraps into two balanced lines without clipping; small navigation and signal labels remain legible.
- Spacing and layout rhythm: the hero maintains generous negative space, a narrow header, a single visual axis, and clear separation between the acoustic path, explanatory copy, and actions. Both audience actions remain above the fold at the verified viewport.
- Colors and visual tokens: warm near-white, deep charcoal, muted grey, and vermilion map directly to the selected direction. Borders and secondary surfaces stay deliberately quiet.
- Image quality and asset fidelity: the acoustic path is a real transparent raster asset generated for its measured 1800 × 500 production slot. Its fine strands remain sharp and no transparency halo or stretched crop is visible. No human or AI-generated face assets are used.
- Copy and content: headline and evidence language remain product-specific. Candidate and recruiter actions, navigation, and supporting text accurately describe the two separate workflows.
- Icons and controls: the existing RoundCraft raster mark and Lucide controls retain one consistent stroke language. Both audience CTAs, navigation anchors, sign-in, and theme control have clear accessible labels/focus behavior.
- Accessibility and responsiveness: semantic links/buttons and visible focus treatment are preserved; reduced-motion styling remains available. The verified 907 × 705 layout has no horizontal overflow, overlap, clipped controls, or hidden primary action.

## Comparison history

### Pass 1

- Earlier P2: at the 907 × 705 browser viewport, the acoustic asset's fixed tablet height pushed the second CTA below the fold and its lower strands collided with the supporting paragraph.
- Fixes: reduced tablet hero vertical padding and visual minimum height, constrained the acoustic image to a centered measured wrapper, and moved every node label inside that wrapper so it scales with the artwork.
- Post-fix visual evidence: `docs/qa/landing-implementation-qa.jpg` and `docs/qa/landing-comparison-qa.jpg` show the full headline, path, paragraph, and both audience actions without collision or clipping.

## Primary interactions tested

- Candidate and recruiter navigation anchors.
- Candidate sign-up route with candidate account type selected.
- Recruiter sign-up route with recruiter account type selected.
- Light/dark theme toggle.
- Browser console checked after the final landing render: no errors or warnings.

## Findings

- No actionable P0, P1, or P2 visual differences remain.
- P3 follow-up: capture a second reference-matched 1536 × 1024 browser pass when that viewport becomes available; the current unequal-view comparison is sufficient for hierarchy and responsive correctness but not pixel-level measurement.

## Final result

final result: passed
---

# Interviewer shared-room regression QA

- Source/problem state: `/var/folders/p5/nvyp_bj90zj55gn4shw_w0gr0000gn/T/codex-clipboard-b5e0bc24-458a-4bd5-b6d0-2e5fa8de32fa.png`
- Browser-rendered meeting grid: `/private/tmp/roundcraft-host-room.png`
- Browser-rendered drawer state: `/private/tmp/roundcraft-host-drawer.png`
- Viewport: 1280 × 720 CSS px, dark theme
- Pixels: source 3008 × 1532 (Retina capture); implementation 1280 × 720 at 1×
- State: five-person interviewer-led room; interviewer tools closed and open

The supplied screenshot is the problem state rather than a literal clone target. The requested transformation was to make participants the primary Meet-style grid and move the existing interviewer controls into an optional drawer while preserving RoundCraft's design system.

## Findings

No actionable P0, P1, or P2 visual differences remain for the requested transformation.

- Fonts and typography: existing product font, weights, hierarchy, truncation, and compact room labels remain consistent.
- Spacing and layout rhythm: the participant grid owns the primary stage; the question and call controls remain persistent; the drawer reduces the stage without hiding controls.
- Colors and visual tokens: established dark-theme background, tile, border, primary, muted, and destructive tokens are preserved.
- Image and asset fidelity: existing RoundCraft identity and participant-avatar treatment are reused. Agora camera tracks replace avatars in-place when available.
- Copy and content: room labels, focus disclosure, question, transcript, messaging, and coding controls are concise and role-appropriate.

## Primary interactions tested

- Entered the guest-interviewer lobby and joined the room.
- Opened and closed the interviewer drawer.
- Switched among Lead, Transcript, and Code tabs.
- Verified transcript turns and the candidate code buffer render in their respective tabs.
- Verified the accessibility tree exposes the drawer as a controlled region and its sections as tabs.

The local visual fixture intentionally used invalid Agora credentials, so its live-media warning belongs to the fixture. The production RTC lifecycle is covered by automated tests; a real two-browser webcam check remains a post-merge smoke test.

Focused region comparison was not needed because the principal change is the full-view information hierarchy; drawer text and controls were separately checked through the browser accessibility tree.

## Comparison history

- Earlier P1: transcript and controls dominated the interviewer screen, while participants were reduced to a narrow identity strip.
- Fix: promoted every AI and human participant to an equal meeting tile and placed lead, transcript, and code tools in a collapsible side drawer.
- Post-fix evidence: the meeting-grid and drawer captures listed above show the revised hierarchy.

## Follow-up polish

- P3: run a real joined-camera smoke test after deployment to evaluate actual webcam crop and network-state transitions.

final result: passed
