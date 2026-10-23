# Local credential authorization diagnostics

**Decision (2026-10-23):** Backend-only, privacy-safe diagnostic logging for ContentGen's local credential endpoints. The user approved this option; the Settings UI is owned by a separate ongoing effort.

## Intent

The current YouTube-key save operation returns the same generic 403 whether the request has an untrusted Host, a missing/mismatched Origin, or a missing/expired/replayed one-time settings token. The 403 response should remain generic, but the local backend console should identify the failing guard so the developer can repair the proxy/session flow.

## Scope and constraints

- Log only fixed, enumerated `operation` and `reason` values at the relevant authorization rejection points (Host, Origin, session token) and Keychain operation failures. Include warnings for blocked requests and errors for storage failures.
- Never log credential values, request bodies, session tokens, arbitrary header values, raw provider errors, or secret lengths. No logging on successful key saves is required.
- Preserve all HTTP status codes, response bodies, single-use session semantics, same-origin protections, and Keychain behavior. The client UI remains unchanged.
- Cover distinguishable failure reasons, unchanged generic responses, and safe diagnostics in tests. Do not require actual Keychain access.
- Do not change unrelated work in the shared checkout or install dependencies.

## Approaches considered

1. **Backend-only reason-coded logging — selected.** Easy to inspect from the local Rust server's stderr; avoids leaking guard details to arbitrary requesters and does not overlap the Settings UI agent.
2. Backend logging plus detailed frontend errors. More actionable in the app, but requires broader UI edits and exposes extra authorization metadata to callers.

## Implementation direction

Add an internal typed `AuthRejectionReason` (static reason codes) in `crates/server/src/settings.rs`; a small rejection helper formats and emits the fixed diagnostic and returns the existing generic error. Pass fixed operation names through the Host/Origin and mutation guards. Log mapped Keychain failure categories without displaying the OS error. Add targeted tests in the same module for codes and response invariants, supplementing existing integration tests.
