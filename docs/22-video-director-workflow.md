# Video Director — Guided Production Workspace

Video Director is organized as a four-step **manual editing** workflow inside **Production → Create Video**, not a separate main-sidebar page. Each step edits the **same saved research-backed video project**. **Generate draft video** is the automatic entry point and does not require manually working through these editing stages or clicking repeated readiness/plan approvals; the controls below remain available for targeted edits and diagnosis.

1. **Storyboard:** Choose a scene, improve narration, visible teaching elements and motion intent. Save scene edits explicitly. Optional local AI alternatives can be combined only after the current scene is saved. A revision summary shows what needs regeneration.
2. **Visual assets:** Find and review useful footage and images for the selected scene. Use the existing asset approval workflow; discovering assets does not mean they are legally usable or automatically included in export.
3. **Sound:** In Sound Studio, review CC0 source rights, select approved effects, add supplementary cues and a quiet ambience bed, and audition a browser-local sketch. No local narration file supplied to audition is uploaded or reused by export.
4. **Preview & Export:** Follow four guided substeps:
   - **Preview:** Inspect the real Kumiki-backed scene, scrub motion, and optionally open an offline rough cut. A live visual preview never synthesizes speech.
   - **Narration:** Select a configured licensed voice and engine version (provider defaults in **Settings → Audio**). **Generate voice sample** is an optional independent asynchronous audition job; cancel or retry if needed. The application still enforces backend voice/transmission authorization when required, but **Production does not present redundant Fish consent checkboxes**. A model's commercial rights are **not** inferred from its name or price.
   - **Final review:** Inspect scene narration, source warnings, voice choice and media rights. A manual **Check readiness** can diagnose local tools and assets; automatic draft production performs its own preflight without a separate approval click.
   - **Export:** The manual export control renders an MP4 and supports progress, cancellation, playback and download. The primary **Generate draft video** action starts the same production route after setup; nothing is automatically published.

The interactive sample opens directly to **Preview & Export**, where its real scene timeline is available without voice credentials. A saved project opens to **Storyboard**.

## Safety and persistence

- An unsaved scene edit blocks changing stage or selecting another scene; save or explicitly discard it first. Project download/new-project controls are disabled until it is resolved.
- The visual preview/render panel stays mounted between steps so in-progress editor settings and review are not unintentionally reset.
- Returning to Preview & Export from another editing step clears an old UI readiness approval. Saved voice configuration and previews remain; a running or completed render remains visible.
- The Studio does **not** silently trigger model generation, third-party asset search, TTS, FFmpeg or a publish action when a user switches steps.
- Sound or storyboard revisions require a fresh production readiness check. Normal-speed final MP4 review is still necessary; visual-only and sound-sketch previews do not prove the exported result.
- Narration samples are limited to a short first-scene excerpt and stay in a job-owned local WAV folder. The previous sample is retired on replacement. They are not a replacement for checking the actual mixed MP4 or commercial narration rights.
- Voice changes hide any previous sample and invalidate readiness. If you change a voice during a sample job, wait for it to finish or cancel it before generating the new voice. The full video render and voice sample each require explicit action.
