# Video Director Guided Workflow Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans in the current session. Checkbox states track what has been verified.

**Goal:** Give Video Director a clear, professional four-step path with safe navigation and no loss of existing production behavior.

**Architecture:** A pure workflow navigation helper handles stage membership and unsaved edits. VideoDirectorWorkspace owns the stage, keeping one persistent ProductionPanel instance while moving the editing, media and sound surfaces behind intentional stage navigation.

**Tech Stack:** React, TypeScript, Tailwind, Node ESM/node:test, existing ContentGen interfaces.

**Spec:** `docs/superpowers/specs/2026-10-24-video-director-workflow-design.md`

## Global Constraints

- Keep source and final media rendering unchanged, with existing approvals and readiness checks.
- Sample still opens the actual real visual preview automatically; other projects start at Storyboard.
- Do not silently discard unsaved scene edits on stage or shot navigation.
- Do not run GitHub Actions (credit limit).

## Review Focus

- An edited draft followed by selecting a different shot must retain the original scene instead of losing input.
- An active production session must not get recreated on step navigation.
- The sample's animation and timeline must remain available immediately after load.
- Importing a new project must reset the selected stage and stale status.
- Switching stages must not trigger TTS or an MP4 job.

### Task 1: Navigation contract

**Files:** Create `apps/web/scripts/video-production/director-workflow.mjs` and `director-workflow.test.mjs`.

**Interface:** `directorStages`; `resolveDirectorNavigation({current,target,unsaved})` returns `{stage,blocked,message}`; `nextDirectorStage(current)` returns the next stage or null.

- [x] Write Node tests for valid order, next-stage behavior, unknown targets and unsaved blocking (RED).
- [x] Implement pure navigation helper, run tests GREEN (5/5, including readiness invalidation).

### Task 2: Guided Video Director UI

**Files:** Modify `apps/web/src/app/video-director-workspace.tsx` and `video-director-workspace.test.tsx`.

- [x] Write React tests for stage navigation, draft protection/discard, and sample landing (execution limited by sparse checkout).
- [x] Implement compact project summary, accessible stage bar, stage-specific content, next-step buttons and an unsaved-edit banner.
- [x] Preserve one mounted ProductionPanel and its settings, adding a narrow `recheckToken` prop to invalidate stale UI readiness when returning from other stages.
- [x] Self-review import, editing, readiness reset and sample behavior against current code; all available 119 Node tests pass. React/TypeScript execution awaits full checkout.

### Task 3: Documentation and GitHub handoff

**Files:** Update the production workflow documentation and current open PR.

- [x] Record the intended UI sequence and boundaries in repository documentation.
- [ ] Publish the change to the existing open PR after verifying its head, preserving concurrent work.
- [ ] Verify remote branch head, mergeability and changed files. Leave GitHub Actions unrun.
