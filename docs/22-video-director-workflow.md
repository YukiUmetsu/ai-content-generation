# Video Director — Guided Production Workspace

Video Director is organized as a four-step workflow. Each step edits the **same saved research-backed video project**, and users can revisit steps without creating a new storyboard or triggering a render.

1. **Storyboard:** Choose a scene, improve narration, visible teaching elements and motion intent. Save scene edits explicitly. Optional local AI alternatives can be combined only after the current scene is saved. A revision summary shows what needs regeneration.
2. **Visual assets:** Find and review useful footage and images for the selected scene. Use the existing asset approval workflow; discovering assets does not mean they are legally usable or automatically included in export.
3. **Sound:** In Sound Studio, review CC0 source rights, select approved effects, add supplementary cues and a quiet ambience bed, and audition a browser-local sketch. No local narration file supplied to audition is uploaded or reused by export.
4. **Preview & Export:** Inspect the real Kumiki scene preview, then compile the renderable storyboard, configure an authorized voice, run **Check readiness**, and explicitly start a new draft MP4. Review the actual output before publishing.

The interactive sample opens directly to **Preview & Export**, where its real scene timeline is available without voice credentials. A saved project opens to **Storyboard**.

## Safety and persistence

- An unsaved scene edit blocks changing stage or selecting another scene; save or explicitly discard it first. Project download/new-project controls are disabled until it is resolved.
- The visual preview/render panel stays mounted between steps so in-progress editor settings and review are not unintentionally reset.
- Returning to Preview & Export from another editing step clears an old UI readiness approval. Saved voice configuration and previews remain; a running or completed render remains visible.
- The Studio does **not** silently trigger model generation, third-party asset search, TTS, FFmpeg or a publish action when a user switches steps.
- Sound or storyboard revisions require a fresh production readiness check. Normal-speed final MP4 review is still necessary; visual-only and sound-sketch previews do not prove the exported result.
