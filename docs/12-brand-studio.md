# Brand Studio — reusable visual, narrative, motion and sonic identity

**Owner:** ContentGen owns brand selection, editable kits, inheritance, production policies and approved revisions. Kumiki-UI owns composable visual/motion primitives; providers render speech, sound and video. This document is normative for brand identity. See [06-media](06-media.md), [13-audio-production](13-audio-production.md), [14-kumiki-integration](14-kumiki-integration.md).

## Goal and user experience

Create a coherent, distinctive brand quickly, then generate consistent YouTube long-form, YouTube Shorts, TikTok, Instagram and Facebook deliverables without authoring each design from scratch. Premium = clarity, intentional hierarchy, originality, stable identity and quality control; it is **not** a universal glass/gradient/animation preset.

**Fast path (target: under two minutes, validate with usability testing):**
1. Enter brand name, audience and subject, plus a one-sentence personality/positioning statement.
2. Choose one curated **art-direction starting point** (modern technical, calm editorial, cinematic investigative, playful education, archival, nature documentary, traditional Japanese, etc.) and optional mood (calm, curious, thrilling, ominous). Presets are starting configurations, not immutable labels or inferred cultural identity.
3. Pick a palette proposal and typography pairing from accessible, font-licensed alternatives. Show large type and numerals over light/dark scenes and a thumbnail at small display size. Allow a single-accent custom color input; regenerate dependent semantic colors with contrast checks.
4. Audition a 10–15-second narrator test and a short sonic signature/SFX sample. Select a **logical voice identity** (provider-neutral), narration direction and mix intensity; allow silence and music-free programs.
5. Show one realistic hook, comparison, number reveal, thumbnail and conclusion, in both 16:9 and 9:16. Compare variants, approve, save **BrandKit revision 1**. Never claim a palette is "premium" solely because it passes constraints.

**Advanced editing:** expose palette, logo/mark, typography roles, motion cadence, diagram/chart recipes, background/material treatment, captions, story structure, editorial voice, narrator, SFX taxonomy, music beds, transitions and delivery profiles. Support undo/version compare, brand duplication/fork, import/export and a one-click "restore approved kit." Avoid asking for dozens of settings before first preview.

## BrandKit — one structured source of truth

A BrandKit is immutable once approved; edits produce a new revision. Authoring draft can be mutable, but rendered artifacts pin exact revision, asset hashes, token compiler version and adapter versions. Schema examples are in [brand-kit.json](../examples/brand-kit.json) and [brand-style-presets.json](../examples/brand-style-presets.json).

| Section | Required model | Rules |
|---|---|---|
| Identity | brandId, revision, displayName, audience, promise, locale, positioning | Unique stable IDs; project inherits approved brand unless explicitly overridden |
| Art direction | aestheticPresetId, descriptive traits, exclusions, visualReferenceIds | Describe decisions (e.g. editorial restraint, woodblock texture) rather than ethnic stereotypes; third-party references require rights |
| Visual tokens | DTCG palette, semantic colors, type roles, spacing, radii, strokes, icon style, texture, background, logo | Compile brand values to Kumiki's --km-* contract; no new competing design system |
| Story language | editorial persona, pace, evidence/citation policy, vocabulary, humor/suspense tolerance, hook/recap preferences | Different subjects/genres can vary without violating core identity |
| Motion identity | preferred recipes, camera policy, entrance/reveal timings, easing, reduced-motion profile, SFX event rules | Motion conveys mechanism; locked camera is usually better for dense technical diagrams |
| Sonic identity | logical narrator ID, tone range, pronunciation dictionary, intro/outro sting IDs, SFX palette, music profiles, mixing policy | Sound identity independent of chosen TTS engine; no implicit uploads of sensitive voice samples |
| Layouts | platform-independent composition roles; aspect-specific layout recipes, caption region policy, thumbnail rules | 9:16 must be recomposed, not blindly cropped from 16:9 |
| Governance | brand revision, approvals, provenance, music/font/voice rights, allowed overrides, QA policy | Pin the exact approved release for each video; approval does not transfer to unlicensed assets |

**BrandKit vs Mood vs DeliveryProfile:** brand is long-lived identity; mood is episode/section-specific (calm/exciting/scary) with bounded changes to cadence/music/SFX/color treatment; delivery profile is destination-specific geometry, encoding and safe areas. Mood must not silently change the brand voice, logo, fonts or palette roles. One video can move from tense to hopeful while remaining recognizably one brand.

**Override precedence:** system defaults < curated style preset < approved BrandKit < approved series/episode treatment < shot-scoped authored overrides < destination/layout policy and non-waivable safety/rights/legibility constraints. Every resolved output stores an auditable manifest of changed values and reasons. Reject unknown keys or incompatible versioned token references; never swallow an invalid override.

