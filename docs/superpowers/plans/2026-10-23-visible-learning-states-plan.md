# Visible Learning States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make research-linked before/change/after concepts visibly transform in actual ContentGen/Kumiki playback instead of staying unrendered metadata.

**Architecture:** Add optional validated visual-state labels to teaching sequences and require them from newly generated local-model plans; bridge the structured fields into generic render-job direction; render a shared-subject transformation as an absolute-frame React/SVG scene. Legacy fixtures remain compatible.

**Tech Stack:** Node.js ESM, Vitest/React TSX, existing Kumiki components and SVG renderer, no new packages.

**Spec:** `docs/superpowers/specs/2026-10-23-visible-learning-states-design.md`

## Global Constraints

- Preserve exact research dossier/source/claim IDs, current approval and rights gates.
- No extra LLM, network, asset, TTS or rendering work triggered by draft generation.
- Existing jobs without visual states must render the same way as before.
- New pixels must be deterministic from frame and source plan only; never reveal payoff at its event frame.

## Review Focus

1. Old v1 teaching plans without state fields are still accepted and rendered via prior layout — compatibility test in Task 1.
2. Literal placeholders and duplicate labels are rejected before rendering — validation tests in Task 1.
3. Mismatched/unsafe direction fields cannot enter the render plan — job contract tests in Task 2.
4. Analogy and dedicated home-cost recipes are not silently replaced — bridge tests in Task 2.
5. The payoff's first frame and problem phase never leak the result; all visible labels fit the right-side safe region — renderer tests in Task 3.

---

### Task 1: Grounded learning-state contract

**Files:** `apps/web/scripts/video-production/visual-pedagogy.mjs`, `preproduction-generator.mjs`, `visual-pedagogy.test.mjs`, `preproduction.test.mjs`

**Interfaces:** Optional `seq.visualStates:{before:string,action:string,after:string}` on teaching sequences; generated plans must supply it. `validateTeachingSequences(plan,dossier)` remains public.

- [ ] Write tests for distinct bounded labels, banned placeholders, legacy omission, and local-model omission rejection; observe failure.
- [ ] Validate visual states in the teaching validator; update planner prompt and require the field in new model output.
- [ ] Run focused `node --test` cases and verify pass.

### Task 2: Research-linked scene handoff

**Files:** `apps/web/scripts/video-production/job.mjs`, `preproduction-render-bridge.mjs`, `preproduction-render-bridge.test.mjs`, `job.test.mjs`

**Interfaces:** Optional `beat.visual.direction.transformation:{subjectId,before,action,after}` on generic-job visuals; only for a matching technical subject and non-analogy/non-special-recipe shot.

- [ ] Write tests proving source states are carried to matching shots, legacy and analogy are untouched, and malformed transformations are rejected; observe failure.
- [ ] Implement minimal bridge and bounded job validation.
- [ ] Run focused Node tests; verify pass.

### Task 3: Purposeful actual renderer

**Files:** `apps/web/src/video-export/teaching-state-scene.tsx` (new), `general-scene.tsx`, `teaching-state-scene.test.tsx` (new)

**Interfaces:** `TeachingStateScene({state,motion})` renders within the right-hand safe region when `state.visual.direction.transformation` is present. `GeneralExportScene` chooses it only for technical teaching phases.

- [ ] Write component tests for before/change/after semantics, frame determinism, locked conclusion, and no off-screen bounds; observe failure.
- [ ] Implement readable SVG hierarchy with subject identity, transition progress and stage-specific revelation; route through shared browser/MP4 scene.
- [ ] Run Vitest, typecheck, lint, build in CI; verify actual scene integration and no render regression.

### Task 4: Handoff and verification

**Files:** `docs/how-to-research-to-storyboard.md`, this spec/plan.

- [ ] Document what becomes visible, what remains draft and what the reviewer checks.
- [ ] Run all available local focused tests; push one GitHub PR and inspect the full Web quality workflow.
- [ ] Record manual normal-speed and real browser-to-FFmpeg verification as explicit follow-up, without claiming it ran.
