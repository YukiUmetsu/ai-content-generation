# Natural Keyword Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep search keywords natural and on-scope without reducing all niches to a housing vocabulary.

**Architecture:** Extend the existing deterministic `weakSuggestion` shape check, broaden the existing optional batched `needsSemanticReview` rubric only for ambiguous jargon, and clarify the generation instructions. Retain persisted data and bounded request scheduling unchanged.

**Tech Stack:** Node ESM, built-in `node:test`, existing local OpenAI-compatible inference transport.

**Spec:** `docs/superpowers/specs/2026-10-25-natural-keyword-quality-design.md`

## Global Constraints

- No new dependencies, network model invocations, data rewrites or API changes.
- Keep 12 shared local inference calls maximum, progressive 1–2 suggestion batches and honest partial results.
- Do not use housing-only keyword replacements; never invent measured search volume.
- No GitHub Actions; run local checks.

## Review Focus

- Natural short technical searches remain accepted when editorial suffixes are added to the gate.
- Comparison terms with dotted products still work; `VS Code` remains a product, not a comparison.
- Ambiguous jargon needs a check, but ordinary terms must not pay extra model calls.
- Invalid or timed-out semantic verdicts retain ordinary keywords, do not fail entire generation.
- Rejected batches refill within the existing budget; no padding or repeated bad literal prompts.

## Task 1: Catch search-heading scaffolding

**Files:** `apps/web/scripts/video-production/project-keyword-generator.mjs`, `.test.mjs`

- [x] RED: Tests show reported editorial constructions clear quality screening while natural counterexamples must survive.
- [x] GREEN: Add narrow deterministic shape checks for editorial suffixes and compound risk framings, without sector-specific replacement rules.
- [x] Verify keyword test suite passes.

## Task 2: Tighten ambiguous naturalness/relevance checks and prompts

**Files:** Same generator and tests, `docs/how-to-discover-project-ideas.md`

- [x] RED: Mock streamed batches/semantic judgments to prove jargon gets checked and rejected candidates trigger later varied requests without padding.
- [x] GREEN: Expand `needsSemanticReview`, strengthen exact-query and scope criteria, revise generation lenses to avoid abstract headings; retain shared call count.
- [x] Verify keyword suite, discovery queue, Vitest, lint, tsc, production build.

## Task 3: Review and handoff

- [x] Inspect only intended source/test/docs against current main and open one focused PR; skip GitHub Actions and do not merge.
