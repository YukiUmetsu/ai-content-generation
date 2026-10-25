# Studio multilayer SFX and ambience design

## Intent

Give editors a useful sound-design timeline before new Kumiki animations arrive: several approved effects on a shot, clip-level gain and fades, and one gently looping ambience bed. Preserve quiet-by-default behavior and current per-shot automatic selection.

## Approaches

- **Chosen:** Add project-local, reviewed supplementary audio layers alongside existing auto/pin/mute selections. Compile them into the existing typed production job and 48 kHz sample-domain FFmpeg mixer. The source library remains the only way to obtain playable files.
- Alternative: Replace the current one-effect-per-shot selection model with a full DAW-style track graph. Rejected for complexity and migration risk.
- Alternative: Encode additional timing directly in free-form FFmpeg strings. Rejected because validation, rights and timing could be bypassed.

## Contracts

- Extra SFX layers are identified by stable IDs, linked to a real shot and a hash-verified human-approved CC0 asset. Limit to four supplementary layers per shot and 80 total. A layer has `trigger: shot-start|first-visual-reveal`, explicit integer `offsetMs` (0–10000), `gainDb` (-48–0), `fadeInMs` and `fadeOutMs` (0–2000). Visual reveal uses the existing fail-closed renderer restrictions.
- One optional ambience asset across the whole movie has `gainDb` (-48–-12) and fade lengths (0–5000). Its normalized WAV loops until the exact measured total sample count. No downloads or searches happen automatically.
- Settings live in a project-specific atomic local file. Mutations go through local same-origin CSRF-protected routes, not client-provided paths. Missing, revoked or changed approved assets block export rather than being silently replaced. The backend builds authoritative choices at both Check and Start so changes invalidate readiness.
- Extend the production job's sound declaration with bounded `kind`, `offsetMs`, `gainDb`, `fadeInMs`, `fadeOutMs`. Legacy sound declarations preserve their current audio level and behavior. Every new clip keeps a named event; its effective cue sample is computed from the event and explicit offset, reported in the manifest without a local path.
- The editor shows supplementary cues under the existing sound selection and one global ambience control, using approved sound library assets only. Playback remains a required human review step.

## Out of scope

Unlicensed music, arbitrary file imports, multi-channel spatial panning, keyframe automation, audio beat detection, external searches without user action, native DAW timeline drag handles, autonomous SFX placement by a language model.
