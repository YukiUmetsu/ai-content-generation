# Cinematic Visual Director for ContentGen — Design

**Status:** proposal for Yuki's review (2026-10-22). No implementation approval yet.
**Related contracts:** `docs/08-assurance.md`, `docs/12-brand-studio.md`, `docs/13-audio-production.md`, `docs/14-kumiki-integration.md`, `docs/15-video-performance-system.md`, `docs/16-creative-pattern-library.md`.

## Intent

Make ContentGen's default **new general explainer** a premium cinematic educational film: evolving 2D/3D objects, meaningful diagrams, evidence-aware comparisons, expressive narration, and deliberate camera movement. Use punchy kinetic hooks, surprises and reveals at pivotal moments; do not apply high-intensity short-form edits continuously to an eight-minute lesson. The viewer must understand the claim and remember its answer, not merely watch elements animate.

### Goals

1. Prevent repeated, nearly static slide layouts across both a 60–90-second and an 8–10-minute video.
2. Make central questions, misconceptions, explanations, evidence and payoffs visually legible at the moment they are spoken.
3. Deliver expressive, authorized Fish Audio or local narration using beat-specific direction and measured audio timing.
4. Compile safe, deterministic, data-driven shots using **existing supported Kumiki** primitives; create reusable Kumiki primitives only where a capability is actually absent.
5. Report structural quality findings cheaply without per-frame LLM vision, invented engagement scores, or expensive media renders in CI.
6. Remove debug chrome (page count, progress strip, frame counter, generic header) from the authored film. Preserve review/rights status and never misrepresent a test-only draft as approved content.

### Non-goals and anti-goals

- No arbitrary JSX/code generation, invented Kumiki APIs, new media clock, or ContentGen-specific copies of Kumiki visuals.
- No unapproved publication, provider transmissions, model downloads, paid Fish fallback, or bypass of rights and human sign-off.
- No guaranteed retention prediction; metrics are review signals, not a `viralScore`.
- No blanket rule to cut every 2–3 seconds, add a camera move to every shot, or force upbeat emotion across the whole narration.
- Do not expand the first vertical slice to House Math, 3D asset authoring, or complete word/phoneme alignment. Existing House Math jobs remain functional.

## Current system and the bottleneck

`topic-generator.mjs` asks a local model for 4–9 short or 20–45 long narration beats and only five generic intents (`intro`, `flow`, `comparison`, `breakdown`, `payoff`). `general-visual-plan.mjs` maps each beat to a chapter with short entrance animation and often a long unchanged hold. `general-scene.tsx` renders a mostly fixed left-copy/right-diagram composition, even when chapter intent changes. It hardcodes a chapter counter, progress line and changing `DRAFT · {frame}f` text. The narration orchestration typically assigns one measured direction to all beats; the Fish adapter currently uses pace but ignores authored emotion. The audio and creative docs describe richer capabilities than the shipped general renderer uses.

The current flow's *narration beat = one slide* assumption must be removed. One spoken explanation can contain several meaningful, temporally ordered visual shots.

## Approaches considered

| Approach | Tradeoff | Decision |
|---|---|---|
| Cosmetic renderer + a few extra templates | Fast, but long-form repetition and weak teaching survive | Not sufficient |
| **Versioned ContentGen director plan → existing Kumiki motion and rendering** | Moderate schema/compiler effort; testable and reusable | **Selected by user** |
| Arbitrary generated scene code and effects | Many visuals, but weak consistency, security and deterministic QA | Rejected |

## Experience and default style

Use a coherent BrandKit throughout, but diversify **shot language**: hero question, typography emphasis, object/system reveal, exploded/cutaway explanation, process journey, quantitative story, qualitative comparison, cause-and-effect transformation, evidence focus, camera inspection, and payoff/synthesis. Compose some shots full-bleed, some close-up, some spatial, some typographic. Never randomly switch family just to satisfy a diversity quota. Maintain continuity when teaching a single mechanism; vary when the argument advances.

The edit grammar follows `promise/question → mechanism → demonstration/evidence → surprise/contrast → qualified answer`. Each narrative claim requires a visual purpose: establish, compare, transform, locate, quantify, test, or summarize. Spoken critical questions must be shown on screen or enacted unambiguously, then linked to a later answer.

### Contract and ownership

Create a versioned, declarative `cinematic-director-plan/v1` artifact owned by ContentGen. It references a validated existing `video-production-job/v1`, BrandKit revision, source/claim IDs, and stable beat IDs. It contains:

- `styleId: cinematic-explainer-v1` (default for newly generated general drafts, not silently applied to old jobs).
- `narrative`: per-beat role (`question`, `hypothesis`, `mechanism`, `evidence`, `comparison`, `reveal`, `payoff`), objective, optional question/answer link, and bounded source-backed facts.
- `voice`: provider-neutral mood, pace, pauses, emphasis and optional audition priority per beat; providers declare which directions they support.
- `shots`: 1–N ordered, bounded shot specs per beat. Each has a stable ID, supported family, semantic subject and change, visible copy, optional sourced quantitative data, a narration cue, and declared visual assets. No free-form executable code.
- `timing`: cue mapping to measured beat samples/frames; report whether the cue was exactly aligned, provider-aligned or estimated. Do not label estimated word timing as synchronized alignment.
- `provenance`: compiler version, prompt version, asset/BrandKit revision, source IDs and decision metadata for repeatable export.

