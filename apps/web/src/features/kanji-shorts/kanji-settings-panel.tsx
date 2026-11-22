import { useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import type { KanjiSettings } from "./kanji-shorts-api";
import { changedSettings, draftFrom, settingsFromDraft, type Draft, type Pairs } from "./kanji-settings-model";
import type { Say } from "./kanji-text";

const field = "mt-1 w-full min-w-0 rounded-control border border-input bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
/** A field in a row of fields, with no label above it. */
const cell = field.replace("mt-1 ", "");
const label = "flex min-w-0 flex-col text-xs font-semibold text-muted-foreground";
function PairsEditor({ title, help, pairs, onChange, keyLabel, valueLabel, valueType = "text", say }: {
  title: string; help: string; pairs: Pairs; onChange: (pairs: Pairs) => void; keyLabel: string; valueLabel: string; valueType?: "text" | "number"; say: Say;
}) {
  const set = (i: number, j: 0 | 1, text: string) => onChange(pairs.map((pair, k) => k === i ? (j === 0 ? [text, pair[1]] : [pair[0], text]) : pair));
  return <fieldset className="flex min-w-0 flex-col gap-2">
    <legend className="mb-2 text-sm font-semibold text-foreground">{title}</legend>
    <p className="text-xs leading-relaxed text-muted-foreground">{help}</p>
    {pairs.length > 0 && <div aria-hidden className="flex gap-2 text-xs font-semibold text-muted-foreground">
      <span className="flex-[3]">{keyLabel}</span><span className="flex-[2]">{valueLabel}</span><span className="w-[var(--km-control-height)] shrink-0" />
    </div>}
    {pairs.map(([key, value], i) => <div key={i} className="flex min-w-0 items-center gap-2">
      <input className={cell + " flex-[3]"} value={key} onChange={e => set(i, 0, e.target.value)} maxLength={400} lang="ja"
        aria-label={say(`${title} ${i + 1}: ${keyLabel}`, `${title} ${i + 1}: ${keyLabel}`)} />
      <input className={cell + " flex-[2]"} value={value} onChange={e => set(i, 1, e.target.value)} type={valueType}
        aria-label={say(`${title} ${i + 1}: ${valueLabel}`, `${title} ${i + 1}: ${valueLabel}`)} {...(valueType === "number" ? { min: 2, max: 99, step: 1 } : { maxLength: 60 })} />
      <Button variant="outline" size="icon" className="shrink-0" aria-label={say(`Remove ${title} entry ${i + 1}`, `${title}の${i + 1}件目を削除`)}
        icon={<Trash2 className="size-4" />} onClick={() => onChange(pairs.filter((_, k) => k !== i))} />
    </div>)}
    <Button variant="outline" size="sm" className="self-start" icon={<Plus className="size-4" />} onClick={() => onChange([...pairs, ["", ""]])}>{say("Add", "追加")}</Button>
  </fieldset>;
}

/** The settings the page edits in data/kanji-shorts/config.json; everything else in the file stays as it is. */
export function KanjiSettingsPanel({ settings, provider, saving, message, error, onSave, say }: {
  settings: KanjiSettings; provider: "fish" | "local"; saving: boolean; message: string; error: string;
  onSave: (next: KanjiSettings) => void; say: Say;
}) {
  const [draft, setDraft] = useState(() => draftFrom(settings));
  const [base, setBase] = useState(() => JSON.stringify(settings));
  // New saved settings (a save, or the file edited elsewhere) start the draft again from them;
  // a reload that finds the same settings keeps the draft's unsaved edits.
  const saved = JSON.stringify(settings);
  if (base !== saved) { setBase(saved); setDraft(draftFrom(settings)); }
  const update = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch }));
  const next = settingsFromDraft(draft);
  const dirty = Object.keys(changedSettings(settings, next)).length > 0;
  return <Surface header={<div>
    <h2 className="font-serif text-lg font-semibold text-foreground">{say("Settings", "設定")}</h2>
    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{say(
      "Saved in the kanji shorts settings file, the same settings pnpm video:kanji uses. Music, data and the card's look stay as the file has them.",
      "漢字ショートの設定ファイルに保存します（pnpm video:kanji と同じ設定）。音楽・データ・カードの見た目はファイルのまま変わりません。")}</p>
  </div>}>
    <form className="flex flex-col gap-6" onSubmit={e => { e.preventDefault(); onSave(next); }}>
      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold text-foreground">{say("Voices", "音声")}</legend>
        <p className="text-xs leading-relaxed text-muted-foreground">{say(
          "Japanese is read by the Japanese voice and English by the English voice, even inside one sentence.",
          "一文の中でも、日本語は日本語の音声、英語は英語の音声で読みます。")}</p>
        <div className="grid gap-3">
          <label className={label}>{say("Japanese voice ID", "日本語の音声 ID")}
            <input className={field + " font-mono"} value={draft.ja} onChange={e => update({ ja: e.target.value })} spellCheck={false} autoComplete="off" />
          </label>
          <label className={label}>{say("English voice ID", "英語の音声 ID")}
            <input className={field + " font-mono"} value={draft.en} onChange={e => update({ en: e.target.value })} spellCheck={false} autoComplete="off" />
          </label>
          <label className={label}>{say("Voice for other languages", "その他の言語の音声")}
            <input className={field + " font-mono"} value={draft.voiceId} onChange={e => update({ voiceId: e.target.value })} spellCheck={false} autoComplete="off"
              required={provider === "fish"} />
          </label>
          <label className={label}>{say("Pace", "話す速さ")}
            <select className={field} value={draft.pace} onChange={e => update({ pace: e.target.value as Draft["pace"] })}>
              <option value="">{say("Default (slow)", "既定（ゆっくり）")}</option>
              <option value="slow">{say("Slow", "ゆっくり")}</option>
              <option value="measured">{say("Measured", "ふつう")}</option>
              <option value="fast">{say("Fast", "はやい")}</option>
            </select>
          </label>
        </div>
      </fieldset>
      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold text-foreground">{say("Narration", "ナレーション")}</legend>
        <label className="flex items-start gap-3 text-sm text-foreground">
          <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={draft.nameFromKunyomi}
            onChange={e => update({ nameFromKunyomi: e.target.checked })} />
          <span>{say("Read each kanji's name with the audio of its kun'yomi line", "漢字の名前を訓読みの行と同じ音声で読む")}
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{say(
              "A name read alone can sound stilted; in \"くんよみ、ひと。\" it sounds natural. Applies where the kun'yomi line ends with the name.",
              "単独で読んだ名前は不自然になることがあります。「くんよみ、ひと。」の中の読みは自然です。訓読みの行が名前で終わる漢字に使います。")}</span>
          </span>
        </label>
        <PairsEditor say={say} title={say("Reuse a reading", "読みの再利用")} pairs={draft.reuse} onChange={reuse => update({ reuse })}
          keyLabel={say("Text one voice reads", "読むテキスト")} valueLabel={say("From line", "元の行")}
          help={say("Read a text with the audio of another line that ends with it, for example ひと → kunyomi. A text may name {name.kana}.",
            "テキストを、それで終わる別の行の音声で読みます（例: ひと → kunyomi）。{name.kana} も使えます。")} />
        <PairsEditor say={say} title={say("Retakes", "読み直し")} pairs={draft.retakes} onChange={retakes => update({ retakes })} valueType="number"
          keyLabel={say("Text one voice reads", "読むテキスト")} valueLabel={say("Take", "テイク")}
          help={say("Ask the voice again for a text it flubbed, for example ひと → 5. Raise the number for another take.",
            "読み間違えたテキストをもう一度読ませます（例: ひと → 5）。別のテイクにするには数を上げます。")} />
        <PairsEditor say={say} title={say("Spoken as", "読み方の指定")} pairs={draft.speech} onChange={speech => update({ speech })}
          keyLabel={say("Word", "ことば")} valueLabel={say("Read as", "読み")}
          help={say("The text the voice reads for a word it misreads, for example 水泳 → すいえい.", "読み間違えることばの読みを指定します（例: 水泳 → すいえい）。")} />
      </fieldset>
      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold text-foreground">{say("Card and timing", "カードとタイミング")}</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={label}>{say("Words on the card", "カードのことば数")}
            <input className={field} type="number" min={1} max={6} step={1} placeholder="3" value={draft.maxWords} onChange={e => update({ maxWords: e.target.value })} />
          </label>
          <label className={label}>{say("Writing pass (s)", "書く時間（秒）")}
            <input className={field} type="number" min={3} max={20} step={0.1} placeholder="6.6" value={draft.write} onChange={e => update({ write: e.target.value })} />
          </label>
          <label className={label}>{say("Review pass (s)", "復習の時間（秒）")}
            <input className={field} type="number" min={3} max={20} step={0.1} placeholder="6.6" value={draft.review} onChange={e => update({ review: e.target.value })} />
          </label>
        </div>
        <label className="flex items-start gap-3 text-sm text-foreground">
          <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={draft.aboveCaptions} onChange={e => update({ aboveCaptions: e.target.checked })} />
          <span>{say("Keep the card above the platforms' title and captions", "カードを各プラットフォームのタイトルと字幕より上に置く")}
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{say(
              "The kanji is then smaller. Off, the card runs to the bottom margin.", "オンにすると漢字は小さくなります。オフではカードが下の余白まで伸びます。")}</span>
          </span>
        </label>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" icon={<Save className="size-4" />} isLoading={saving} disabled={!dirty || saving}>{say("Save settings", "設定を保存")}</Button>
        {dirty && <Button type="button" variant="outline" size="sm" onClick={() => setDraft(draftFrom(settings))}>{say("Discard changes", "変更を破棄")}</Button>}
      </div>
      {error && <p role="alert" className="rounded-control border border-status-danger bg-status-danger/10 px-3 py-2 text-sm text-foreground">{error}</p>}
      {message && !error && <p role="status" className="text-sm text-status-success">{message}</p>}
    </form>
  </Surface>;
}
