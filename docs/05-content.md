# Content, demonstrations, learning and performance

## Shared content model

Every creation starts from a **ContentBrief**: `{project, audience, language/market, intent, learning_or_business_objective, evidence_collection, format, constraints, brand_profile, due_date}`. All derived outputs link back to research source snapshots/claim IDs and retain generator + reviewer provenance. Categories (technical tutorial, science, privacy, business, product education, marketing, etc.) are tags and templates, not hardcoded output types.

## Evidence-backed article workflow

`SEO/research brief → audience questions → outline → section drafts → examples/experiment → citations → visual brief → accessible graphics → editorial/factual QA → approved content revision → MD/MDX/HTML export`.

Persist typed `ArticleDoc` with language, canonical slug, title/description, section IDs, paragraphs/code/callouts/media placements, sources/passages, target keyword/intent, internal-link suggestions and revision history. **Do not generate one giant Markdown blob then guess structure.** Output MD/MDX, metadata, alt text, semantic headings, sanitized schema.org BlogPosting/Article JSON-LD where appropriate, sitemap-ready URL, image optimization and relative/absolute citation references. Keep unpublished drafts independent of publishing target.

**Editorial rules:** useful question answered early, strong examples and original experiments; clear progressive explanation, compact paragraphs, meaningful section headings, correct technical claims, contextual calls to action (disclose self-interest), no keyword stuffing or inflated text length. SEO metadata and sourced claims are validated separately. A reviewer can mark `verified`, `disputed`, `needs_source`, `estimate`, `opinion`; unsupported security promises block publishing. Store side-by-side changes and selective regeneration.

## Brand-aware narrative content

A visual content brief resolves to a pinned approved BrandKit (editorial voice, factual policy, art direction, narration persona, sound palette and motion grammar) before storyboard compilation. Episode mood can vary within approved bounds; platform versions adapt script structure, opening, shot pacing and layout rather than only truncating or cropping. Do not replace provenance with a stylish graphic. See [12](12-brand-studio.md).

## Repurposing and localization

`source topic/research` → shared concept outline → format-specific stories. Blog, full explainer, Short, slideshow, infographic, newsletter, social post, worksheet and course lesson must **adapt** to distinct audiences and platform constraints, not merely truncate or translate. Preserve claim/evidence alignment and product capabilities. English/Japanese: terminology glossary, locale-specific queries and SEO, line breaks, text expansion, captions, pronunciation, translated on-screen graphics, independently rendered 16:9/9:16 compositions and voice consistency. Report untranslated or unsupported terms.

All derivatives record parent content revision + transforms + locale + QA. Changing source evidence marks dependent outputs `review_required`; don't silently replace approved exports.

## Demonstration Studio (real software, not fake screenshots)

Scenario schema: app/test build fingerprint, fixture/sample data, preconditions, allowed actions, expected UI/result assertions, capture target, privacy masks, narration beats and cleanup. Use Playwright for browser apps and OS-level automation/harness for desktop, OBS/WebSocket or compatible local screen recording, then annotate real captures via video renderer. **Never fabricate product UI states** to illustrate supposed functionality. No personal account data in demo fixtures.

Flow: prepare fixture → perform actual interactions → assert results → timestamp capture → clean/blur secrets → choose key actions → narration/script aligned to real steps → motion highlights → QA. A failed assertion blocks demo publication; retain raw-capture provenance and generated edit decisions. First acceptance fixture should be a disposable dummy application.

## Interactive lessons and courses

A course has audience, outcomes, prerequisites, ordered modules, lessons, exercises, rubrics, assets, expected time and product release mapping. Graph prerequisites may suggest ordering but are instructor-reviewable. Lessons combine articles, videos, visual simulations, practice, prompts, quizzes and checkpoints. Generate assessments from explicit objectives, include verifiable answer keys and explanations; for code exercises use sandboxed tests, not LLM scoring alone. Interactions should be keyboard accessible and locally previewable. Export portable packages/HTML/JSON; optional H5P adapter when license/format fit.

Minimum use case: one concept → short explanation + interactive exercise + deterministic assessment + downloadable asset; course package includes manifest, prerequisites and source-linked references.

## Content intelligence and experiments

The feedback loop is `publish → permitted metrics import → identify evidence-backed opportunities → propose hypothesis/variant → run legitimate experiment → compare → apply reviewed revision`. Store metrics as dated windows with origin, unit, provider, dimensions, incompleteness; connect to exact content revision and campaigns. Do not equate impressions with views or infer product purchases from clicks; conversion requires permitted first-party measurement, clear attribution limitations and user consent where applicable.

Examples: Search Console shows high impressions and low CTR; compare title/snippet hypotheses. YouTube retention shows drop during unexplained scene; propose a better diagram/sequence. Thumbnail A/B: store variants and experiment assignment/evidence; platform-native experiment outcome is preferred to fabricated offline scores. Any heuristic ranking is labeled an estimate and does not silently trigger replacement.

## Maintenance, distribution and product journey

Sources/SDKs/products/SEO positions can change. Monitor opt-in links/release notes and compare snapshots → compute impacted claims/graph relationships/articles/graphics/courses → open review proposal with citations and estimated work → regenerate affected components, **never overwrite published releases**. Distribute approved platform-specific packages via adapter (filesystem/branch/PR first; remote APIs later), with canonical URL, license, metadata, consent and disclosure checks. A transparent conversion funnel can link valuable free content to relevant product releases through tagged links, without dark patterns or invasive tracking.

**Accept:** given one research collection, create a cited readable article; regenerate a changed section without losing linked art; capture one real 20–40s dummy-app demo; produce English/Japanese derivative with checked technical terms; create one interactive assessment with verifiable answers; import metrics without confusing unknown with zero; report affected content when source snapshot changes.
