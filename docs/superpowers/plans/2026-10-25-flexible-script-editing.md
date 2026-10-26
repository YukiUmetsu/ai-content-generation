# Flexible Script Editing Implementation Plan

Goal: insert a section before/after any section and replace the active destination's script from reviewed JSON or numbered text, preserving an undo copy.

Architecture: retain version-1 saved drafts and default five-part outline; allow 1–20 uniquely identified sections with independent roles. Share bounds/role resolution with the model adapter and Director. Imported prose is manual, unverified content, never fabricated research. Existing approvals become stale after structure changes.

- [x] Test and implement flexible draft validation and insertion with stable IDs/history and legacy compatibility.
- [x] Test and implement strict JSON / consecutive numbered-text parsing, preview, atomic replacement and restorable backup. Reject unknown citations, excessive input and malformed numbering without mutation.
- [x] Add before/after controls and an import dialog using existing Button/Dialog components; support typing narration into blank sections, source selection, cancellation and accessible errors.
- [x] Adapt sequential AI context, dynamic progress/full regeneration, storyboard identities and Director shot/answer selection to arbitrary sections, including an appended promotion.
- [x] Preserve uncited manual claims as explicit unverified evidence gaps; do not manufacture citations or elevate publishing approval. Captured-research prerequisites still apply to cinematic rendering.
- [ ] Run frontend/headless suites, typecheck, lint and build, perform self-review and focused independent review, create one PR and merge the exact reviewed commit without relying on Actions.

Review focus: accidental import overwrite, failed storage writes, late AI responses, prototype-key IDs, stale approvals, mixed sourced/unsourced promotion, and source/scene lineage when sections move or are inserted.


Review fixes: preserve the prior recovery copy after an active-write failure; keep uncited placeholder IDs separate from captured evidence IDs; split short outlines into distinct problem/mechanism/payoff shots without splitting decimal tokens; retain the main answer before promotional postscripts. Added regressions for each. Integrated main's platform-generation/network fix before final checks.

Validation limits: no Rust code changed and Cargo is unavailable in this environment. Browser screenshot QA was attempted but blocked: the browser download returned an HTML response instead of a browser archive. No live user-model inference or final video playback was performed. No dependency or lockfile changes.