V1's director plan is a **companion derived document**, not an unversioned expansion of arbitrary fields in existing jobs. The producer reads the validated job plus validated matching director-plan snapshot; no-director jobs retain the current legacy renderer. Topic/manual draft creation should persist the plan alongside the editable draft with stable IDs and reuse it when re-rendering. Editing narration or shot dependencies invalidates only the affected downstream artifacts.

### Visual compilation

The ContentGen director selects a bounded family and semantic parameters, then hands a deterministic specification to current Kumiki primitives. Start with six truly different implemented visual treatments based on verified current capabilities: (1) hero question/answer, (2) process journey with moving focus, (3) quantitative story including lawful provenance, (4) qualitative comparison with state transition, (5) focused information/number reveal, (6) mechanism/object transformation using authored SVG/approved assets. Grow to ~10–12 families after actual review demonstrates distinct value; do not count recolored versions of one geometry as variety. Advanced 3D and cinematic camera features remain opt-in only where the pinned Kumiki surface genuinely implements them.

Shots must be compilable at any integer frame, with no randomness at playback, and safely fit both supported aspect ratios via independent compositions, never a scaled crop. A missing required visual/asset must produce a visible editorial finding, not silently revert to the same generic slide. Use BrandKit identity while allowing shot-dependent layout/camera/staging. Keep consequential source and uncertainty labels when the explanatory visual needs them.

### Voice and sound

Rewrite narration for speaking rather than reading: purposeful sentence lengths, questions, contrasts, breath and cadence. Direct each beat independently. The Fish adapter may map supported S2 expression cues and bounded prosody/sampling parameters; an unsupported local adapter must report lost expressive capabilities instead of quietly pretending to apply them. Audition representative calm, curious, surprising and explanatory clips before standardizing presets. ContentGen must never silently change to a paid model. Cache includes provider/model/version/voice/text plus applied direction. Retain exact sample-count-based timeline and FFmpeg checks. Existing SFX policy remains semantic: sound marks an actual reveal, comparison or transition, with speech-priority mixing and rights gate.

### Structural and render QA

Hard failures: invalid/invented shot family or unsafe fields; orphan central question/payoff; director beat ID mismatch; unresolved required evidence or critical asset; missing narration for a beat; commercial rights/approval violations; source-backed quantitative facts visualized without required provenance; debug chrome on publication-ready output. Test-only exports remain clearly marked as unapproved in a non-misleading way without showing a frame/page/progress HUD.

Warnings: consecutive identical family **and geometry** without explanatory rationale; extended unchanged visual while a new claim is spoken; spoken central question without planned visual prominence; one layout dominating long-form duration; unsafely dense onscreen copy; too-brief labels; monotonous repeated voice direction; unusually flat delivery proxies. Preserve intentional quiet holds and a recurring visual when semantic continuity justifies them. No hard-coded "change every X seconds" editing gimmick.

Director's report: shot map with frame/time ranges, family histogram, repeated-composition runs, longest meaningfully unchanged interval, question→payoff coverage, source/rights findings, voice-direction profile, approximate vs measured cue flags, and a small manually inspectable contact sheet. Compute structural QA without screenshot LLM. Normal-speed human review remains required for polish and perceived naturalness.

## Delivery slices and acceptance

**Slice A — story + voice direction + clean export.** Add companion schema/validation and persistence to new general drafts; explicit question→answer mapping; Fish/local per-beat direction mapping with provider capabilities; render without debug counters; preserve test-only marking. Fixture verifies question rendering, missing payoff rejection, normalized speech duration, direction/cache determinism, legacy compatibility, errors/cancel/budget/rights paths.

**Slice B — shot compiler + Kumiki variety + QA.** Support multiple shots per narration beat, six distinct meaningful families, measured timing transitions, repeatable seek/frame output, diversity/readability report and two real preview cuts. Prefer one or two substantial PRs, not many cosmetic PRs.

Acceptance fixtures: (1) 60–90 s concept teaser including an explicit question, evolving diagram and satisfying answer; (2) coherent 8–10 min explanatory film (e.g. HVAC replacement costs) whose repeated shots, visual holds and question coverage can be audited from the director's report. All core unit/contract tests run offline; provider calls and real browser→FFmpeg playback remain opt-in manual verification. Visually inspect at normal speed and final 16:9 size, with additional 9:16 layout tests where the feature is supported. Compare viewer recall of the central question/answer and subjective naturalness against the previous film; neither can be certified by unit tests.

## Open builder decisions

- Select the first fixture topic and licensed visual/voice inputs based on what is available; default to the existing general explainer smoke fixture, then the HVAC cost long-form fixture.
- Establish concrete warning thresholds only after baseline measurements from both cuts; do not pretend universal attention thresholds are facts.
- If word-accurate forced alignment is unavailable locally, ship honest estimated sentence/beat cues before adding any new heavy model; seek explicit download approval when required.
- The design does not authorize external publication, payment or broad repository refactoring.
