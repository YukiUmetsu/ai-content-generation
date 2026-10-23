# ContentGen Studio — shared frontend foundation

React 19 + TypeScript + Vite 8 + Tailwind CSS v4 + a pinned, source-vendored
[Kumiki-UI](https://github.com/YukiUmetsu/kumiki-ui) registry.

This app is the **shared application shell and creative-workbench foundation**.
Its headless video-production scripts are separate from the interactive workbench. The
five feature slots are independently owned: **Brand & appearance** and **Motion
& media lab** are working examples; thumbnail, storyboard and platform delivery
remain integration slots. The shell, split pane, preview canvas, inspector,
appearance/density axes and error boundary are provided.

## Headless video production (draft MP4 pipeline)

The headless command now connects automatic Fish Audio or local-loopback narration to sample-accurate scene timing, SFX, a Kumiki frame-export scene, bounded browser capture, FFmpeg encoding/muxing, and a measured QA report. **This is an automated *draft*, not a published or commercially approved video.** The example House Math jobs are hypothetical and test-only; neither a live Fish API request nor real browser playback has been verified by CI.

### Easiest way to try it on your Mac

With Node >=22.12, pnpm, FFmpeg/FFprobe and an already-installed Chrome/Chromium-compatible browser:

```bash
cd apps/web
pnpm install --frozen-lockfile  # one time
pnpm video:studio
```

Open **http://127.0.0.1:8790** (change with `CONTENTGEN_STUDIO_PORT=8791 pnpm video:studio` if needed). The **local Video Test Studio** offers a complete browser test path:

1. Choose **Quick smoke test** (3 beats, ~30–60 seconds), **Long-form YouTube** (26 beats, at least 8 measured minutes), or **Your own topic**. For a custom topic, enter its question, intended audience, optional notes, and an installed local text-model endpoint; click **Generate local draft**.
   The model proposes three alternate titles/hooks and writes an editable, scene-by-scene narrated story. Review its `job.json` in the editor and **Save draft edits** before testing. The model's statements are explicitly **unverified**, not invented citations or commercial-ready claims. For custom long-form, the model must produce a substantive script and the finished narration must still measure at least eight minutes.
2. Select **Fish Audio API** or your own installed **local TTS bridge**. Enter an authorized voice reference and, for Fish, an API key (or set `FISH_AUDIO_API_KEY` in the launching terminal). The Fish model is fixed to the test-only `s2.1-pro-free` ID; paid models cannot be selected.
3. Check the voice permissions and click **Check readiness**. The studio builds the export scene and checks dependencies/browser/consent **without any TTS request**. Read actionable findings if blocked.
4. Click **Render test video** and confirm this specific run. Watch real worker stages and completed verified frame batches, or cancel. Then play the real MP4, audition voice/master audio, check review stills, and download captions, render manifest and QA report. The job-owned output directory is displayed below the player.

No arbitrary file paths, online publishing, model downloads or commercial approval are exposed. The local topic generator sends the brief only to an **already running OpenAI-compatible text server on loopback** such as `http://127.0.0.1:11434/v1/chat/completions`; it never silently uses a cloud model. Topic generation alone does not call Fish Audio or render a video. The server only listens on `127.0.0.1`, requires a local token for changes/artifact downloads, does not persist credentials and creates unique directories under `~/Movies/ContentGen/`. Close the studio with Ctrl-C. Run a long-form test only after the smoke test succeeds and you have adequate time/disk space; 8 minutes at 30 fps requires **at least 14,400 frames** and can take a long time to capture.

### Topic-only terminal command

For scripting or debugging without opening the Studio, start your own local OpenAI-compatible text server with the model already installed and run:

```bash
cd apps/web
pnpm video:topic -- --topic "How does a refrigerator move heat?" \
  --audience "Curious homeowners" --mode smoke \
  --model your-installed-model-name --out ../../outputs/refrigerator-draft.json
```

The command writes a unique **test-only, editable `video-production-job/v1` draft**; it does not fetch sources, call a voice provider, render, or publish. Run `pnpm video:topic -- --help` for local endpoint, audience, language and long-form options. The generator supports English and Japanese and enforces substantive narration limits; actual duration is still checked using measured generated audio before export.

### Terminal alternative

```bash
cd apps/web
pnpm video:try
```

This guided terminal command automatically detects Chrome in standard macOS locations, builds the export page, takes an **authorized Fish voice ID**, and reads a Fish API key from `FISH_AUDIO_API_KEY` or a **hidden** terminal prompt. It asks for voice/text-transmission authorization, checks media tools and the scene build, and **asks again before generating narration or calling Fish Audio**. Press Enter (default No) at the render question to stop safely after preflight. It generates a fresh job-owned directory in `~/Movies/ContentGen/smoke-...`, containing the complete `job.json` and, if production succeeds, `release/video.mp4` and the QA artifacts. It never modifies the checked-in example. Fish `s2.1-pro-free` is evaluation-only until availability and commercial terms are checked.

Use `pnpm video:try -- --dry-run` to check readiness without any TTS request or video output; it still builds the local scene and prompts for authorization. For a configured local bridge, use `pnpm video:try -- --provider local` and provide `CONTENTGEN_LOCAL_VOICE_ID`, `CONTENTGEN_LOCAL_MODEL_ID`, `CONTENTGEN_LOCAL_ENGINE_VERSION`, and optionally `CONTENTGEN_LOCAL_ENDPOINT`. The underlying `pnpm video:produce` remains available for fully scripted runs. No browser, model or dependency is automatically downloaded by the guide.

Prerequisites: Node `>=22.12`, pnpm, FFmpeg/FFprobe, the production `apps/web/dist` build, an **already installed** Chrome/Chromium executable, and `playwright-core` (installed from this app's pinned pnpm lockfile; it does not download a browser). Supply your own permitted voice reference and TTS service. Run on an explicitly chosen, job-owned directory with sufficient disk space; ~8-minute 1080p videos require lengthy frame capture.

```bash
cd apps/web
pnpm install --frozen-lockfile
pnpm build
pnpm test:video:headless

# In the job JSON, replace the placeholder voiceId with an authorized ID.
# Set FISH_AUDIO_API_KEY and CONTENTGEN_CHROMIUM_EXECUTABLE in your local environment.
pnpm video:produce -- \
  --job ../../examples/video-production-house-math-smoke.json \
  --provider fish --provider-revision fish-api-v1 --out ../../outputs/house-math-smoke \
  --allow-network --voice-consent --transmit-text --allow-test-assets --dry-run

# Remove --dry-run only after reviewing the preflight findings and permissions.
# Output: <out>/release/video.mp4, master.wav, voice.wav, captions.srt,
# stills/frame-NNNNNN.png, render-manifest.json and qa-report.json.
```

For long-form production start from `../../examples/video-production-house-math-long.json`: its 26 script beats target at least **480 measured seconds**, not a rough word-count duration. Both the scene compiler and QA gate enforce the larger of the eight-minute baseline and the job's `destination.minimumDurationSeconds` using actual synthesized audio. Short-form jobs and portrait rendering remain future work, with **no forced 30–60-second length** for shorts. The first renderer accepts YouTube landscape only.

`--dry-run` is side-effect-free: it checks consent, credentials' **presence**, local FFmpeg/FFprobe, the built export scene, an executable Chromium path and installed browser driver, voice/rights metadata and budget policy without calling providers, launching a browser, starting a server, or producing media. A real production run goes further: it **launches Chromium and verifies the built scene before any narration requests**. For Fish, the video orchestrator currently accepts **only the `s2.1-pro-free` model ID**, and makes no guarantee that the provider offers unlimited free use or commercial licensing. Paid models are blocked because per-job usage metering is not yet implemented; paid-use approval flags alone cannot override that. Never commit `FISH_AUDIO_API_KEY` or an unlicensed voice reference.

For user-installed **local TTS**, change the job voice to `provider: "local"`, an authorized voice and a local model/engine revision; supply `endpoint: "http://127.0.0.1:8765"`. Run with `--provider local --provider-revision <actual-engine-version> --local-voice-authorized` and omit Fish-only network flags. Use `--local-endpoint http://127.0.0.1:8765` only if you need to override the job endpoint. No model is downloaded, installed, or activated by this CLI.

Each release is atomically exposed only after a finished MP4 has been probed for FPS, dimensions, frame count, duration drift, loudness and required story payoff. The release also contains up to four **raster-checked, SHA-verified review stills** (opening, middle, shortly after payoff, end); they are saved separately from bounded render batches and checked again when resuming. The render manifest records the hashed compiled scene, per-beat narration hashes and provider revisions, and SHA-256 hashes of the delivered media. A changed JS/CSS/font build invalidates render-segment reuse; scene typography has a deterministic fit pass and a real-browser text-bounds check. These stills help triage but are **not** a substitute for watching the film. Ctrl-C/SIGTERM requests graceful cancellation and staging cleanup; failed captures preserve per-beat caches and hashed render segments for safe resumption, without overwriting any prior `release/`. Every successful run still reports `commercialReady: false` and requires normal-speed audio/video inspection plus explicit commercial-asset/voice licensing review before any publication.

### Narration adapters (opt-in, currently offline-tested only)

- **Fish Audio:** supply `FISH_AUDIO_API_KEY` at runtime, an authorized voice-reference ID, locale, and explicit model. The adapter uses `POST https://api.fish.audio/v1/tts`, a versioned request with `model: s2.1-pro-free` for evaluation, and checks WAV bytes. No API call occurs without `--allow-network` and voice/text-transmission consent. The standalone adapter accepts paid models with explicit approval, but the multi-beat production CLI blocks them until reliable budget metering exists. Availability and commercial licensing of any free model or voice must be independently verified before release; no real Fish request has been made during this foundation implementation.
- **Local:** a **user-installed and running** TTS bridge can be configured with a bare loopback origin such as `http://127.0.0.1:8765`. The adapter POSTs to `/v1/speech` with JSON `{schema_version:1,text,locale,voice_id,model_id,direction,format:"wav"}`. The bridge must return 200, mono 16-bit PCM WAV with `Content-Type: audio/wav` and `X-TTS-Engine-Version: <actual engine version>`. No model is installed or started by ContentGen. Redirects and non-loopback endpoints are refused. The caller must confirm local voice authorization; engine/model identity is recorded for future cache isolation. No installed TTS bridge has been verified yet.
- Both adapters expose per-beat generated WAV bytes and fail closed on invalid audio. The CLI consumes them automatically. Web CI runs FFmpeg-free planning tests, frontend tests, lint, typecheck, Kumiki source verification and a production build, **without installing FFmpeg**. Run `pnpm test:video:headless` locally with FFmpeg/FFprobe installed to exercise real audio/encoding/mux tests and injected provider/browser integration tests before reviewing a media release. **A real provider-to-browser end-to-end film has not yet been produced**.

### Measured speech and audio-mastering modules

The independently testable worker modules (`scripts/video-production/{speech,timeline,audio}.mjs`) now generate narration per beat, normalize it through FFmpeg to mono 48 kHz/16-bit PCM, probe the *actual* sample count with FFprobe, and cache by script, provider/engine revision, voice settings, and rights scope. Corrupt cache entries are regenerated; revoked voice authorization still blocks cache use. `buildSampleTimeline` uses half-open sample ranges and rounds to picture frames only at the boundary. Beat-level SRT captions exclude deliberate pauses and never masquerade as word alignment.

`renderMasterAudio` concatenates measured narration with silence, mixes named event-timed effects, masters and measures loudness/true peak, and writes `voice.wav`, `master.wav`, and `captions.srt` to an explicitly chosen directory. The built-in self-authored payoff chime is **test-only** and cannot be treated as licensed commercial sound. A verified local third-party SFX must have an explicit asset path and rights record. Optional background music is not yet implemented; a supplied music request fails explicitly. The speech, mastering, segmented encoding and final MP4 mux each have FFmpeg-backed tests; the orchestration integration test uses an injected provider and browser, so **real visual playback remains unverified**.

### Native 9:16 short videos

Choose **Create your video** in the local Studio and set **Output format** to
YouTube Shorts, Instagram Reels, or TikTok. All three target a **newly authored
1080×1920** general-explainer composition; landscape YouTube remains 1920×1080.
The same authored narration and semantic beats can be compiled into either
output, but each output gets an independent scene layout, not a crop/stretch.
Measured narration drives the existing Fish/local TTS, frame capture, H.264
and artifact QA pipeline.

This milestone pins Kumiki `ShortSafeFrame` (source
`YukiUmetsu/kumiki-ui@f0c227a58227a87004000eb2bb324ea7e298ce8a`,
`registry/visual/safe-frame.ts` +
`registry/visual/short-safe-frame.tsx`) in ContentGen. Its approximate
platform safeInset profiles reserve the app's top/side/bottom UI areas,
while measured SVG text preflight rejects copy outside the safe zone and
cards with clipped labels. Guides never export. Actual platform UI can
change, so manual playback inspection remains mandatory.

Scope: human-authored short-form general videos only (up to 180 seconds
of measured narration); locally model-generated topic videos and House Math
test fixtures retain the existing landscape output. Numerical ChartStory
is explicitly blocked in portrait until its legend/source disclosure is
reflowed and tested; it is not silently omitted. Supports the same opening
hook and title treatment recipes as landscape. This work does not
claim timed-word karaoke, real footage decoding, CapCut-equivalent effects,
or any proven algorithm for virality. Drafts remain unpublished and
commercial rights unverified.

### Manual Studio editing and portable project files

The **Create your video** workspace includes ordered scene cards. Use the up/down
controls to move **middle scenes** while keeping the opening hook and final
answer fixed; duplicate or remove middle scenes (3–40 scene bound), and edit
narration/diagram labels. Any change invalidates the previous readiness check:
click **Create editable storyboard**, review, then **Check readiness** again.

**Export storyboard JSON** saves your local work, including *incomplete*
scenes, to a text file; **Import storyboard JSON** restores it after bounded,
strict schema validation. This is an authored-content-only file—not a raw
production job dump. It does **not** include Fish API keys, voice IDs,
authorization, generated audio, output paths or release claims. Import checks
for unknown fields, unsafe control characters and scene limits before changing
the current editor. Failed imports leave the existing work alone. No cloud
storage, browser localStorage, or automatic uploads are involved. The normal
preflight remains strict: incomplete imported scenes cannot render until
filled in and successfully recompiled.

These controls help with local authoring and versioning; they are not a
visual timeline preview, waveform editor, autosave service, or true
word-synchronized subtitle system.

### General video authoring in Studio (manual, no text model)

Select **Create your video** in the local Video Test Studio. Type a title, question
and audience; add or remove narrated scenes (at least 3), select the visual
treatment for each middle scene, and choose a Kumiki opening/typography recipe.
The first scene is always an opening and the final scene answers the question.
Scene headline, spoken narration, supporting copy and 2–5 specific diagram
labels are authored by the user; ContentGen does **not** invent facts, citations,
figures, dialogue, or new scene copy to fill gaps. Choose English or Japanese,
then click **Create editable storyboard**. You can inspect/edit the resulting
job JSON, run **Check readiness**, and render through the same tested Fish/local
TTS → browser → FFmpeg → QA worker as other jobs. No local text model needed.
The local-AI **Your own topic** flow remains available separately.

Kumiki recipe integration pins the dependency-free pure compiler from upstream
`YukiUmetsu/kumiki-ui` commit
`f0c227a58227a87004000eb2bb324ea7e298ce8a`
(`registry/motion/attention-editing-recipes.ts`; blob
`c3b5aa1a143086629a0ce8892c30a6fbd2149f09`).
It is copied unchanged to
`src/video-export/vendor/kumiki-attention-editing-recipes.ts`, **not**
installed through the full registry closure, which also depends on 3D and
media-decode adapters the general renderer does not use. Our wrapper compiles
`compileHookVariant` (action-first, unexpected reveal, transformation) and
`compileImpactTypography` (snap, overshoot, wipe), and samples those plans at
absolute frames for the existing 1920 × 1080 scene. These are selected native
attention **plans and title/diagram treatments**, not all 13 recipe effects or a
finished viral-video editor. Impact statistics and evidence-focused effects are
intentionally disabled without source-backed evidence; word-synced captions
are disabled without real word alignment. Unrelated generic/House Math jobs
remain unchanged. No fake audio beat detection or virality scores.

The manual video Studio now supports a separately composed 1080 × 1920
portrait explainer for Shorts/Reels/TikTok. Captions with word alignment,
licensed real footage and richer 3D treatments remain future milestones.
Review a real rendered portrait MP4 at normal speed before commercial release. GitHub CI performs only no-FFmpeg
compilation and test checks; no source/voice commercial rights are inferred.

### Create → Platform layouts

This formerly planned tool now compiles actual layouts for YouTube 16:9,
Shorts/Reels/TikTok 9:16, Instagram 4:5, and square output. It uses Kumiki's
platform presets and ShortSafeFrame geometry for independent element positions,
not a blind landscape crop. Edit the headline, subhead and 2–4 graphic labels;
inspect the live shared preview, optional reserved-UI guides and deterministic
safe-frame diagnostics. Export a local JSON layout plan containing the exact
preset, raster, positions, reserved regions and findings.

This tool does NOT render an MP4, upload a video, synchronize captions to words,
or publish to any platform. UI overlays are approximate, and long copy
requires normal-size visual review. For actual MP4 generation use the separate
Video Test Studio (port 8790) and its preflight/export pipeline. Thumbnail
Composer and Storyboard Planner availability metadata now correctly says
Live instead of Planned; Motion & media remains a demonstration lab.

## Studio main navigation

The React Studio now has live destinations for all nine sidebar items.
Research stays on the existing evidence/packaging API; Create retains the
Kumiki tools; Jobs & QA keeps using the Rust jobs API.

The other six pages operate on an explicitly local browser metadata catalog:

- Projects: create, select, rename and delete project records. The active
  project ID is passed to Create. Deleting a project removes only catalog entries,
  never rendered video files.
- Content: track planned videos, Shorts, articles and thumbnails with editorial
  stages and notes. Marking Published is an author-entered status, not a verified
  platform publish event.
- Assets: track local reference names, sources/paths and rights status.
  No media bytes are uploaded or licenses granted.
- Products: manage course/download/membership/service plans, not live
  Stripe products or a storefront.
- Insights: only actual counts of those author-entered records, never
  fabricated views, revenue or virality predictions.
- Settings: the existing appearance, density and language controls, plus a
  JSON catalog backup/import and confirmed reset.

The catalog is stored under the localStorage key
contentgen:studio-catalog:v1, with a 512 KB limit, strict schema validation,
entry caps and project reference checks. It stores only metadata, not Fish keys,
voice IDs, rendered videos or raw media. Failed storage writes are surfaced.
Browser localStorage is not a durable backup: use Settings to download JSON
if the records matter.

This catalog is not connected to the standalone Video Test Studio (port 8790),
production APIs, cloud sync or publishing providers. Tool-authored drafts are
not automatically serialized into catalog records. Backend persistence and
media ingestion require explicit API contracts and authorization work.

## Run and verify

Requirements: Node `>=22.12`, pnpm `11.22` (declared in `package.json`).

```bash
cd apps/web
pnpm install --frozen-lockfile
pnpm dev            # http://127.0.0.1:5173
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm kumiki:verify  # re-downloads the pinned commit and checks every hash
```

The dev server binds loopback only. The Vite proxy entries for
`/api/research`, `/api/jobs`, `/api/creative` and `/v1/creative` are for the
pre-existing Research/Jobs/QA screens and for local fixtures; the foundation
shell itself never requires a backend. With no services running those screens
must show honest error states, not fabricated data.

## Creative packaging panel

The packaging panel calls `GET /api/creative/packaging`, the route the backend
registers in `crates/server/src/creative/mod.rs`. That handler is a stub today
and answers HTTP 501 `not_implemented`; without a fixture the panel must show
that error honestly and must not render a sample set.

For local QA, `pnpm fixtures:creative` starts a dependency-free Node server on
`127.0.0.1:8789` (override with `FIXTURE_PORT`) that serves
`fixtures/packaging-set.json` for the same route. Vite proxies `/api/creative`
there by default; set `CONTENTGEN_CREATIVE_ORIGIN` to point elsewhere. The
fixture is illustrative and synthetic, derived from the documented house-cost
scenario, and is never a published or measured performance claim. Stop the
fixture server to see the real 501 response again.

## Motion & media integration showcase

Open **Create → Motion gallery** to exercise the vendored components as one
frame-addressed workflow:

- **MotionDirector → CameraStage:** deterministic camera movement and a signal
  reveal sampled at integer frames, with reduced-motion behavior respected.
- **EconomicChartView:** an illustrative HVAC cost waterfall reveals from the
  same frame scrubber; the values are synthetic examples, not market claims.
- **Artboard + LayerStack + LayerList + AlignmentGuides:** inspect the layered
  title card, select layers, and keep safe-area/grid guides out of the export.
- **ExportPreview:** review export diagnostics and download the authored still as
  SVG or PNG, including small-format checks.
- **VideoExportStage:** select YouTube landscape or Shorts portrait, author at
  the selected profile's exact dimensions, and verify a frame is ready for
  browser capture. This is a capture handshake, not a video encoder or publisher.

The **Web quality** GitHub Actions workflow runs frozen dependency installation,
pinned Kumiki verification, lint, typecheck, tests and production build for
changes to `apps/web/**`.

## Layout

```text
src/
  app/                 shell, header, sidebar, workspace, inspector, preview,
                       preferences provider, shortcuts dialog, error boundary
  components/{ui,media,infographic,motion,video}/
                       vendored Kumiki source — do not edit by hand
  features/
    registry.ts        feature ids, metadata and the FeatureSlotProps contract
    slots.tsx          id -> slot component map (the only shared registration)
    brand-appearance/  local appearance editor and scoped creative previews
    thumbnail-composer/
    storyboard-planner/
    motion-gallery/
    platform-composer/
  styles/
    app.css            app entry; imports the Kumiki layer and app-only base rules
    kumiki/            vendored global.css + generated tokens.css
  lib/api/             pre-existing API client for the out-of-scope screens
```

The shell is intentionally three-zone: **sidebar → workspace (tabs, editor,
preview, split pane) → properties inspector**. On narrow screens the sidebar
becomes a drawer, the split pane stacks, and the inspector becomes a collapsed
bottom sheet. The 375 px, 768 px and 1440 px widths are the required review
targets.

## Kumiki-UI pin and vendoring

| Item | Value |
|---|---|
| Repository | `https://github.com/YukiUmetsu/kumiki-ui` |
| Pinned commit | `275209e228bc981dd176838e20f6a0d51761b3a9` |
| Config | `kumiki.config.json` |
| Hash lock | `vendor/kumiki.lock.json` |
| Script | `scripts/vendor-kumiki.mjs` |

Selected items and their dependency closure:

- **Application UI:** `button`, `tabs`, `surface-card`, `sidebar`,
  `split-pane`, `input` (includes `field-input`), and `dialog`.
- **Editable media:** `artboard`, `editable-text`, `layer-stack`,
  `alignment-guides`, and `export-preview`. Dependencies include
  `media-document` and `media-frame`.
- **Infographics:** `infographic-economic-charts`, plus
  `infographic-system` and `infographic-view`.
- **Motion:** `motion-director`, `camera-stage`, and
  `visual-transformation`, `diagram-stage`, and `process-journey`. The closure includes `motion-track`,
  `motion-preset`, `scene-storyboard`, `motion-react`, and the required
  timeline/path/mask/morph/animated-text modules.
- **Video delivery:** `video-export-stage` and `video-platform-presets`.
- **Styles:** `src/styles/tokens.css` → `src/styles/kumiki/tokens.css`,
  `src/styles/global.css` → `src/styles/kumiki/global.css`.

The configuration selects 19 top-level items; the pinned registry resolves
34 items and vendors 85 unique files including the two stylesheets. All
required npm dependencies already exist in `package.json`; this expansion
adds no new runtime dependencies.

### Upstream adoption candidates (checked 2026-10-22)

Kumiki main had advanced **22 commits** beyond this pin at the audit (140 registry items vs 110 at the pin). Generic `general-flow` beats with two to five stages now use the **existing pinned** `DiagramStage` + `ProcessJourney` components: fixed non-overlapping layouts, connected graph routes, one frame-addressable traveling subject, explicit stage handoffs, deterministic seeking, SVG text labels, and a still fallback for very short beats. Breakdown beats display equal-size **qualitative categories** rather than invented proportional bars; numeric charts require a separate source-backed data contract. Intro/comparison/payoff views remain unchanged. Browser preflight rejects reported diagram node overlap; real-time 16:9 export and visual inspection are still required before production sign-off.

Further **separately validated** registry upgrades should target:

1. `explainer-principles` for CPU-only narrative/visibility preflight, plus `chart-story` for data-based topics with real sourced quantities. Never generate evidence or measurements from chart animation.
2. `audio-visual-cue` + `caption-performer` after the TTS pipeline has **real alignment data**; beat-level SRT does not represent word timestamps. Do not guess word timing.
3. `short-safe-frame` + `short-hook-director` + `cut-director` with the **separate portrait milestone**, where 9:16 output is composed independently rather than cropped from 16:9.

`evidence-stage` is useful later for authorized source visuals. Its dependency tree is broader, and recent Short/Video items still document pending human inspection. **Do not silently move the Kumiki commit pin or call uninstalled registry APIs.** Adopt an item through `kumiki:update`, hash verification, consumer typecheck/build and actual video playback checks in a dedicated change.

### Evidence snapshots for quantitative scenes

`video-production-job/v1` now accepts an optional top-level `evidence` array. It is **not required for illustrative or unverified drafts**. Every `claims[].sourceRefs` identifier must resolve to an `evidence[].id`, and a `verified` claim requires at least one reference. Example source record:

```json
{
  "id": "source-2026-study", "title": "Reviewed source title",
  "sourceUri": "https://example.org/research/document",
  "retrievedAt": "2026-10-22T14:00:00.000Z",
  "passageLocator": "section 2, table 4, row A",
  "snapshotSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

The hash above is **only a format example**, not genuine retrieved evidence. A real source record must use the SHA-256 of the *actual preserved content snapshot*, a precise passage locator, and its retrieval time. The validator checks shape, reference integrity and immutable-source metadata; it does **not** fetch a source, recalculate its hash or decide whether a quoted claim is true. The general visual compiler retains the claim-to-snapshot reference chain for future `chart-story` rendering and review. Model-generated jobs remain unverified and must not invent these records.

### Validated quantitative chart metadata (renderer not yet enabled)

An existing `general-explainer-v1` beat may additionally carry an optional
`beats[].visual.chart` object. This is **validated source/assumption metadata**
for a future Kumiki `ChartStory` adapter—not a request to render proportional
bars with the current qualitative scene. Existing jobs without `chart` (and all
House Math jobs) remain unchanged. A chart beat still needs the existing
`headline`, `subhead`, `emphasis`, and 2–5 `items` used by today's scene.

```json
{
  "kind": "quantitative-chart-v1",
  "categories": ["Scenario A", "Scenario B", "Scenario C"],
  "series": [
    { "id": "example", "label": "Hypothetical duration", "values": [12, null, 18] }
  ],
  "unit": "ms",
  "provenance": {
    "basis": "illustrative",
    "disclosure": "Illustrative hypothetical values, not observations.",
    "claimRefs": ["illustrative-duration-claim"],
    "assumptions": ["These values were authored solely to explain the visual form."]
  }
}
```

Chart categories require 2–12 unique, safe single-line labels; 1–4 series
must each contain exactly one finite number or `null` per category and at
least one actual number. `null` means **missing**, never zero. Series IDs
are unique; labels, unit and disclosure are required and length-bounded.
No numeric strings, `NaN`, infinities or arbitrary nested/unknown fields
are accepted.

- **Measured** requires `provenance.basis: "measured"`, a non-empty
  disclosure, `claimRefs` attached to that narrated beat and pointing only
  to `verified` claims, plus `evidenceRefs` that **exactly equal** the union
  of those claims' `sourceRefs`. Each evidence ref must resolve to a
  registered source snapshot. Do not author these refs or quantities from
  a model's unsupported assertion.
- **Illustrative** requires `provenance.basis: "illustrative"`, refs to
  `illustrative` claims attached to the beat, 1–5 explicit value assumptions,
  and a disclosure beginning with `Illustrative`, `Hypothetical`, `Synthetic`
  (or `例示`, `仮定`, `架空`). It must **not** contain `evidenceRefs`, which could
  misrepresent invented values as actual observations.

The parser checks **shape and reference consistency, not truth**: it cannot
recalculate or independently inspect the original source table, determine
whether the verified claim supports *each* plotted value, audit arithmetic
or infer the unit from the source. Those remain mandatory human/source
review before any measured chart is published. The generic topic generator
does not synthesize quantitative series, the current renderer ignores chart
metadata, and ChartStory scenario/reveal timing remains a future adapter.

Kumiki has one root `registry.json`, not per-item JSON files expected by the
shadcn GitHub registry flow. `scripts/vendor-kumiki.mjs` is the reproducible
installer: it resolves `registryDependencies`, preserves each source path
under `src/components/` (for example, `registry/motion/types.ts` becomes
`src/components/motion/types.ts`), and records SHA-256 hashes and byte counts.
Preserving source directories is required for relative imports and avoids
collisions between similarly named files such as infographic and motion
`types.ts`.

Repeated references to the same source file are deduplicated; different
sources resolving to the same target fail loudly. `pnpm test` includes tests
for path preservation, traversal rejection, dependency deduplication and
collision detection. `components.json` remains for future standard shadcn
items, but it is not the Kumiki install path.

### Upgrade procedure

1. Read the upstream diff for the candidate commit. Check component API,
   token and CSS-variable changes before bumping.
2. Edit `commit` in `kumiki.config.json` (and the item list only if needed).
3. Run `pnpm kumiki:update` (alias for
   `node scripts/vendor-kumiki.mjs --update-lock`).
4. Review every changed file and every hash/dependency change in
   `vendor/kumiki.lock.json`. Do not ignore an unexpected file.
5. Run `pnpm kumiki:verify`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
   `pnpm build`, then redo the 375/768/1440 light/dark visual review.
6. Commit the config, lock, vendored files and any app-side adaptations
   together. Never edit `src/components/ui/*` or `src/styles/kumiki/*` directly;
   fix upstream or adapt at the call site.

`pnpm kumiki:verify` needs network access to
`raw.githubusercontent.com` for the pinned commit. It fails on any drift.

## Import paths

```ts
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";        // Tabs, Tabs.List, Tabs.Tab, Tabs.Panel
import { Surface } from "@/components/ui/surface-card";
import { Sidebar } from "@/components/ui/sidebar";  // Sidebar.Header/Nav/Item/Toggle/...
import { SplitPane } from "@/components/ui/split-pane";
import { Input, Field } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
```

Use the parts attached to the component (`Tabs.List`) or the named exports
(`TabsList`); both are supported. `Button` accepts `variant`
(`primary | secondary | subtle | outline | destructive`) and `size`
(`sm | md | lg | icon`); icon-only buttons require an accessible name.

## Component ownership — no parallel primitives

`src/components/ui/` is the only primitive layer. Each interaction role has one
implementation, vendored from the pin above:

| Role | Component |
|---|---|
| Action | `Button` (`button.tsx`) |
| Text entry | `Input` / `Field` (`field-input.tsx`, re-exported by `input.tsx`) |
| Tabs | `Tabs` / `Tabs.List` / `Tabs.Tab` / `Tabs.Panel` |
| Card / panel | `Surface` |
| Navigation | `Sidebar` |
| Resizable regions | `SplitPane` |
| Modal | `Dialog` |

Do **not** add a local `Button`, `Input`, `Card`, `Tabs`, `Dialog`, sidebar or
split-pane lookalike in `src/app` or `src/features`. If a new primitive is
needed, add it upstream to Kumiki and re-vendor it; if a screen needs a
composition, build it from the primitives above.

App-level compositions are not duplicates: `EmptyState`,
`FeatureErrorBoundary`, `ShortcutsDialog`, `ApiErrorNotice` and
`FeatureSlotShell` all wrap Kumiki primitives. `input.tsx` is a thin upstream
re-export of `field-input.tsx` (the pinned registry ships both entry points),
not a second implementation. Shared failure UI lives in
`src/app/api-error-notice.tsx` so the Research, Jobs/QA and packaging panels do
not each carry a private error card.

## Tokens and theming

There is exactly one theme system.

- `src/styles/app.css` is imported once from `src/main.tsx`.
- It imports `src/styles/kumiki/global.css`, which imports Tailwind v4 and the
  generated `src/styles/kumiki/tokens.css`.
- `global.css` bridges Kumiki's semantic `--km-*` variables into Tailwind's
  `@theme inline` namespaces. Prefer the bridged utilities:
  `bg-surface`, `bg-canvas`, `text-foreground`, `text-muted-foreground`,
  `border-border`, `bg-primary`, `text-danger`, `ring-ring`,
  `rounded-control`, `rounded-surface`, `text-heading-sm`, `text-body-sm`,
  `text-caption`, `duration-short`, `ease-continuity`.
- For a value with no bridged utility, use the raw custom property
  (`var(--km-space-4)`, `var(--km-shadow-DEFAULT)`) in a scoped class. Do not
  add hex colors, a second reset, or another token source.
- **Appearance** is set by `data-km-appearance="light|dark"` on `<html>`.
  **Density** is set by `data-km-density="compact|spacious"`. The preferences
  provider persists both (plus locale) under
  `content-gen:studio-preferences` and `index.html` applies the stored values
  before first paint to avoid a theme flash.
- Density changes `--spacing` and control height; fixed layout dimensions
  should use explicit spacing tokens rather than assuming one density.
- Typography: Geist Variable (sans) and Newsreader Variable (serif) are local
  `@fontsource-variable` packages, loaded in `main.tsx`. CJK text falls back to
  system Japanese fonts. Do not add remote font requests.

### Creative previews vs editor chrome

Keep neutral editor styling separate from BrandKit output. Wrap a creative
preview in a `data-preview-surface` container and scope any BrandKit token
overrides there:

```tsx
<div data-preview-surface style={{ "--km-action-primary": brand.accent }}>
  <BrandKitPreview />
</div>
```

Do not re-point `--km-*` variables on `<html>` for a brand preview, and do not
restyle the shell around a brand's palette. The shell stays neutral; only the
artboard changes.

## Feature slots for parallel agents

Every slot implements:

```ts
interface FeatureSlotProps {
  projectId: string;
  locale: "en" | "ja";
  className?: string;
}
```

A slot is registered in `src/features/slots.tsx` and described in
`src/features/registry.ts` (title, outcome, `consumes`, `produces`). The shell
owns the tab bar, split pane, preview region, inspector, error boundary and
responsive behavior. The slot owns only its editor body.

Rules:

1. Work only inside your `src/features/<id>/` folder. Do not edit the vendored
   Kumiki files, `styles/kumiki/*`, or another team's slot. If a shared shell
   change is genuinely required, coordinate it rather than editing in parallel.
2. Fill height (`h-full`) and own your internal scroll. Do not set page-level
   width/height or `position: fixed`.
3. Use Kumiki components and the semantic tokens above. No second theme, no raw
   palette, no global CSS reset.
4. Keep all async states honest: loading, empty, error, cancel, retry. No fake
   percentages, invented metrics or placeholder "success" data.
5. Respect `prefers-reduced-motion`, keyboard access and visible focus. Test
   English and Japanese copy at 375 px.
6. Render creative output inside a preview/artboard scope, not as editor chrome.

The five ids and their boundaries are documented in
`src/features/registry.ts`; the placeholder bodies in each folder show the
expected shell integration.

## Current scope and known gaps

- Brand Appearance provides a local palette/preset/typography editor with
  JSON import/export and three scoped previews. The other four slots remain
  placeholders.
- No router or backend persistence; section and active tool are in-memory,
  preferences are local storage.
- The pre-existing Research, Jobs/QA and packaging screens are outside this
  foundation task and call the local API client. They must remain honest when
  their services are absent.
- BrandKit token compilation, export/render workers and platform profiles are
  later milestones; the preview is a neutral artboard placeholder.
- The production bundle currently exceeds Vite's 500 kB warning threshold
  (single chunk). Code-split feature slots when real editors land.

## Research-first cinematic preproduction (opt-in)

ContentGen now owns six pre-render stages; Kumiki UI remains the visual execution layer.

| Stage | Output | Release check |
|---|---|---|
| Research | Captured evidence snapshots, passage locators, SHA-256s, reviewed claims, gaps | Requires captured evidence and linked claim IDs |
| Story architect | Narrative pattern, premise, hook, question, acts, payoff | All acts explained, answer linked |
| Explanation planner | Before-understanding, demonstration, after-understanding for each step | Learning steps grounded in claim IDs |
| Shot & asset director | Family, subject, visual change, on-screen text, claim/asset refs | Every step visualized; assets resolve to explicit rights metadata |
| Transition & continuity director | Technique and carried subject IDs at each shot boundary | No missing transition or broken persistent subject |
| Performance & sound director | Narration, delivery, energy, pause and SFX intent per shot | Every shot has a performance plan |

Run offline against human-authored JSON files:

```bash
pnpm video:plan --research /path/research.json --plan /path/plan.json --out /path/new-bundle.json
pnpm video:plan --research /path/research.json --plan /path/plan.json --out /path/new-bundle.json --require-ready
```

Or opt in to an already-running local OpenAI-compatible planning model:

```bash
pnpm video:plan --research /path/research.json --model INSTALLED_MODEL_ID --out /path/new-bundle.json
```

The optional endpoint defaults to http://127.0.0.1:11434/v1/chat/completions and accepts only loopback HTTP.
No remote web research, model download, TTS, expensive rendering or publication occurs.
Output files are exclusive-create (never overwritten); the bundle contains research and plan SHA-256 fingerprints.

Research file schema: research-dossier/v1 with keys schemaVersion, kind, id, topic, evidence, claims, assets, gaps, review.
Each evidence record has id/title/sourceUri/retrievedAt/passageLocator/snapshotSha256.
Each claim has id/text/status/sourceRefs, reusing existing video-job claim status vocabulary.
The optional assets array contains id/kind/ref/licenseStatus; planned asset IDs must resolve.
Topic contains title/viewerQuestion/audience/locale. Review is draft or human-reviewed, with reviewer required for the latter.
See scripts/video-production/preproduction.test.mjs for a synthetic, non-publishable working contract fixture.

Planner output schema: preproduction-plan/v1 contains researchId/styleId/story/explanation/shots/continuity/sound.
See the tested fixture for supported enumerations. The CLI outputs a preproduction-bundle/v1 with
either ready-for-animatic-review or draft-needs-review plus actionable findings.
Research review is an editor's attestation, not automated verification that a passage supports a claim.
Unverified or disputed used claims and test-only visual assets block readiness.

**Not yet implemented:** Studio-integrated source acquisition, persistent Studio editing, timed animatics,
shot compilation to Kumiki, or attaching the plan to the production job. Legacy topic/manual jobs
and House Math remain unchanged until the new path is integrated with migration tests.
Preproduction readiness is not approval to spend money, invoke Fish Audio, render commercially or publish.


### Research-first preproduction (opt-in source discovery)

Run `pnpm video:research` before `pnpm video:plan` to **search and capture actual sources**, then use an **already running local OpenAI-compatible model** to suggest candidate claims with exact supporting excerpts. The resulting `research-dossier/v1` passes the current preproduction parser and remains **draft / unverified**. The model is selected explicitly with `--model`; no cloud LLM is selected automatically.

Use a locally running [SearXNG](https://docs.searxng.org/) instance whose JSON search output is enabled. ContentGen queries its loopback `/search` endpoint and captures only explicitly authorized public HTTPS page content; local SearXNG is a search provider, *not* the LLM.

```sh
cd apps/web
pnpm video:research -- \
  --topic "Why does replacing an HVAC system cost so much?" \
  --question "What drives the final replacement quote?" \
  --audience "Homeowners" --model YOUR_INSTALLED_LOCAL_MODEL \
  --search-provider searxng --search-endpoint http://127.0.0.1:8080/search \
  --allow-network --out-dir ../../outputs/hvac-research-01

pnpm video:plan -- \
  --research ../../outputs/hvac-research-01/research-dossier.json \
  --model YOUR_INSTALLED_LOCAL_MODEL --out ../../outputs/hvac-plan-01.json
```

The alternative `--search-provider brave` requires a **separately configured** `BRAVE_SEARCH_API_KEY` and **`--approve-search-charges`**; Brave may incur provider charges, so review the pricing and budget yourself before opting in. `--allow-network` is still required. Neither search path runs unless the operator explicitly authorizes remote page retrieval. No new models/dependencies are installed by this command.

The newly created, non-overwritten directory contains `research-dossier.json`, SHA-256-identifiable `captures/source_NN.txt` and `run-manifest.json`. Sources are leads until successfully fetched; the worker rejects redirects, non-HTTPS URLs, local/private IPs, unbounded responses, and missing textual content. The extracted `quote` from each model claim must exist *verbatim* in a saved source capture. Dossier claims deliberately have `status: unverified` and `review.status: draft`; this does **not** fact-check quote interpretation, resolve contradictions, determine publication permission, or mark a video commercially ready. Web pages are untrusted data and should be assessed against primary sources and rights restrictions by a human. Page extraction is text/HTML only (no JS-required pages, PDFs, login, or robots-policy bypass). Sources failing capture are recorded as research gaps; no fabricated substitute citations are created. The model and local SearXNG endpoints must remain loopback-only.

To run the new suite: `node --test scripts/video-production/research-agent.test.mjs`. The existing headless test command includes it automatically. This is CLI-only; connecting research to the main Studio UI is a separate milestone.
