# Rendered-scene quality review

## Context

ContentGen authors seven storyboard families, but the general exporter uses a small set of compositional structures. A different natural-language `visualAction` does not itself change the pixels. Long or repeated shot sequences can therefore look identical even when their prose differs.

## Design

Run a pure, deterministic visual preflight against the **compiled renderer plan** inside `compileLiveVisualPreview`, with the original narration beats and stable source shot IDs. Return a non-blocking `quality` report on the existing preview response. Detect:

1. Repeated headlines and narration, including non-adjacent repetition.
2. Three-shot runs of the same schematic structure and substantially identical visible elements without an authored animation/mechanic/scene recipe.
3. Placeholder-level visual elements or a requested cinematic action that only compiles to a generic diagram.
4. Text that cannot fit the actual SVG headline, support copy, and known scene-card dimensions using the renderer's own deterministic text layout helpers.

The report has stable codes, severities, shot IDs, related shot IDs, specific editing suggestions and counts. It must not modify research, the original plan, verified claims, rights, or render hashes. It must not use LLMs, external services, audio, screenshot engines, or filesystem state. Static geometry estimates cannot guarantee browser-level no-clipping; say so.

Video Director shows a compact review summary in Actual Preview, prioritized findings for the selected shot and an expandable all-issues list. Selecting a finding seeks the corresponding real-renderer scene; the existing Edit Shot affordance returns to editorial controls. No fabricated score and no automatic changes to factual copy.

An editable scene-layout selector in the storyboard lets an editor actually change a middle general scene from a flow into a side-by-side comparison or itemized breakdown, triggering visual-only invalidation. Opening, closing, and bespoke recipe scenes keep their dedicated layouts.

## Acceptance

- The existing preview plan and SHA are unchanged; the report is deterministic and source-shot addressable.
- Near-identical stories/visuals raise actionable findings; legitimate three-phase semantic transformation and approved bespoke recipes are not mislabeled as repeated generic slides.
- A too-long card detail is identified without crashing review, while successful fits are not flagged as clipping.
- The panel handles older preview responses with no `quality` field, is keyboard accessible and has no visual warning overlay in exported footage.
- Editing a supported middle shot's family changes the compiled renderer intent without regenerating narration; source and other scenes stay untouched.
- Node tests and existing video-production regressions pass locally. No GitHub Actions runs are requested.
