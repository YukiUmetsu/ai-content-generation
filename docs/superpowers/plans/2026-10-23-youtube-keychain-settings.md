# YouTube Keychain Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner configure YouTube Data API credentials from ContentGen Settings, keep them in macOS Keychain, and have both manual and scheduled YouTube collection use the saved key without restarting.

**Architecture:** Rust owns an injectable credential source with a macOS native Keychain implementation and env-only fallback. An authenticated loopback settings API exposes status and write/delete, never readback; React renders the YouTube connection in the existing Settings screen. Other providers and Tauri packaging are separate slices.

**Tech Stack:** Rust Axum/Tokio, macOS `security-framework` target dependency, React/Vite/Vitest, existing SQLite market worker.

**Spec:** `docs/superpowers/specs/2026-10-23-local-first-keychain-design.md`

## Global Constraints

- Preserve unrelated dirty files and do not edit Research/Video pipeline components in progress.
- No plaintext, browser, SQLite, `.env`, URL or response storage of saved API key; no provider calls as part of Save.
- Loopback-only, exact origin validation, CSRF token, strict provider allowlist, bounded JSON.
- Keychain takes precedence; environment fallback remains; no automatic env import.
- Unsupported OS returns secure-storage-unavailable, never insecure persistence.
- No external live YouTube calls in automated tests.

## Review Focus

1. Existing env key but no Keychain entry → reported as `environment` and still usable.
2. Keychain access denied, not absent → explicit safe error; do not silently fall back to environment or leak details.
3. Failed replacement of an existing item → original credential remains usable.
4. Hostile cross-origin browser mutation or missing CSRF → request rejected before touching credentials.
5. Secret-shaped data in body/log/error response → no key content appears in output.

---

### Task 1: Credential source and collector integration

**Files:**
- Create: `crates/server/src/credentials.rs`
- Modify: `crates/server/Cargo.toml`, `crates/server/src/lib.rs`, `crates/server/src/state.rs`, `crates/server/src/research/youtube_api.rs`, `crates/server/src/research/market_api.rs`, `crates/server/src/research/market_worker.rs`
- Test: `crates/server/src/credentials.rs` module tests; `crates/server/tests/market_api.rs`

**Interfaces:**
- `trait CredentialStore: Send + Sync { fn read(&self, provider: ProviderId) -> Result<Option<String>, CredentialError>; fn put(&self, provider: ProviderId, key: &str) -> Result<(), CredentialError>; fn delete(&self, provider: ProviderId) -> Result<(), CredentialError>; }`
- `ProviderId::Youtube`; effective lookup `resolve_youtube_key(state: &AppState) -> Result<(String, CredentialSource), CredentialError>` and status source `keychain | environment | missing | unavailable | error`.
- `AppState::with_credentials(...)` for fake-store tests; production `AppState::new` gets native store.
- `YoutubeClient::from_key(String)` preserves sanitized provider errors.

- [ ] Write fake-store failing tests for precedence, env fallback, denied reads, put/delete, failure-preserves-previous.
- [ ] Run targeted Rust test to observe failures from missing interfaces.
- [ ] Implement credential module + conditional native Keychain adapter; integrate both worker and manual collector with effective lookup.
- [ ] Run targeted Rust tests to green, then existing market API tests.
- [ ] Keep new macOS dependency target-specific; confirm Linux tests build without attempting to access Keychain.

### Task 2: Secure local settings API

**Files:**
- Create: `crates/server/src/settings.rs`
- Modify: `crates/server/src/router.rs`, `crates/server/src/lib.rs`, `crates/server/src/state.rs`
- Test: `crates/server/tests/settings_api.rs`

**Interfaces:**
- `GET /api/settings/providers` configured/source/error without secrets.
- `GET /api/settings/session` issue in-memory session CSRF token with `no-store`.
- `PUT /api/settings/providers/youtube/key` with `{ "key": "..." }` and `DELETE` same path.
- Require exact local UI origin and allowed Host, `X-Contentgen-Settings` session token, and JSON content type for PUT; no permissive CORS.

- [ ] Write API failing tests for status/no readback, save/replace/remove, oversized/unknown body/provider, rejected origin, missing/incorrect token, Keychain denied, no secret echoes.
- [ ] Run targeted Rust tests and capture failure from unimplemented endpoint.
- [ ] Implement routes, strictly typed validation, limits, origin/token checks and redacted safe errors; avoid logging key material.
- [ ] Run targeted suite and backend tests.

### Task 3: React Settings integration

**Files:**
- Create: `apps/web/src/lib/api/provider-credentials.ts`, `apps/web/src/app/provider-connections.tsx`
- Modify: `apps/web/src/app/catalog-workspace.tsx`, `apps/web/vite.config.ts`
- Test: `apps/web/src/app/provider-connections.test.tsx`, `apps/web/src/lib/api/provider-credentials.test.ts`

**Interfaces:**
- `loadConnections`, `saveYoutubeKey`, `deleteYoutubeKey` typed API functions; security token held only in component memory.
- `<ProviderConnections locale={locale}/>` in existing Settings screen; full label/button/status in English and Japanese, password-only input.

- [ ] Write failing component/API tests for masked entry, server status, save/clear, remove, unavailable/denied errors, local-only requests.
- [ ] Run targeted Vitest tests, inspect the expected failure.
- [ ] Implement component, API adapter, exact `/api/settings` Vite proxy to Rust 8787 and Settings integration.
- [ ] Run targeted Vitest tests, then frontend typecheck/test/build.

### Task 4: Integration verification and documentation

**Files:**
- Modify: `README.md`, `apps/web/README.md`, `docs/02-runtime.md`

- [ ] Document Keychain name, key status semantics, env precedence, lack of saved-key readback, Mac test procedure, Linux CI limitation and security boundary.
- [ ] Run `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace` and project frontend checks; report failures honestly.
- [ ] Verify no secret literals in app storage/export paths, no requests to Google in tests, no unrelated file changes; report macOS live validation as pending if runner is Linux.
