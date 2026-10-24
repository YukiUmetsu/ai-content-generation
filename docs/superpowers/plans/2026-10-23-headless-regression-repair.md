# Headless Video Regression Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a reliable green headless video test suite before shipping the Studio research/storyboard feature.

**Architecture:** Keep security behavior and network consent unchanged. Repair stale assertions/imports, make local-only error and hook guidance explicit, and execute local HTTP listener integration tests with the permission they require.

**Tech Stack:** Node 24 test runner, ESM JavaScript, SearXNG Docker CLI, local OpenAI-compatible model endpoint.

**Spec:** The user asked to fix the previously reported headless suite failures before creating the ContentGen pull request.

## Global Constraints

- No external network calls, actual Docker image downloads, or paid model invocations in these tests.
- Preserve unrelated dirty workspace changes.
- Do not weaken loopback-only validation, public-source size checks, or prompt-injection defenses.
- A `listen EPERM` failure inside the restricted sandbox is an environment issue: rerun local HTTP tests using explicitly authorized permission.

## Review Focus

- Invalid public model endpoints remain rejected; error should clearly name the loopback rule.
- Tests above and below the documented 512 KiB raw input boundary behave differently.
- Untrusted source content is bounded without masking legitimate warnings in the system prompt.
- The Docker Compose test uses the current configuration-module owner, not a removed export.
- Hook prompts explicitly prioritize immediate audience relevance.

---

### Task 1: Local endpoint diagnostics and hook prompt

**Files:** `apps/web/scripts/video-production/topic-generator.mjs`, `apps/web/scripts/video-production/hook-variants.mjs`.

**Tests:** Existing red assertions in `local-search-config.test.mjs`, `preproduction.test.mjs` and `video-revisions.test.mjs` establish expected behavior.

- [x] Verify the existing tests fail because the error text/prompt lacks audience or loopback terminology, not because validation fails open.
- [x] Make the rejection message explicitly mention loopback while preserving the accepted-host policy.
- [x] Confirm that the default hook prompt already requires audience relevance; correct the test to respect explicit custom prompt overrides and add a default-prompt regression test.
- [x] Rerun each affected test file and verify green.

### Task 2: Correct research security test boundaries and SearXNG import

**Files:** `apps/web/scripts/video-production/research-agent.test.mjs`, `apps/web/scripts/video-production/searxng-docker.test.mjs`.

**Tests:** These test files already reproduce the failures.

- [x] Verify the 520000-byte fixture is below 512 KiB and the model system prompt intentionally contains `UNTRUSTED`.
- [x] Use a truly oversized fixture and check the original source text stays isolated as user data; do not forbid the safe system guidance.
- [x] Import `COMPOSE_FILE` from `local-search-config.mjs` where it is defined.
- [x] Rerun the two suites; mock port availability only in tests that are not testing real socket binding.

### Task 3: Full verification under correct permissions

**Files:** No application changes anticipated.

- [x] Run the HTTP stage and Studio integration tests with authorized localhost-listener privileges.
- [x] Run `pnpm --dir apps/web run test:video:headless` with the same privileges: 235/235 passed.
- [x] Run the frontend unit suite (245/245), production build, and lint (0 errors, 2 existing warnings).
- [x] Only once green, proceed to PR integration; document remaining warnings accurately.
