# Visual quality foundation — original 2D/2.5D explainer scenes

**Status (2026-10-31):** First tested vertical slice: separate audience copy from editor-only direction and detect serious repeated-schematic/editorial-copy faults. **ComfyUI asset generation, a layered asset pack, Kinetograph export, and cinematic invoice animation remain future work.** Do not claim the visual upgrade is complete from these guardrails.

## The creative result, not a slideshow

Every substantive beat needs one **specific visible subject** and a meaningful **before → operation → after** visual change. Merely displaying a headline over a stock image, panning a still, or shuffling three labels is a *rough layout*, not a premium scene.

1. **Original art:** ComfyUI (when installed, verified, enabled and rights-reviewed) supplies scene-specific environments, subjects and edited reference art, not typography or accurate financial documents.
2. **Exact information:** SVG/React generates all legible prices, documents, forms, arrows, code, charts, captions and UI. Never outsource precise text or numbers to diffusion pixels.
3. **Layered motion:** Background, independently moving props, contact shadows, foreground and overlays form a reusable scene. Kumiki owns the animation clock, transforms and choreography.
4. **Actual export review:** Inspect the encoded MP4 at first, middle, last, arrival and payoff frames; watch normal-speed video without audio, then with audio. A static QA report is only a warning system.

### Three distinct starting art directions (reference presets, not hardcoded brands)

| Direction and best use | Palette | Imagery / typography / movement |
| --- | --- | --- |
| **Warm editorial diorama** — desk, receipts, household costs | Walnut `#734A34`, paper `#F5EBD8`, petrol `#1E5559`, amber `#D69B4B` | Photographic/illustrated environment, tangible paper layers and shadows; readable geometric sans-serif; paper lands, correspondence lines attach, camera gently changes focus. |
| **Investigative evidence board** — history, documentary, mystery | Ink `#16232F`, parchment `#E8DCC6`, vermilion `#B34C37`, brass `#B89A5B` | Layered maps/archives with source labels, paper grain and selective light; restrained serif headings with sans-serif data; evidence moves into a relationship, not a carousel. |
| **Precision vector lab** — software and abstract mechanisms | Deep blue `#101F36`, cool white `#EFF5FA`, cyan `#2C9DAE`, coral `#EE775B` | Sharp SVG diagrams and deliberate geometric cutaways; clean sans-serif/numeric typography; states, data flow and cause-effect reveal through aligned motion. |

Use configured BrandKit typography/tokens where available. The colors above are examples for art direction, not new global design tokens. Confirm font installation/glyph coverage (including Japanese) and commercial rights before relying on a font in export.

### Visual composition contract for the first 1920 × 1080 benchmark

- Reserve roughly **100 px side / 80 px top** as working guides and a **bottom 150 px caption-safe band**. These are *initial guides*, not a permanent platform policy. Check the actual text/subject bounding boxes.
- Establish one obvious focal subject; place data annotations adjacent to the thing they explain. For the invoice example, align an exact SVG document with a perspective-calibrated tabletop and an appropriate contact shadow.
- Keep generated text out of illustration prompts. On-screen copy must be short, necessary and editable. **`onScreenText`/`audienceCopy` are viewer text; `visualChange`/`learningChange`/`visualAction` are never viewer text.** If the new optional `audienceCopy` is absent, the bridge temporarily uses the first spoken sentence as a backward-compatible fallback and reports that limitation.
- When the camera, subject, or visual state moves, the motion should reveal **which amount differs, which part connects, which process changes, or what outcome follows**. No default ornamental bounce/slow-zoom substitution.
- Keep each main subject's identity, apparent scale, lighting direction, material treatment and visual role consistent between shots. Broken masks, gibberish document pixels and floating props fail manual visual QA.
- Compose 9:16 separately once the 16:9 benchmark is strong; do not simply crop the 16:9 design.

## Intended production boundary

```text
Storyboard (audience copy + private visual intent)
  → validated visual brief and shot roles
  → local ComfyUI original background/subject art OR exact SVG/React objects
  → immutable asset pack (hashes, masks, anchors, perspective, provenance)
  → pinned Kumiki scene recipe + narrator-frame scheduling
  → existing Chromium frame capture [production default]
  → optional certified Kinetograph native export [future, license + parity gate]
  → existing master audio / verified MP4 / sampled-frame QA
```

Put ComfyUI integration in the existing Node video-production `asset-preparation` stage, extending its photo/video-only asset ledger with versioned generated-image/layer-pack entries **after migration and tests**. Do not add another scheduler. Put a possible Kinetograph adapter beside `render.mjs` behind a renderer-selecting seam in `produce.mjs`; it is **not a drop-in browser URL consumer** and must not be allowed to execute model-authored TSX/HTML. An existing Kumiki scene must prove compatibility and visual parity before Kinetograph is enabled. The [Kinetograph license](https://github.com/0xS4N4TG/kinetograph/blob/main/LICENSE.md) is PolyForm Small Business, requiring an actual product-owner eligibility/commercial-license review before adoption or distribution.

## Quality gates now and next

| Gate | Measured condition | State |
| --- | --- | --- |
| Private directions never appear in the audience subhead | Bridge uses `audienceCopy` or narration, never `learningChange`/`visualChange` | **Implemented, tests** |
| Premium scene repeat rejection | Three consecutive nearly identical, generic schematic scenes trigger `repeated-schematic` **error** in existing `analyzeRenderedSceneQuality` report | **Implemented, tests** |
| Private direction leak QA | `editorial-copy-leak` flags exact or truncated direction text displayed as subhead | **Implemented, tests** |
| Grounded art | Generated subject and relevant objects visibly match shot brief; assets have provenance and usable layers | **Not implemented** |
| Real semantic motion | Actual rendered subject moves/changes before→after, perspective/shadows remain plausible and audience understands without voice | **Not implemented** |
| Premium final export | Human approves a coherent 10-second desktop/invoice/receipt demonstration and a 45–60-second follow-on with narration | **Not implemented** |

### Next *single* implementation slice

Build a 10-second **synthetic desk → invoice → receipt → mismatch** scene in Kumiki using an approved/synthetic desk background, two independently editable SVG documents and calibrated perspective/shadows. It must export as a real MP4 through the existing `VideoExportStage`/Chromium/FFmpeg path and receive a human normal-speed review **before** installing a local image model or introducing the optional Kinetograph backend. Only then connect ComfyUI to replace the temporary background through a repeatable, versioned image-and-layer workflow.

Keep unverified model art and project-owned private character ZIPs outside Git fixtures. Use clearly synthetic amounts; do not commit uploaded private images or imply commercial clearance from the rendering software's license.
