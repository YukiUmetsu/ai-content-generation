# ContentGen Studio — shared frontend foundation

React 19 + TypeScript + Vite 8 + Tailwind CSS v4 + a pinned, source-vendored
[Kumiki-UI](https://github.com/YukiUmetsu/kumiki-ui) registry.

This app is the **shared application shell and creative-workbench foundation**.
It deliberately contains no research, job, render, or publishing logic. The
five feature slots are independently owned: **Brand & appearance** and **Motion
& media lab** are working examples; thumbnail, storyboard and platform delivery
remain integration slots. The shell, split pane, preview canvas, inspector,
appearance/density axes and error boundary are provided.

## Headless video production (foundation slice)

The CLI currently validates versioned inputs and gives a no-network preflight. **It does not synthesize or export media yet**. The mock/demo fixture is explicitly test-only.

```bash
cd apps/web
pnpm test:video:headless
pnpm video:produce -- --job ../../examples/video-production-house-math-smoke.json --provider fish --dry-run --out ../../outputs/house-math-smoke
```

Dry-run checks the Fish credential's **presence** without revealing it, explicit network permission, FFmpeg/FFprobe and a configured existing browser (`CONTENTGEN_CHROMIUM_EXECUTABLE`). No API request or media render happens. Later production tasks will add generated Fish or local narration and actual browser-to-FFmpeg output; these must not be marked complete from this dry-run alone. Never commit `FISH_AUDIO_API_KEY` or an unlicensed voice reference.

### Narration adapters (opt-in, currently offline-tested only)

- **Fish Audio:** supply `FISH_AUDIO_API_KEY` at runtime, an authorized voice-reference ID, locale, and explicit model. The adapter uses `POST https://api.fish.audio/v1/tts`, a versioned request with `model: s2.1-pro-free` for evaluation, and checks WAV bytes. No API call occurs without `--allow-network` and voice/text-transmission consent. Paid models additionally require an explicit budget/paid-use approval. Availability and commercial licensing of any free model or voice must be independently verified before release; no real Fish request has been made during this foundation implementation.
- **Local:** a **user-installed and running** TTS bridge can be configured with a bare loopback origin such as `http://127.0.0.1:8765`. The adapter POSTs to `/v1/speech` with JSON `{schema_version:1,text,locale,voice_id,model_id,direction,format:"wav"}`. The bridge must return 200, mono 16-bit PCM WAV with `Content-Type: audio/wav` and `X-TTS-Engine-Version: <actual engine version>`. No model is installed or started by ContentGen. Redirects and non-loopback endpoints are refused. The caller must confirm local voice authorization; engine/model identity is recorded for future cache isolation. No installed TTS bridge has been verified yet.
- Both adapters expose per-beat generated WAV bytes and fail closed on invalid audio. The CLI orchestration, 48 kHz normalization, audio mastering and final video export are subsequent tasks; passing mocked adapter tests is **not** an exported film.

### Measured speech and audio-mastering modules

The independently testable worker modules (`scripts/video-production/{speech,timeline,audio}.mjs`) now generate narration per beat, normalize it through FFmpeg to mono 48 kHz/16-bit PCM, probe the *actual* sample count with FFprobe, and cache by script, provider/engine revision, voice settings, and rights scope. Corrupt cache entries are regenerated; revoked voice authorization still blocks cache use. `buildSampleTimeline` uses half-open sample ranges and rounds to picture frames only at the boundary. Beat-level SRT captions exclude deliberate pauses and never masquerade as word alignment.

`renderMasterAudio` concatenates measured narration with silence, mixes named event-timed effects, masters and measures loudness/true peak, and writes `voice.wav`, `master.wav`, and `captions.srt` to an explicitly chosen directory. The built-in self-authored payoff chime is **test-only** and cannot be treated as licensed commercial sound. A verified local third-party SFX must have an explicit asset path and rights record. Optional background music is not yet implemented; a supplied music request fails explicitly. These modules have FFmpeg-backed tests, but the CLI is still preflight-only until orchestration and browser export land.

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
  `visual-transformation`. The closure includes `motion-track`,
  `motion-preset`, `scene-storyboard`, `motion-react`, and the required
  timeline/path/mask/morph/animated-text modules.
- **Video delivery:** `video-export-stage` and `video-platform-presets`.
- **Styles:** `src/styles/tokens.css` → `src/styles/kumiki/tokens.css`,
  `src/styles/global.css` → `src/styles/kumiki/global.css`.

The configuration selects 17 top-level items; the pinned registry resolves
32 items and vendors 82 unique files including the two stylesheets. All
required npm dependencies already exist in `package.json`; this expansion
adds no new runtime dependencies.

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
