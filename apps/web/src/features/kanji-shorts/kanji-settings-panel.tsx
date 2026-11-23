import { useEffect, useRef, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import type { KanjiSettings } from "./kanji-shorts-api";
import { changedSettings, draftFrom, draftProblems, editsOnto, sameSettings, settingsFromDraft, type Draft, type DraftProblem, type Pairs } from "./kanji-settings-model";
import type { Say } from "./kanji-text";
import { keptSettings } from "./kanji-drafts";

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
    {pairs.length > 0 && <div aria-hidden className="hidden gap-2 text-xs font-semibold text-muted-foreground sm:flex">
      <span className="flex-[3]">{keyLabel}</span><span className="flex-[2]">{valueLabel}</span><span className="w-[var(--km-control-height)] shrink-0" />
    </div>}
    {pairs.map(([key, value], i) => <div key={i} className="flex min-w-0 flex-wrap items-center gap-2 rounded-control border border-border bg-surface-subtle/50 p-2 sm:flex-nowrap sm:border-0 sm:bg-transparent sm:p-0">
      <input className={cell + " basis-full sm:basis-0 sm:flex-[3]"} value={key} onChange={e => set(i, 0, e.target.value)} maxLength={400} lang="ja"
        placeholder={keyLabel} aria-label={`${title} ${i + 1}: ${keyLabel}`} />
      <input className={cell + " flex-1 sm:flex-[2]"} value={value} onChange={e => set(i, 1, e.target.value)} type={valueType} placeholder={valueLabel}
        aria-label={`${title} ${i + 1}: ${valueLabel}`} {...(valueType === "number" ? { min: 1, max: 99, step: 1 } : { maxLength: 60 })} />
      <Button variant="outline" size="icon" className="shrink-0" aria-label={say(`Remove ${title} entry ${i + 1}`, `${title}の${i + 1}件目を削除`)}
        icon={<Trash2 className="size-4" />} onClick={() => onChange(pairs.filter((_, k) => k !== i))} />
    </div>)}
    <Button variant="outline" size="sm" className="self-start" icon={<Plus className="size-4" />} onClick={() => onChange([...pairs, ["", ""]])}>{say("Add", "追加")}</Button>
  </fieldset>;
}

function problemText(problem: DraftProblem, say: Say) {
  return {
    "reuse-row": say("Fill in both parts of each reuse, or remove it.", "読みの再利用は両方を入力するか、削除してください。"),
    "retakes-row": say("Fill in both parts of each retake, or remove it.", "読み直しは両方を入力するか、削除してください。"),
    "speech-row": say("Fill in both parts of each \"spoken as\" entry, or remove it.", "読み方の指定は両方を入力するか、削除してください。"),
    "retake-number": say("A take is a whole number from 1 (the first recording) to 99.", "テイクは 1（最初の録音）〜99 の整数です。"),
    number: say("Words and passes must be numbers.", "ことば数と時間は数値で入力してください。"),
    duplicate: say("A text is listed twice in one list; keep one.", "同じテキストが一覧に 2 回あります。1 つにしてください。"),
    "name-clash": say("The name switch reads {name.kana} from the kun'yomi line; remove the {name.kana} row or turn the switch off.",
      "名前のスイッチは {name.kana} を訓読みの行から読みます。{name.kana} の行を削除するか、スイッチをオフにしてください。"),
  }[problem];
}

/**
 * The settings the page edits in the kanji shorts settings file; everything else in the file stays.
 * `onSave` gets only the settings the person changed, and resolves to the saved settings or the error.
 */
