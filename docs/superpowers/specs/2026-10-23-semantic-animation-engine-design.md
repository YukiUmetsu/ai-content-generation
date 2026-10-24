# ContentGen semantic animation engine — design

Date: 2026-10-23
Status: Approved by Yuki on 2026-10-23; implementation in draft PR #51
Target: `YukiUmetsu/ai-content-generation` after PR #51's teaching-state foundation

## Why

Research-generated ContentGen videos can now carry a cited subject and text descriptions of
its **before / action / after** states. PR #51's exported `TeachingStateScene` renders
those descriptions as text boxes joined by an animated line. The viewer still cannot see
the *mechanism*. Repeating that pattern for unrelated topics would produce dull explainer
films despite technically valid motion.

Build a small, reusable, **semantic visual compiler** that turns authored, evidence-linked
operations into concrete motion using the **already pinned Kumiki-UI** primitives. The
video should demonstrate causation, change, movement, comparison, or assembly, while
maintaining identity across shots and showing the result only when it is earned.

## Goals, boundaries, and non-goals

### Goals

1. A new research-backed explanatory sequence can specify *what changes*, the participating
   objects, and the visual operator without supplying arbitrary JSX, SVG paths, or coordinates.
2. Support six reusable operators: `split`, `assemble`, `transfer`, `accumulate`,
   `compare`, `reveal`. All six have a materially different visible effect.
3. Preserve stable actor IDs and poses from problem to mechanism to payoff; animated
   objects remain identifiable and their final state is not disclosed early.
4. Make the Video Director's interactive frame preview and MP4 render share the exact
   deterministic scene implementation and timing.
5. Use Kumiki's pinned transformation/diagram/MG1 recipes wherever applicable:
   assembly, layout, diagram mapping, shared elements, and sequential data flow.
6. Make source provenance, unit honesty, layout safety, and fallbacks deterministic and
   testable without screenshot LLM calls. House Math is the first authoring case; one
   unrelated technical transfer case must prove that the machinery is not house-specific.
7. Propagate and expose the semantic operation in the Research editorial storyboard so
   writers can see and correct it before attempting video export.

### Non-goals in the first increment

- The initial renderer is **2D SVG** with authored procedural shapes; actor asset keys
  remain blocked until a reviewed local registry exists.
  Keep asset IDs and actor poses extensible for a later curated 3D renderer, but do
  not promise 3D playback/export in this increment. Yuki approved this scope.
- Generating arbitrary cinematic 3D scenes from prose; automatic 3D mesh rigging, physics,
  external asset downloads, paid API calls, social publishing, or commercial approval.
- Replacing the entire Kumiki renderer, building a second independent motion clock,
  or adding a parallel unrestricted scene scripting language.
- Supporting shorts/portrait exports before the current YouTube 1920×1080 pipeline
  has been visually verified; the internal layout may be designed for later adaptation.
- Rendering quantitative diagrams from an LLM's numbers. In this increment the new
  six operators are **qualitative**: quantities/lengths require a later explicit
  mapping to an existing source-validated chart contract. Legacy verified or
  clearly illustrative dedicated cost recipes remain unchanged.
- Treating a static Research storyboard still as proof that the encoded MP4 looks good.

### Anti-goals / failure modes

- A text panel flies around while the purported technical subject never changes.
- The LLM emits arbitrary URLs, paths, scripts, CSS, or positions and these reach the
  renderer without deterministic validation.
- An unsupported scene silently renders an unrelated icon, fabricated bar size, or
  generic Before/After card and appears complete.
- A payoff flashes before the payoff frame; the animation clips outside its dedicated
  content region; a new asset lacks commercial-use provenance.

## Alternatives considered

1. **Selected — typed semantic operations compiled to existing Kumiki recipes.**
   Moderate integration cost, strong reuse and deterministic safeguards. Requires an
   explicit object/operation schema and a small visual grammar.
2. Handcraft bespoke HVAC/home/finance scenes. Fastest path to excellent House Math
   samples, but needs a new scene for every topic and fragments the renderer.
3. Let an LLM generate scene JSX/Three.js directly. Broad theoretical expressiveness,
   but fails deterministic layout/security, resource limits, compatibility, and factual
   integrity; unsuitable for an automatic source-based production workflow.

## Source-of-truth contract

