---
version: beta
name: RoundCraft Editorial Video Wall
description: A light-first, dual-theme interface for a realistic adaptive AI interview panel.
omitted:
  - section: spacing
    reason: The product uses Tailwind's framework scale without a separate repository-owned spacing token contract.
colors:
  light:
    background: "#f5f6f7"
    foreground: "#252728"
    card: "#fbfbfa"
    primary: "#c33a2d"
    primary-foreground: "#fffaf8"
    secondary: "#eceeef"
    muted-foreground: "#62676b"
    border: "#d7dadd"
  dark:
    background: "#121414"
    foreground: "#f0f1ef"
    card: "#1a1d1d"
    primary: "#ff7568"
    primary-foreground: "#260c09"
    secondary: "#242828"
    muted-foreground: "#a8afad"
    border: "#343a39"
typography:
  sans:
    fontFamily: Geist, Geist Fallback, ui-sans-serif, system-ui, sans-serif
  mono:
    fontFamily: Geist Mono, Geist Mono Fallback, ui-monospace, monospace
rounded:
  base: 0.75rem
components:
  button-default:
    backgroundColor: "{colors.light.primary}"
    textColor: "{colors.light.primary-foreground}"
    rounded: "{rounded.base}"
    height: 2.25rem
  video-tile:
    backgroundColor: "{colors.light.card}"
    rounded: "{rounded.base}"
    borderColor: "{colors.light.border}"
  card:
    backgroundColor: "{colors.light.card}"
    rounded: "{rounded.base}"
---

## Overview

RoundCraft is a photographic, light-first interview workspace. The visual center is a real panel, not a single assistant: two to five interviewer tiles remain visible with the candidate, while one selected interviewer receives the strongest border, scale, status, and audio focus. A manual light and dark control is always available and persists locally.

## Brand

The RoundCraft mark is a ring of conversational participants with one highlighted speaker. Pearl, silver, and cool charcoal form the neutral system. Vermilion is the only brand accent and identifies live speech, primary actions, focus, and important status. Use the generated raster marks in `apps/web/public/brand`; do not reconstruct the mark in CSS or inline SVG.

## Typography

Geist Sans carries interface copy, headings, transcript text, and controls. Geist Mono is reserved for elapsed time, turn IDs, scores, and other compact evidence. Headings are compact and semibold. Supporting copy uses comfortable line height and limited width.

## Layout

The live room uses three functional columns on wide screens:

1. A narrow session rail for brand, theme, panel count, timing, director rationale, and privacy state.
2. A fluid video wall with the selected speaker enlarged, every other interviewer visible, the candidate preview, and the current question.
3. A transcript and tool-evidence rail.

On smaller screens the left rail becomes a compact header and the evidence rail becomes an explicit drawer. The video wall preserves all participants and scrolls vertically instead of shrinking faces into unusable thumbnails.

## Video and avatar presence

Each panelist has an independent avatar identity, provider, image fallback, Agora agent UID, and optional avatar video UID. When a matching remote Agora video track exists, the tile renders that track. Otherwise it renders the approved photographic fallback.

The selected interviewer is the only audible panel voice. Inactive panelists remain alive through asynchronous, low-amplitude breathing, gaze, nod, thinking, and request-to-speak states. Their cycles use different durations and negative delays so the panel never moves in unison. Avoid decorative looping or large camera movement. Respect reduced-motion preferences.

## Components and states

Primary buttons identify the single forward action. Secondary and ghost variants handle alternatives. Cards rely on one-pixel borders and restrained shadows. Inputs use the background surface inside cards so editable regions are obvious.

Panel state is never color-only. Every tile pairs its state with direct text and an icon: Speaking, Listening, Thinking, Nodded, or Floor requested. The transcript keeps speaker names, timestamps, and turn IDs visible so assessment evidence can link back to exact moments.

## Do's and don'ts

- Do show all configured panelists and the candidate simultaneously during the interview.
- Do keep one selected speaker while allowing non-linear sequences such as 1, 3, 1, 5.
- Do use real remote video tracks when configured and photographic fallbacks otherwise.
- Do expose light and dark mode without changing information hierarchy.
- Do show Agora connection state, interruption guidance, and transcript evidence explicitly.
- Do preserve visible focus rings, keyboard access, and reduced-motion behavior.
- Don't animate every panelist with the same timing or gesture.
- Don't imply that inactive panelists are audible.
- Don't use placeholder portraits, emoji avatars, CSS illustrations, or hand-drawn interface icons.
- Don't use em dashes in visible interface copy.
