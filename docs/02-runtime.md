# Providers, durable workflows and local development

## Replaceable capability contract

Rust service modules depend on async traits such as `TextGenerate`, `StructuredGenerate`, `ToolCall`, `VisionAnalyze`, `ImageGenerate`, `Speak`, `Transcribe`, `Embed`, `Search`, `SeoObserve`, `RenderGraphic`, `RenderVideo`, `CaptureDemo`, `PublishDraft`. A provider declares `{id, version, capabilities, modalities, context/max_output, supported_languages, estimated_ram, license, cost_class, health}`. Selection is by capability, not model name; store the exact provider/model/quant/prompt and adapter versions with every result. Unavailable providers return typed `Unavailable` and display setup instructions; never fake success.

**Request envelope** (illustrative, not a vendor API):

```json
{"schema":"task/v1","id":"t01","capability":"structured_generate",
 "input_artifacts":["sha256:..."],"parameters":{"schema_ref":"article-outline/v1","locale":"en"},
 "provider_profile":"local-qwen","deadline_ms":180000,"budget":{"max_external_usd":0}}
```

Result: `status`, typed artifact references/validated structured output, usage (if measured), diagnostics, model/seed/params, timestamps, license/provenance metadata and retry classification. Never deserialize arbitrary untrusted provider output without schema validation. A subprocess adapter uses structured JSON on stdin/stdout or verified API, argument arrays (not `sh -c`), timeouts, owned process groups, stdout limits and sanitized logs. Never infer Magnitude's runtime endpoint from `opencode --model`; verify its supported inference protocol. `examples/provider-profiles.json` contains **illustrative** profiles.

## Speech, audio and render capability contract

The broad legacy Speak/RenderVideo names should be interpreted as facade capabilities, **not a dependency on Qwen, Fish Audio, Motion Canvas or one mixer**. Add versioned SpeechSynthesize, SpeechAlign, AudioMix, AudioAnalyze, SoundResolve and KumikiRenderAdapter interfaces as defined in [13](13-audio-production.md) and [14](14-kumiki-integration.md). Store a logical VoiceProfile with provider mappings, audition/rights/version status. Provider substitution invalidates duration/alignment dependent visual events and audio, never silently assumes equivalent voice identity.

Remote TTS (including a no-cost API) requires explicit scoped network access, rate/budget controls, current commercial output rights and redactable logs. Offline/mock and imported-audio paths remain functional when the preferred provider is unavailable.

**Persistence note:** the additive [creative-production fixture](../examples/creative-production.sql) defines the relational pointers between logical voice revisions/provider mappings, source-true sample timings, audio mixes, Kumiki scene documents, output profiles and frozen video releases. Do not store provider credentials in SQLite or use this SQL fixture as an automatic production migration. See [data ownership](03-data.md).

## Durable DAG scheduler

- `Workflow`: versioned DAG of steps, immutable input IDs and output artifact references, typed dependencies, approval gates, resource claims, retry policy. Reject cycles before enqueue.
- Step: `PENDING → READY → RUNNING → SUCCEEDED | FAILED | CANCELLED`; `FAILED → READY` only through bounded retry. Approval pauses at a declared gate. Job: `QUEUED/RUNNING/PAUSED/WAITING_FOR_APPROVAL/SUCCEEDED/FAILED/CANCELLED`.
- Persist attempt, heartbeat/lease, checkpoint, idempotency key and timestamps. On restart reconcile orphaned `RUNNING`, rather than marking it complete. Remote publishing/paid actions use durable deduplication keys to prevent double writes.
- Retry transient errors with bounded exponential backoff; terminal errors (invalid scene, policy/rights denial) require correction. QA remediation defaults to **two** focused attempts, then human inspection; rerun only the changed section/scene and downstream dependents.
- Fingerprint cache keys from task implementation version, approved input bytes/IDs, schema and prompt version, model/quant/config/seed, locale, brand tokens, asset/font hashes, render/tool version and access rights. Research snapshots and published products are **durable evidence**, not eviction candidates.
- Cancellation propagates to child workers; terminate owned processes only, clean owned disposable temp space after checkpoint. Show stage progress, actual counts, last activity, retry reason and conditional ETA; never invent percentages.
- Scheduled runs via `launchd` or equivalent must handle sleep/missed runs/idempotency and trigger *draft preparation*, never automatic publication.

## Practical workstation budget

Target: **M4 / 24 GB unified RAM / finite SSD**. Default one heavyweight model and one heavy render (prefer sequential), bounded browser contexts, no background model preloads, model weights in one configurable shared directory. Require approval before >250 MB downloads; warn on expected temp and final output footprint.

