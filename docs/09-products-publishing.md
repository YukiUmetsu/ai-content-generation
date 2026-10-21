# Project hierarchy, products, publishing and conversion

## Brands, projects and reusable assets

**Brand** holds identity, editorial voice, languages and design tokens; owns many root projects. **Project** has exactly one brand and optional parent project of the same brand; nests arbitrarily (checked for cycles). Projects group content, source collections, workflows and product-building work. **Product** is a separate catalog entity under a brand; it may link to any number of its permitted projects and freeze specific deliverables. **Character** is an independent versioned identity, shared only with explicit rights approval. **Artifact** bytes are stored once and referenced by IDs/ownership, not duplicated on drag/drop.

UI: tree search, create/move/rename/duplicate, selection, keyboard and undo; show inheritance and overrides, dependencies/`used by`, safe deletion preview. Default create flow asks one meaningful choice at a time. Large advanced panels for licenses, providers or pricing are contextual, not mandatory before creating a project.

## Brand inheritance and immutable creative identity

Brand holds a versioned BrandKit (approved palette/type hierarchy, art direction, narration persona, sonic palette, motion grammar, storytelling policy, supported languages and delivery recipes). Projects inherit an approved revision; episodes may request mood and destination-safe overrides with clear provenance. Platform deliverables may derive from one semantic master but **must reauthor** layout/captions/shot structure to match portrait or landscape. Video export packages freeze voice-provider/model/rights, selected SFX/music hashes, font assets, brand revision, editorial evidence and output profile. See [12](12-brand-studio.md), [13](13-audio-production.md).

## Product lifecycle (payments later)

`Draft product → selected variants (language, format, edition) → assembled deliverables → rights/provenance/QA → approved immutable release manifest → export package`. Manifest pins exact content/artifact revision and SHA-256, language, license/terms, metadata, cover/thumbnail, file formats and customer-facing contents. New changes create a new release; they never mutate existing approved packages.

Commerce-neutral model: local products/variants/offers and optional provider reference mapping. An offering may be one-time or recurring with currency in minor units; a later Stripe adapter maps local IDs to Stripe Products/Prices/Checkout IDs, handles idempotent webhooks and entitlement delivery in a separate service. No Stripe accounts or SDK required for early catalog features. Don't infer tax compliance or refund rules from product creation. A product can be exported without ever being sold.

## Publishing contract

`prepare(package, destination)` checks exact asset versions, source licensing, citations, localizations, page metadata, canonical URL and QA; creates preview/branch/PR or a local export. `approve(publish_plan)` binds actor/time/revision/destination; `publish` acts once via provider adapter with idempotency and auditable remote reference; partial failures are resumable and do **not** silently repost. Git/draft export is MVP. Publishing targets (MDX site, CMS, YouTube, newsletter) are optional plugins with platform-specific capabilities and actual authorization. Read destination code/schema before implementation; never assume API support from the site's home URL.

**Article package:** `article.mdx` + typed frontmatter/metadata + sanitized HTML if needed + images in supported formats + alt/captions + structured data + source manifest + internal link/canonical plan + QA report. **Video package:** scripted scene/timeline, voice/caption tracks, rendered MP4, cover thumbnails, rights and render manifest. **Course product:** objective map, ordered lessons/exercises/media, student downloads, verified answer keys and immutable release record.

## Product-led content and analytics

Tie articles/videos/courses to relevant products via transparent CTAs and optional first-party campaign attribution. Capture aggregate search/distribution conversions with date/window/source, privacy and consent policies. Do not confuse traffic with revenue or overstate causal attribution. Track affiliate/product owner disclosure where relevant. Experiment with titles/thumbnails on platforms that actually support it; don't fabricate A/B winners from model opinions.

**Acceptance:** move a nested project without broken references; preserve rights scope; assemble an approved product from two distinct projects without duplicating bytes; update a source artifact but prove released bundle hash remains unchanged; prepare one article PR and one local video package, with deliberately missing approval blocking remote publication; export offline without credentials.
