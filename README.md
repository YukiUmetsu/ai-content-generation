# ContentGen — local AI content studio specification

Build a **local-first, research-driven content production studio**: accumulate evidence and SEO intelligence; create and edit articles, graphics, thumbnails, explainer videos, courses, characters, and sellable content packages; verify quality; publish only after approval. The goal is *finished, trustworthy content*, not maximum AI output.

**Target:** Apple Silicon M4, 24 GB unified memory. **Backend:** Rust/Axum/SQLite. **UI:** React/TypeScript. **Default development agent:** `opencode --model magnitude/qwen3.6-35b-a3b:gguf:q2`. **Runtime model:** configured through adapters, not OpenCode itself. All cloud providers and heavyweight media engines are optional.

Replace the previous `docs/` directory rather than merging both versions; obsolete pages would provide conflicting instructions. Preserve any project-specific notes or actual migrations separately.

Start with [AGENTS.md](AGENTS.md) → [docs/INDEX.md](docs/INDEX.md) → the current milestone in [docs/10-build-plan.md](docs/10-build-plan.md). The domain/backend specification is not yet implemented; the shared frontend foundation is runnable in [`apps/web`](apps/web/README.md).

## First OpenCode task

```text
Read AGENTS.md, docs/INDEX.md, docs/01-system.md, docs/02-runtime.md,
docs/03-data.md and docs/10-build-plan.md. Implement milestone A only.
Do not auto-install large models, paid providers or video engines. Show
actual test/build results, disk usage, known limitations and next steps.
```

## Video-first vertical slice and Brand Studio

The target video workflow is **approved BrandKit → researched script/semantic beats → provider-neutral narration (Fish Audio or local/imported) → alignment + rights-checked SFX/music → Kumiki-UI compositions → offline FFmpeg mastering/encoding → QA → approved multi-platform packages**. Branding is repeatable but not generic: use semantic color, fonts, camera language, narration persona, SFX grammar and platform-specific composition. Video-first milestone track is specified in [build plan](docs/10-build-plan.md); full article/research product scope remains available.

Owners: [12 — Brand Studio](docs/12-brand-studio.md), [13 — Audio production](docs/13-audio-production.md), [14 — Kumiki integration](docs/14-kumiki-integration.md). These are **specifications/fixtures, not claims of implemented ContentGen services**.

## Opt-in YouTube niche monitoring (local server)

Studio **Research → YouTube Intelligence** supports local niche watchlists and public-video observations from the official YouTube Data API. The collector runs **only while `contentgen-server` is running**: there is no background cloud cron, and it stops when the server exits.

1. Create your own YouTube Data API v3 key in Google Cloud. Enable that API for the key's project. Check Google's current quota and terms for your project.
2. Start the Rust service with `cargo run -p contentgen-server` and in another terminal run `pnpm --dir apps/web dev`. On macOS, open Studio → **Settings → API connections & secure credentials**, paste the key, and select **Save to Keychain**. No restart is required. The key cannot be read back or included in browser/catalog backups.
   - Alternatively, pass `CONTENTGEN_YOUTUBE_API_KEY` in the server process environment (never check it into Git). The macOS Keychain value takes precedence if both are present; removing it restores the environment fallback.
   - On non-macOS platforms, native secure credential writes are not yet supported. Use the process environment as a temporary non-persistent fallback; ContentGen never silently saves to SQLite or browser storage.
3. Open Studio → **Research → YouTube Intelligence**. Add a niche and search phrase, and explicitly enable collection. Existing Research evidence continues using its separate service; the market API goes to the Rust server on port 8787.
4. Wait for the next local collector tick (up to about a minute) or choose **Collect now**. Review the observed title, public view count, channel, publication date, source link, and observation timestamp. **Use for video** opens an editable *original* idea saved in the Content catalog; it does not copy the source script or its metrics.

The API key remains server-side. The feature defaults to disabled watchlists, limits enabled niches to ten and API searches to twenty in a rolling 24 hours, and expires cached API observations after thirty days. Missing API key means no external calls; shutting down the server means no scheduled collection. YouTube search requests and metadata lookups still consume the quota assigned by Google. Saving a key does **not** call Google or consume quota. This is **not** a source of keyword search-volume, audience retention, CTR, advertiser RPM, or predicted video earnings. Public metadata belongs to its source, not to ContentGen; respect YouTube's current API policies.

## Non-negotiables

- Durable **source snapshots, passage citations and dated SEO metrics** precede semantic summarization; no fabricated citations, features, keyword volumes or test results.
- **Model/tool independence:** typed capability adapters, checkpointed jobs, deterministic layout and rights checks, and a full offline fallback for basic workflows.
- **Editable source of truth:** retain structured article, scene, timeline, character and product-revision specifications; exports are derived artifacts.
- **Approval/rights boundaries:** no unapproved remote publish, paid call, voice cloning, private-data upload or destructive cache cleanup.
- **Measured craftsmanship:** readable UI/content, purposeful motion, excellent margins/typography, accessibility, real rendered-output QA, coherent brand identities.
- **Resource limits:** sequential heavy models by default; avoid duplicate weights, huge Cargo caches and retained raw video frames.

Detailed schema fixtures and provider examples live in [`examples/`](examples/). Verify API, licensing, platform compatibility and price before integrating any external project.