Keep the existing `teachingSequences[].visualStates` text contract for narration/editing
and legacy imports. Add an **optional versioned** `visualMechanic` to a sequence:

```ts
interface VisualMechanicV1 {
  version: 1;
  operator: "split" | "assemble" | "transfer" | "accumulate" | "compare" | "reveal";
  subjectId: string;                  // same as technicalSubjectId
  actors: Array<{
    id: string;                       // unique within sequence
    label: string;                    // short, bounded, authored visible noun
    role: "subject" | "part" | "source" | "destination" | "result";
    assetKey?: string;                // an allowlisted local Kumiki asset, NOT a URL
    claimIds: string[];               // known source/illustrative claim refs
  }>;
  operands: string[];                 // ordered IDs from actors, 2..6
  outcomeId: string;                  // existing actor receiving/resulting from operation
}
```

The schema names the *meaning* of an operation, not geometry or easing. The bounded
JSON validator refuses unknown fields, duplicate/unknown IDs, invalid role/operator
combinations, unsafe strings, missing relevant claims, embedded amounts, and
unavailable asset keys. It requires at least two meaningful actors and 2–6 operands;
each operator's cardinality/role requirements are explicit. `outcomeId` may be hidden
until payoff. No arbitrary code, URI, SVG markup, model-provided pixel coordinates,
or externally downloaded asset enters this contract.

The generation prompt sees research claim IDs, technical subjects, existing shot IDs,
and a small operation menu with examples. It must choose an applicable operator and
provide actor labels tied to claims. The mechanic is **required for newly generated
technical teaching sequences**; if none is supportable, the editor shows a blocking
preflight finding and no automatic production/export starts. Unchanged legacy saved
plans without `visualMechanic` continue through the current text fallback renderer,
but that fallback is never silently presented as a fully visualized new production.

## Compilation and rendering

1. **Research → preproduction.** Validate that the mechanic's subject exists in the
   sequence's shots and actor claims exist in the dossier; refuse explicit numeric
   amounts/scales in mechanic actor labels. Preserve `visualStates` for editable text.
2. **Preproduction → video job.** `preproduction-render-bridge.mjs` projects the
   validated mechanic into `beat.visual.direction.visualMechanic` for matching
   problem, mechanism and payoff beats. Preserve the special home-cost recipe, charts,
   and analogy routes; never overwrite bespoke, verified visuals.
3. **Job contract.** `job.mjs` accepts the optional bounded specification and rejects
   unknown keys, unregistered assets, invalid references, or quantity/operator
   inconsistencies before any browser or voice API starts.
4. **Pure semantic scene compiler.** A new `compileSemanticMechanic` transforms the
   contract into named actor poses, a transition graph, a shared timeline, and a
   deterministic safe-region layout. It maps onto Kumiki's `createAssemblyTransformation`,
   `createLayoutTransformation`, `createDiagramTransformation`,
   `createSharedSceneTransformation` and existing MG1 flow recipes, rather than
   duplicating those algorithms.
5. **One SVG/React scene.** A `SemanticTeachingScene` consumes the compiled poses,
   current absolute frame (via `getGeneralFrame` / existing motion sampler), and
   registered actor visuals. It is used unchanged in Video Director and frame capture.
   All operations occur in the content area currently reserved on the right
   (~x1040–1820, y230–920 in 1920×1080). Minimal text labels identify actors;
   visual movement, separation, accumulation, comparison, or masking carries the idea.
6. **Research storyboard.** Persist/edit the same mechanic in the semantic storyboard,
   with an operator selector and actor reference/label controls. Its static editorial
   preview renders an identifiable planned pose sourced from the mechanic rather than
   fabricated HVAC objects. It must explicitly identify itself as a planning still.

### Operator semantics

| Operator | Visible behavior | Required meaning |
| --- | --- | --- |
| Split | One assembled subject separates into labeled, persistent parts | Part-of relationship |
| Assemble | Distinct parts move into a single recognized system/result | Assembly/composition |
| Transfer | Same identifiable token moves from source through path to destination | Movement/flow |
| Accumulate | Distinct contributions visibly join a running whole or stack | Addition of elements; no unsourced lengths |
| Compare | Two subjects occupy a common labeled axis or matched side-by-side frames | Explicit comparison basis; no implied rank |
| Reveal | Occluder/overlay exposes an existing hidden layer with context maintained | Hidden but evidenced component |

