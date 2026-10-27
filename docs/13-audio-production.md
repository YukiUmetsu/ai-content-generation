# Audio production — provider-neutral narration and semantic sound design

**Owner:** ContentGen orchestrates voice provider selection, speech synthesis/alignment, audio asset rights, editing, DSP and mastering. Kumiki owns audio cue/timeline *declarations* and consumes resolved alignment for animation/captions; it is not a TTS engine or audio mixer. [Kumiki's audio contract](https://github.com/YukiUmetsu/kumiki-ui/blob/main/docs/10-character-audio.md) is the reference for cue semantics.

## Provider-neutral capabilities

Define typed, versioned Rust ports with optional TypeScript/Python worker IPC:

- **SpeechSynthesize:** input = text, locale, logical voice-profile ID, direction (pace, emotion, emphasis, pronunciation), output format and budget; output = immutable audio artifact, exact duration in samples, sample rate, measured usage, provider/model/voice ID, status/provenance and rights record.
- **SpeechAlign:** input = audio artifact + expected text + language; output = segment, word and optionally phoneme times in the *source sample domain*, confidence/provenance and accuracy level. May be provided by TTS API or separate local alignment adapter. Unsupported levels are explicit.
- **AudioMix:** resolves versioned lane/clip/fade/automation/sidechain spec to WAV and optional stems; interchangeable DSP implementation with deterministic fixtures. Prefer FFmpeg initially, without storing command text as the canonical spec.
- **AudioAnalyze:** probe duration, sample rate, channel mapping, peak/true peak, integrated loudness, detected clipping, unexpected silence, script coverage and mix clipping.
- **SoundResolve:** resolve semantic sound categories/events through a rights-checked, deterministic bank with bounded variation. Manual no-sound is always valid.
- **MusicSelect:** selects only licensed beds/stings with genre/mood/tempo/intensity and usage constraints; not a mandatory generative-music dependency.

**Initial adapters:** Fish Audio cloud TTS, local TTS (e.g. Qwen3-TTS when installed), manual/imported recording, local speech aligner when necessary, FFmpeg mixer/encoder. Avoid assuming Fish's free model supports timestamp alignment or commercial monetization without testing current API terms and model capability. An optional provider can declare unavailable; never silently upload a voice sample or fall back to a paid model.

A **VoiceProfile** is the stable creative identity: locale, timbre/persona description, pace range, pronunciation lexicon, allowed tone/emotion range and ordered provider-specific mappings. Each mapping has a separate consent/license state and audition artifact. Switching provider is allowed but perceptual equivalence is not promised; audition and approve substitutions. Sensitive voice samples have explicit retention and external-call permissions. No speaker-cloning requests without rights approval.

**Generate by beat**, not whole-film blobs. Synthesis cache key hashes normalized speech text, locale, pronouncer version, voice mapping/provider/model/version, settings, sample format and rights/consent scope. A rewritten sentence invalidates its segment + alignment + dependent cue times, not unrelated footage. Keep an immutable copy of provider output; decoded/resampled derivatives have their own hashes.

## Audio data model and production passes

Source of truth = editable **AudioProductionSpec**, linked to a video/scene revision and approved BrandKit revision. Record:
- narration beats, text, desired delivery, optional pauses, phrase/word alignment and exact source samples
- clip lanes: narration, music, SFX, ambience; stable artifact refs with versioned rights and audio channel metadata
- named events such as reveal, arrival, compare, error, question, resolution and intentional silence; event anchors to Kumiki semantic IDs, not arbitrary wall-clock playback
- trim/source offset, start sample/time, gain, pan, envelopes, fades, ducking, EQ/compression/limiter presets, output profile and captions
- resolved compiler/FFmpeg version, rights/licensing/attribution, deterministic selection seed, measured output stats

**Pipeline:**
1. Approve script and pronunciation glossary; split semantic beats, mark pauses/emphasis and expected spoken content.
2. Synthesize/import each beat; probe audio, normalize encoding **for processing** (suggest 48 kHz float PCM internal), measure exact durations, and align segment/words where supported.
3. Resolve speech clock into timeline named cues; schedule scenes, subject handoffs, camera, captions and SFX from the same cue IDs. Convert fractional speech timestamps to visual frames **once** under a documented rounding policy; do not round sample positions.
4. Resolve sound events to a themed audio palette. Assets need rights, attribution, categories, intensity, attack/tail, default loudness and alternate IDs. Avoid one SFX per text entrance; cap density and collision of foreground effects.
5. Choose optional licensed music/ambience using BrandKit identity + episode/section mood. Apply smooth ducking under speech; build intro/outro transitions; let intentional silence breathe.
6. Decode → trim → gain/fades → bus automation/EQ/dynamics → narration-driven ducking → bus mix → limiter → profile loudness/true-peak measurement → final WAV/stems.
7. Validate: no missing clip, orphan cue, unexpected silent sentence, clipped speech, abrupt cut, unusable pronunciation/alignment, masked dialogue, excessive SFX, invalid export rights or mismatched video duration.
8. Render Kumiki visuals, mux mastered audio through current Kumiki exporter/FFmpeg boundary, export SRT/VTT where requested, then validate rendered MP4 audio and caption sync.

**Suggested mastering starting points, not mandatory platform standards:** voice-forward compression/occasional de-essing; restrained music roughly 18–25 dB below narration as an *audition starting point*; final integrated loudness near -16 LUFS and true peak at or below -1.5 dBTP for a common stereo online-video profile. Implement configurable profiles and measure output rather than asserting one target for all platforms. Store stereo/downmix and sample-rate policy, do not accidentally phase-cancel speech.

## Sound-design grammar and brand modes

Sound categories (not filenames): input.click, data.transfer, number.reveal, transition.sweep, evidence.arrives, emphasis.soft, tension.rise, resolution, environment.room, ambience.nature. Each semantic event declares importance (0..1), optionality, max density, nearby speech protection, gain limits and approved mood variants.

**SonicIdentity** stays recognizable (narrator timbre, intro signature, characteristic acoustic palette) while **SoundMood** changes per chapter: calm, curious, energetic, suspenseful, unsettling/scary, reassuring, historic/ceremonial. Mood controls selection and intensity inside BrandKit-approved bounds; do not force scary stingers or horror tropes onto every educational topic. Keep silence an intentional approved sound-design outcome. Match SFX to actual visual contact/reveal events.

**Licenses:** Freesound may contain CC0, CC BY and other rights; ingestion must record license per asset rather than treating the whole website as free commercial stock. For tracks, record source/license snapshot, attribution text, platform/monetization restriction, user approval and checksum. Block export for unresolved rights. Online provider "free" pricing is not proof of commercial output rights.

### Current Studio SFX bank (implemented)

Video Director reads each shot's optional `sfxIntent`; shots with no intent remain silent. On **Find CC0 sound effects**, Studio searches Openverse for short sound effects and shows source, license and previews. It does not download anything during discovery. Openverse's third-party license metadata is not independently verified: on first import the editor must check the original page, affirm CC0 and explicitly authorize a download. Server-side import rechecks metadata, rejects untrusted hosts/redirects, bounds input size, and uses FFmpeg to normalize to 48 kHz mono PCM WAV. The reusable local bank records provenance, license, approval and hashes; damaged files cannot be selected. Approved effects are automatically suggested across projects, with per-shot pin, mute and auto overrides. Searches are opt-in, bounded and do not use a language model.

**Export integration:** Video Director's **Check** and **Start** independently resolve the same bank and per-shot overrides. Each approved sound binds to its narration shot. By default it plays at shot start; an editor may explicitly choose **first visible element reveal** for simple general-comparison/breakdown diagrams with measurable element reveals. For that mode the renderer samples its actual visible-element state after the first frame, then converts the first increase to the exact measured audio sample. It never estimates timing from prose or duration. Dynamic flows, charts, semantic transformations/mechanics, unexpected-reveal hooks and custom scene recipes do **not** expose an authoritative generic reveal clock, so they fail readiness; missing transitions fail production instead of silently using a wrong timestamp. Pin requires the original approved clip; mute and unmatched auto suggestions yield silence. The old demo chimes are excluded from this production path.

**Layered sound design:** The editor can add up to four supplementary CC0 cues per shot (80 total), each with shot-start or supported visual-reveal timing, a manually chosen 0–10,000 ms offset, gain (-48–0 dB) and fade-in/out (0–2000 ms). One optional CC0 ambience **or user-reviewed music** recording loops quietly across the entire film at -48 to -12 dB with end fades up to 5000 ms. Music is found through an explicit Openverse CC0 music-category search and cannot enter automatic one-shot SFX recommendations. The local project file stores reviewed bank IDs and SHA-256 hashes, never user-supplied file paths; removed or damaged approved assets block readiness. Approved audio GETs retry only transient transport/server or incomplete-length failures (three bounded attempts), never rate limits, rights changes, invalid media, or cancellation. Cancellation propagates through metadata fetch and FFmpeg conversion, and no cancelled import is added to the approved bank. Any cue, envelope, selection or checksum change invalidates a previous **Check** result. The mixer verifies and snapshots the imported WAV again, resolves the effective audio sample from the measured narration timeline, and writes clip timing, envelope and hash (no local path) into the manifest. Short loops can sound repetitive; review the full export at normal speed, especially ambience and speech intelligibility. Existing projects retain their old one-effect-per-shot behavior. This implementation does **not** provide automatic music selection, beat detection, narration-driven ducking, arbitrary Kumiki animation cues, EQ, stereo panning or a drag-and-drop DAW timeline. Other free-audio licenses are outside this CC0-only implementation.

### Sound Studio editing and browser-local audition

The Sound Studio UI has a scene strip, **Arrange** for main and supplementary cues, **Library** for reviewed assets and explicit CC0 discovery/import, and a persistent sound-sketch player with a whole-video ambience control. A saved cue may be pinned directly or added as an extra layer. All source searches remain opt-in, and a sound's source must be reviewed before first import.

**Play sound sketch** fetches only SHA-verified, same-origin approved WAV previews, mixes the selected scene's effects and ambience in the browser with clip gain/fades/offsets, and stops on scene/mix changes. An editor can optionally choose a local narration WAV to hear it alongside the sketch; the file is read in memory only and never enters the server or export. The audition defaults to a short 12-second editorial window. It is **not** the FFmpeg master: before exact narration synthesis and rendered frames exist, it cannot resolve first-visual-reveal cues (they are omitted with a warning), full-film scene boundaries, exact voice timing or mastered loudness. The production **Check → Start → MP4** path remains the source of truth and requires normal-speed human playback after export.

## QA and fixtures

Use offline provider mocks in CI and opt-in integration tests for cloud/local voices. Fixtures:
- 30s multi-beat film with speech, music ducking, reveal SFX and an intentionally silent pause
- split/rewrite just one beat and verify only dependent artifacts invalidate
- unavailable Fish Audio → local provider selected explicitly; no secret leaks, unapproved remote call or cost increase
- aligner returns only segment timestamps: captions get segment timing, not fake phoneme precision
- deliberate missing speech, clipped peak, incompatible sample rate, unsupported license, too-loud SFX and wrong audio/video duration must fail
- mixed English/Japanese with pronunciation tests and font/caption alignment; long-form and vertical export with independent time/layout policies
- compare reference narration/Mix QA with a short **human listening check**; never equate measured LUFS with premium sound

**Milestone done when:** a local deterministic fixture plus one approved real-provider sample generate a repeatable mastered WAV, timed SFX and captions and a Kumiki MP4 without requiring any specific speech model in domain types.

