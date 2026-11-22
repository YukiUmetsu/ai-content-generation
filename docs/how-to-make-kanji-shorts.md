# Make kanji study shorts

`pnpm video:kanji` makes one vertical short (1080 × 1920, 30 fps) per kanji. The picture is Kumiki's `shodo-kanji-card`; ContentGen supplies the card data, the narration, the music bed and the release folder.

## What one short does

1. **Intro.** The voice asks "Do you know how to write the kanji mizu?". On screen the reading is typed (みず) and converts to the typed kanji (水) at once. The typed kanji pushes in slowly and pulses when its name is spoken.
2. **Write.** The brush comes in from outside the frame (from the right with the default brush), writes the kanji and leaves the frame after the last stroke, so the finished kanji holds with nothing on it. The voice reads the on'yomi as the brush lands for the first stroke, then the kun'yomi.
3. **Review.** The brush comes in again and writes it with vermilion stroke-order numbers, then leaves. Only music plays.
4. **Words.** As the review writing ends, the voice reads each useful word and its tile is highlighted until the next one starts.

The paper fills the frame. The kanji is centred in its practice box with room above and below; the reading card lies under it with a margin all round and runs down to near the bottom edge, so there is no empty band. The card is as tall as its own text needs, so a kanji with short readings and words gets a bigger character. The brush is drawn above the card.

**Platform overlays.** By default the card uses the bottom of the frame, where YouTube, TikTok and Reels lay the title and channel name over the video, and where uploaded captions (`captions.srt`) appear. To keep the card above them, set `card.safeInset` to `{ "bottom": 0.19 }`; the kanji is then smaller. Opposite bands together may cover at most 0.45 of the frame.

The card's height is estimated from its text with the default labels and fonts. Custom `card.labels` or `card.theme` fonts that are much wider make the card's text shrink a little to fit.

### The narration is a script (data)

The voice-over is an **anchored-narration script** (`scripts/video-production/anchored-narration.mjs`): a list of steps, each a line with text templates, placed on a moment of the picture. The default is `scripts/video-production/kanji-short-script.json`. Copy it and set `narration.script` in the config to change the wording, the order, the language or the timing, with no code change.

- **Templates** use the kanji's fields:
  - `{name.kana}`, `{name.romaji}`, `{meanings}`, `{jlpt}`
  - `{onyomi}`, `{kunyomi}` (kana), `{onyomiRomaji}`, `{kunyomiRomaji}`
  - `{labels.on}`, `{labels.kun}`
  - in a step with `"forEach": "words"`: `{item.word}`, `{item.speech}`, `{item.meaning}`
  - in a step with `"forEach": "strokes"`: `{n}`
- **Anchors** are the card's moments: `start`, `write.start`, `write.firstStroke`, `write.lastStroke`, `review.start`, `review.firstStroke`, `review.end`, `info.start`, and per stroke `write.strokes` and `review.strokes`.
  - A line starts at its anchor plus `offset`, or `gap` after the previous line ends, whichever is later.
  - Every gap is at least 0.12 s and the first line starts at 0.04 s or later: the silence each recorded clip keeps around its speech.
  - `"at": "after"` places it only after the previous line.
  - The QA report records how late each line starts after its anchor, and warns above `qa.anchorDriftSeconds` (1.5 s). Only the first line on an anchor counts; the lines after it on the same anchor follow it on purpose.
- **Other step settings:**
  - `when`: leave the step out when the field is empty. An unknown field is an error.
  - `locale`: the voice's language for the line, as a BCP 47 tag.
  - `caption`.
  - `highlight`: highlight each word while it is spoken. Only on `forEach: "words"`, because the card highlights its words.
  - `emphasize`: the part of `say` whose spoken moment pulses the typed kanji.
- Ids take only `{n}` or `{index}`.
- Before any voice is made, the script is placed once with estimated line lengths. A line without a moment in the picture, such as a word on `review.strokes` when the kanji has fewer strokes than words, stops production there.
- **The intro** lasts while the lines placed at `start` are spoken. A script with no such line has no typed intro.
- **Example:** counting the strokes during the review is one more step: `{ "id": "stroke-{n}", "forEach": "strokes", "say": "{n}", "at": "review.strokes", "gap": 0.1 }`. `--dry-run` lists it once the kanji's KanjiVG data is cached.

### The card's look is settings

`card` in the config sets the card's options:
- `heading` and `density`
- `labels`: the card's words (`onyomi`, `kunyomi`, `words`, `jlpt`), the heading format (`heading`, default `{HEADING}: {char}`) and the accessible names (`cardName`, `writingName`). For example: `{ "onyomi": "音読み", "kunyomi": "訓読み", "words": "ことば", "heading": "{heading}：{char}" }`
- `theme`: colours and fonts
- `brushStyle`: Kumiki brush, ink, paper and hand settings
- `typeStep`: typing pace
- `strokeNumbers`
- `safeInset`: bands of the frame the card keeps clear, over the destination's (`left`, `right`, `top`, `bottom`, each 0 to 0.4). The default is the destination's side and top bands with no bottom band.

All are passed to Kumiki's `shodo-kanji-card` and checked before any network request.

### Decisions in the data, not in code