## Token and creative compilation

- BrandKit colors use **semantic roles** (canvas, elevated surface, high/low-emphasis text, accent, warning, chart series), not just five hex swatches. Allow light/dark/ambient variants and contextual background surfaces.
- BrandKit typography assigns display/headline, body, caption, numeric/data and CJK fallback roles. Record font file, family, weight, shaping/fallback and redistribution license. Test Kanji, kana, Latin numerals, symbols and long localizations at output size.
- Generate an interoperable DTCG token document and a pinned Kumiki theme mapping, then render representative scenes with *existing* Kumiki registry components. Do not fork/patch Kumiki's global tokens for each brand.
- Presets encode multiple linked choices: typography, color roles, spacing density, texture/material motifs, camera behavior, motion pace and sonic tendencies. They are **composable data**, not hardcoded UI themes.
- A background such as "ancient," "Asian" or "traditional Japanese" needs a narrower, user-controlled art direction (period, medium, restraint, color/print/architecture inspiration). Never invent cultural authenticity or default to generic kanji, torii, bamboo or calligraphy. Verify rights for cultural references, textures and fonts.
- Use a recipe/slot resolver: semantic intent (compare, mechanism, cost timeline, map, definition, payoff) → approved scene recipe → brand treatment → 16:9/9:16 layout variant → Kumiki compilation. Avoid baking brand-specific components for each channel.

## Consistency without sameness

Define **identity invariants** (palette roles, typographic hierarchy, emblem/logo, narrator character, illustration/texture idiom, SFX signatures, caption treatment) and **controlled variability** (shot composition, specific chart types, hero palette emphasis, suspense/intensity, soundtrack arrangement). A channel should look coherent across 100 videos without repeating the same title-card animation every time.

Build a small **Brand Scene Set** at approval: 8-second hook, definition, side-by-side comparison, metric reveal, causal sequence, source/citation card, conclusion, thumbnail. These are editable recipes and diagnostic references, not pre-rendered videos or mandatory animations. Record a short narrated sample with at least one real visual handoff.

Version assets independently: logo, fonts, music, SFX, narrator mappings, art-direction references. Changing a BrandKit makes **new** renders eligible; already released videos and approved product bundles retain pinned versions.

## Platform packaging

Platform profiles are **versioned/configurable**, not eternal constants. Maintain separate profiles for YouTube landscape, Shorts, Instagram Reels, Facebook Reels/video and TikTok. Specify exact width/height, rational FPS, max/min duration where known, caption/UI exclusion polygons, loudness intent, thumbnail/covers and caption delivery (burned/sidecar), codec negotiation and output manifest. Recheck platform requirements before publication.

- **Landscape:** wide camera compositions, restrained captions, longer reading holds, multi-column diagrams as appropriate.
- **Vertical:** reflow diagram labels and information hierarchy, narrower shot, larger critical numerals, top/bottom UI-safe bands, sometimes sequential shots instead of one split screen. Preserve semantic IDs and concept order.
- **Editorial versions:** adapt the hook, narrative pacing, duration and visual density for shorts; do not mechanically crop or speed up long-form.
- **Metadata:** title, description, disclosures, audience/language, custom thumbnail variants and related brand/category labels inherit safely; creator explicitly approves destination-specific release.

Create independent platform previews at **actual export size** and at mobile thumbnail/card size. Emit unsupported-capability errors instead of silently altering composition semantics.

## Systematic, low-cost quality gates

**Compile-time and deterministic:** valid token refs, minimum contrast, verified font glyph fallback, safe text bounds after font loading, chart scales/units, missing asset/license, intentional vs unintended overlay, caption exclusion polygons, relevant scene action, critical subject/camera windows, audio clipping/duration/missing speech, brand hash/version mismatch, destination profile mismatch. Use Kumiki's existing geometry/timeline/camera guards; do not reimplement screenshot recognition or launch a browser for every frame in CI.

**Human/editorial:** real distinctiveness, visual storytelling clarity, voice suitability, cultural nuance, harmonic music, pronunciation, readability and overall craft. Show a concise checklist and audition/capture *selected* frames and clips, not a fabricated numerical "premium score." Capture accepted references per brand revision.

**Acceptance fixtures:** (a) create brand in few deliberate selections and export versioned kit; (b) render same cost reveal in landscape + reauthored vertical; (c) switch calm → tense while logo/type/voice identity remain stable; (d) replace Fish Audio with local TTS mapping without editing script/scene; (e) fail a clipped caption, insufficient contrast, missing CJK glyph, unlicensed SFX and out-of-date brand approval; (f) brand edits never mutate an earlier approved published video.
