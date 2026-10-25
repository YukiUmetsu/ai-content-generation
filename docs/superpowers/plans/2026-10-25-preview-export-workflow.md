# Preview & Export Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a guided four-stage Preview & Export UI with authorized voice audition and an unmodified safe MP4 render boundary.

**Architecture:** Keep the `ProductionPanel` mounted and its existing Check/Start contract, add an asynchronous audio-sample endpoint owned by the local production bridge, and give the panel explicit stage state. Use backend-focused Node tests and React interaction tests.

**Tech Stack:** React, TypeScript, Tailwind, Vite local Node middleware, native `node:test`, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-25-preview-export-workflow-design.md`

## Global Constraints

- Samples are ephemeral, short and explicitly requested; never silently synthesize nor persist keys.
- Only a checked **test-only** MP4 can render; do not weaken existing rights gates.
- Keep existing built-in demo, real scene/motion preview and single-flight production behavior.
- No GitHub Actions due exhausted credits.

## Review Focus

- Changing provider during an in-flight voice sample must not show stale sample as the new voice — UI revision identity test in Task 2.
- Unauthorized Fish or local voice must not invoke synthesis — API test in Task 1.
- Concurrent Check/Start while sample generation is active must reject — API test in Task 1.
- Back navigation while MP4 is rendering must preserve progress — UI test in Task 2.
- Stale readiness from an edit must disable render — existing regression and additional UI test in Task 2.

---

### Task 1: Explicit first-scene narration audition

**Files:** Modify `apps/web/scripts/director-production-vite.mjs`, `apps/web/scripts/director-production-vite.test.mjs`.

**Interfaces:** `POST /api/contentgen-video/narration-sample`, `GET /api/contentgen-video/narration-sample/status`, `GET /api/contentgen-video/narration-sample/:id.wav`, `POST /api/contentgen-video/narration-sample/cancel`.

- [ ] Write Node API tests for authorization, bounded first-beat text, 202/status/WAV playback, cancellation, stale IDs and mutual exclusion with render.
- [ ] Run Node tests and confirm RED due missing routes.
- [ ] Implement deferred sample synthesis with existing `synthesizeNarration` and dedicated owned sample cache, strict validated voice, short excerpt, cancellation, stable states and private single-use playback URL.
- [ ] Run tests and confirm GREEN, including existing production tests.

### Task 2: Progressive, accessible production UI

**Files:** Modify `apps/web/src/app/video-production-panel.tsx`, `apps/web/src/app/video-production-panel.test.tsx`.

**Interfaces:** Consume Task 1's four endpoints; maintain existing `check`, `start`, `status`, `cancel`, `plan`, `preview`, `live-preview` API usage.

- [ ] Write Vitest tests for four-stage navigation, voice sample consent/audition, stale revision, readiness/recheck, playback and rendering state.
- [ ] Run Vitest to confirm RED if frontend dependencies exist; if sparse checkout lacks dependencies, explicitly document the inability to run UI tests.
- [ ] Implement compact stage navigation, context-specific next actions, short narration audio sample with polling, readiness summary and final player. Keep `ProductionPanel` state mounted.
- [ ] Run available static/Node tests and run frontend typecheck/Vitest if possible; report exact coverage gap.

### Task 3: Usability documentation and integration verification

**Files:** Modify `docs/22-video-director-workflow.md`, add this spec/plan.

- [ ] Explain each step, voice-sample rights/use, readiness invalidation and recoverable failures.
- [ ] Run full available local Node regression suite, inspect the complete diff for broken safety boundaries and accessibility regressions.
- [ ] Open one PR from fresh `main` without triggering GitHub Actions.
