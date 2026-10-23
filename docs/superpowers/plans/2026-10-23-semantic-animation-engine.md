# Semantic Animation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic before/action/after text-card baseline in new research-backed technical explainers with a deterministic, evidence-linked 2D semantic animation engine covering six reusable operations.

**Architecture:** Add one versioned, model-safe `visualMechanic` contract to the research teaching sequence and the video job. Compile named actors and operations to stable poses and Kumiki-compatible transitions; Video Director and MP4 share the same scene. Research's editorial storyboard persists and edits the plan, showing an honest planning still.

**Tech Stack:** Node.js ESM + `node:test`; TypeScript, React, Vite/Vitest; pinned Kumiki-UI VT1/MG1 motion components; SVG; existing research dossier and `video-production-job/v1` validators.

**Spec:** `docs/superpowers/specs/2026-10-23-semantic-animation-engine-design.md`

## Global Constraints

- Use exactly six operations: `split`, `assemble`, `transfer`, `accumulate`, `compare`, `reveal`.
- Only typed `visualMechanic.version === 1` and known object/claim/asset IDs; reject unknown fields, code, URI, SVG, model-supplied coordinates, ambiguous or meaningless operations.
- First release is **2D SVG only**, qualitative, with no unsourced numeric amounts, scaled quantities, remote asset downloads or 3D promises.
- Original `visualStates`, dedicated `home-cost-story-v1` recipe, charts, analogies, and legacy saved jobs remain compatible.
- Newly generated technical teaching sequences require a valid visual mechanic; unsupported ones display a blocking preflight error, never silently fall back to flying text cards.
- One frame clock and shared actual preview/MP4 renderer; no payoff before permitted frames.
- Landscape 1920×1080 only; keep visual content inside safe stage ~x1040–1820, y230–920 and preserve heading/narration area.
- No new external credentials, approval state, content publishing, TTS provider calls, or changes to Jobs & QA's separate 502 work.

## Review Focus

1. **Old saved drafts** without `visualMechanic`: parser and preview still load existing `TeachingStateScene` fallback; Task 2 tests it.
2. **Model emits unsafe or nonsensical actor fields**: unknown keys, long labels, asset URIs, duplicate IDs, claims or amounts result in diagnostics; Task 1 tests it.
3. **Operation lacks meaningful actor relationship**: zero/many source actors, unknown outcome or invalid role mapping blocked before generating an MP4; Task 1 tests it.
4. **Viewer scrubs across scene boundaries**: actor IDs, initial/final topology and payoff locking consistent regardless of seek order; Task 3 tests it.
5. **Research storyboard import and temporary edits**: valid mechanics survive save/load and actor editing, invalid JSON reports a precise error, and unrelated HVAC artwork never appears; Task 4 tests it.

---

### Task 1: Canonical semantic mechanic contract, generation, and research validation

**Files:**
- Create: `apps/web/scripts/video-production/semantic-mechanic.mjs`
- Create: `apps/web/scripts/video-production/semantic-mechanic.d.mts`
- Create: `apps/web/scripts/video-production/semantic-mechanic.test.mjs`
- Modify: `apps/web/scripts/video-production/{visual-pedagogy,preproduction,preproduction-generator}.mjs`
- Test: `apps/web/scripts/video-production/{visual-pedagogy,preproduction-visual-states}.test.mjs`

**Interfaces:**
- Produces `validateVisualMechanic(mechanic, {technicalSubjectId, knownClaimIds, knownAssetKeys}): {ok,findings}`, `VISUAL_OPERATORS`, and documented `VisualMechanicV1` type.
- `preproduction-generator` prompts for the exact `visualMechanic` fields using only claim-linked, non-numeric actors. `preproduction` validates it. New generation rejects absent mechanic on required teaching sequences; old saved plan import remains accepted.

- [ ] **Step 1:** Write failing `semantic-mechanic.test.mjs` tests for all six operators, stable subjects, 2–6 operands, and rejection of unsafe URLs, numbers, duplicate IDs, wrong claim IDs and operator/role mismatches. Add a generated-plan test requiring `visualMechanic`.
- [ ] **Step 2:** Run `node --test apps/web/scripts/video-production/semantic-mechanic.test.mjs apps/web/scripts/video-production/preproduction-visual-states.test.mjs` and confirm the new behavior fails for the missing contract.
- [ ] **Step 3:** Implement bounded validation, type declaration, and prompt/parser integration without changing legacy parse behavior.
- [ ] **Step 4:** Re-run focused tests, then `pnpm --dir apps/web test:video:headless`; record failures or green result.
- [ ] **Step 5:** Commit the contract and tests to the isolated feature branch.

### Task 2: Validated research-to-job projection

**Files:**
- Modify: `apps/web/scripts/video-production/{preproduction-render-bridge,job}.mjs`
- Modify: `apps/web/scripts/video-production/general-visual-plan.d.mts`
- Test: `apps/web/scripts/video-production/{preproduction-render-bridge,job}.test.mjs`

**Interfaces:**
- Consumes Task 1's `validateVisualMechanic`; produces `beat.visual.direction.visualMechanic: VisualMechanicV1` only when shot subject and teaching phase match.
- Older jobs retain existing `transformation`; special House Math and chart paths are untouched.

- [ ] **Step 1:** Add failing bridge/job tests: three phases receive identical stable mechanic IDs; mismatched subject/claim or unknown data is rejected; special recipe/legacy falls back unchanged.
- [ ] **Step 2:** Run `node --test apps/web/scripts/video-production/preproduction-render-bridge.test.mjs apps/web/scripts/video-production/job.test.mjs` and check RED.
- [ ] **Step 3:** Implement the projection and job-level validation; update type declaration.
- [ ] **Step 4:** Run those tests and the relevant general-plan tests, check GREEN.
- [ ] **Step 5:** Commit contract integration and tests.

