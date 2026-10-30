# Durable draft recovery, edited-scene export, and visible failures

**Status:** Proposed for approval, not implemented. **Target:** PR #134,
`feat/production-one-click-jobs`.

## Intent and constraints

Let a creator edit one storyboard scene, save it, and generate a complete
narrated draft without navigating through redundant review/preflight screens.
The first video version begins with a single Generate action; the second and
later edited versions require one concise confirmation before production.
Rendering must be observable in Rust/SQLite Jobs and survive a local Studio
restart, with a conservative boundary around repeat external narration calls.
Maintain the current Kumiki renderer, Jobs DAG and verified media caches. No
automatic publishing, rights assertions, new paid services or API-key storage.

## Chosen approach and alternatives

- **Chosen: first version starts directly; later versions confirm.**
  A persisted, version-bound production intent allows the local Node coordinator
  to restart the unfinished full-video job on Studio startup. It first validates
  Jobs ownership and existing artifact hashes. No completed video release yet:
  the first Generate action proceeds without an additional review/confirm step.
  After a completed release, a new edited version shows one contextual confirmation
  of changes and possible new voice usage. The explicit confirmation is retained
  with that version's durable intent, so a restart may continue already authorized
  local work without requesting the same initial confirmation again. A potentially
  repeated external TTS call after a crash is separately guarded by a bounded
  replay allowance and pauses for consent when its previous outcome is uncertain.
  Local FFmpeg/Kumiki work and verified narration reuse continue automatically.
- **Alternative A: every version starts without a confirmation.** Fewer clicks,
  but edited versions could re-synthesize an entire script unexpectedly. Rejected.
- **Alternative B: confirmation for every first or retried render.** Avoids
  surprise voice requests, but introduces a redundant action for the first draft
  and fails the one-click goal. Rejected.

The phrase “first draft A; second/third time B” means **first video version
starts directly, second and later regenerated versions require confirmation**.
Count versions by completed releases for this production, not process restarts:
retrying a failed first render does not turn it into version two. A newly edited
revision starts only after a deliberate Generate action and may not inherit
external voice/text authorization from a different revision.

## Server state and recovery contract

1. After validating a Generate request and before any media/provider work,
   persist a bounded private production snapshot atomically in the run-owned
   directory: source revision, compiled director input, nonsecret voice/settings
   identity and exact per-run voice/transmission authorization. Do not write an
   inline API key, bearer token or provider response. Secure credentials are
   freshly loaded from the existing Keychain when needed. Reject symlinks,
   mismatched revisions, malformed snapshots and unexpected folder ownership.
2. Keep Rust Jobs authoritative. On startup, enumerate eligible unfinished
   snapshots with a strict bound, query their corresponding Jobs DAG, reconcile
   expired attempts and claim exactly one continuation per job/revision. Never
   steal a live lease or revive a cancelled job. Completed verified files are
   reused only through the existing manifest/hash/codec checks; damaged ones
   are regenerated in owned directories.
3. Maintain a durable, monotonic bound on uncertain external voice replays,
   reserved before a repeated call. Do not enter an unbounded replay loop after
   crashes; when further reauthorization is required, record a
   **waiting-for-confirmation** outcome in Jobs and expose one contextual Resume
   action. This is not a generic silent retry and cannot be shown as success.
4. A restart with unavailable Jobs, missing voice credentials, changed input,
   revoked authorization or exhausted retry allowance becomes a specific,
   persistent blocked/failed status with next action; it must not issue a new
   provider request. Crash between an external request and its response cannot
   be guaranteed exactly-once; the UI must honestly explain this uncertainty.
5. Preserve cancellation semantics and lease-loss aborts; no obsolete process
   may publish a release. The first app start must not trigger work for a
   different production, revision or user without an eligible snapshot.

## Shortest editing and draft path

1. From Production, **Generate draft video** remains the single deliberate
   start action when voice authorization is configured. It opens Video Director
   at the running export/status surface and performs preflight automatically.
   No additional Final review, Check readiness or Render test MP4 action is
   mandatory for this path. Missing setup is shown inline with one retry action,
   preserving the script and scene edits.
   After at least one verified completed release, the same Generate action opens
   a compact **Generate updated version?** confirmation, summarizing the changed
   scenes and possible new narration/provider usage. Confirm once, then preflight
   and render without a separate review flow. Do not treat a failed attempt or
   an app restart as another version.
2. From the scene editor, **Save scene** retains the existing explicit-save
   guard. A nearby **Generate updated draft** action begins the same full narrated
   path using the saved revisions. **Render this scene MP4** stays clearly
   labeled as a silent, selected-chapter preview; it must never be confused
   with the narrated full-video output.
3. In Production and Director show the actual stage, persistent job ID/link,
   the failing operation, a safely redacted cause and a specific action (retry,
   configure voice, resume with consent, or inspect Jobs). Preserve the active
   status after navigation/reload; do not turn a legitimately RUNNING external
   Job into a generic FAILED label. Use the existing component/tokens and
   maintain keyboard focus, status announcements, Japanese layout, responsive
   text wrapping and reduced-motion behavior.

## Verification and boundaries

- **Regression tests:** single-click Generate (preflight + start), saved scene
  edit changing only the matching segment, first-version direct start,
  second-version confirmation, failed-first retry without confirmation,
  real full MP4/captions/media hashes,
  UI loading/done/failure/resume states, Job ID/stage propagation, cancellation,
  restart claim race, stale/malformed snapshot, missing Keychain credential,
  first automatic replay and second replay requiring approval.
- **Integration:** launch actual Rust Jobs + Node coordinator, kill it during a
  production stage, restart, and assert independent verified work is reused and
  exactly one active owner finishes the MP4. Exercise a seeded failure and
  inspect Jobs' durable code/detail and UI. Where authorized real TTS is absent,
  a fixture voice service can prove wiring and FFmpeg output, but **cannot** be
  called a live Fish Audio or natural-speech verification.
- **UI QA:** inspect actual rendered 360/768/1280px views, English/Japanese
  text, keyboard and error states; verify the editing-to-export click count.
  Run typecheck, lint, build, web/headless tests, Rust Jobs tests and actual
  FFprobe/Chromium scene verification as the environment permits. Record skipped
  or blocked checks separately.

## Non-goals

No guarantee of third-party stock footage for every scene (Kumiki remains the
honest fallback), no unattended newly authorized provider purchases, no
publishing, and no replacement of Rust's Jobs engine or Kumiki's renderer.
