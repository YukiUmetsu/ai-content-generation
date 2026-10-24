# Deterministic Source Citations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the recurring non-verbatim model quote failure while preserving strict source provenance.

**Architecture:** The research model selects server-generated passage IDs. A local resolver constructs exact supporting quotations from captured text, keeps supported claims, and marks unsupported ones as omitted research gaps. The existing dossier validator still checks literal quotes against saved page captures.

**Tech Stack:** Node.js ES modules, built-in `node:test`, ContentGen local chat endpoint.

**Spec:** `docs/superpowers/specs/2026-10-23-deterministic-research-citations-design.md`

## Global Constraints

- Public source page capture/security and the saved-search interface are unchanged.
- Never fabricate or approximately match quotations; no unsupported claim becomes evidence.
- Keep source passages and model responses bounded, keep exactly one local-model call.
- Existing dossier fields, citation hashes and `unverified` statuses stay compatible.

## Review Focus

- Source text with no whitespace near a chunk boundary still yields exact contiguous quote text.
- Unknown, duplicate, or foreign passage IDs cannot introduce citations.
- Mixtures of valid and bad references preserve valid claims with explicit gaps.
- All-invalid model references fail safely with a useful error.
- Legacy analyzers supplying forged literal quotes still fail closed.

---

### Task 1: Server-owned passage IDs and resolution

**Files:** Modify `apps/web/scripts/video-production/research-agent.mjs`; test `apps/web/scripts/video-production/research-agent.test.mjs`.

**Interfaces:** `analyzeCapturedResearch(captures, brief, options, deps)` continues returning `{claims:[{text,support:[{sourceId,quote}]}],gaps}`. Its model request instead contains `{sources:[{id,title,passages:[{id,text}]}]}`, and its model-response schema is `{claims:[{text,support:[{passageId}]}],gaps}`.

- [x] Write tests proving model-generated passage ID citation resolves to exact captured quote, with no freeform quote required.
- [x] Run `node --test apps/web/scripts/video-production/research-agent.test.mjs` and observe the expected red failure.
- [x] Implement bounded deterministic passage splitting and exact ID lookup. Keep `validateExtractedClaims` strict on the resolved quotes.
- [x] Run the scoped test command and verify green.

### Task 2: Honest partial recovery

**Files:** Modify `apps/web/scripts/video-production/research-agent.mjs`; test `apps/web/scripts/video-production/research-agent.test.mjs`.

**Interfaces:** Same as Task 1, but missing/invalid passage IDs exclude corresponding claims and append a clear gap; an all-invalid set throws a non-quote-drift error.

- [x] Write tests for mixed references, duplicate IDs, and all-invalid claims. Watch red.
- [x] Implement filtering with explicitly reported omissions; never invent support.
- [x] Run `node --test --test-isolation=none apps/web/scripts/video-production/research-agent.test.mjs apps/web/scripts/video-production/studio-research.test.mjs`, ensure green.

### Task 3: Integration and handoff

**Files:** Tests above, optional `docs/how-to-research-to-storyboard.md` clarification.

- [x] Add a failing test that source passages for a long captured page total no more than 4,000 characters; then bound the model prompt and verify green.
- [x] Add failing tests proving research and planning inference timeouts name the correct stage while keeping saved searches; wrap stages and verify green.
- [x] Run scoped Node tests (27/27 pass); attempt project test/build (`pnpm` cannot initialize its store in this partial sandbox checkout).
- [ ] Check fresh main, commit files on a separate GitHub branch, and create one PR without merging.
- [ ] Review the final diff for provenance weakening and regressions.
