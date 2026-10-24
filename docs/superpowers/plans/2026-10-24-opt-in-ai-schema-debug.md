# Opt-in AI Schema Failure Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let ContentGen print a bounded raw AI response to its local server console only when a schema-invalid storyboard model attempt occurs and debugging is explicitly enabled.

**Architecture:** A small Node `AsyncLocalStorage` helper holds the latest model response in the current inference attempt. The job queue scopes that attempt with safe metadata. The JSON parser captures only the assistant's response content. Rejection triggers a single structured, bounded log line.

**Tech Stack:** Node ESM, `node:async_hooks`, `node:test`, existing ContentGen research queue/planner.

**Spec:** `docs/superpowers/specs/2026-10-24-opt-in-ai-schema-debug-design.md`

## Global Constraints

- Raw model output never leaves local logs; no request headers or prompts are included.
- Debug flag is exactly `CONTENTGEN_DEBUG_AI_OUTPUT=1`; off for all other values.
- Cap model-content bytes at 16 KiB and JSON-escape all untrusted output.
- Preserve all existing schema, retry, source-privacy, and checkpoint semantics.

## Review Focus

- A prompt that contains ANSI escapes/newlines cannot inject additional log lines; cover in Task 1 tests.
- A larger-than-16-KiB response is bounded and marked truncated; cover in Task 1 tests.
- Overlapping asynchronous contexts cannot mix responses; cover in Task 1 tests.
- A valid response or non-schema failure does not emit raw text; cover in Task 1 tests.
- A disabled debug flag never outputs raw text; cover in Task 2 integration test.

---

### Task 1: Isolated diagnostic context and renderer

**Files:** Create `apps/web/scripts/video-production/research-ai-debug.mjs` and `.test.mjs`.

**Interfaces:** `withModelDebugContext(context, action, options?)` executes `action` in isolated context and conditionally logs rejected content; `captureModelOutput(text)` records model text for that context only.

- [ ] Write failing tests for enabled/disabled operation, schema/non-schema errors, UTF-8 truncation, log injection, and concurrent isolation.
- [ ] Run `node --test --test-isolation=none apps/web/scripts/video-production/research-ai-debug.test.mjs` and verify the intended failures.
- [ ] Implement the minimal safe context and logger.
- [ ] Rerun focused tests; expect all pass.

### Task 2: Wire queue and model response parsing

**Files:** Modify `research-job-queue.mjs`, `research-job-planner.mjs`; extend matching tests.

**Interfaces:** Queue calls `withModelDebugContext` with job/stage/currentStep/model/attempt. Planner calls `captureModelOutput` on assistant message content just before JSON parsing.

- [ ] Write a failing job-queue/model-planner integration test for schema error and disabled debug mode.
- [ ] Run focused tests and verify failure before editing implementation.
- [ ] Add context wrapper at the queue inference boundary and response capture in the existing parser.
- [ ] Rerun focused tests; expect all pass.

### Task 3: Full verification and PR

**Files:** Only files from Tasks 1–2 and these docs.

- [ ] Run `node --test --test-isolation=none apps/web/scripts/video-production/*.test.mjs`; expect zero failures.
- [ ] Inspect the branch diff for accidental raw logging, config changes, or unrelated file edits.
- [ ] Create one GitHub PR. Report that real local Magnitude logging still needs user verification.
