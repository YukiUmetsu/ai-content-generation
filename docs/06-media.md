# Graphics, thumbnails, characters, narration and explanatory video

## Core rule: visuals must teach, not decorate

Every visual has a **learning/marketing objective**, source claims, intended viewer distance, locale, canvas target and editability requirements. Use deterministic SVG/HTML/React composition for text, process diagrams, charts and infographics; optional local diffusion only for illustrations/backgrounds, *not* precise labels. Keep layers, source images, typography, storyboards and timelines editable. Distinguish UI-preview engine from final offline renderer.

## Current integration decision (2026-10-21)

**Prefer Kumiki-UI for reusable visual composition and choreography**: its implemented source registry already includes media stills, motion MG1/MD1/CC1/VT1, infographics, visual guards and a single-audio-file Playwright/FFmpeg exporter. Do not rebuild each named component here. The broad "neutral SceneSpec" and template list below describe **ContentGen's semantic authoring needs only**, not a second canonical media wire format; adapt to implemented Kumiki contracts with capability checks. The full Kumiki video Composition schema remains proposed. See [14](14-kumiki-integration.md).

**Audio is now a dedicated production subsystem**, not just normalized TTS fragments: speech provider adapters, sample-accurate alignment, semantic SFX, rights-checked music, gain/ducking/mix/master, audio QA and multi-platform packaging. See [13](13-audio-production.md). Brand style, voice tone, mood, semantic palette, type and platform-safe layouts are versioned in [12](12-brand-studio.md).

## Media stack and adapter boundaries

| Capability | Practical initial provider | Alternatives / tradeoff |
|---|---|---|
| SVG/graphic layout | SVG + ELK.js + Satori/React, resvg output | Mermaid/Graphviz; validate font metrics and geometry |
| Programmatic slides/video | Kumiki MG1/MD1/CC1/visual + existing VideoExportStage/FFmpeg adapter | Motion Canvas/other engines only after a measured missing capability; versioned adapter and license review |
| Narrative illustrations | MFLUX + commercially permitted FLUX.2 Klein 4B | Z-Image or other adapter; optional heavyweight download |
| TTS | Provider-neutral speech port; Fish Audio cloud candidate | Qwen3-TTS MLX, Kokoro, imported WAV; provider terms and commercial voice rights reviewed independently |
| STT/alignment | whisper.cpp | MLX-Audio; Rhubarb English lip-sync optional |
| Character animation | Layered sprites + timeline actions | Inochi2D rigs or Blender as optional advanced workers |
| Desktop demos | OBS + test/automation harness | Browser apps via Playwright |
| Video encode | Pluggable macOS VideoToolbox/encoder, optional FFmpeg | Verify codec/container licensing before distribution |

Do not download all tools in baseline or assume a particular repo supports your exact Apple Silicon/24 GB setup. Text inference, image generation, TTS and heavy render are **sequential by default**.

## One editable semantic authoring specification, one Kumiki visual integration boundary

ContentGen's versioned semantic storyboard adapter (see [`visual-scene.json`](../examples/visual-scene.json)) must express: `{id, canvas: {width,height,fps,profile}, tokens/brand_version, locale, layers[], audio_tracks[], timed_actions[], dependencies[], source_refs[], render_targets[]}`. Elements have stable IDs, type, normalized/text-safe bounds, measured constraints, z-index, intentional-overlap tags, alt description, font/style tokens and editable properties. Timed actions have start/end/easing/property/target and optional narration/phoneme anchors.

**Renderer-specific adapters** interpret supported subsets and report unsupported features; do not claim identical output between Motion Canvas, HyperFrames and SVG. Keep generated visual source and exported frames linked by exact render manifest (renderer/version/fonts/assets/seed). Support targeted scene/segment rerenders.

## Graphics and thumbnails

Required reusable templates: process steps, before/after, comparison, concept breakdown, architecture layers, data highlight, progressive diagram, timeline, device/workflow illustration, editorial hero. Use grid systems, restrained palette, consistent icon weights, readable figures and ample safe margins. Charts show scales/units; arrows have clear direction, legends if needed. Text remains vector/editable for final composition.

**Thumbnail Studio:** standalone or video-linked editable spec; 16:9 and 9:16 are separate compositions. Create multiple controlled variants, store hypotheses, approved default per platform, preview at 100% and realistic small mobile sizes (e.g., ~160–320 px wide), and account for UI occlusion zones with profile-specific overlays. Character reference lock, truthful subject, no fake logos/metrics, limited salient text, one focal point and high legibility. Detect overflow, low contrast and indistinguishable variants; only platform-eligible experiment claims can be attributed to real A/B results. Export layered source and PNG/WebP/JPEG with source revision.

