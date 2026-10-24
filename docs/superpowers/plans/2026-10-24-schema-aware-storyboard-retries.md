# Schema-Aware Storyboard Retries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the actual source of invalid storyboard micro-jobs without weakening teaching diversity.

**Architecture:** Existing validators attach safe schema issue codes. The research job queue interprets these codes and the saved substep into specific retry instructions. The scene direction producer retains the prior accepted phase values and reinforces a distinct visual purpose for each phase.

**Tech Stack:** Node.js ESM, `node:test`, ContentGen research job planner and queue.

**Spec:** `docs/superpowers/specs/2026-10-24-schema-aware-storyboard-retry-design.md`

## Global Constraints

- One accepted checkpoint per completed micro-job; do not discard saved scenes.
- Keep three local retries and optional secondary-model failover.
- No raw AI text in normal logs, public status, or correction error codes.
- Source-grounding, structural correctness, and phase diversity remain required.

## Review Focus

- Duplicate previous `learningChange`: classify and give a phase-targeted correction.
- Duplicate previous `visualAction`: reject a paraphrase-only retry and teach an actual new action.
- Visual elements with a 47-character detail: accept while preserving 44-character label cap.
- Malformed visual elements: specific two-object repair rather than generic retry.
- Provider 5xx: back off and retry without calling it a schema error.

### Task 1: Semantic schema error classification

**Files:** `research-job-planner.mjs`, `research-job-planner.test.mjs`.

- [x] Add failing tests that assert the `duplicate_previous` safe issue on either repeated field.
- [x] Run targeted tests to verify failure.
- [x] Attach `schemaIssue` to duplicate errors and run the tests green.

### Task 2: Error-specific retry inputs

**Files:** `research-job-queue.mjs`, `research-job-queue.test.mjs`, `research-job-planner.mjs`.

- [x] Write failing integration tests for duplicate payoff retry, visualElements structural retry, and transient provider behavior.
- [x] Run targeted tests red.
- [x] Generate targeted per-issue feedback; make each visual phase explicitly teach a different step, using existing previousVisuals data.
- [x] Verify tests green and unchanged checkpoint behavior.

### Task 3: Visual descriptions and final verification

**Files:** `visual-elements.mjs`, `research-job-planner.test.mjs`.

- [x] Write and fail a test for a valid 47-character `detail` with a short label.
- [x] Relax only internal detail length to 160; preserve on-screen label bounds.
- [x] Run `node --test --test-isolation=none apps/web/scripts/video-production/*.test.mjs` and verify all passing (100/100).
- [x] Review changes against latest main and publish one PR.
