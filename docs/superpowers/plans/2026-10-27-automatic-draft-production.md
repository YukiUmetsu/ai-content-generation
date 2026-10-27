# Automatic-draft Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ContentGen's approved-script-to-video path immediately usable, with one explicit automatic draft action and editable output.

**Architecture:** Keep current source/revision contracts and renderer API; expose focused user actions through the existing Director and Production workspaces. Vendor Stepper from ContentGen's existing pinned Kumiki commit. Preserve the local producer's preflight/consent requirements and distinguish its non-durable run state from the Rust Jobs queue.

**Tech Stack:** React 19, TypeScript, Kumiki source registry, Vitest, Node test runner, Rust/Axum.

**Spec:** `docs/superpowers/specs/2026-10-27-automatic-draft-production-design.md`

## Global Constraints

- Local-first; no network model/media calls during tests and no download over 250 MB.
- Never automatically publish, bypass rights review, or persist Fish API credentials.
- Never edit vendored Kumiki components in place; update the approved manifest and lock.
- Keep saved user edits, source revisions, approval state, and unrelated data.
- Prioritize an executable vertical slice over a pretend end-to-end success state.

## Review Focus

- Server unreachable during automatic preflight: retain inputs and show actionable failure.
- Repeated Generate clicks: prevent duplicate concurrent renders.
- New script/storyboard revision: invalidate readiness without clearing voice inputs.
- Custom Japanese labels and narrow view: stepper remains accessible and horizontally scrollable.
- Thumbnail cover reroll: does not silently change the published/upload asset reference.

---

### Task 1: Pinned Kumiki Stepper and Character Studio navigation

**Files:** `apps/web/kumiki.config.json`, `apps/web/vendor/kumiki.lock.json`, `apps/web/src/components/ui/stepper.tsx` (vendored), `apps/web/src/app/production-workspace.tsx`, `apps/web/src/app/navigation.tsx`, `apps/web/src/app/shell.tsx`, `apps/web/src/app/production-workspace.test.tsx`, `apps/web/src/app/shell.test.tsx`.

**Interfaces:** `Stepper({steps,currentStepId,states,onStepSelect,...})`; `SectionId="characters"` routes to the existing `CharacterPackInspector` via `CatalogWorkspace`/a focused host.

- [x] Add failing frontend tests for stage navigation, status labels, and Character Studio discovery.
- [x] Run the focused tests and confirm expected failures.
- [x] Vendor the pinned Stepper and replace hand-written Production stage buttons; expose Character Studio navigation.
- [x] Run focused tests, typecheck, and Kumiki lock verification.
- [x] Commit the tested UI navigation slice.

### Task 2: Direct Visual/Sound entry and one-click automatic draft

**Files:** `apps/web/src/app/production-workspace.tsx`, `apps/web/src/app/video-director-workspace.tsx`, `apps/web/src/app/video-production-panel.tsx`, `apps/web/src/app/video-production-panel.test.tsx`, `apps/web/src/app/video-director-workspace.test.tsx`, `apps/web/scripts/director-production-vite.test.mjs`.

**Interfaces:** `ProductionPanel` supports an initial section and a checked `generateDraft()` sequence: plan → preflight → start, using current `/api/contentgen-video/{plan,check,start,status}` endpoints. No extra transport or renderer clock.

- [x] Write failing tests for visual entry, audio entry, blocked preflight, successful one-click generation, and repeated-click prevention.
- [x] Run tests and confirm failures are behavioral.
- [x] Route visual entry to live preview, sound to voice setup; offer one clear Generate Draft CTA, preserve reasons and configuration.
- [x] Run focused frontend/Node tests and check failures/cancel state.
- [x] Commit the verified automatic draft slice in the shared PR branch.

### Task 3: Editable production-linked publishing artwork

**Files:** `apps/web/src/features/platform-optimization/generated-art.ts`, `PlatformOptimization.tsx`, `generated-art.test.ts`, `PlatformOptimization.test.tsx`.

**Interfaces:** Cover layout variant and headline are explicit current-production UI choices, not hidden upload-title derivatives; three materially distinct cover concepts in the existing deterministic layout engine. Export current chosen PNG and preserve original source revision.

- [x] Write failing tests proving variants differ, controls update previews, and unchanged metadata persists.
- [x] Run tests and confirm failures.
- [x] Implement editable, regenerable cover choices in Publish Kit, with separate export identity and an explicit selected variant.
- [x] Run focused tests; visually inspect small-size thumbnail legibility when browser tooling permits.
- [x] Commit the publishing artwork slice in the shared PR branch.

### Task 4: Documentation, cross-checks, and PR

**Files:** `docs/production-workflow.md` plus only tests/docs needed for verified behavior.

- [x] Run local pinned Kumiki vendor verification, `typecheck`, `lint`, `test`, `test:video:headless`, and `build` (recorded failures/limitations below).
- [x] Attempt Rust fmt/clippy/tests; `cargo` is unavailable in this environment.
- [x] Review changed behavior adversarially and fix confirmed findings.
- [x] Update docs with the automatic start and manual release boundaries; open one PR.

**Verification notes:** Local headless video tests pass (679/679), focused frontend tests pass (48/48), pinned Kumiki files match the locked revision (96/96), final TypeScript, ESLint and production build pass. Three visual layouts were rendered and inspected in both 16:9 and portrait formats. Full frontend suite has four pre-existing YouTube Intelligence/Shell UI-selector failures (695/699); those files are untouched. Rust checks cannot run because the container lacks `cargo`.
