# Visual quality foundation — original 2D/2.5D explainer scenes

**Status (2026-10-31): PLAN + LIMITED GUARDRAILS, NOT A CINEMATIC RENDERER.** Implemented: audience/editorial copy separation, `editorial-copy-leak`, and `repeated-schematic` QA. Unimplemented: ComfyUI, a generated layered-asset contract, a new premium scene, Kinetograph export, and human-approved MP4 samples. This is the implementation order and acceptance contract for the next PRs.

**Read this first:** Build **one 10-second desk/invoice scene using SVG and the existing renderer**; approve the actual motion. Then add a ComfyUI background with reproducible layers; then test a 45–60-second sequence. Do not start with 26 templates, 3D generation, or another export stack. Each numbered step below has a merge gate.

## The creative result, not a slideshow

Every substantive beat needs one **specific visible subject** and a meaningful **before → operation → after** visual change. Merely displaying a headline over a stock image, panning a still, or shuffling three labels is a *rough layout*, not a premium scene.

1. **Original art:** ComfyUI (when installed, verified, enabled and rights-reviewed) supplies scene-specific environments, subjects and edited reference art, not typography or accurate financial documents.
2. **Exact information:** SVG/React generates all legible prices, documents, forms, arrows, code, charts, captions and UI. Never outsource precise text or numbers to diffusion pixels.
3. **Layered motion:** Background, independently moving props, contact shadows, foreground and overlays form a reusable scene. ContentGen owns measured narration and the absolute frame; Kumiki's pure frame samplers and host renderer compute transforms and choreography.
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

## 1. What the code actually supports — verified 2026-10-31

**Two revisions, two capability sets.** ContentGen's [`apps/web/kumiki.config.json`](../apps/web/kumiki.config.json) pins Kumiki commit [`e1f0d04`](https://github.com/YukiUmetsu/kumiki-ui/tree/e1f0d04e826c551a6e6c50c42ab4416cb51cf133). Kumiki `main` at inspection was [`898bb60`](https://github.com/YukiUmetsu/kumiki-ui/tree/898bb601eb13ad056168a209677920c7af7dbe5f). **A feature in current Kumiki `main` is not available in ContentGen merely because it exists upstream.** Changes after these revisions require reinspection.

