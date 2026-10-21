# Quality gates, test fixtures, privacy and commercial rights

**Principle:** AI-generated “quality scores” are advisory; release eligibility is determined by testable evidence, source provenance, licenses and human judgment where needed. A beautiful artifact with unsafe claims, missing audio, inaccessible essential text, counterfeit product UI or unauthorized media **fails**.

## Finding / approval contracts

Finding: `{code, severity: blocker|error|warning|info, artifact_id, content_or_scene_revision, location: {element_id,page,frame,timestamp,rect}, explanation, measured_value, expected_rule, evidence_ref, suggested_fix, status}`. Keep structured QA report per revision. `DRAFT → IN_REVIEW → NEEDS_FIX | APPROVED → RELEASED`; any blocker blocks approval. A warning may be accepted explicitly with rationale; approval binds exact hashes/version; changes invalidate related approvals. Never automatically publish from QA pass.

| Domain | Deterministic blocking checks | Additional advisory review |
|---|---|---|
| Research | Source fetch/locator exists, snapshot immutable, legal import scope, cited passage actually supports quoted text, no invented SEO values | Conflict resolution, claim significance |
| Article | Broken links/citations, invalid MDX or metadata, inaccurate fixed product claims, missing source for material claims, inaccessible images | Originality, clarity, helpfulness, narrative flow |
| UI/editor | Critical overflow/clip, missing focus/labels, keyboard trap, invalid required state, unexpected loss of work | Brand identity, aesthetic balance, task friction |
| Graphic/thumbnail | Actual rendered text/element collision, accidental cropping, insufficient margins/contrast, missing asset/font, wrong aspect/profile | Visual hierarchy, attention, small-screen recognition |
| Audio | Missing segment, clipping/undue silence, invalid duration, script transcript mismatch above threshold | Vocal naturalness, pronunciation |
| Video | Blank/frozen frames, missing speech, subtitle/diagram collision, out-of-bounds elements, invalid output, time sync | Whether image truly explains narrated concept |
| Characters | Wrong approved identity/rig/reference, rights absent, asset hash/version mismatch | Outfit/face/proportion drift via human/VLM |
| Product | Broken frozen manifest/dependencies, missing deliverables, expired asset rights, tampered release | Commercial positioning |
| Publishing | No approval, invalid canonical link/schema/sitemap metadata, unapproved external credentials/cost | Marketing claims and disclosures |

**Geometry QA specifics:** post-font-load bounds and text measurement, containment, z/occlusion, clipping, spacing and line-wrapping; intentional overlapping requires declared semantics. Sample animations at keyframes and near entrances/exits/scene cuts plus representative in-between frames. Test 16:9 and 9:16 *independently* at small/actual size. Audio STT verification compares to approved script, and output QA notes tool limitations. Limit automatic fixes to two targeted cycles, then request review.

## Testing matrix

- **Rust/unit:** schema validation, provider errors, DAG cycle rejection, restart/retry/cancel, cache fingerprinting, resource preflight, safe cleanup, graph traversal and permission filters.
- **SQLite integration:** clean create + upgrade, migrations and FK checks, FTS consistency, direct SQL hierarchy cycle/brand mismatch, snapshot history, approved release immutability, thumbnail unique default, idempotency and orphan cleanup policies.
- **Frontend:** responsive/keyboard/JA-EN/reduced motion/zoom, editing + undo, loading/error flows, accessibility via axe-core, real Playwright screenshots at fixed font/environment, stable scroll/focus.
- **Media fixtures:** known overlaps, tiny captions, bad contrast, clipped arrows, broken assets, deliberate black/frozen frames, missing narration, character identity drift, unintended thumbnail occlusion; validators should detect each seeded defect while tolerating explicitly tagged composition layers.
- **Research/SEO fixtures:** two contradictory sources and versions, stale quote, duplicate URL, missing volume vs zero, date/locale/provider mismatch, incomplete Search Console export, cost budget refusal and inaccessible/private source scope.
- **Commercial:** approved release keeps its original bytes after upstream changes, unauthorized voice/asset blocked, no paid/payment/publish API call in offline test.

For subjective craft, compare trusted reference scenes with human review plus task measurements (comprehension, errors, correction time, clarity). Don't optimize to a single aesthetic score. Test key actions via accessibility tooling *and* keyboard/manual checks; automated axe cannot guarantee full accessibility.

## Security and privacy baseline

- Local API binds loopback; enforce origin checks, scoped file paths, size limits, request validation, CSP for rendered previews, safe Markdown/HTML sanitization and restricted embeds. Do not run content from scraped pages; they are untrusted and can contain prompt injection.
- Treat local source documents, voice samples, unreleased products, API keys and paid provider responses as potentially sensitive. Only send to approved external providers with explicit scope. Redact secrets/PII from logs, QA screenshots and demo captures; avoid provider raw prompts in error telemetry.
- Child processes run least-privilege with explicit arguments/timeouts; no network by default, no shell execution of research text, no uncontrolled crawler or attachment access. Preserve consent/authorizations in auditable records.
- Secrets via OS secure storage or ignored env/config; maintain license-rights ledger (model weights, generated outputs, fonts/icons/music, source documents, stock and character references, voice identity, derivative works). A repository's code license **does not determine** its model-weight license.
- Before adoption or distribution, verify each provider's current commercial terms, dataset/model restrictions, attribution, redistribution of bundled dependencies and relevant codec conditions. Research-only models and unlicensed face/voice models must not power commercial releases. No blanket promise of legally safe or trademark-available outputs.
- C2PA/provenance signing is optional: it records supplied production assertions, not factual truth or rights clearance; avoid leaking creator/device details unintentionally. Respect retention and deletion rights without corrupting referenced published releases.
- Paid SEO, remote APIs, social/email posting, checkout/Stripe and external publishing need explicit user action/budget. Repeated schedules prepare a **draft** only. Never interpret a UI click as blanket future consent.

## Ship report template

```text
Artifact/revision + renderer/model/tool versions:
Provenance and rights status:
Tests actually run / environment:
Defects (blocker/error/warning/info) with screenshots/timestamps:
Fixed and remaining issues, approval rationale:
Disk/RAM/cost footprint:
Allowed next action (draft/export/approved publication):
```
