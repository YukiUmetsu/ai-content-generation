# Resumable Research Scene Chunking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task; write failing tests first.

**Goal:** Complete research storyboards with short local AI calls, retaining validated outputs when later calls truncate.

**Architecture:** Planner generates independently validated scene structure, three visuals, and three narrations. Queue calls each step through its existing bounded retry/failover scheduler, checkpoints it atomically, then combines a validated scene deterministically. Prior whole-scene checkpoint files remain compatible.

**Tech Stack:** Node.js ESM, `node:test`, Vite's existing server/UI.

**Spec:** `docs/superpowers/specs/2026-10-24-research-scene-chunking-design.md`

## Global Constraints

- Use saved local model generation settings as the ceiling for each call.
- Preserve source-grounded requirements and privacy-safe error diagnostics.
- Do not reset successful checkpoints on ordinary resume.

## Review Focus

- Truncation during the second visual phase must leave prior phases on disk.
- Model identity changes and manual scene retries must not reuse stale partial checkpoints.
- Previously saved whole-scene artifacts must skip every new substep.
- An interrupted job must not rerun AI before an explicit resume.
- No raw provider text, claims, or quotes may appear in error state/logs.

---

### Task 1: Small Planner Calls

**Files:** Modify `research-job-planner.mjs`; test `research-job-planner.test.mjs`.

**Interfaces:** Export `generateSceneStructure`, `generateSceneVisual`, `generateSceneNarration`, `assembleSceneUnit`. Each generation function takes the existing outline/index/dossier/quotes/settings plus optional dependencies, and visual/narration context; assembled scene has the existing unit shape.

- [x] Add tests proving three concise outputs can be separately generated and merged into a valid plan, including rejection of malformed/truncated substep output.
- [x] Run focused planner tests and confirm RED.
- [x] Implement the four exports with strict field validation, compact prompts, and saved token limits.
- [x] Run focused planner tests and confirm GREEN.
- [x] Verify outline truncation retries request only two concise beats and Qwen hints are model-specific.

### Task 2: Per-substep Queue Checkpoints

**Files:** Modify `research-job-queue.mjs`; test `research-job-queue.test.mjs`.

**Interfaces:** Accept injectable structure/visual/narration/assembly implementations, retaining `scene` injection for legacy tests. Save `structure_*`, `visual_*`, and `narration_*` files guarded by safeName; expose `currentStep` on job status.

- [x] Test a truncated middle substep, persisted earlier checkpoints, resume from exactly that step, and existing whole-scene backward compatibility.
- [x] Run focused queue tests and confirm RED.
- [x] Implement checkpoint and retry per substep with existing safe model failover; retain cancellation/scene revision behavior.
- [x] Run focused queue tests and confirm GREEN.
- [ ] Run repository available test suites, inspect code diff, and create one PR with outcomes and any verification limitations.
