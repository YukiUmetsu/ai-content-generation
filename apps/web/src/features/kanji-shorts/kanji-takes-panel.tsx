import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Mic, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chooseTake, loadTakes, recordTake, speakAs, takeAudio, type Recording, type Take } from "./kanji-shorts-api";
import { errorText, type Say } from "./kanji-text";

/**
 * A take's pitch as a small line, on a scale shared by the takes of one recording so they compare:
 * higher is higher pitch, gaps are unvoiced (a devoiced し).
 */
function PitchLine({ pitch, low, high, say }: { pitch: (number | null)[]; low: number; high: number; say: Say }) {
  if (pitch.filter(hz => hz !== null).length < 2) return <span className="text-xs text-muted-foreground">{say("pitch: too little voiced", "ピッチ: 有声部分が少なすぎます")}</span>;
  const span = Math.max(high - low, 2 / 12), width = 120, height = 28, step = width / Math.max(1, pitch.length - 1);
  const segments: string[] = [];
  let current = "";
  pitch.forEach((hz, i) => {
    if (hz === null) { if (current) segments.push(current); current = ""; return; }
    const y = height - 3 - ((Math.log2(hz) - low) / span) * (height - 6);
    current += `${current ? "L" : "M"}${(i * step).toFixed(1)},${y.toFixed(1)}`;
  });
  if (current) segments.push(current);
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="shrink-0 text-primary">
    <rect x="0" y="0" width={width} height={height} rx="4" className="fill-surface-subtle" />
    {segments.map((d, i) => <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />)}
  </svg>;
}

/** The measured shape in words (the pitch line says the same visually). */
function shapeText(take: Take, say: Say) {
  if (take.silent) return say("Silent: the voice returned no speech. Record another take.", "無音です（音声が返されませんでした）。別のテイクを録音してください。");
  if (take.unreadable) return say("This take could not be measured.", "このテイクは測定できませんでした。");
  if (take.shape === null) return say("Pitch not measured (too little voiced).", "ピッチは測定できません（有声部分が少なすぎます）。");
  const sign = (n: number) => `${n > 0 ? "+" : ""}${n}`;
  if (take.shape === "rises") return say(`Pitch rises to the end, like a question (${sign(take.rise!)} semitones).`, `ピッチが語尾で上がります（疑問のよう、${sign(take.rise!)} 半音）。`);
  if (take.shape === "falls") return say(`Pitch falls ${-take.fall!} semitones after its peak.`, `ピッチが山のあと ${-take.fall!} 半音下がります。`);
  return say("Pitch is level.", "ピッチは平らです。");
}

/**
 * The takes of one recording: hear each, see its measured pitch, choose the one a short uses, record
 * another, or have the voice read the part as another text. Choosing writes narration.retakes; reading
 * as writes narration.speech under the part as its line says it (`recording.written`). Make the short
 * again to hear it in place. The panel stays open across a refresh of the preview, and follows it.
 */
