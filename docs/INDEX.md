# Specification index

**Rule:** each subject has one normative owner. Read the index and the required files for the task; avoid loading the entire pack into a limited-context model.

| File | Owns | Read for |
|---|---|---|
| [01-system](01-system.md) | Product scope, system architecture, boundaries, repository layout | Any new subsystem |
| [02-runtime](02-runtime.md) | Provider contracts, DAG jobs, cache, memory/disk hygiene, local dev | Models, tools, jobs, infra |
| [03-data](03-data.md) | SQLite ownership, constraints, migrations, graph and versioned artifacts | All persistence changes |
| [04-research-seo](04-research-seo.md) | Research Hub, hybrid search, evidence, SEO observations and discovery | Research, SEO, knowledge graph |
| [05-content](05-content.md) | Articles, demo capture, repurposing, learning/course content, performance and freshness | Editorial/educational workflows |
| [06-media](06-media.md) | Graphics, slides, videos, audio, characters, thumbnails and editable scenes | Media tools and renderers |
| [07-experience](07-experience.md) | Premium UI, art direction, design tokens, editor behavior and motion | Any visual or interaction work |
| [08-assurance](08-assurance.md) | Deterministic QA, tests, accessibility, privacy, rights and release gates | Every release |
| [09-products-publishing](09-products-publishing.md) | Brand/project hierarchy, products, package releases, publication and attribution | Catalog, commerce, export |
| [10-build-plan](10-build-plan.md) | Priority order, acceptance fixtures, agent handoff | Every milestone |
| [12-brand-studio](12-brand-studio.md) | BrandKit, curated style presets, visual/sonic identity, consistency and platform layouts | Multi-brand video systems and brand authoring |
| [13-audio-production](13-audio-production.md) | Swappable TTS/alignment, sound event bank, music, mix/master, audio QA | Narration, SFX, soundtrack, captions |
| [15-video-performance-system](15-video-performance-system.md) | Trend/opportunity evidence, distinct title+thumbnail hypotheses, hook/short/long story grammar, analytics feedback | Creative strategy, high-retention explainers |
| [2026-10-21 market scan](research/2026-10-21-video-market-scan.md) | Dated performance examples, surveys, platform trend evidence, topic opportunities | Refreshing current topic hypotheses |
| [14-kumiki-integration](14-kumiki-integration.md) | Implemented Kumiki registry/video handshake and unimplemented boundary | Visual scenes, motion, renderer adapters |
| [11-tools](11-tools.md) | Swappable tool candidates, benchmarks and primary references | New dependencies |

**Code-adjacent fixtures:** [`../examples/core-schema.sql`](../examples/core-schema.sql), [`../examples/research-intelligence.sql`](../examples/research-intelligence.sql), and example JSON for provider profiles, jobs, research, articles/SEO, design tokens, graphics, thumbnails, characters and release manifests. Examples are contracts to adapt and test, **not automatically applied migrations or confirmed third-party APIs**.

**Creative workflow path:** 05,08,12,15 + dated market scan; Kumiki scene compilation → 14; TTS/SFX → 13; validated research snapshots → 04. Never turn public views into a fake CTR/retention/revenue or a causal "viral score."

**Video-first task path:** brand creation → 03,06–08,12; audio → 02,03,08,13; visual/video integration → 06,08,14 and Kumiki's pinned source contracts; platform adaptation → 05,09,12,14.

**Task paths:** research/SEO → 03,04,08; article/editor → 04,05,07,08; media/characters → 03,06–08; catalog/publishing → 03,08,09; runtime/inference → 01–03,08,11. For cross-cutting work, consult the narrowest additional owner file. When guidance conflicts: safety and legal constraints → tested migration/contracts → domain owner → roadmap → examples. Never silently discard user data to reconcile a specification conflict.

**Legacy crosswalk (for existing projects):** previous `00–06,18–20` → 01–03/10–11; `07–09,28–29,30–37` → 04–05/09; `10–13,23,25–27` → 06/08; `14,21–22` → 07; `15–17,24` → 08–09. Preserve application-specific decisions in migration notes rather than keeping duplicate normative specs.
