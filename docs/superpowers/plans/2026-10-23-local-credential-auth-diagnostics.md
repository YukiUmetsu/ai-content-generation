# Local Credential Authorization Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Explain exactly why a ContentGen credential write returns HTTP 403, in backend stderr, without exposing any credential or token values.

**Architecture:** Preserve generic client-visible errors and all authorization behavior. An internal enum supplies only fixed diagnostic codes to a single logger/rejection helper. The existing Rust Settings endpoints use the helper at each guard and when Keychain operations fail.

**Tech Stack:** Rust, Axum, existing integration/unit tests; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-23-local-credential-auth-diagnostics-design.md`

## Global Constraints

- The Settings UI is outside this change; another agent is modifying it.
- Never print API keys, session tokens, raw request headers, request bodies, or raw Keychain errors.
- No new dependencies and no change to HTTP status/body, token consumption, or security guards.
- Preserve all unrelated dirty files in the shared checkout.

## Review Focus

- Missing Host header must be logged as a distinct reason, without reflecting the request.
- Untrusted Host must remain forbidden even with a well-formed Origin.
- Mismatched Origin and missing Origin must have different reasons on mutation.
- Missing token and invalid/expired/replayed token must have different reasons.
- Keychain Denied/Unavailable and miscellaneous errors must be distinguishable while HTTP mapping remains unchanged.

---

### Task 1: Safe server-side diagnostic reasons

**Files:**
- Modify: `crates/server/src/settings.rs` (static rejection enum, formatting/logger, guard call sites, Keychain failure logging)
- Test: `crates/server/src/settings.rs` (`#[cfg(test)]` module for diagnostic codes and privacy invariants)
- Test: `crates/server/tests/settings_api.rs` (HTTP behavior for all branch cases remains generic)

**Interfaces:**
- Consumes: existing `trusted_origin`, `require_mutation`, `credential_error`, `ApiError`, and `HeaderMap`.
- Produces: internal `AuthRejectionReason::code() -> &'static str`; `reject(operation: &'static str, reason: AuthRejectionReason) -> ApiError` that logs then calls existing `forbidden()`; `credential_error(error, operation)` keeps HTTP mapping and logs only fixed categories.

- [ ] **Step 1: Write failing tests** asserting each static diagnostic code for the listed guards, that diagnostic formatting is wholly fixed text (no caller-supplied secret), and that the HTTP response remains the existing 403 error for wrong Host/Origin/token.
- [ ] **Step 2: Run** `cargo test -p contentgen-server --lib settings::tests` and `cargo test -p contentgen-server --test settings_api`; verify the new assertion fails against the old behavior.
- [ ] **Step 3: Implement** `AuthRejectionReason` and `reject` with fixed operation identifiers (`provider_status`, `issue_session`, `save_youtube_key`, `delete_youtube_key`); distinguish missing/malformed vs untrusted Host, mismatched vs absent Origin, missing vs rejected token; log fixed categories on Keychain failure.
- [ ] **Step 4: Re-run** targeted tests; expect all pass and no Keychain access or new external calls.
- [ ] **Step 5: Verify** `cargo fmt --check`, `cargo clippy -p contentgen-server --all-targets -- -D warnings`, `cargo test --workspace` (report any failures); verify only intended files differ.
- [ ] **Step 6: Open one focused PR** touching only the diagnostic implementation and tests (plus these two docs), with failure cases and instructions to retry saving then examine backend stderr.
