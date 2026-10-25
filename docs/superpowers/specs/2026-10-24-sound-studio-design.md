# Sound Studio editorial workspace

## Intent

Make sound production understandable to a solo creator: choose a scene, find a legally reviewed sound, place one or more cues, set ambience and hear the result without a full MP4 export. Keep the existing source-linked storyboard and sample-accurate export contract.

## Approaches considered

- **Chosen:** Upgrade the existing Video Director SFX panel into an embedded Sound Studio with a scene strip, Arrange/Library views, a persistent Audition card and simple-by-default mixing controls. It reuses current endpoints and approved WAV previews.
- Separate full-page audio editor: more navigation and duplicated project context, not warranted yet.
- DAW waveform/drag editor: misleading without measured narration/visual timing, complex to synchronize with verified export.

## Functional design

1. A clear hierarchy: title/rights state, shot strip, Arrange and Library views, one listening/mix rail. Scene changes remain synchronized with Video Director. The selected shot, current primary choice, added cues and whole-film ambience are obvious.
2. Library search and import require explicit clicks and review of the original CC0 source. Previously approved sounds support one-click pinning and addition to a scene; no AI, background search or automatic downloads.
3. Each supplementary cue remains individually editable (start/reveal timing, offset, gain and fade), and the ambience has its own gain/fades. Expose the specialized controls progressively; give practical defaults and human-readable guidance.
4. **Audition:** an explicitly labeled browser-local sound sketch for the selected shot, with primary effect, supplementary cues and quiet looping ambience. Fetch only same-origin SHA-verified approved WAV previews on Play; apply gains, cue offsets and fades with Web Audio. Optional user-chosen narration recording is decoded in memory and never uploaded. Without a voice recording the sketch is effects-only. Exact first-visual-reveal moments cannot be inferred before render and are omitted with an explanatory notice. The final production pipeline remains authoritative.
5. Audition has Play/Stop, loading/errors, a concise timing lane diagram and silent/empty states; it must stop audio and abort loading on scene change, unmount or explicit Stop. Avoid rendering a decorative fake waveform.

## Constraints and non-goals

- No new dependency or background generation, no paid TTS call, no unapproved audio inputs entering production.
- No modification to server mastering, hash enforcement, or source-link review status. Preview is an editorial aid, not proof of synced final mix.
- No storing the optional narration file or using it as the production voice. Human playback of the exported MP4 remains required.
