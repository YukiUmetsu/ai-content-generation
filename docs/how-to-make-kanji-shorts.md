# Make kanji study shorts

`pnpm video:kanji` makes one vertical short (1080 × 1920, 30 fps) per kanji. The picture is Kumiki's `shodo-kanji-card`; ContentGen supplies the card data, the narration, the music bed and the release folder.

## What one short does

1. **Intro.** The voice asks "Do you know how to write the kanji mizu?". On screen the reading is typed (みず) and converts to the typed kanji (水) at once. The typed kanji pushes in slowly and pulses when its name is spoken.
2. **Write.** The brush writes the kanji. The voice reads the on'yomi as the brush lands for the first stroke, then the kun'yomi.
3. **Review.** The brush writes it again with vermilion stroke-order numbers. Only music plays.
4. **Words.** As the review writing ends, the voice reads each useful word and its tile is highlighted until the next one starts.

The reading card stays above the platform's caption band. In 9:16 the bottom 19 % shows a dark felt mat, where white platform captions stay readable.

### Decisions in the data, not in code

- **Useful words** never include the bare kanji (水 is not a useful word for 水). The card takes the first three other words of the data, in order.
- **The spoken name** is the reading of the kanji's own word (水 → mizu). Otherwise it is the first on'yomi (学 → gaku).
  - The voice gets the name in kana inside the English question, because a voice reads romaji such as "hi" (日) as an English word.
  - The captions file shows romaji.
- **Words are spoken as written**, so the voice reads them in context. An irregular reading (今日, 大人) is spoken from its kana. `narration.speech` overrides the text for a word that the voice misreads, for example `{ "水泳": "すいえい" }`.
- **Timing** comes from the brush. Kumiki's `kanjiCardWriting` gives the time of every stroke in Node (bundle `dist-shot/kanji-entry.mjs`), and the export page plans the same strokes from the same glyph.

## Set up once

Make the folder `data/kanji-shorts/` (git ignores `data/`). Put `config.json` in it, after `apps/web/fixtures/kanji-short/config.example.json`:

- `dataset`: the kanji study-card data (`{ kanji: [{ char, jlpt, words, card }] }`), for example `jlpt-n5-n3.json` from the private `kumiki-shodo` repository. Put its credit line in `credits`.
- `voice.voiceId`: your Fish voice. Only the free model `s2.1-pro-free` is supported. The key comes from the macOS Keychain (Settings) or `FISH_AUDIO_API_KEY`.
- `music`: a reviewed bed with its source, licence and SHA-256. A changed file stops production. The producer picks the window with the fewest silent stretches where nobody speaks, unless `startSeconds` is set. It sets the bed `belowVoiceDb` (default 11) under the voice and ducks it under speech.
- `timing.write` and `timing.review`: seconds of each writing pass. They are snapped to whole frames.

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
