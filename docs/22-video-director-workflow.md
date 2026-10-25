# Video Director — Guided Production Workspace

Video Director is organized as a four-step workflow. Each step edits the **same saved research-backed video project**, and users can revisit steps without creating a new storyboard or triggering a render.

1. **Storyboard:** Choose a scene, improve narration, visible teaching elements and motion intent. Save scene edits explicitly. Optional local AI alternatives can be combined only after the current scene is saved. A revision summary shows what needs regeneration.
2. **Visual assets:** Find and review useful footage and images for the selected scene. Use the existing asset approval workflow; discovering assets does not mean they are legally usable or automatically included in export.
3. **Sound:** In Sound Studio, review CC0 source rights, select approved effects, add supplementary cues and a quiet ambience bed, and audition a browser-local sketch. No local narration file supplied to audition is uploaded or reused by export.
4. **Preview & Export:** Follow four guided substeps:
   - **Preview:** Inspect the real Kumiki-backed scene, scrub motion, and optionally open an offline rough cut. A live visual preview never synthesizes speech.
   - **Narration:** Select a licensed voice and the engine version. Explicitly press **Generate voice sample** to hear a short excerpt of the first scene before committing to an MP4. A sample is an independent asynchronous job; cancel or retry if needed. For Fish Audio, voice-use permission and approval to transmit the short text are required. The free model's commercial rights are **not** assumed.
   - **Final review:** Check your scene narration, source warnings, voice choice and media rights. Press **Check readiness**; the local tools and approved sounds must be ready before proceeding.
   - **Export:** Press **Render test MP4**, watch the local progress and optionally cancel. On completion, review the inline player and download the draft; nothing is automatically published.

The interactive sample opens directly to **Preview & Export**, where its real scene timeline is available without voice credentials. A saved project opens to **Storyboard**.

## Safety and persistence

- An unsaved scene edit blocks changing stage or selecting another scene; save or explicitly discard it first. Project download/new-project controls are disabled until it is resolved.
- The visual preview/render panel stays mounted between steps so in-progress editor settings and review are not unintentionally reset.
- Returning to Preview & Export from another editing step clears an old UI readiness approval. Saved voice configuration and previews remain; a running or completed render remains visible.
- The Studio does **not** silently trigger model generation, third-party asset search, TTS, FFmpeg or a publish action when a user switches steps.
- Sound or storyboard revisions require a fresh production readiness check. Normal-speed final MP4 review is still necessary; visual-only and sound-sketch previews do not prove the exported result.
- Narration samples are limited to a short first-scene excerpt and stay in a job-owned local WAV folder. The previous sample is retired on replacement. They are not a replacement for checking the actual mixed MP4 or commercial narration rights.
- Voice changes hide any previous sample and invalidate readiness. If you change a voice during a sample job, wait for it to finish or cancel it before generating the new voice. The full video render and voice sample each require explicit action.
