# Make kanji study shorts

`pnpm video:kanji` and the Studio's **Kanji shorts** page make one vertical short (1080 × 1920, 30 fps) per kanji. Both use the same settings file, preview and producer. The picture is Kumiki's `shodo-kanji-card`; ContentGen supplies the card data, the narration, the music bed and the release folder.

## What one short does

1. **Intro.** The voice asks "Do you know how to write the kanji mizu?". On screen the reading is typed (みず) and converts to the typed kanji (水) at once. The typed kanji pushes in slowly and pulses when its name is spoken.
2. **Write.** The brush comes in from outside the frame (from the right with the default brush), writes the kanji and leaves the frame after the last stroke, so the finished kanji holds with nothing on it. The voice reads the on'yomi as the brush lands for the first stroke, then the kun'yomi.
3. **Review.** The brush comes in again and writes it with vermilion stroke-order numbers, then leaves. Only music plays.
4. **Words.** As the review writing ends, the voice says "Some common words using this kanji are" (in the English voice), pauses half a second, then reads each useful word; its tile is highlighted until the next one starts. While the introduction plays, the "USEFUL WORDS" title turns vermilion and the tiles lift one after another, so the picture keeps moving until the first word lights.

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
  - `pauseAfter` on a step is the silence after its line, in place of the next line's `gap`. The words' introduction uses it for the half-second pause before the first word; the words keep their own 1 s gap between each other. In a `forEach` step the pause follows its last item; after the script's last line it has no effect.
  - `cue` on a step names a part of the card to draw attention to while the line plays, from just before it is spoken until the next line starts: `"words"` (the useful words) or `"readings"`. The words' introduction uses `"cue": "words"`. Another name stops production before any voice is made.
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
  - **Any of its readings can be its name.** In the settings file, `names` maps a kanji to the reading it is called by, in kana: `{ "年": "ねん" }` makes the question "Do you know how to write the kanji nen?" and types ねん → 年. The romaji comes from the data, and a reading the kanji does not have is refused. In the Studio, each kanji's preview has **Called by**; choosing its first reading again goes back to the default. `--dry-run` lists the names each kanji can be called by.
  - The voice gets the name in kana inside the English question, because a voice reads romaji such as "hi" (日) as an English word.
  - The captions file shows romaji.
- **A voice per language.** `voice.voiceIds` maps a language to a voice, for example `{ "ja": "<Japanese voice>", "en": "<English voice>" }`. A line that mixes scripts is read in runs, each by its language's voice, and joined into one line: "Do you know how to write the kanji" in the English voice, "つき" in the Japanese one.
  - A line in one script is read by the voice of that script (a Japanese line by the Japanese voice). `voice.voiceId` reads any language without its own voice.
  - Digits go with the text they touch (12月 is Japanese).
  - The Japanese voice does not read the English sentence's ASCII punctuation: a lone "つき?" came out as すき. The English run is read without the sentence's final "?"; the caption keeps it.
  - The question's pulse lands as the name's run starts. `--dry-run` shows which voice reads which part, and the release's manifest records each run's voice.
- **Phrases said in every short are recorded once.** A line is read in parts at its template's own commas: in `{labels.on}、{onyomi}。` the label "おんよみ、" is one part and the reading "ネン。" another.
  - A part with none of the kanji's own fields in it is a **phrase**: おんよみ、, くんよみ、, "Do you know how to write the kanji", "Some common words using this kanji are". It is one recording, made once and heard in every short. Each new short records only its own words and readings.
  - The parts are joined with `narration.phraseGap` (0.15 s, default) between them. With each clip's own silence this is about the 0.26 s comma pause the voice makes inside a line.
  - `narration.splitPhrases: false` reads every line whole again.
  - `--dry-run` marks phrases. The release's manifest records `phrase: true` for each one.
