# Research Scene Micro-jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task, with failing tests first.

**Goal:** Make scene structure and visual inference independently checkpointable so Qwen-sized local models can resume after output truncation.

**Architecture:** Planner validates tiny fields and deterministically assembles the existing full structure/visual contracts. The job queue persists each fragment, respecting legacy artifacts, serialized inference, resume semantics, and safe retry diagnostics.

**Tech Stack:** Node.js ESM, Node built-in test runner, existing ContentGen research queue.

**Spec:** `docs/superpowers/specs/2026-10-24-scene-microjobs-design.md`

## Global Constraints

- No new dependencies, network destinations, or new UI settings.
- Preserve model-specific configured generation limits and current source-evidence validation.
- Keep private model output and captured text out of logs and API errors.
- Do not rerun successfully checkpointed pieces on resume.

## Review Focus

- A local model fails on `structure_states` after `structure_core` was saved: resume reuses the core.
- A model fails on `visual_elements` after direction was saved: resume reuses the direction and earlier phases.
- A preexisting complete `structure`/`visual` artifact bypasses the new calls.
- A corrupted partial JSON or invalid field cannot be marked complete.
- A scene revision or model change cannot accidentally reuse old partial pieces.

### Task 1: Planner's small scene inference contracts

**Files:** `apps/web/scripts/video-production/research-job-planner.mjs`, `research-job-planner.test.mjs`.

**Interfaces:** `generateSceneCore`, `generateSceneStates`, `assembleSceneStructure`, `generateSceneDirection`, `generateSceneElements`, `assembleSceneVisual`.

- [x] Write planner tests proving tiny requests, configured token limits, valid reconstruction and invalid fragment rejection.
- [x] Run tests, verify RED from missing interfaces.
- [x] Implement bounded AI calls and validation using existing `localJson`.
- [x] Run focused tests GREEN.

### Task 2: Queue fragment checkpoints and compatibility

**Files:** `apps/web/scripts/video-production/research-job-queue.mjs`, `research-job-queue.test.mjs`.

**Interfaces:** New default fragment generators; legacy `sceneStructure` / `sceneVisual` injected producers may still bypass the new path. Atomic filenames `structure_core_<generation>_<scene>_<revision>.json`, `structure_states_<...>.json`, `visual_direction_<...>_<phase>.json`, `visual_elements_<...>_<phase>.json`.

- [x] Add RED tests for structure/visual resumes, legacy completed checkpoints and safe public `currentStep`.
- [x] Implement checkpoint loading, creation and deterministic assembly.
- [x] Run complete available video-production test suite GREEN.
- [ ] Review the changed branch; open a single PR and disclose live/CI verification limits.