## Stable character assets and names

`Character` is a stable identity with editable *character bible*: name/aliases/localized pronunciation, personality, speech style, appearance invariants (colors, proportions, distinctive features), roles/relationships, rights and voice profile. Produce approved front/side/back/expressions/poses as reference assets. New poses use approved references; detect drift with deterministic version/hash/reference checks plus optional vision review. Name generation via LLM + local locale dictionaries (e.g. `fake-rs`) is ideation only, not a trademark clearance service.

**Animation ladder:** (1) approved 2D sprites + expressions + motion timeline (best MVP), (2) layered puppet + gesture library, (3) optional Inochi2D rigs, (4) optional Blender/MPFB2 3D. Store named actions (`idle`, `talk`, `point`, `think`, etc.) independent of renderer. In-article character use must preserve approved identity. Export optional layered SVG/PNG, rig and animation clips; approvals bind exact version. Avoid per-frame independent diffusion for identity-critical animation.

## Video script, slides and narration

Pipeline: evidence brief → hook/objective → voiceover script **by beat** → storyboard (visual type, timed on-screen text, diagram states, camera, character actions) → TTS segments → actual audio duration → scene timing → slides/animated diagrams/real captures → subtitles → render → QA. Each narration beat must have an explanatory visual, not merely loosely themed stock footage.

Slide/video layout components: `TitleReveal`, `ConceptCard`, `ProgressiveDiagram`, `Comparison`, `StepSequence`, `CodeHighlight`, `Callout`, `DataChart`, `DeviceFrame`, `CharacterPresenter`, `CaptionOverlay`, `SceneTransition`, `ProgressTimeline`. Motion communicates causality, grouping or progression; no ornamental bouncing or animation that outruns reading time. Prefer 1920×1080 for long form and 1080×1920 for Shorts as configurable defaults; keep profile-specific safe areas and caption exclusions versioned because platform UIs change.

**Audio:** sentence/beat-level WAV segments cached by voice+provider/model+text+locale+style; support English/Japanese, glossary pronunciation, speed, speech rights, and partial regeneration. Normalize loudness, detect clipping/silence, compare STT transcript to approved script when available, and align captions to actual speech. Rhubarb is English-oriented; Japanese visemes need a phoneme-specific adapter. Do not clone a third-party voice without permission.

## Non-destructive editor

Canvas/layer selection, inline text edit, drag/resize/snap, constraints and alignment, hide/lock, timeline/keyframes, scene ordering, clip/voice swaps, undo/redo, keyboard editing, autosaved versions and scoped AI regeneration. Layout source is authoritative: don't rasterize editable text or discard original audio after render. Preview may proxy lower resolution; final export must be validated at full size.

## Quality and acceptance

- Inspect **computed** bounds after font load, not just LLM-proposed rectangles; safe margins, text wrapping, occlusion, clipping, accidental collisions, minimum readable font/contrast, aspect, missing assets and JPEG/PNG distortion.
- Sample video at keyframes and around transitions in addition to checking source geometry; detect blank/frozen frames, missing/cut narration, subtitle collisions, audio peak, A/V alignment and inadequate on-screen exposure. VLM aesthetic critique is advisory, not proof.
- Compare generated character with approved appearance references; track renderer/character/rig version. Video narrator must visually demonstrate what the script says, with scene-by-scene evidence.
- **Fixtures:** three-panel infographic with intentionally clipped label; 9:16 caption over critical diagram; 45s narration video with a deliberately missing segment; thumbnail legible at 200px; same mascot across two scenes; regenerate one audio segment without rerendering unrelated art.

References: [Motion Canvas](https://github.com/motion-canvas/motion-canvas), [HyperFrames](https://github.com/heygen-com/hyperframes), [MFLUX](https://github.com/mflux-community/mflux), [ELK.js](https://github.com/kieler/elkjs), [resvg](https://github.com/linebender/resvg), [Inochi2D](https://github.com/Inochi2D/inochi2d), [Rhubarb](https://github.com/DanielSWolf/rhubarb-lip-sync), [Qwen3 TTS MLX](https://github.com/syedpeer/qwen3-tts-mlx).
