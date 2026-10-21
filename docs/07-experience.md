# Premium experience, design foundations and visual editing

**Quality philosophy:** premium does not equal glassmorphism, minimalism or a specific color palette. It means *obvious priorities, composed typography/spacing, trustworthy behavior, control, legible teaching visuals and refined motion*. Evaluate actual use, not just attractive screenshots. The studio UI should be calm and efficient; articles are editorial/readable; explainers can be cinematic while remaining instructional. Brand expression differs; quality gates remain shared.

## Interaction and information architecture

Primary navigation: **Projects, Research, Create, Content, Assets/Characters, Products, Jobs/QA, Insights, Settings**. Show the current context (brand/project), current objective and one clear primary action. Detail appears progressively: basic create workflow first; provider configuration, complex export settings, token customization, licenses and raw job logs on demand. Avoid large text-dense dashboards, tiny labels, modal cascades and deeply nested navigation. Allow keyboard search/command access, undo, cancel, resume and contextual help. Search results expose passage provenance and actionable related content rather than decorative graphs.

**User paths:** Research `search → inspect evidence → save/annotate → build brief`; content `choose topic → outline → write → visual → QA → approve`; video `script → storyboard → preview → edit → render`; product `choose assets → validate rights → freeze release → export`. Every path needs honest loading, empty, success, failure, progress and interrupted-job states. Do not fake percentage progress or silently erase edits.

## Design tokens and responsive system

Use a versioned, DTCG-compatible token source, compiled to CSS and renderer parameters. Three levels: foundations (`space.4`, `neutral.900`), semantic intent (`surface`, `action.primary`, `text.muted`), and component (`dialog.radius`, `timeline.rowHeight`). Separate **brand**, **light/dark**, and **density** (comfortable/compact/editorial) axes. Snapshots pin the exact token/font versions used for published assets. See [`design-tokens.json`](../examples/design-tokens.json) for an illustrative source.

| Decision | Suggested starting point; exceptions documented |
|---|---|
| Typography | Interface body 16px default, readable helper ≥14px, deliberate headings; long article 16–19px with ~1.5–1.7 line-height and 60–75ch measure |
| Spacing | Scale 4/8/12/16/24/32/48/64px; group-related spacing < between-sections spacing; media template may use its own proportional grid |
| Controls | Predictable hit targets; ~44px comfortable touch controls where practical; clear focus ring; never rely solely on color |
| Color | Semantic surface/text/border/accent/feedback roles; target WCAG 2.2 AA contrast (4.5:1 ordinary text, 3:1 qualifying large text) |
| Layout | Browser/responsive breakpoints by content, not arbitrary device name; test 360/768/1280/1600px, zoom 200%, long English/Japanese strings |
| Motion | CSS for simple feedback; spring/layout animation only when it aids continuity; default hover 100–150ms, menus ~150–220ms, dialogs ~180–260ms; reduced motion removes nonessential movement |
| Images/video | Composition at intended display size, meaningful hierarchy, sensible safe areas, no compressed dense text, consistent art direction |

Values are **starting heuristics**, not universal standards. Some professional grids need higher density; they still must remain legible. Preserve platform-native interaction conventions rather than inventing novel controls to look distinctive.

## Component contract and customization

Reusable UI components accept semantic variants, density, theme tokens, `className`/slot composition and controlled/uncontrolled state where sensible. Preserve keyboard and screen-reader behavior under customization. Choose accessible headless primitives (Base UI, Radix, React Aria, existing house library such as Kumiki UI) by actual need; **do not make any one library a core Rust dependency**. Avoid custom accessibility mechanisms when vetted primitives suffice. Visual editors must preserve stable element IDs, editing constraints and undo history; distinct preview and exported visual specs must be traceable.

Component states to showcase/test: default, focus-visible, hover, disabled, loading, invalid, error, empty, overflow/truncation, high contrast, dark, Japanese text, reduced motion, touch, keyboard. External assets must include alt/label/rights and failure fallback.

## Art direction and storytelling

**Visual choice follows explanatory goal.** Compare → split-screen; causality → progressive flow; hierarchy → nested architecture; change → before/after; measurement → honest chart; process → step progression. Use approved source evidence for statements in captions and diagrams. One focal point per screen, deliberate typography, whitespace, controlled palette, precise alignment and restrained texture. Don't use generic floating spheres, unrelated stock imagery, unreadable code or excessive transitions. Character presenters should support explanation—not obscure critical diagrams.

Video motion is a teaching instrument: reveal causal links gradually, align labels to narration beats, hold complex states long enough to read, avoid strobing and camera moves that impair comprehension. Ensure Japanese typography wraps naturally, subtitles don't mask evidence, and both normal/reduced-motion outputs convey essential meaning.

## Performance and review loop

UI: respond to input immediately and offload heavy jobs; preserve focus/scroll/state; avoid layout shifts and animated reflow of working text. `INP ≤200ms` is a **website field-performance target**, not a guaranteed local app metric. Measure actual task completion, error rate, recovery, layout stability and user-perceived clarity. A subjective premium score cannot override accessibility or functional failures.

**Design review loop:** objective + audience → component/token selection → basic interaction → real data/edge cases → visual/motion polish → screenshots at required sizes and states → deterministic geometry/contrast/keyboard tests → human visual approval. Maintain a small library of exemplary article/infographic/video scenes rather than hundreds of mediocre templates. Any new pattern must explain when **not** to use it.

Research anchors: [Apple HIG](https://developer.apple.com/design/human-interface-guidelines), [NN/g heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/), [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [DTCG tokens](https://www.designtokens.org/), [web.dev INP](https://web.dev/articles/inp/), [Motion accessibility](https://motion.dev/docs/react-accessibility).