### Task 3: Real six-operation scene renderer with deterministic timing

**Files:**
- Create: `apps/web/src/video-export/semantic-mechanic-compiler.ts`
- Create: `apps/web/src/video-export/semantic-mechanic-scene.tsx`
- Create: `apps/web/src/video-export/semantic-mechanic-scene.test.tsx`
- Modify: `apps/web/src/video-export/general-scene.tsx`
- Test: `apps/web/src/video-export/teaching-state-scene.test.tsx`

**Interfaces:**
- Consumes `VisualMechanicV1`, phase, local frame and the existing `SemanticFrame` sampler.
- `compileSemanticMechanic(spec, frameContext)` returns named actor poses, visible edges, opacity and bounds, with one deterministic clock. Kumiki's pinned VT1/MG1 assembly, layout and flow primitives back the transformations where applicable; draw semantics, not generic arrow/cards.
- `SemanticMechanicScene` receives a `GeneralFrame` and motion and replaces only the transformation branch when the validated mechanic is present.

- [ ] **Step 1:** Write six failing operator snapshots/semantic DOM tests asserting genuinely different geometry; test persistent actor IDs, hidden first payoff frame, consistent nonsequential seeking, reduced-motion final state and safe bounds.
- [ ] **Step 2:** Run `pnpm --dir apps/web exec vitest run src/video-export/semantic-mechanic-scene.test.tsx` and verify missing-implementation failure.
- [ ] **Step 3:** Implement typed actor layout/pose compiler and SVG scene; integrate existing Kumiki transformations without editing pinned vendor files or introducing a second clock.
- [ ] **Step 4:** Run focused Vitest, full frontend tests, and TypeScript build; fix implementation until GREEN.
- [ ] **Step 5:** Commit renderer and tests.

### Task 4: Research editorial storyboard integration

**Files:**
- Modify: `apps/web/src/features/storyboard-planner/model/{types,serialize,validate,edit}.ts`
- Modify: `apps/web/src/features/storyboard-planner/{StoryboardPlanner,i18n}.ts*`
- Modify: `apps/web/src/features/storyboard-planner/components/{SceneEditor,ScenePreview}.tsx`
- Test: `apps/web/src/features/storyboard-planner/model/{serialize,teaching-state-edit}.test.ts`
- Add: `apps/web/src/features/storyboard-planner/model/visual-mechanic.test.ts`

**Interfaces:**
- Consumes Task 1's `VisualMechanicV1`, maps research sequence → editable `StoryboardBeat.teachingMechanic`, preserves it in JSON/local recovery, and validates edits.
- Static preview shows an editorial preview of the same operator and actor IDs, explicitly not the MP4 renderer.

- [ ] **Step 1:** Write failing round-trip, editing, linked-beat synchronization and preview tests; invalid actors/unknown assets produce localized actionable diagnostics.
- [ ] **Step 2:** Run `pnpm --dir apps/web exec vitest run src/features/storyboard-planner` and confirm RED.
- [ ] **Step 3:** Implement bounded storyboard model/editor/persistence and semantic still preview; preserve demo HVAC special illustration only for its own ID.
- [ ] **Step 4:** Re-run focused tests, typecheck and lint, check GREEN.
- [ ] **Step 5:** Commit authoring integration and tests.

### Task 5: Cross-domain evidence fixtures, QA, documentation, and handoff

**Files:**
- Add focused fixtures under `apps/web/scripts/video-production/fixtures/` or existing test helpers.
- Modify: `apps/web/scripts/video-production/{preproduction-render-bridge,visual-pedagogy}.test.mjs`
- Modify: `apps/web/src/video-export/semantic-mechanic-scene.test.tsx`
- Modify: `apps/web/README.md` and PR review checklist.
- Include this spec and plan in `docs/superpowers/`.

**Interfaces:**
- End-to-end tests: a qualitative HVAC equipment/labor split, homeownership-cost accumulation, and a network-packet transfer all travel through research plan → job → renderer; no unsourced amounts or unknown assets accepted.
- Export preflight and sample frame tests stay headless/deterministic; final film playback and consented browser→FFmpeg on a real machine remain explicit human sign-off gates.

- [ ] **Step 1:** Write failing integration tests/fixtures for the three examples, safe bounds, and editorial vs real-preview distinctions.
- [ ] **Step 2:** Run targeted suites and confirm RED; implement minimal fixture/docs/quality-gate plumbing.
- [ ] **Step 3:** Run `pnpm --dir apps/web lint`, `pnpm --dir apps/web typecheck`, `pnpm --dir apps/web test`, `pnpm --dir apps/web test:video:headless`, `pnpm --dir apps/web build`; record exact results.
- [ ] **Step 4:** Independently review the complete diff for semantic accuracy, permissions, accessibility, regressions, and visual credibility; fix important findings with RED→GREEN tests.
- [ ] **Step 5:** Update the existing draft PR if still open; keep it draft until normal-speed video review and real browser/FFmpeg export pass.

## Self-review / design trace

- Semantics and data safety: Tasks 1–2; actual motion and frame safety: Task 3.
- Both editorial and video workflows: Tasks 2–4; three domains/testable deliverables: Task 5.
- Existing authoring and legacy compatibility: Tasks 1–4.
- Scope limitation: 2D only, qualitative operators only, YouTube export only.
- Full automated QA is required, while human normal-speed playback remains explicitly outstanding if this environment cannot run an actual film.
