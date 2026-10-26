# Concise discovery keywords implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task with RED → GREEN tests.

**Goal:** Keep AI-suggested project keywords short, nonredundant and searchable.

**Architecture:** Retain the current generator/quality gate and streaming batch contract. Tighten natural-language instructions, enforce a seven-word maximum only on AI suggestions, and reject equivalent concept anchors before review.

**Tech Stack:** Node ES modules, `node:test`, existing React UI.

**Spec:** `docs/superpowers/specs/2026-10-25-concise-discovery-keywords-design.md`

## Global Constraints

- Prompt for 2–5 words, hard maximum 7 for AI-generated text; never truncate phrases mechanically.
- No changes to persisted user keywords, no schema migration, no increased inference budget, no cloud calls.
- Retain the incremental 1–2 suggestions/batch review contract.

## Review Focus

- Empty or malformed model batches: existing retries and truthful partial results.
- Legitimate six- or seven-word technical comparisons: accepted.
- Overlapping 'opportunity cost' suggestions: only one reaches review.
- Unrelated cost subjects: both survive filtering.
- Long suggestions in a mixed batch: concise entries appear without waiting for another request.

### Task 1: Concise quality screening and dedupe

**Files:** `apps/web/scripts/video-production/project-keyword-generator.mjs`, `.test.mjs`

**Interface:** `qualityKeywordSuggestions(rows,{name,existing,accepted})` unchanged.

- [x] Add RED tests for rejecting 8+ word suggestions, retaining 6–7 word technical phrases and separating unique subjects.
- [x] Run `node apps/web/scripts/video-production/project-keyword-generator.test.mjs` and observe expected failure.
- [x] Enforce AI keyword word cap and narrow concept-aware duplication; keep rationales and user keywords intact.
- [x] Run same test to GREEN; update old fixture expectations where verbose fixtures intentionally violate the new contract.

### Task 2: Prompt length guidance and documentation

**Files:** same generator/tests, `docs/how-to-discover-project-ideas.md`

**Interface:** `generateProjectKeywords(candidate,options)` unchanged.

- [x] Add RED test asserting all prompts explicitly request 2–5 words and no more than seven.
- [x] Run failing test.
- [x] Add concise examples to prompt and carry rejected verbose phrases forward as feedback without extra model calls.
- [x] Run keyword suite to GREEN; update documentation with concise keyword vs video-topic distinction.
- [x] Run full Node/frontend tests, lint, typecheck and build. Report any failures honestly.
