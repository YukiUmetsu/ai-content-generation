# Local-first ContentGen and provider credentials — design

Date: 2026-10-23
Status: **Approved by owner; YouTube Keychain slice implemented pending macOS runtime verification**

## Intent and decision

ContentGen is initially a **single-user, local-first creative application**, optimized for the owner's Apple Silicon Mac and local inference/rendering. It may become a distributable desktop app later. The user selected **OS Keychain** for API credentials; hosted multi-user SaaS and cloud rendering are not current goals.

Keep the existing React Studio, Rust/Axum + SQLite service, model adapters, and local Chromium/FFmpeg pipeline. A future Tauri v2 window can host the same React UI and start or supervise the backend/workers. The desktop shell is a separate milestone: do not derail current Research and Packaging repairs to introduce it now.

## Approaches considered

1. **Hosted website with cloud workers:** easiest remote access and central updates, but uploads, renderer hosting, local-model access, multi-user security, and recurring GPU costs are unwelcome now.
2. **Rewrite the product as a native/Tauri desktop app immediately:** good integration with filesystem and native secrets but disruptive to the existing web-preview, Rust server, and active video pipeline.
3. **Selected — local app with existing web UI, then a thin Tauri shell:** reuse the working UI/backend and introduce native integration behind explicit adapter boundaries, one tested slice at a time. Accept temporary localhost development infrastructure until bundling is ready.

## Current state to preserve

- Rust `contentgen-server` binds to `127.0.0.1:8787` and its YouTube collector reads `CONTENTGEN_YOUTUBE_API_KEY` directly from the process environment in the manual and scheduled execution paths.
- Vite runs the React Studio and proxies Research, Jobs and Creative to separate loopback ports; this is a development setup, not a secure desktop packaging design.
- The Fish Audio local studio currently accepts an ephemeral password-field key or environment key. It must not be claimed to use persistent Keychain storage until that worker is actually wired to the credential adapter.
- The Research workspace is dense and the Packaging panel calls an unfinished endpoint. Those are separate vertical-slice changes, not prerequisites for Keychain support.
- Several Research/YouTube/Studio files are already modified in the shared worktree. Preserve others' changes and avoid editing conflicting files concurrently.

## Scope of the first vertical slice: YouTube API key in Keychain

### User experience

- Add a **Settings → Provider connections** screen/entry that works from the existing local React Studio.
- The YouTube Data API card shows one of: Not configured, Stored in Keychain, Provided by environment, Secure storage unavailable, or Error accessing Keychain.
- Paste into a password input, **Save**, **Replace**, or **Remove**. Clear input immediately after success or cancellation and never display the saved key or its prefix/suffix.
- Existing env-var setup remains a documented non-persistent fallback. Keychain takes precedence when both are present; removing the Keychain item reveals the still-configured environment fallback rather than pretending all access was removed.
- Do not silently test a key by making a chargeable/quota-consuming provider request. A separately initiated connection check, if added, requires a budget/usage notice.
- Other provider rows (including Fish Audio) should appear only when their runtime can actually load the stored key; no misleading fully-functional connection controls.

### Credential boundary

- Rust owns the credential interface, with provider IDs allowlisted rather than arbitrary service/account strings. On macOS it uses the **native Apple Keychain generic-password API**. One namespaced service and per-provider account prevent collisions. Other OSes must use an equally secure OS credential store in a later implementation, otherwise report `secure_storage_unavailable`; **never fall back to plaintext SQLite, a `.env` file, `localStorage`, or generic persistent Tauri Store**.
- `GET /api/settings/providers` returns only provider ID, configured status, source, and a sanitized error category. It **never** returns the key.
- `PUT /api/settings/providers/youtube/key` accepts a bounded JSON body containing the new key; `DELETE` removes the native item. No reveal/readback route or key export. Restrict request bodies, reject unknown fields/providers, avoid recording the body, mark all responses `Cache-Control: no-store`.
- Secret mutations require trusted local origin, non-simple custom header plus a session-bound anti-CSRF token or equivalent desktop-native authorization. Do not treat an easily forged static `local-only` header as authentication. Backend remains strictly loopback-bound; do not enable permissive CORS or `0.0.0.0` binding.
- Validate browser `Origin` and `Host` precisely, accounting for configured Vite development origin, without accepting arbitrary `localhost`/subdomain strings. Future Tauri callers may use native command permissions rather than browser HTTP credentials.
- No secrets in response JSON, logs, errors, telemetry, persisted jobs, research artifacts, screenshots, Git, command arguments, or URL query strings. Scrub accidental provider error bodies; do not print input values from tests.
- An OS login or Keychain permission denial must produce a recoverable, specific UI error; never overwrite the previously stored item if replacement fails.
- A compromised same-user OS process is outside the guarantee: Keychain protects data at rest and access under OS policy, not against every local attacker while the user is logged in.

