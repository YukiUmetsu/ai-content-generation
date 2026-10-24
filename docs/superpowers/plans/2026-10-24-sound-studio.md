# Sound Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sound workflow a usable premium Sound Studio with local audition before export.

**Architecture:** Preserve the existing SFX service and verified export path. Introduce a pure audition planner, a self-contained Web Audio listening card, and a reorganized SFX editor within Video Director.

**Tech Stack:** React/TypeScript, Tailwind, Web Audio API, Node ESM and node:test.

**Spec:** `docs/superpowers/specs/2026-10-24-sound-studio-design.md`

## Global Constraints

- Audition fetches only same-origin approved preview paths; optional local narration never leaves the browser.
- No external searches except explicit Discover; no new TTS or FFmpeg workload for sketch playback.
- Visual-reveal effects with unmeasured timing are omitted from the audition and explained, never guessed.
- Changes in editor remain subject to the existing Check/Start integrity and sample-domain renderer.
- Do not run GitHub Actions (credit limit); extend existing open SFX PR when possible.

## Review Focus

- Shot switch during audio loading must not play a stale shot.
- Rejected/unapproved or changed bank hashes cannot appear in a preview plan.
- Empty/muted shots provide clear silence and no misleading Play claim.
- Effects with unsupported visual reveal do not play at the wrong time.
- User-provided narration remains browser-local and cannot be silently used in export.

### Task 1: Testable, bounded audition plan

**Files:** Create `apps/web/scripts/video-production/sound-audition-plan.mjs` and `sound-audition-plan.test.mjs`.

**Interface:** `planSoundAudition({shotId,choice,layers,ambience,library,windowMs?}) → {cues,durationMs,warnings}`.

- [x] Add Node tests for verified library only, primary and layers with independent settings, ambience, omitted reveal cues, muted/empty states, window bounds (RED).
- [x] Implement pure bounded sketch planner (GREEN).

### Task 2: Browser-local audible sketch

**Files:** Create `apps/web/src/app/sound-audition-controls.tsx` and `sound-audition-controls.test.tsx`.

**Interface:** Props `{shotId,choice,layers,ambience,library}`; schedule approved cues in Web Audio on click only.

- [x] Add browser-player Node tests for explicit playback, local-only decoding, cancellation and gain/fade scheduling (RED, then GREEN). Add UI component tests; awaiting a full frontend toolchain to execute.
- [x] Implement decoding, gain/fade scheduling, optional local narration file, cancellation and cleanup; show timed lanes, playback progress and truthful limits (GREEN in Node).

### Task 3: Professional Sound Studio workflow

**Files:** Modify `apps/web/src/app/sfx-discovery-panel.tsx`, `apps/web/src/app/video-director-workspace.tsx`, their relevant tests, and `docs/13-audio-production.md`.

- [x] Add UI tests for shot selection, Arrange/Library transitions and retained layer/ambience editing; pending execution with frontend dependencies.
- [x] Implement shot rail, Arrange/Library views, reusable asset cards, review flow and persistent listening/mix card.
- [x] Review keyboard/accessibility semantics and run all locally available Node tests (114 passing).
- [ ] Run frontend Vitest, typecheck and visual browser review once the full checkout/dependencies are available; avoid claiming these passed in this sparse staging workspace.
- Publication target: existing Sound Design PR #94, with GitHub Actions intentionally skipped.
