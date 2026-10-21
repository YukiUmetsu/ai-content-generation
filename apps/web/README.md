# ContentGen Studio — shared frontend foundation

React 19 + TypeScript + Vite 8 + Tailwind CSS v4 + a pinned, source-vendored
[Kumiki-UI](https://github.com/YukiUmetsu/kumiki-ui) registry.

This app is the **shared application shell only**. It deliberately contains no
research, job, render, or publishing logic. The five feature teams own the
folders under `src/features/` and replace their placeholder slot bodies; the
shell, split pane, preview canvas, inspector, appearance/density axes and error
boundary are provided.

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

## Layout

```text
src/
  app/                 shell, header, sidebar, workspace, inspector, preview,
                       preferences provider, shortcuts dialog, error boundary
  components/ui/       vendored Kumiki components — do not edit by hand
  features/
    registry.ts        feature ids, metadata and the FeatureSlotProps contract
    slots.tsx          id -> slot component map (the only shared registration)
    brand-appearance/  placeholder slot
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

Installed items and their dependency closure:

- `button` → `class-variance-authority`, `motion`
- `tabs` → `@base-ui/react`
- `surface-card`
- `sidebar`
- `split-pane`
- `input` + `field-input`
- `dialog`
- styles: `src/styles/tokens.css` → `src/styles/kumiki/tokens.css`,
  `src/styles/global.css` → `src/styles/kumiki/global.css`

Kumiki ships a single root `registry.json`, not the per-item JSON that the
shadcn CLI expects, so the shadcn CLI cannot resolve a pinned GitHub commit for
these items. `scripts/vendor-kumiki.mjs` is the reproducible replacement: it
reads the manifest, resolves `registryDependencies`, copies each file
byte-for-byte, and records SHA-256 hashes and byte counts in the lock.
`components.json` remains in place for future standard shadcn items, but it is
not the Kumiki install path.

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

- Five slots are placeholders by design.
- No router or backend persistence; section and active tool are in-memory,
  preferences are local storage.
- The pre-existing Research, Jobs/QA and packaging screens are outside this
  foundation task and call the local API client. They must remain honest when
  their services are absent.
- BrandKit token compilation, export/render workers and platform profiles are
  later milestones; the preview is a neutral artboard placeholder.
- The production bundle currently exceeds Vite's 500 kB warning threshold
  (single chunk). Code-split feature slots when real editors land.
