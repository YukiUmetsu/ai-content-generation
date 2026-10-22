# Video Test Studio Implementation Plan

> **For agentic workers:** Implement task-by-task using test-first development and check each API contract against the design before proceeding.

**Goal:** One-command local UI to preflight, render and review real draft videos using the existing worker.

**Architecture:** A dependency-free, loopback-only Node HTTP service owns job runs and media allowlists. A static accessible browser UI consumes its JSON API. Small progress callbacks expose verified worker stages without changing media contracts.

**Tech Stack:** Node 22+, browser HTML/CSS/JS, existing Fish/local TTS + Chromium + FFmpeg pipeline.

**Spec:** `docs/superpowers/specs/2026-10-22-video-test-studio-design.md`

## Global constraints

- Draft/test-only, no paid Fish models, publishing, automatic model downloads, arbitrary output directories or remote listen interface.
- Never persist provider credentials; exact config preflight before a render.
- Use actual release paths/QA, no mock media or fictitious progress in production.

## Review focus

- External web page tries to call localhost without token/origin → rejected.
- User switches provider or voice after preflight → render gated until new preflight.
- User cancels during narration/frame capture → abort signal, no false completed state.
- Malformed or traversal artifact paths → denied; valid MP4 Range request → partial response.
- API key appears in error/response or on-disk job → leak prevented.

### Task 1: HTTP controller and safety

**Files:** `apps/web/scripts/video-production/studio-server.mjs`, `studio-server.test.mjs`

- [ ] Write tests for configuration, preflight, consent, state transitions, cancellation, security and artifacts. Watch RED.
- [ ] Implement `createStudioJob`, `startVideoStudio` with injectable build/inspect/produce/findBrowser and allowed release media.
- [ ] Run targeted tests GREEN and existing tests.

### Task 2: Accurate pipeline progress

**Files:** `produce.mjs`, `render.mjs`, `produce.test.mjs`, `render.test.mjs`

- [ ] Add a failing regression test for stage callbacks and completed segment frame counts.
- [ ] Add optional `onProgress` callback without changing sample-accurate audio or capture semantics.
- [ ] Run targeted tests GREEN and existing suite.

### Task 3: Browser frontend and launch path

**Files:** `studio-ui/{index.html,app.css,app.js}`, `apps/web/package.json`, `apps/web/README.md`

- [ ] Test the HTML routing and contract for accessible controls and artifact links.
- [ ] Implement configuration, preflight findings, real render/cancel status, media preview and download view.
- [ ] Add `pnpm video:studio`, concise README instructions and verify assets/working routes.

### Task 4: Integration and handoff

- [ ] Run `node --test scripts/video-production/*.test.mjs` and any available frontend checks.
- [ ] Push a non-destructive commit to the existing draft PR, review CI results, document test limitations.