| Surface | In ContentGen's vendor pin? | What it actually does / adoption decision |
| --- | --- | --- |
| `VideoExportStage`, `process-journey`, `DiagramStage`, `chart-story`, `character-presenter` | **Yes** | Existing browser capture, diagrams, quantitative charts and rigs. Reuse now; do not replace the scene clock. |
| `motion-director` (MD1), `camera-stage`, `visual-transformation` (VT1) | **Yes** | Deterministic motion planning, SVG camera viewport and visual transformations. `camera-stage` is **not** the newer CC1 director. Integrate carefully in host scene code; vendoring alone does not make scenes cinematic. |
| `layer-stack` | **Yes** | Paints and edits document layers; **not** a depth-map generator or automatic 2.5D cinema engine. Custom renderer may use its layer painter; video still needs authored parallax/shadows. |
| `scene-template-foundation` (ST1), recipe wrappers including `before-after`, `guided-inspection`, `worked-example`, `layered-cutaway`, `page-turn-story` | **No** | Implemented upstream in [`scene-templates.ts`](https://github.com/YukiUmetsu/kumiki-ui/blob/898bb601eb13ad056168a209677920c7af7dbe5f/registry/video/scene-templates.ts) and [`scene-templates-react.tsx`](https://github.com/YukiUmetsu/kumiki-ui/blob/898bb601eb13ad056168a209677920c7af7dbe5f/registry/video/scene-templates-react.tsx); needs deliberate pin + transitive registry-item installation, compatibility tests and video qualification first. |
| `follow-subject-through-sections` (FS1), `environment-parallax`, `audio-visual-cue`, `frame-accurate-clip`, `cinematic-camera-director` (CC1) | **No** | Current-main candidates for tracked subjects, depth parallax, absolute-frame audio links, frame-addressed footage and cinematic camera direction. Not available in current host. |
| Optional Three.js cutaway/book/glass/world renderers | **No** | Kumiki's advanced examples/renderer slots, not free production-ready assets or a guaranteed GPU export. Review actual geometry, license, device frames and video before integration. |

Upstream [`docs/22-premium-scene-animation-review.md`](https://github.com/YukiUmetsu/kumiki-ui/blob/898bb601eb13ad056168a209677920c7af7dbe5f/docs/22-premium-scene-animation-review.md) explicitly **withholds visual approval** of recipe clips, GPU scenes and 26-scene gallery. Its source tests are not normal-speed MP4 proof. Use [`docs/15-explainer-lessons.md`](https://github.com/YukiUmetsu/kumiki-ui/blob/898bb601eb13ad056168a209677920c7af7dbe5f/docs/15-explainer-lessons.md) and [`docs/visual-production-contract.md`](https://github.com/YukiUmetsu/kumiki-ui/blob/898bb601eb13ad056168a209677920c7af7dbe5f/docs/visual-production-contract.md) as acceptance rules. Do **not** implement the speculative full Composition v2 described in Kumiki rendering proposals.

**Existing ContentGen execution path:** [`produce.mjs`](../apps/web/scripts/video-production/produce.mjs) → `asset-search`/`asset-preparation` → measured TTS/`buildSampleTimeline` → `compileGeneralVisuals`/`planExplainerLayouts` → [`main.tsx`](../apps/web/src/video-export/main.tsx) and [`general-scene.tsx`](../apps/web/src/video-export/general-scene.tsx) → [`VideoExportStage`](../apps/web/src/video-export/main.tsx) frame seek → [`render.mjs`](../apps/web/scripts/video-production/render.mjs) Chromium capture + FFmpeg mux → QA/release. [`production-jobs.mjs`](../apps/web/scripts/video-production/production-jobs.mjs) adapts Rust's existing persisted Jobs DAG; it is **not** permission to create a second scheduler. `render.mjs` already checks plan/build hashes, frame bounds and FFprobe output. Preserve these safeguards.

### Technology decision table: choose per *visual need*, not per buzzword

| Need / example | Use first | Use only if needed | Never use for this |
| --- | --- | --- | --- |
| Correct invoice, arithmetic, form, code, source citations, chart | **SVG/React** using measured text and sourced numbers; overlay on artwork | Kumiki `chart-story`, `DiagramStage`, ST1 `worked-example` **after pin** | Diffusion-generated readable text or numerical labels |
| Recognizable desk/room/landscape, lighting and texture | User-approved image or **local ComfyUI** background; retain provenance | 2–4 foreground/depth-separated planes generated or manually masked | Generic stock replacement or one huge flat generated poster |
| Cutout prop/hand/document without accurate text | ComfyUI inpaint/reference-guided cutout with alpha mask, **then manual check** | SVG vector object when geometry/text must be controlled | Unregistered view-angle prompt sequences as an object turntable |
| Semantic 2D movement: paper slides, amount changes, parts connect | Host React/SVG keyed by **absolute frame**; Kumiki MD1/VT1 once integrated | ST1 `before-after`/`guided-inspection` **after vendor upgrade** | Random CSS timing, perpetual bouncing, cosmetic Ken Burns on a still |
| 2.5D travel / persistent subject through multiple rooms | Three or more registered layers, authored depth/anchors, deterministic camera | Upstream FS1/environment-parallax **after pin and visual QA** | Pretending the camera truly rotated around a flat image |
| Talking guide / recurring character | Current Kumiki `character-presenter` with a properly segmented, licensed rig | Pixi/advanced puppet only after proven capture and mouth/eye QA | A single portrait that bobs while narration plays |
| Real orbit, exploded 3D cutaway, curved page, physical glass | **Only when concept requires actual view-dependent geometry:** authored Blender/glTF or qualified Three.js scene | Upstream optional 3D renderer slot; bake footage if reliable frame seeking fails | ComfyUI angle variants as faithful 3D; unqualified CSS illusion |
| Final video export | **Existing `VideoExportStage` + Chromium + FFmpeg** | Kinetograph adapter only after license, deterministic parity and production review | Feeding model-generated TSX/HTML directly into renderer |

Do not depend on Poly Haven or any catalog having a specific object. **ComfyUI is an image-making tool, not a video timeline, exact typography engine or 3D reconstruction guarantee.** For a repeated object from new angles, use the *same reference image* plus constrained reference/pose/depth guidance and reject shape drift; if a true orbit must be exact, model once in Blender or use a controlled 3D representation.

## 2. Explicit visual and copy contracts

For each **5–9-second teaching beat**, budget one physical/logical action, one focal subject, and a before→operation→after payoff. These are review budgets, not arbitrary rewriting of a complete narration:

| Field | Word/count budget | Example and rule |
| --- | --- | --- |
| Narration | **~12–24 words** at normal delivery, adjusted to measured TTS | “The invoice says fifty. The receipt says seventy. That extra twenty is the mismatch.” Never truncate the spoken script to fit a visual template. |
| Audience caption/headline | **0–9 words**; 1 focal caption | “Where did the extra $20 come from?” Exact editable text only. |
| Object labels | **1–2 labels**, normally **1–4 words** each | `Invoice $50`, `Receipt $70`; keep data as SVG/text. |
| Asset-generation brief | **50–100 words** per distinct image | Subject, silhouette, camera/vanishing point, lighting, palette, empty placement zone, background/foreground separation, exclusions. No rendered letters/numbers. |
| Action direction | **1 action, 3 key states**, at least **1 held result** | Desk → invoice slides in → receipt overlaps → $20 discrepancy circled. |
| Image options | **2–4 contact-sheet candidates** per hero environment, not an open-ended search | Reject poor geometry/lighting before upscaling or masking. |

Keep `onScreenText`/`audienceCopy` separate from `visualChange`/`visualAction`/`learningChange`. The latter are **private instructions**, never audience subtitles. Use original facts/evidence IDs from ContentGen research; never let an image model invent amounts. Word limits are *per visual beat*, not one-line limits on the narration file.

**Contract to implement (not yet a shipped schema):** `VisualBriefV1 = {beatId, claimRefs, subject, initialState, action, finalState, framing, aspect, artDirection, onScreenText, assetRoles[], cueEventIds[]}`. `VisualAssetPackV1 = {schemaVersion, beatId, briefHash, items:[{id, role, mime, width, height, sha256, localRef, alpha, anchor, depth, source, licenseStatus, modelId?, workflowHash?, seed?, referenceHash?}]}`. Roles: `background`, `midground`, `subject`, `foreground`, `shadow`, `overlay`; preserve SVG separately as authored code, not model output. Image assets must have dimensions, hashes, an explicit rights state and valid opaque/alpha bounding boxes; absent depth/anchor means **no parallax assumption**. Schemas must be closed, size-bounded, non-executable and tested before any model output enters a render plan. A model response is a candidate, **not** a trusted asset path or rights declaration.

## 3. Implementation steps and gates (one reviewable PR per slice)

| Step | Exact work and code seam | Proof required before next step |
| --- | --- | --- |
| **0. Baseline** | Freeze one current draft and identify 3 worst scenes. Use `visual-quality.mjs`, existing scene-review coverage and the stored MP4. Record why each fails (wrong subject, generic cards, illegible text, meaningless motion, repetition). | Before/after evaluation sheet, not an aggregate “quality score”. Existing `editorial-copy-leak`/`repeated-schematic` tests pass. |
| **1. Synthetic benchmark; no ComfyUI** | Add `desk-invoice-mismatch` as an **explicit** ContentGen scene choice, with a small host React/SVG renderer beside `general-scene.tsx`. Draw actual line-item text as SVG; desk can initially be simple vector/locally authored illustration. Compile its enter/operate/hold states from the **existing absolute frame** and event timeline. | A **10-second real MP4**: invoice arrives, receipt settles above it, `$50 → $70` mismatch visibly resolves; true frame-seek and human normal-speed pass. Do not ship image generation yet. |
| **2. Versioned brief + asset pack** | Introduce validation modules beside `apps/web/scripts/video-production/`; bind by stable `beatId` (not scene index) after `planExplainerLayouts`. Author `VisualBriefV1` and `VisualAssetPackV1` as documented data validators with negative cases. Extend `general-visual-plan.d.mts` deliberately; keep legacy plans rendering unchanged. | Validation rejects invented refs, untrusted paths/URLs, bad hashes, missing fields, duplicate IDs and wrong aspect; exact synthetic SVG invoices still render. |
| **3. Asset serving + Jobs ledger migration** | Extend existing `asset-preparation` code in `produce.mjs` and allowlisted [`stage-server.mjs`](../apps/web/scripts/video-production/stage-server.mjs) to serve **hash-addressed generated PNG/WebP** from job-owned storage. Today `production-jobs.mjs` only allows `photo`/`video` asset types, one selected asset per beat and a max of 60: version and migrate the ledger before including layered roles. Preserve previously stored ledgers. | Browser can decode alpha assets at selected seek frames; tampered file, symlink, MIME mismatch, remote URL and stale hash fail closed. Jobs resumption never treats a partial pack as complete. |
| **4. Local ComfyUI connector** | Add an **opt-in** local HTTP client at the asset-preparation boundary. Probe configured loopback endpoint, load a committed **versioned API-format workflow JSON**, queue with `/prompt`, poll `/history/{prompt_id}`, fetch approved `/view` outputs. Configure output directory from API response/history, **never assume the desktop UI folder**. Hash exact outputs and record checkpoint/model, sampler, seed, workflow revision, reference image hash. | Without running ComfyUI the job returns `unavailable` and keeps synthetic art; with it, a pinned seed/workflow yields traceable assets. Cancellation, timeout, invalid image, offline endpoint and no GPU are tested. No implicit download/install/checkpoint change. |
| **5. Original multi-layer art** | First ComfyUI workflow: generate 2–4 desk background options **without any text or form**. Choose one and create/mask separate desk surface, hand/prop (if needed), foreground occluder and contact shadow, with shared perspective. Keep visible page data as host SVG. Optional reference-guided inpainting aligns variants; reject an object whose silhouette/corners change across views. | Approved contact sheet + registered PNG/alpha pack. Same desk identity/light direction across three captured frames; edges pass full-resolution zoom; at least 2 independently moving semantic layers. |
| **6. Motion semantics** | Author cue frames on `buildSampleTimeline`, then add a renderer adapter to map absolute-frame progress into subject transforms, occlusion, highlight and shadow. Use vendored MD1/VT1 and `camera-stage` where appropriate; **CC1 needs a later Kumiki upgrade**. Add optical constraints: document slides under hand, its shadow follows, camera holds during reading; use a 0.5–1.0 s unambiguous outcome hold. | Compare frames 0, ~25%, ~50%, ~75%, last, plus the exact event/payoff frames. Seek in random order returns pixel-equivalent semantic poses. Without narration, reviewer identifies the mismatch and its cause. |
| **7. Kumiki recipe upgrade, only after benchmark** | In a **separate PR**, inspect current Kumiki HEAD and select **only** required ST1 recipe(s). Update `apps/web/kumiki.config.json` commit + `items`, run `pnpm kumiki:update` per [`apps/web/README.md`](../apps/web/README.md), review dependency closure/vendor diff, typecheck/build and source tests. Convert benchmark to `SceneTemplateSpec` only if it improves clarity. `SceneTemplateView({spec,frame,reducedMotion,renderAsset?})` and `evaluateSceneTemplate` are scene APIs; `renderAsset` is a **host-owned React callback**, never model-provided code. | No regression to existing scenes, plan schema or export handshake; an **actual captured ST1 clip** visually approved in both aspect ratios. Upstream status remains “candidate” until proven. |
| **8. 45–60-second sequence** | Produce **6–9 teaching beats** with at least **3 distinct subject/action categories** (physical object, evidence comparison, quantitative mechanism), one consistent art direction and visible callbacks to the same subject. Use SVG for chart numbers and Kumiki chart-story for proven quantitative work; never use the same card stack for three consecutive scenes. | Entire voiced MP4 reviewed for continuity, factual correctness, pacing, caption-safe areas and variation. Each beat changes understanding, not just the layout. |
| **9. Automated visual + human gates** | Expand scene quality report with asset-role completeness, copy limits, reveal/payout holds, deterministic seek, alpha bounds, safe areas, image decode, original source/rights and repeated-layout tests. Store up to the existing bounded review-still budget; **do not** assume a zero-warning report proves aesthetics. | CI source/integration tests; saved first/key/last frames, contact sheet, audio-on/off watch; reviewer can fail and re-run **only affected scenes/assets** while keeping immutable prior release. |
| **10. Optional Kinetograph** | Only if Chromium is a measured bottleneck or native motion becomes necessary, prototype a **separate** adapter next to `render.mjs`. Compare exact frame timing, fonts, alpha, shadows, overlays, audio, resume, codec and QA output on the approved benchmark. Check [PolyForm Small Business license](https://github.com/0xS4N4TG/kinetograph/blob/main/LICENSE.md), project eligibility and distribution rights; no model-authored executable TSX/HTML. | Default renderer stays Chromium. Kinetograph remains disabled unless a license decision, security review and real MP4 parity report pass. |

### Exact first benchmark storyboard (30 fps example; retime to measured narration)

| Frames | Subject action, not decorative movement | Auditable viewer result |
| --- | --- | --- |
| `0–44` | Empty desk establishes light, vanishing point and empty document zone; camera **holds**. | Viewer locates the surface; no dummy slide title. |
| `45–104` | Exact SVG invoice (`$50`) slides into perspective; contact shadow follows. | `$50` is legible; paper visibly belongs to the desk. |
| `105–184` | Exact SVG receipt (`$70`) moves over the invoice with distinct depth and a restrained overlap. | Viewer can compare two amounts; nothing morphs to gibberish. |
| `185–244` | Difference becomes a **source-linked** `$20` SVG line/arrow; only relevant values brighten. | The mismatch is demonstrated, not announced. |
| `245–299` | Lock camera and hold the full side-by-side comparison. | Readability and understanding before the cut. |

Use these as **initial timing targets**, not fake narration alignment. On a real job derive cue offsets from measured speech and `plan.events`; fail an action that arrives after its spoken explanation. Do not represent a changing dollar value as image-model texture. Export at the exact existing `manifest` raster/FPS and validate with FFprobe.

### ComfyUI workflow, input, output, and failure contract

1. Configure explicitly: `COMFYUI_ENDPOINT=http://127.0.0.1:8188` (example only; user may choose another loopback port), a chosen installed checkpoint, image dimensions, reference image path and deterministic seed. Probe `/system_stats` or `/object_info` for availability and required nodes; use a **verified** workflow exported in **API format**, not a UI screenshot/workflow graph copied by hand.
2. **Workflow A — environment:** text/reference-guided image generation of a *blank wooden desk with large empty paper placement area*; no visible letters, numerals, invoices, hands or baked shadows for the later document. Export a scene-sized raster with candidate ID and seed.
3. **Workflow B — layer extraction:** remove/segment foreground objects using vetted installed masking/inpainting nodes **or a manual mask**. Transparent PNG/WebP, alpha bounds and shared alignment must survive. A flat background alone is not an animatable pack.
4. **Workflow C — controlled variant:** only where the script really needs a changed pose or viewpoint, reuse reference art with camera/structure guidance. Write an explicit “same subject” acceptance test. If corners, handle count or material drifts, regenerate; do not fake a 3D orbit.
5. Connector receives prompt ID → waits for history completion → selects its output filename/subfolder/type → downloads bytes from `/view` → verifies signatures, image decode, dimensions, hash, alpha, allowed size → moves into job-owned content-addressed storage. Treat returned filenames as **untrusted identifiers**, not arbitrary paths. Store prompt/workflow/seed provenance privately; do not log sensitive prompts or machine paths into Jobs events.
6. One-click production should **not require opening ComfyUI manually for each beat**. It should check that a previously configured service/checkpoint is ready, report asset progress and allow cached asset reuse. If unavailable, use a clearly marked **non-premium local fallback** or stop the premium job with an actionable error; never silently claim the image was generated.

**Deployment note:** ComfyUI installation alone is not setup. The user must have a working model/checkpoint, approved workflow nodes, storage budget, GPU/CPU capacity, and a tested API. Do not hardwire checkpoint names, workflow node IDs or output locations into the application. Store approved workflow templates in a versioned `apps/web/workflows/comfyui/` directory **when Step 4 starts**; until then that path is proposed, not shipped.

## 4. Release decision and quality bars

| Gate | Automated check | Human review | Current state |
| --- | --- | --- | --- |
| Editorial privacy | `audienceCopy` fallback never prints private instruction; `editorial-copy-leak` | Viewer sees no production notes | **Implemented** |
| Repeated schematic | `repeated-schematic` error for three generic repeats | Varied semantic actions, not decorative template rotation | **Implemented** |
| Asset fidelity | Hash/alpha/decode/dimension/anchor/role/rights validation | Subject, hands and shadows look coherent; no gibberish/warping | **Not implemented** |
| Causal motion | Before/action/after cues, deterministic seeks, payoff hold | Silent first viewing explains what changed | **Not implemented** |
| Readable data | Exact editable SVG values, safe rectangles, font readiness | Pause on documents: every number is correct and legible | **Partially available, benchmark not built** |
| Qualified video | Actual MP4, FFprobe, frame parity, bounded stills | Normal-speed 10 s, then 45–60 s approval in both aspects | **Not approved** |

**Definition of done for this upgrade:** a reviewer accepts both 10-second and 45–60-second **encoded** examples, with original relevant visual subjects, meaningful motion, no fake numerals, consistent lighting/art direction, traceable asset rights, and no repeated-slide fallback. No benchmark MP4 = no “quality upgrade complete” claim.

**Review/ownership discipline:** Keep generated art and user character ZIPs out of Git and committed fixtures; use synthetic invoice figures only. PRs must state the changed contract, test command/results, one example MP4/review contact sheet and rollback/fallback. Existing `render-source-plan.json`, `planHash`, `buildHash`, per-segment resume and Rust Jobs are the source of truth. A new asset revision invalidates dependent scene frames, **not** all narration or unrelated scenes.

**Research scope:** Source-inspected both ContentGen's current `produce.mjs`, `stage-server.mjs`, `general-scene.tsx`, `main.tsx`, `production-jobs.mjs`, `kumiki.config.json` and Kumiki `898bb60` ST1/FS1, audio cue, environment, layer stack, render handshake and critical quality documents. This is an API/source audit; no upstream Storybook browser session or GPU filmstrip was run. Upstream visual-quality status is therefore **unverified**, not endorsed.