### Runtime integration

- Abstract `CredentialStore` behind a Rust interface injectable in tests. Both **manual YouTube collection** (`market_api::collect`) and **background collector** (`market_worker`) resolve a fresh client from the same credential source; the status endpoint must report that same effective source.
- Maintain compatibility with `CONTENTGEN_YOUTUBE_API_KEY` in the environment without importing it into Keychain silently. Loading a key from the OS should not require restarting the backend.
- Do not put the key in SQLite. No migration should be necessary for the first slice.
- Fish Audio credential persistence is a **separate** vertical slice: its current Node worker must be connected through an authenticated local service/IPC or future Tauri supervisor so a secret is never exposed via an unauthenticated HTTP read endpoint.

## Later, separate slices (not hidden inside this implementation)

1. **Packaging:** Vite currently forwards `/api/creative` to port 8789 while the Rust 8787 route returns `501`. Implement a real backend fetch of persisted sets, route it to the correct process, and show a genuine empty state when no set exists. Never present illustrative fixture data as a user's hypothesis set. Authoring three distinct, source-grounded title/thumbnail/hook hypotheses is a further workflow slice with its own acceptance tests.
2. **Research UX:** reorganize dense Evidence/YouTube/Storyboard controls into Discover → Research → Create, with one topic action, progressive disclosure, clear evidence status, source review, and useful storyboard preview. Preserve existing researched-storyboard and market contracts; test responsive, keyboard, English/Japanese and failure states.
3. **Tauri packaging:** wrap the existing frontend/Rust backend, supervise owned worker processes, use OS storage/filesystem capabilities, and remove unnecessary dev ports in production. Verify bundled Chromium/FFmpeg/licensing/signing and recoverable background jobs before claiming a distributable app. No Tauri scaffolding in the Keychain slice.

## Acceptance criteria and risk controls for the first slice

- A saved YouTube key survives app/backend restart, never appears in GET/status responses, and powers both manual and scheduled collection **only after the user enabled that watchlist**.
- A replaced key takes effect without restart; deleting it removes the Keychain item and uses only an explicitly configured env fallback.
- Malformed input, unknown provider, oversized key, untrusted origin, missing mutation authorization, denied Keychain access, and unavailable platform all fail safely with no secret echo. Failed replacement preserves the old entry.
- Frontend tests exercise masked input, save/retry/delete status, keyboard and locale paths; Rust tests use a fake credential store and exercise both worker/manual lookup plus failure/redaction.
- On actual macOS, manually verify native Keychain persistence, restart behavior and removal. In Linux CI, test the adapter boundary, not a fake claim that Apple Keychain ran.
- Run targeted Rust and frontend checks plus available repo QA. No external YouTube or Fish calls during tests unless explicitly opted in by the user.

## Owner choices and non-goals

- **Decided by user:** local-first app, local AI, OS Keychain; no immediate cloud/SaaS requirement.
- **Proposed by builder:** macOS-first Keychain, YouTube provider as the first complete vertical slice, env fallback, existing React/Axum architecture, Tauri later.
- **Non-goals:** multi-user accounts, cloud sync of secrets, auto-publishing, uploading private models/voice samples, password reveal, full Tauri distribution, a generalized credentials marketplace, or bundling Research/Packaging rewrites into the same first implementation PR.

## References

- Apple's Keychain guidance: https://developer.apple.com/documentation/security/using-the-keychain-to-manage-user-secrets
- Tauri v2 architecture and external binaries: https://v2.tauri.app/concept/architecture/ and https://v2.tauri.app/develop/sidecar/
- OWASP CSRF guidance: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- Project owners: `AGENTS.md`, `docs/01-system.md`, `docs/02-runtime.md`, `docs/03-data.md`, `docs/07-experience.md`, `docs/08-assurance.md`.
