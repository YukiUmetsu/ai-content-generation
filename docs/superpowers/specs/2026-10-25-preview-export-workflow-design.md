# Preview & Export production workflow — design

## Intent

Make the existing Video Director's Preview & Export stage usable without knowing backend verbs. Editors should see an actual scene, audition a small voice sample, check export blockers and obtain a playable MP4 with clear progress and recovery.

## Approaches and choice

- **Selected:** Progressive stages within the existing mounted `ProductionPanel`: Preview → Narration → Final review → Export. Reuse the existing same-origin API and add one bounded narration-sample job; preserve exact Check/Start preflight identity and video rendering.
- **Rejected:** Cosmetic relabeling of the existing control pile; it wouldn't allow voice audition or make dependencies clear.
- **Deferred:** Whole-film voice-only render and waveform timeline; expensive local inference, extra media synchronization and new authorization/rights work.

## Contract

- **Preview:** One primary action opens the actual Kumiki-backed scene, allows shot/motion editing, and offers an optional offline rough cut. Never starts synthesis.
- **Narration:** Voice provider settings and authorization are independent of the storyboard scene-list UI. Editors can explicitly generate a **short first-scene voice sample** and listen before committing to a full render. Sample generation is an asynchronous single-flight job, not part of the full render; it does not set readiness. Fish calls require both existing opt-ins; no unreviewed paid request.
- **Final review:** Show scene count, editorial caveats, voice/provider, sample status, and actionable readiness findings. A successful backend Check gates Export. Editorial changes, narration changes and return from other Director stages invalidate readiness without discarding running/completed video.
- **Export:** Show a single explicit render action, real job progress and cancellation, then an inline player and MP4 download. Render still creates *test-only*, not rights-certified material. No publishing, automatic download, or implicit TTS.
- All stages accessible by keyboard and screen readers, with explicit titles, concise copy and safe back navigation. Failures stay visible with retry affordances. Existing `autoOpenSample` demo, shot selection and live editor must remain working.

## Safety and constraints

Keep loopback same-origin and `X-Contentgen-Director` authorization; no key logging or persistence. Narration samples are ephemeral job-owned WAVs, bound to an unpredictable ID and at most one in memory; a new sample cleans the prior owned directory. Constrain preview text to a small excerpt and reject unapproved voices before any work. Separate narration job state from MP4 status. No claims of commercial-use clearance from Fish free API. Do not run GitHub Actions (user's credit limit).

## Acceptance

1. Actual preview loads and remains editable; rough cut remains optional.
2. A single-scene voice sample can be generated/listened to with explicit rights authorization; unauthorized, busy or invalid requests do not synthesize. Cancellation/timeout/errors give recoverable status.
3. `Check` is required after changes; video `Start` maintains backend identity enforcement. No preview or sample silently renders MP4.
4. Progress/cancel/finished video are accessible with consistent stage navigation; regression tests cover API and UI.