- **Useful words** never include the bare kanji (水 is not a useful word for 水). The card takes the first three other words of the data, in order.
- **The spoken name** is the reading of the kanji's own word (水 → mizu). Otherwise it is the first on'yomi (学 → gaku).
  - The voice gets the name in kana inside the English question, because a voice reads romaji such as "hi" (日) as an English word.
  - The captions file shows romaji.
- **A voice per language.** `voice.voiceIds` maps a language to a voice, for example `{ "ja": "<Japanese voice>", "en": "<English voice>" }`. A line that mixes scripts is read in runs, each by its language's voice, and joined into one line: "Do you know how to write the kanji" in the English voice, "つき" in the Japanese one.
  - A line in one script is read by the voice of that script (a Japanese line by the Japanese voice). `voice.voiceId` reads any language without its own voice.
  - Digits go with the text they touch (12月 is Japanese).
  - The Japanese voice does not read the English sentence's ASCII punctuation: a lone "つき?" came out as すき. The English run is read without the sentence's final "?"; the caption keeps it.
  - The question's pulse lands as the name's run starts. `--dry-run` shows which voice reads which part, and the release's manifest records each run's voice.
- **Words are spoken as written**, so the voice reads them in context. An irregular reading (今日, 大人) is spoken from its kana. `narration.speech` overrides the text for a word that the voice misreads, for example `{ "水泳": "すいえい" }`.
- **Timing** comes from the brush. Kumiki's `kanjiCardWriting` gives the time of every stroke in Node (bundle `dist-shot/kanji-entry.mjs`). The export page plans the same strokes from the same glyph and refuses any frame whose strokes differ.
- **Reusable parts** that other narrated videos can use:
  - `narration-clips.mjs`: trim measured speech and place it on an exact sample timeline
  - `anchored-narration.mjs`: scripts
  - `music-bed.mjs`: choose and level a reviewed bed under a voice
  - `media-measure.mjs`: loudness, peak, longest still
  - `cue-captions.mjs`: SRT from timed cues

## Set up once

Make the folder `data/kanji-shorts/` (git ignores `data/`). Put `config.json` in it, after `apps/web/fixtures/kanji-short/config.example.json`:

- `dataset`: the kanji study-card data (`{ kanji: [{ char, jlpt, words, card }] }`), for example `jlpt-n5-n3.json` from the private `kumiki-shodo` repository. Put its credit line in `credits`.
- `narration`: optional `script` (a file or the script itself), `labels` (`{ "on", "kun" }`, the words the voice says before each reading) and `speech` (the text the voice reads for a word it misreads).
- `voice`:
  - `provider` is `fish` (default) or `local`.
  - **Fish:** `voiceId`. Only the free model `s2.1-pro-free` is supported. The key comes from the macOS Keychain (Settings) or `FISH_AUDIO_API_KEY`. Make with `--allow-network --voice-consent --transmit-text`.
  - **Local engine:** `voiceId`, `modelId`, `engineRevision` and a loopback `endpoint`. Make with `--local-voice-consent`; add `--allow-network` once, to download KanjiVG data that is not cached.
- `music`: a reviewed bed with its source, licence and SHA-256. A changed file stops production. The producer picks the window with the fewest silent stretches where nobody speaks, unless `startSeconds` is set. It sets the bed `belowVoiceDb` (default 11) under the voice and ducks it under speech.
- `timing.write` and `timing.review`: seconds of each writing pass, snapped to whole frames. Also `introTail` and `tail`: the hold after the intro's last line and after the last line. The lines' own timing is in the script.
- `maxWords` (1–6, default 3): how many useful words the card shows.
- `music.fadeInMs`, `music.fadeOutMs`.
- `qa.stillBudgetSeconds` (2.5), `qa.anchorDriftSeconds` (1.5), and `captions.tailSeconds` (0.2): how long a caption stays after its line, never past the next.

Paths are relative to the config file. `pnpm build` must have run (export page and `dist-shot`), and Chrome must be installed or `CONTENTGEN_CHROMIUM_EXECUTABLE` set.

## Make shorts

From `apps/web`:

```sh
pnpm video:kanji -- 水 火 木 --dry-run                                        # what each short shows and says
pnpm video:kanji -- 水 火 木 --allow-network --voice-consent --transmit-text  # make them
```

- Each kanji gets `<outputRoot>/<kanji>-<code point>/v1`, then `v2` on the next run. A release is never overwritten.
- Fish speech and the KanjiVG stroke data are cached in `data/kanji-shorts/cache`, so a re-run costs no new Fish requests.
- `--config <file>` and `--out <folder>` override the defaults.

Each `release/` folder holds:
- `video.mp4`, `master.wav`, `voice.wav` and `captions.srt`
- `credits.txt`, for the video description: your data credits, KanjiVG and the music
- `card-plan.json`, `stills/`, `qa-report.json` and `render-manifest.json` (hashes of every source and artifact)

## Before publishing

- Watch and listen to the whole short. `qa-report.json` records:
  - the longest still stretch (budget 2.5 s)
  - the loudness: the master is mono at about -18 LUFS, which plays as about -15 LUFS on two speakers
  - every timing
- **Pronunciation is not machine-checked.** Listen to every word. Fix a misread word with `narration.speech`.
- The release is a draft (`reviewStatus: not-reviewed`). Nothing is published.
