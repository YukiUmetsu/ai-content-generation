# Research Outline Micro-jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task, with failing tests first.

**Goal:** Prevent monolithic outline truncation from blocking resumable research production.

**Architecture:** Planner exports compact skeleton/beat calls and a deterministic assembler. Queue persists each independently, retaining legacy full-outline checkpoints. Retry metadata preserves a truncation signal across interleaved connection errors and emits safe provider failure categories.

**Tech Stack:** Node.js ESM, `node:test`, existing ContentGen server.

**Spec:** `docs/superpowers/specs/2026-10-24-research-outline-microjobs-design.md`

## Global Constraints

- Local-only endpoints and saved per-job model settings.
- No raw prompt/response, URL, or captured source text in logs or status.
- Keep scene micro-jobs and old outline checkpoints compatible.

## Review Focus

- Mid-outline failure after one beat saves enough to resume without re-inference.
- `output_truncated → provider_unavailable` still yields compact instructions on attempt 3.
- Manual resume does not overwrite completed artifacts; an actual model change starts new checkpoint names.
- Invalid/unapproved claim IDs are never saved as successful beats.
- Existing completed `outline_0.json` jobs skip skeleton and beat calls entirely.

---

### Task 1: Planner skeleton and individual beats

**Files:** `apps/web/scripts/video-production/research-job-planner.mjs`, `research-job-planner.test.mjs`.

**Interfaces:** `generateOutlineSkeleton(dossier,quotes,settings,deps)`, `generateOutlineBeat(skeleton,beatIndex,previousBeats,dossier,quotes,settings,deps)`, `assembleOutline(dossier,skeleton,beats)`.

- [x] Write tests for independently validated skeleton/beat calls, source IDs, configured token ceilings, and deterministic assembly.
- [x] Watch planner tests fail.
- [x] Implement calls with compact bounded prompts and strict validation.
- [x] Run planner tests green.

### Task 2: Queue checkpoints and sticky retry diagnostics

**Files:** `apps/web/scripts/video-production/research-job-queue.mjs`, `research-job-queue.test.mjs`.

**Interfaces:** Inject optional `outlineSkeleton`, `outlineBeat`, `combineOutline`; retain `outline` injection for prior tests. Save `outline_skeleton_<generation>.json`, `outline_beat_<generation>_<index>.json`.

- [x] Write tests for partial outline resume, old outline checkpoints, sticky compact feedback, safe provider categories, and model-change invalidation.
- [x] Watch queue tests fail.
- [x] Implement checkpoints through existing serialized attempts and safe diagnostic metadata.
- [x] Run focused and available regression suites green.
- [ ] Open one PR and disclose unavailable full-repo/frontend or local-model verification.