- **Words are spoken as written**, so the voice reads them in context. An irregular reading (今日, 大人) is spoken from its kana. `narration.speech` overrides the text for a word that the voice misreads, for example `{ "水泳": "すいえい" }`.
  - **Any part can be read as another text** too, keyed by the part as the line says it: `{ "いま。": "今。" }` gives the voice the kanji. In kana いま is also 居間 and came out rising; as 今 it falls from い to ま. The caption and the card keep the line's own text. The name that reuses this reading follows it.
- **A fresh take of a flubbed line.** A voice can flub one take, and the cache would return that take every time. The Japanese voice once read the name ひと as ひとだ, and gave とし a rise at its end. `narration.retakes` chooses the take of a text, for example `{ "とし。": 3 }`.
  - The key is the exact text one voice reads, punctuation included: a reading part ("とし。"), a phrase ("くんよみ、") or a word line ("人間。"). For a part read as another text, the key is that text ("今。").
  - A phrase's take is heard in every short made from then on. A short already made keeps its recording until it is made again.
  - `--dry-run` shows each line's parts and the retakes that apply. A key that matches nothing in a short is not used there.
- **Takes: hear, compare and choose.**
  - **In the Studio,** each part in "What each short says" has **Takes**. It lists the recorded takes. You can play each one and see its measured pitch line and shape, then **Use this take**, **Record another take**, or **Read as** another text.
  - **The pitch is measured, not judged.** A take that *rises* climbs to its end like a question. One that *falls* drops after its peak (今: い high, ま low). A *level* take does neither. A devoiced し has too little voice to measure. Listen, then choose.
  - **On the command line,** `pnpm video:kanji -- 年 --takes` lists every recording of the shorts with its takes and the take in use. `--new-take "とし。" --allow-network --voice-consent --transmit-text` records one more take.
  - **After choosing,** make the short again to hear the new take in it.
  - Every take is cached on its own, so going back to an earlier number costs nothing; removing the entry goes back to the first take.
  - The release's QA report and manifest record the take of each line or run.