Each operator defines a distinct problem pose, mechanism progression, payoff pose
and reduced-motion still. Do not automatically equate every `after` label with a
physical transformation. If the data describes an abstract idea without a credible
operator, show an actionable unsupported-scene notice in editorial review.

### Initial demonstration fixtures

- **House Math / split:** an installed HVAC quote visibly separates into equipment,
  labor, ductwork and permits. Use categorical parts, not financial values or
  bar lengths, until the source-validated quantitative contract can be linked.
- **House Math / accumulate:** property tax, insurance, maintenance and financing
  join a qualitative total-ownership-cost diagram. No numeric values or scaled bars
  are rendered by these new operators in this increment.
- **Different domain / transfer:** a network packet moves through named network
  nodes while preserving its identity; demonstrates the same grammar outside finance.

## Asset registry

Actor `assetKey` selects from a reviewed local registry, which stores a stable key,
domain, available states/poses, fallback silhouette, source location, license type,
commercial-use conditions, attribution requirements and pinned revision/hash.
Only a known key may render. Assets whose license/attribution cannot be verified
cannot enter commercial-ready exports. Generic procedural SVG objects remain available
for safe abstract domains. Prefer existing Kumiki tokens and vendor-pinned assets.
The initial registry contains **2D SVG/icon variants only**; a later 3D adapter
can reuse the keys and provenance fields without injecting meshes into SVG.

Asset-key lookup and frame layout are deterministic: no silent browser fetching,
license guessing or generative background imagery. Unrecognized assets fail
preflight with an editable suggestion; they do not degrade to an unrelated picture.

## Timing, visibility, and QA

- Share one video frame clock; expressions must be pure in `frame` (seek/replay invariant).
- Problem shows the initial actor topology only. Mechanism animates an operation without
  exposing the conclusion early. The **first payoff frame** reveals nothing about the
  result; the final scene progressively reveals the authored outcome. In reduced motion,
  show a clear final still only when the payoff has begun.
- No motion outside safe bounds; viewport, title, captions and diagrams cannot overlap.
  Actors, text boxes, connectors and camera region get deterministic bounding-box checks.
- Compare sampled frames at 0, 10%, 25%, 50%, 75%, 95%, and final for geometry and
  continuity, plus phase-boundary frames. Check hidden outcome and stable actor IDs
  without using an LLM to inspect screenshots.
- Test validated plan → job → frame-renderer selection with every operator, plus
  malicious/invalid JSON, missing claim, amount embedded in label, duplicate actor,
  unsupported asset, legacy fallback and seek determinism.
- Run full web lint, typecheck, Vitest, video-planning/mock-production, production build.
  Then actually watch a generated film at normal speed and run one local consented
  browser-to-FFmpeg MP4 export before moving a draft PR to ready.

## Implementation boundary

First implementation is one coherent larger PR or an extension of draft PR #51,
depending on whether it has been merged at execution time. Do not overlap the
separate Jobs & QA HTTP 502 debugging task. No publication, provider consent,
spending, or repo merge is implied.

Likely code touchpoints:

- `apps/web/scripts/video-production/{preproduction-generator,preproduction,visual-pedagogy,preproduction-render-bridge,job}.mjs`
- `apps/web/src/video-export/{general-scene,teaching-state-scene}.tsx`
- New `apps/web/src/video-export/semantic-mechanic-{types,compiler,scene}.*` or
  similarly cohesive small modules and focused tests.
- `apps/web/src/features/storyboard-planner/model/{types,serialize,validate}.ts`
  and `components/{SceneEditor,ScenePreview}.tsx`
- Existing pinned `apps/web/src/components/motion/` APIs, imported without
  directly modifying vendored Kumiki source.

## Builder-owned decisions

- Precise iconography, spacing, palette within the existing premium visual language.
- Exact actor role/cardinality table beyond required structural limits, as long as
  every operator has an honest teaching meaning and deterministic regression tests.
- The smallest compile-time adapter from Kumiki VT1/MG1 samples to the existing
  SVG stage, without a second clock or arbitrary geometry from the model.

## Approval checkpoint

The **2D-first** scope, this contract, six operators and three demo scenarios were
approved. The draft PR
remains unmergeable
on quality grounds until real playback verifies that the resulting film actually
shows the described mechanism.