| Data | Rule |
|---|---|
| Model weights | Shared cache outside repository; never duplicate per project |
| `target/` | One workspace, ignored; explicit cleanup only |
| Node dependencies | One package manager/lockfile; avoid parallel trees |
| Frames/temp audio | Per-job owned scratch dir, TTL, size cap; clean only after verified render |
| Research source snapshots | Durable, hashed, versioned; rights and retention respected |
| Approved assets/releases | Never cache-evict or delete implicitly |
| Network provider results | Mark freshness/date/cost; no silent refresh with charges |

**Cargo starting profile** (adjust after benchmarking):

```toml
[profile.dev]
debug = 0
incremental = false
[profile.test]
debug = 0
incremental = false
[profile.release]
strip = "symbols"
```

This trades incremental build speed for lower disk use. Enforce `.gitignore` for `target`, `node_modules`, local DB, models, outputs and temp. Before/after major builds report `du -sh target node_modules data outputs 2>/dev/null`; show model-cache sizes separately. Prefer feature-gated Rust crates and external worker binaries over linking heavyweight ML engines into backend.

## Local developer contract

1. Use Rust stable, Cargo, Node LTS and one JS package manager; install optional tools only for the corresponding milestone. Document exact supported versions in lockfiles.
2. Expected commands **after bootstrapping**: `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, frontend `typecheck/test/build`, and Playwright for UI/media-specific changes. Don't claim these commands exist before scaffolding.
3. Bind Axum to `127.0.0.1` by default; constrain CORS/origins, validate inputs, cap upload/request sizes. Put secrets in OS keychain or ignored configuration, never project manifests.
4. Test with lightweight deterministic/mock providers in CI; separate opt-in integration suite checks installed local inference, graphics, speech and media binaries. Failure messages must explain configuration and alternatives.

**Core workflows:** `research.import/search/refresh`, `seo.observe`, `article.generate`, `graphic.render`, `thumbnail.render`, `script/storyboard`, `speech.synthesize`, `video.render/qa`, `character.pose/animate`, `demo.capture`, `course.package`, `publish.prepare`. Every workflow may be run without an optional provider when a deterministic/manual fallback exists.

### Local YouTube collector runtime

`contentgen-server` starts one in-process YouTube market worker, not an OS daemon or scheduled cloud job. Both manual and scheduled collection resolve the YouTube key freshly from macOS Keychain (generic password service `com.contentgen.local.credentials`, account `youtube-data-api-v3`) or the `CONTENTGEN_YOUTUBE_API_KEY` process environment. Keychain takes precedence; an absent item falls back to the environment, but permission denial fails closed. Linux/other OSes cannot persist a key to insecure storage and may only use the existing environment fallback. No secret is written to SQLite, returned by the Settings API, placed in the browser catalog, or included in exports. Saving never invokes YouTube.

The local-only `GET /api/settings/providers` endpoint exposes provider status, while `GET /api/settings/session` issues a short-lived, single-use CSRF token for `PUT`/`DELETE /api/settings/providers/youtube/key`. Mutation requests must originate from the exact trusted browser origin, with a matching loopback Host and `X-Contentgen-Settings` token; responses are `no-store` and no permissive CORS is enabled. The Vite proxy forwards `/api/settings` to Rust port 8787. Default accepted origins are `http://127.0.0.1:5173` and the Rust direct origin `http://127.0.0.1:8787` (or the exact `localhost` equivalents). If the Studio uses another loopback port, start the backend with `CONTENTGEN_STUDIO_ORIGIN=http://127.0.0.1:<port>` set to the exact value. Do not bind the Rust service to a non-loopback interface.

The collector skips remote work without a key and without explicitly enabled watchlists, and stops with the server. On restart it reconciles interrupted runs and expires observations. Watchlist changes and manual collection require a local-only header; the server binds to loopback. The Vite dev proxy routes `/api/research/market` to Rust port 8787 before the broader `/api/research` prefix goes to the separate evidence service on port 8788. The backend uses SQLite for the search-call reservation and dated 30-day observations. Provider response errors are sanitized, and tests use local fixtures rather than live YouTube calls.

**Mac verification before release:** On macOS, run `cargo test --workspace` and `pnpm --dir apps/web test && pnpm --dir apps/web build`; start both local services, save a disposable YouTube key, confirm the generic password item in Keychain Access, restart ContentGen and confirm status remains `keychain`, replace it without restarting, then remove it and confirm fallback/status. Never paste a real key into logs or screenshots. Cross-compiling the Keychain adapter from Linux is not a substitute for this test.
