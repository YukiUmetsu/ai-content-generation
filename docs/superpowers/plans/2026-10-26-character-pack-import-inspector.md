# Character Studio recovery: local ZIP inspector

One vertical slice toward the approved Character Studio design. The original
uncommitted implementation was not recoverable, so this slice establishes a
versioned, secure input boundary and a useful first screen in Assets.

1. Follow the proposed Kumiki `CharacterDefinition` schema version 1 for
   sprite-2d and puppet-2.5d characters. Do not vendor or import the unmerged
   `CharacterPresenter` PR. Require `character.json` and locally referenced
   PNG/WebP layer images under `layers/`.
2. Read a user-selected ZIP entirely in the browser, with explicit compressed
   and expanded limits. Reject traversal, duplicate paths, symlinks, encrypted
   entries, unsupported compression, CRC mismatches, malformed/incompatible
   definitions and missing image references.
3. Structural validation is not equivalent to Kumiki runtime validation,
   rigging, publication, commercial rights approval or persisted registration.
   The UI must state these constraints visibly.
4. Show friendly layer thumbnails, hierarchy/anchors summary, source rights,
   and actionable validation errors in the existing Assets workspace. No
   upload, backend call, temporary server storage or silent catalog write.
5. Add adversarial ZIP/manifest tests, frontend tests, documentation and run
   typecheck/lint/focused unit tests. Deliver a separate PR for this boundary.

Deferred: durable content-addressed file store, Rust catalog/approval revision,
Kumiki pinned adapter, production cast and jobs, cross-project access, export.