export function KanjiSettingsPanel({ settings, provider, onSave, onDirtyChange, say }: {
  settings: KanjiSettings; provider: "fish" | "local"; onSave: (changes: Partial<KanjiSettings>) => Promise<{ saved: KanjiSettings } | { error: string }>;
  onDirtyChange: (dirty: boolean) => void; say: Say;
}) {
  // The unsaved draft outlives the page (kanji-drafts); it is dropped once saved or discarded.
  const [base, setBase] = useState(() => keptSettings.value?.base ?? settings);
  const [draft, setDraft] = useState(() => keptSettings.value?.draft ?? draftFrom(settings));
  const [saving, setSaving] = useState(false);
  // Worded at render time, so it follows a language switch.
  const [feedback, setFeedback] = useState<{ kind: "saved" | "discarded" } | { kind: "error"; text: string } | null>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const next = settingsFromDraft(draft);
  const dirty = Object.keys(changedSettings(base, next)).length > 0;
  const problems = draftProblems(draft);
  // The file changed elsewhere (or was saved): an untouched form follows it; unsaved edits are kept
  // and will be saved on top of the new file, changing only what was edited here.
  const changedElsewhere = !sameSettings(base, settings);
  if (changedElsewhere && !dirty) { setBase(settings); setDraft(draftFrom(settings)); }

  useEffect(() => { keptSettings.value = dirty ? { base, draft } : null; onDirtyChange(dirty); }, [base, draft, dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => { if (feedback) feedbackRef.current?.focus(); }, [feedback]);

  const update = (patch: Partial<Draft>) => { setDraft(current => ({ ...current, ...patch })); if (feedback?.kind !== "error") setFeedback(null); };
  async function save() {
    setSaving(true); setFeedback(null);
    const result = await onSave(editsOnto(base, next, settings));
    setSaving(false);
    if ("error" in result) { setFeedback({ kind: "error", text: result.error }); return; }
    // The form starts again from what the file now has.
    keptSettings.value = null;
    setBase(result.saved); setDraft(draftFrom(result.saved));
    setFeedback({ kind: "saved" });
  }
  function discard() {
    setBase(settings); setDraft(draftFrom(settings));
    setFeedback({ kind: "discarded" });
  }

  return <Surface header={<div>
    <h2 className="font-serif text-lg font-semibold text-foreground">{say("Settings", "設定")}</h2>
    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{say(
      "Saved in the kanji shorts settings file, the same settings pnpm video:kanji uses. Music, data and the card's look stay as the file has them.",
      "漢字ショートの設定ファイルに保存します（pnpm video:kanji と同じ設定）。音楽・データ・カードの見た目はファイルのまま変わりません。")}</p>
  </div>}>
    <form className="flex flex-col gap-6" onSubmit={e => { e.preventDefault(); if (dirty && !problems.length) void save(); }}>
      {changedElsewhere && dirty && <p role="status" className="rounded-control border border-status-info bg-status-info/10 px-3 py-2 text-sm text-foreground">{say(
        "The settings file changed elsewhere. Your unsaved changes are kept; saving changes only what you edited here.",
        "設定ファイルが別の場所で変更されました。未保存の変更は残っています。保存すると、ここで編集した項目だけが変わります。")}</p>}
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
          {Object.keys(draft.otherVoiceIds).length > 0 && <p className="text-xs text-muted-foreground">{say(
            `Voices for ${Object.keys(draft.otherVoiceIds).join(", ")} are kept as the file has them.`, `${Object.keys(draft.otherVoiceIds).join("、")} の音声はファイルのまま残ります。`)}</p>}
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
          <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={draft.nameFromKunyomi} onChange={e => update({ nameFromKunyomi: e.target.checked })} />
          <span>{say("Read each kanji's name with the audio of its reading line", "漢字の名前を読みの行と同じ音声で読む")}
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{say(
              "The question's name is the very recording of the reading: the kun'yomi line's (ひと for 人), else the on'yomi line's (ねん for 年 called nen).",
              "問いかけの名前に、読みの録音をそのまま使います。訓読みの行（人なら ひと）、なければ音読みの行（年を ねん と呼ぶとき）。")}</span>
          </span>
        </label>
        <PairsEditor say={say} title={say("Reuse a reading", "読みの再利用")} pairs={draft.reuse} onChange={reuse => update({ reuse })}
          keyLabel={say("Text one voice reads", "読むテキスト")} valueLabel={say("From line", "元の行")}
          help={say("Read a text with the audio of another line that ends with it, for example ひと → kunyomi. A text may name {name.kana} for every kanji.",
            "テキストを、それで終わる別の行の音声で読みます（例: ひと → kunyomi）。{name.kana} と書くとすべての漢字に使えます。")} />
        <PairsEditor say={say} title={say("Retakes", "読み直し")} pairs={draft.retakes} onChange={retakes => update({ retakes })} valueType="number"
          keyLabel={say("Text one voice reads", "読むテキスト")} valueLabel={say("Take", "テイク")}
          help={say("Ask the voice again for a text it flubbed, for example ひと → 5. Raise the number for another take.",
            "読み間違えたテキストをもう一度読ませます（例: ひと → 5）。別のテイクにするには数を上げます。")} />
        <PairsEditor say={say} title={say("Spoken as", "読み方の指定")} pairs={draft.speech} onChange={speech => update({ speech })}
          keyLabel={say("Word", "ことば")} valueLabel={say("Read as", "読み")}
          help={say("The text the voice reads for a word it misreads, for example 一時 → いちじ.", "読み間違えることばの読みを指定します（例: 一時 → いちじ）。")} />
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
      {problems.length > 0 && <ul role="status" className="flex flex-col gap-1 text-sm text-status-warning">
        {problems.map(problem => <li key={problem}>{problemText(problem, say)}</li>)}
      </ul>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" icon={<Save className="size-4" />} isLoading={saving} aria-disabled={!dirty || problems.length > 0 || undefined}
          className={!dirty || problems.length > 0 ? "opacity-60" : undefined}>{say("Save settings", "設定を保存")}</Button>
        {dirty && <Button type="button" variant="outline" size="sm" onClick={discard}>{say("Discard changes", "変更を破棄")}</Button>}
        {dirty && <span className="text-xs text-muted-foreground">{say("Unsaved changes", "未保存の変更があります")}</span>}
      </div>
      {feedback && <p ref={feedbackRef} tabIndex={-1} role={feedback.kind === "error" ? "alert" : "status"}
        className={feedback.kind === "error" ? "rounded-control border border-status-danger bg-status-danger/10 px-3 py-2 text-sm text-foreground focus:outline-none"
          : "text-sm text-status-success focus:outline-none"}>{feedback.kind === "error" ? feedback.text
            : feedback.kind === "saved" ? say("Settings saved.", "設定を保存しました。") : say("Changes discarded.", "変更を破棄しました。")}</p>}
    </form>
  </Surface>;
}