- **Reuse a reading.** `narration.reuse` reads a text with the audio of another line of the same short.
  - With `{ "{name.kana}": ["kunyomi", "onyomi"] }`, the question's name is the very recording of the reading in the kun'yomi line (人: "ひと。"), or else in the on'yomi line (年 called nen: "ネン。"). So the name and the reading sound the same, and one choice of take fixes both.
  - A list of lines is tried in order, and the first that says the text gives it. Katakana matches its hiragana, so ねん is found in "ネン。".
  - The key is the exact text one voice reads, as for retakes; the value is a line id (`question`, `onyomi`, `kunyomi`, `word-1`, …).
  - **One entry for every kanji:** a key may name the kanji's fields. `{ "{name.kana}": "kunyomi" }` reads each kanji's name with the audio of its kun'yomi line (人: ひと, 年: とし). This is the Studio's "Read each kanji's name with the audio of its kun'yomi line" switch. The fields are `{char}`, `{name.kana}`, `{name.romaji}`, `{meanings}`, `{jlpt}`, `{onyomi}`, `{kunyomi}`, `{labels.on}` and `{labels.kun}`; another field stops at config read. An exact text wins over a key that fills in to the same text, and a key that fills in empty (a kanji with no kun'yomi) does nothing. `narration.retakes` keys may name fields too.
  - It applies only where that line says exactly the text after its last comma (or is just that text). The config covers every kanji, so in a short whose line says something else (費: "くんよみ、ついやす。") the text is read on its own. `--dry-run` shows where it applies.
  - The cut is at the longest pauses, one per comma of the line (a consonant inside a word does not count), from where the sound before the word falls to quiet, so a soft "h" or "s" is kept. The text is also read on its own as a fallback: if the line's audio has no clear pause, the short uses that reading and its QA report warns.
  - Where the short has no such line, the line is the text's own, or the line itself has a reused part, the text is read on its own too. The QA report and manifest record `reusedFrom` and the source line's voice.
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
- `narration`: optional settings:
  - `script`: a file, or the script itself.
  - `labels`: `{ "on", "kun" }`, the words the voice says before each reading.
  - `speech`: the text the voice reads for a word it misreads, or for any part of a line.
  - `retakes`: the take of a text, from 1 (the first recording) to 99.
  - `reuse`: a text read with another line's recording.
  - `splitPhrases` and `phraseGap`: whether lines are read in parts, with phrases recorded once, and the pause between the parts.
- `voice`:
  - `provider` is `fish` (default) or `local`.
  - **Fish:** `voiceId`, and `voiceIds` for a voice per language. Only the free model `s2.1-pro-free` is supported. The key comes from the macOS Keychain (Settings) or `FISH_AUDIO_API_KEY`. Make with `--allow-network --voice-consent --transmit-text`.
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
- `--dry-run --json` prints the same preview as JSON: each line, its parts with their voice, phrases and recording, and the reuses and retakes that apply.
- `--takes` and `--new-take <text>` list and record takes (see "Takes" above).

### In the Studio

Open **Kanji shorts** in the Studio's navigation (`pnpm dev` from `apps/web`). The page uses `data/kanji-shorts/config.json`, or the file named by `CONTENTGEN_KANJI_CONFIG`. Without one, the page says where to make it.

1. **Choose kanji.** Type them, or pick them from the list by JLPT level or search (kanji, kana, romaji or meaning). A dot marks a kanji already made. One run makes up to 10.
2. **Check what each short says.** Each line is listed with the voice that reads each part, where the name reuses the kun'yomi line's audio, and the retakes that apply. Nothing is sent to make the preview.
3. **Make.** Pressing Make is the consent for that run: with Fish, the narration text goes to Fish Audio, as `--allow-network --voice-consent --transmit-text` allow on the command line. The kanji are made one after another.
   - Each short shows the producer's real step (checking, stroke data, voices, timing, music, mixing, rendering frames, combining, measuring), not an estimated percentage.
   - **Cancel** stops the short being made and the ones after it.
   - A short that stops shows its error, and the run goes on to the next kanji.
   - With the local Rust server running, each short is a `video-kanji-short` job on the Jobs page, and cancelling it there stops it too. Without the server, the short is made anyway and says it is not tracked.
4. **Watch.** The newest short of the chosen kanji plays with its earlier versions, its length, loudness, longest still, how its name was read, and any QA warnings. Nothing is published.
5. **Takes.** Each part of a line has its takes: play and compare them, choose one, record another, or have the voice read the part as another text. Recording a take sends that one text to Fish Audio when you press the button.
6. **Settings.** The page edits the voices (Japanese, English, other languages), the pace, the name reuse, reuses, retakes, "spoken as" readings, the number of words, the band above the platforms' captions, and the writing and review passes.
   - Everything else in the file (data, music, script, the card's look, credits) stays as it is.
   - A save is checked like the CLI's config read, then written in one step, and only if the file has not changed since the page loaded it. A file edited meanwhile is never overwritten: reload, then make the change again.

Each `release/` folder holds:
- `video.mp4`, `master.wav`, `voice.wav` and `captions.srt`
- `credits.txt`, for the video description: your data credits, KanjiVG and the music
- `card-plan.json`, `stills/`, `qa-report.json` and `render-manifest.json` (hashes of every source and artifact)

## Before publishing

- Watch and listen to the whole short. `qa-report.json` records:
  - the longest still stretch (budget 2.5 s)
  - the loudness: the master is mono at about -18 LUFS, which plays as about -15 LUFS on two speakers
  - every timing
- **Pronunciation is not machine-checked.** Listen to every word. Fix a misread word with `narration.speech` (Fish read 一時 as いっとき; `{ "一時": "いちじ" }` says it as the card shows it), and a flubbed take with `narration.retakes`.
- The release is a draft (`reviewStatus: not-reviewed`). Nothing is published.
