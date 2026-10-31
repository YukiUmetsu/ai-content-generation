# ComfyUI → ContentGen: reviewed PNG planes

**Status:** client, CLI, validation, and the Kumiki scene slot are implemented. No checkpoint, custom masking nodes, or API-format generation workflow is installed by ContentGen. These are supplied and approved by the video producer. The JSON examples are **templates**, not executable workflows or approved assets.

1. Start a locally configured ComfyUI with at least one installed checkpoint. From `apps/web`, run:

   ```sh
   node scripts/video-production/visual-assets-cli.mjs health --endpoint http://127.0.0.1:8188
   ```

2. In ComfyUI, compose a **three-output API-format workflow**. Each separate `SaveImage` node must produce exactly one `image/png`: an environment/background, a transparent subject, and a transparent foreground/occluder. Mask or inpaint using *installed* nodes; the default RGB checkpoint output is **not** automatically transparent. Prompt for **original artwork with no text or numbers**. The three outputs must share a consistent camera and light direction. Export **API format**, not the UI canvas workflow. Replace the example node IDs with the actual IDs from your API JSON. Choose the checkpoint and seed already present in its node inputs.

3. Copy `examples/desk-invoice-brief.json` into your own job folder. Set the real `beatId`, `claimRefs`, and `cueEventIds` from the ContentGen production job. The example numbers are synthetic; any actual amounts must come from the job evidence.

4. Generate **candidates only**:

   ```sh
   node scripts/video-production/visual-assets-cli.mjs generate \
     --brief /path/to/job/brief.json \
     --workflow /path/to/job/comfy-api.json \
     --nodes /path/to/job/save-image-nodes.json \
     --model installed-checkpoint.safetensors --seed 42 \
     --out /path/to/job/desk-candidates \
     --endpoint http://127.0.0.1:8188
   ```

   The client checks `/system_stats`, queues `/prompt`, polls `/history/{prompt_id}`, and downloads the actual filenames via `/view`. It never assumes an output directory. Output is `desk-candidates/generation.json` and hashed PNGs in `candidates/`. Network access is restricted to a local HTTP loopback endpoint. No models are downloaded or switched automatically.

5. Inspect the actual PNGs at full size. Reject misshapen objects, inconsistent vanishing points, gibberish lettering, poor cutouts and bad masks. Copy `examples/reviews.example.json`, assign each approved layer an explicit `rights` (`self-created` or `verified-licensed`), change its `reviewStatus` to `approved`, and record accurate normalized `anchor` and `depth`. The supplied template is intentionally **pending** and cannot make a pack by itself.

6. Create the reviewed, content-addressed pack:

   ```sh
   node scripts/video-production/visual-assets-cli.mjs pack \
     --brief /path/to/job/brief.json \
     --candidates /path/to/job/desk-candidates \
     --reviews /path/to/job/reviews.json \
     --out /path/to/job/reviewed-desk
   ```

   This verifies PNG headers, hashes, role count, rights and geometry, then writes `visual-brief.json`, `visual-asset-pack.json`, and `assets/<sha256>.png`. It refuses unreviewed images.

7. Create a `visual-scenes.json` mapping as in `examples/visual-scenes.example.json`. Paths resolve relative to the mapping file. Run the **existing production command** with the extra `--visual-scenes-file /path/to/job/visual-scenes.json` flag and all normal voice/approval flags. `--dry-run` checks the reviewed packs and capture dependencies. For an ordinary beat, omit this flag and the old renderer stays unchanged.

8. The ContentGen general-explainer production path binds the pack **by beat ID**, verifies claim/cue references, makes three hash-only private image URLs, and switches that beat to `SceneTemplateView`'s `environment-reveal` (frame-exact camera, parallax, subject arrival) plus SVG exact text. The in-browser capture preflight checks all three PNGs actually decoded. Final MP4 still requires the configured Chromium/TTS/FFmpeg environment and human review.

**v1 constraints:** landscape 1920×1080, up to six premium beats per production, one background/subject/foreground per beat, PNG up to 16 MiB each, all overlays on SVG, three authored evidence lines 38 characters or fewer. This is a CLI/export integration; Studio's persisted Jobs ledger and UI do not yet select these packs. Full scene-level QA, mask-edge QA and Kinetograph parity remain follow-ups.