export function KanjiTakesPanel({ id, recording, phrase, provider, onChanged, say }: {
  id: string; recording: Recording; phrase: boolean; provider: "fish" | "local"; onChanged: () => void; say: Say;
}) {
  const [takes, setTakes] = useState<Take[] | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [recording_, setRecording] = useState(false);
  const [choosing, setChoosing] = useState<number | null>(null);
  const [savingAs, setSavingAs] = useState(false);
  // A choice shown at once, until the refreshed preview says the same (or something else).
  const [pending, setPending] = useState<{ take: number; was: number } | null>(null);
  const [seenTake, setSeenTake] = useState(recording.take);
  const [done, setDone] = useState<{ kind: "recorded"; take: number } | { kind: "chosen"; take: number } | { kind: "read-as" } | null>(null);
  const written = recording.written;
  const [readAs, setReadAs] = useState(recording.text === written ? "" : recording.text);
  // Another text read (a "read as" saved here or elsewhere): its takes and its field follow it.
  const [shown, setShown] = useState(`${written}|${recording.text}`);
  if (seenTake !== recording.take) {
    // The preview now says which take is used: a choice made here has arrived (or was changed elsewhere).
    setSeenTake(recording.take); setPending(null);
    if (done?.kind === "chosen" && done.take !== recording.take) setDone(null);
  }
  if (shown !== `${written}|${recording.text}`) {
    setShown(`${written}|${recording.text}`); setReadAs(recording.text === written ? "" : recording.text); setTakes(null); setPending(null);
    // A result about the old text (a take of it recorded) no longer applies; a saved "read as" is what changed it.
    if (done?.kind !== "read-as") setDone(null);
  }
  const doneRef = useRef<HTMLParagraphElement>(null), latest = useRef(0), actor = useRef<Element | null>(null);
  const ja = say("en", "ja") === "ja";
  const load = useCallback(() => {
    const request = ++latest.current;
    // Only the newest answer is shown: a slower, older one never replaces it.
    return loadTakes(recording).then(result => { if (request === latest.current) { setTakes(result.takes); setFailure(null); } })
      .catch(error => { if (request === latest.current) setFailure(error); });
  }, [recording]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!done) return;
    const now = document.activeElement;
    if (now === actor.current || now === document.body || now === null) doneRef.current?.focus();
  }, [done]);
  // The newest load, for an action that finishes after the text read here changed.
  const loadLatest = useRef(load);
  useEffect(() => { loadLatest.current = load; }, [load]);
  const inUse = pending && pending.was === recording.take ? pending.take : recording.take;

  async function record() {
    setRecording(true); setFailure(null); setDone(null); actor.current = document.activeElement;
    try { const made = await recordTake(recording, provider); await loadLatest.current(); setDone({ kind: "recorded", take: made.take }); }
    catch (error) { setFailure(error); } finally { setRecording(false); }
  }
  async function choose(take: number) {
    setChoosing(take); setFailure(null); setDone(null); actor.current = document.activeElement;
    try { await chooseTake(recording.text, take); setPending({ take, was: recording.take }); setDone({ kind: "chosen", take }); onChanged(); }
    catch (error) { setFailure(error); } finally { setChoosing(null); }
  }
  async function saveReadAs() {
    setSavingAs(true); setFailure(null); setDone(null); actor.current = document.activeElement;
    try { await speakAs(written, readAs); setDone({ kind: "read-as" }); onChanged(); }
    catch (error) { setFailure(error); } finally { setSavingAs(false); }
  }
  const voiced = (takes ?? []).flatMap(take => (take.pitch ?? []).filter((hz): hz is number => hz !== null)).map(hz => Math.log2(hz));
  const low = voiced.length ? Math.min(...voiced) : 0, high = voiced.length ? Math.max(...voiced) : 1;
  // A chosen take with no recording yet: named, unless nothing is recorded and the first recording is the one in use.
  const missing = takes !== null && !takes.some(take => take.take === inUse) && (takes.length > 0 || inUse > 1);
  const quote = (text: string) => ja ? `「${text}」` : `“${text}”`;

  return <div id={id} className="mt-2 flex min-w-0 flex-col gap-3 rounded-control border border-border bg-surface p-3 sm:ml-[6.5rem]">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <p className="min-w-0 break-words text-sm font-semibold text-foreground">{say("Takes of", "テイク:")} <span lang={recording.locale}>{quote(recording.text)}</span></p>
      {phrase && <p className="text-xs text-status-info">{say("A phrase: the take you choose is used in every short made from now on.", "フレーズ: 選んだテイクは、これから作るすべてのショートで使われます。")}</p>}
    </div>
    {failure != null && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-status-danger">
      <AlertCircle aria-hidden className="size-4 shrink-0" /><span className="min-w-0 flex-1 break-words">{errorText(failure, say)}</span>
      {takes === null && <Button variant="outline" size="sm" icon={<RefreshCw className="size-4" />} onClick={() => void load()}>{say("Try again", "再試行")}</Button>}
    </div>}
    {takes === null ? failure == null && <p role="status" className="text-sm text-muted-foreground">{say("Loading the takes…", "テイクを読み込んでいます…")}</p>
      : !takes.length ? <p className="text-sm text-muted-foreground">{say("Not recorded yet: it is recorded when the short is made, or record a take now.", "まだ録音されていません。ショートの作成時に録音されます。今すぐ録音することもできます。")}</p>
      : <ul className="flex flex-col gap-2">
        {takes.map(take => {
          const used = take.take === inUse;
          return <li key={take.take} className={"flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-control border p-2 " + (used ? "border-primary bg-primary/5" : "border-border")}>
            <span className="w-16 shrink-0 text-sm font-semibold text-foreground">{say(`Take ${take.take}`, `テイク ${take.take}`)}</span>
            <audio controls preload="none" src={takeAudio(recording, take.take)} className="h-8 w-full min-w-0 max-w-[14rem]" aria-label={say(`Play take ${take.take}`, `テイク ${take.take} を再生`)} />
            {!take.unreadable && !take.silent && <PitchLine pitch={take.pitch ?? []} low={low} high={high} say={say} />}
            <span className="min-w-0 flex-1 basis-40 text-xs text-muted-foreground">{take.seconds ? `${take.seconds} s · ` : ""}{shapeText(take, say)}</span>
            {used ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-status-success"><Check aria-hidden className="size-3.5" />{say("In use", "使用中")}</span>
              : <Button variant="outline" size="sm" isLoading={choosing === take.take} disabled={choosing !== null}
                aria-label={say(`Use this take (take ${take.take})`, `このテイクを使う（テイク ${take.take}）`)} onClick={() => void choose(take.take)}>{say("Use this take", "このテイクを使う")}</Button>}
          </li>;
        })}
      </ul>}
    {missing && <p className="text-xs text-status-warning">{say(`Take ${inUse} is chosen but not recorded yet: it is recorded (and sent to the voice) when the short is made.`,
      `テイク ${inUse} が選ばれていますが、まだ録音されていません。ショートの作成時に録音されます（音声サービスに送信されます）。`)}</p>}
    <div className="flex flex-col gap-1">
      <Button variant="outline" size="sm" className="self-start" icon={<Mic className="size-4" />} isLoading={recording_} disabled={recording_}
        aria-busy={recording_ || undefined} onClick={() => void record()}>{say("Record a take", "録音する")}</Button>
      <span className="text-xs text-muted-foreground">{provider === "fish" ? say("Sends this text to Fish Audio, read with your voice.", "このテキストを Fish Audio に送り、設定した音声で読み上げます。")
        : say("Read by the local voice.", "ローカルの音声で読み上げます。")}</span>
    </div>
    <form className="flex min-w-0 flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void saveReadAs(); }}>
      <label className="flex w-full min-w-0 flex-col text-xs font-semibold text-muted-foreground sm:w-auto sm:flex-1">
        {say(`Read ${quote(written)} as`, `${quote(written)}の読ませ方`)}
        <input lang={recording.locale} className="mt-1 w-full min-w-0 rounded-control border border-input bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={readAs} onChange={e => setReadAs(e.target.value)} maxLength={40} placeholder={written} />
      </label>
      <Button type="submit" variant="outline" size="sm" isLoading={savingAs} disabled={savingAs}>{say("Save", "保存")}</Button>
      <p className="basis-full text-xs text-muted-foreground">{say("For example 今。 for いま。: the kanji gives the voice the word's accent. Leave it empty to read the text as written.",
        "例: いま。を 今。と読ませると、漢字から正しいアクセントになります。空にすると書いてあるとおりに読みます。")}</p>
    </form>
    {/* Always in the page, so a screen reader announces what fills it. */}
    <p ref={doneRef} tabIndex={done ? -1 : undefined} role="status" className={"text-sm text-status-success focus:outline-none " + (done ? "" : "sr-only")}>{!done ? ""
      : done.kind === "recorded" ? say(`Take ${done.take} recorded.`, `テイク ${done.take} を録音しました。`)
        : done.kind === "chosen" ? say(`Take ${done.take} is now used. Make the short again to hear it.`, `テイク ${done.take} を使います。動画で聞くにはショートをもう一度作成してください。`)
        : say("Saved. Make the short again to hear it.", "保存しました。動画で聞くにはショートをもう一度作成してください。")}</p>
  </div>;
}
