# Local AI model profiles and Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect Magnitude and other loopback model servers through reusable profiles with per-task assignment, while making Settings clear and restoring Custom selection.

**Architecture:** A strict new disk-backed profile contract resolves task-specific model settings. Existing CLI and Studio calls consume only resolved model/endpoint settings. Settings edits the canonical profile document, preserving legacy data and the separate Keychain integration.

**Tech Stack:** Node 22 ESM, React 19/TypeScript, Vite/Vitest, existing Tailwind/Kumiki tokens.

**Spec:** `docs/superpowers/specs/2026-10-23-local-ai-model-profiles-design.md`

## Global constraints

- Loopback-only inference; no API credentials or paid/cloud providers; no auto-download or activation.
- Existing `data/research-model.json` remains readable and untouched.
- One heavy model at a time on the target 24 GB Mac.
- Do not touch Keychain backend, Jobs/QA, video renderer, or vendored Kumiki sources.
- Same-origin settings writes, strict validation, preserved CLI explicit overrides, EN/JA labels.

## Review Focus

1. Provider set to Custom with the same URL as a preset must survive selection, saving, and reload (Task 3).
2. Magnitude `/inference/v1/models` must work without relaxing loopback/path/redirect security (Task 1).
3. Changing a task profile must not reroute a different task or silently mutate other profiles (Tasks 1–2).
4. Legacy single-model settings remain available if new config has not been saved (Task 1).
5. Disabled/unavailable model server must yield a visible recovery message and preserve unsaved edits (Task 3).

---

### Task 1 — Validated, versioned profile persistence and model discovery

**Files:** `apps/web/scripts/video-production/model-profiles.mjs` (new), `model-profiles.test.mjs` (new), `research-model-settings.mjs`, `topic-generator.mjs`, `apps/web/scripts/research-model-vite.mjs`.

**Interfaces:** `validateModelProfiles(raw)`, `readModelProfiles(path?)`, `saveModelProfiles(raw,path?)`, `resolveModelForTask(task,{path?,legacyPath?}?)`, synchronous companion; `modelsEndpoint(chatEndpoint)` retains provider path prefix.

- [ ] Write tests for Magnitude, custom, credentials and remote rejection, duplicates, migration, persistence and per-task resolution. Run Node tests and observe RED.
- [ ] Implement strict profile contract and atomic file replacement, models endpoint path and Vite routes. Confirm GREEN and old tests remain green.
- [ ] Commit focused backend changes to isolated PR branch.

### Task 2 — Route actual local-AI operations through the saved task map

**Files:** `director-studio-vite.mjs`, `studio-research.mjs`, `research-cli.mjs`, `preproduction-cli.mjs`, `topic-cli.mjs`, and existing `.test.mjs` suites.

**Interfaces:** consumers receive `{endpoint,model}`; Research Studio receives a *separate* `storyModelSettings`; `--model`/`--endpoint` remain highest-priority CLI overrides.

- [ ] Add RED tests demonstrating independent research, story, hooks, script routing and legacy CLI fallbacks.
- [ ] Update only existing actual AI call sites, not speculative stages. Run GREEN targeted and Node video test suite.
- [ ] Commit routing changes to same branch.

### Task 3 — Professional Settings and stable Custom option

**Files:** `apps/web/src/app/research-model-settings.tsx`, `catalog-workspace.tsx`, `app/model-profile-settings.test.tsx` (new), minimal shared style if necessary.

**Interfaces:** GET `/profiles`, POST `/profiles/save`, POST `/models`; controlled provider ID stored separately from URL; no browser secrets.

- [ ] Add RED Vitest interactions: custom persists, add/remove profile, model discovery, task overrides, Save/reload, errors, Japanese/mobile semantics.
- [ ] Implement full-width Local AI editor, task assignments and clear secondary Settings areas while preserving Keychain PR integration point.
- [ ] Verify CI lint/typecheck/Vitest/headless suite/build and leave normal-speed browser visual inspection as explicit sign-off.
- [ ] Update docs and PR description; keep one PR for this feature.
