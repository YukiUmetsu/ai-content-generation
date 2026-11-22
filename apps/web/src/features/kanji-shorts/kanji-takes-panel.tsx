import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Check, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chooseTake, loadTakes, recordTake, speakAs, takeAudio, type Recording, type Take } from "./kanji-shorts-api";
import { errorText, type Say } from "./kanji-text";

/** A take's pitch as a small line: higher is higher pitch, gaps are unvoiced (a devoiced し). */
function PitchLine({ pitch, say }: { pitch: (number | null)[]; say: Say }) {
  const voiced = pitch.filter((hz): hz is number => hz !== null);
  if (voiced.length < 2) return <span className="text-xs text-muted-foreground">{say("pitch: too little voiced", "ピッチ: 有声部分が少なすぎます")}</span>;
  const low = Math.log2(Math.min(...voiced)), high = Math.log2(Math.max(...voiced)), span = Math.max(high - low, 1 / 12);
  const width = 120, height = 28, step = width / Math.max(1, pitch.length - 1);
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

function shapeText(take: Take, say: Say) {
  if (take.shape === null) return say("Pitch not measured (too little voiced).", "ピッチは測定できません（有声部分が少なすぎます）。");
  const words = { rises: say("rises to the end, like a question", "語尾で上がる（疑問のよう）"), falls: say("falls after its peak", "山のあと下がる"), level: say("level", "平ら") }[take.shape];
  return say(`Pitch ${words} (start to end ${take.rise! > 0 ? "+" : ""}${take.rise} st).`, `ピッチ: ${words}（始めから終わり ${take.rise! > 0 ? "+" : ""}${take.rise} 半音）。`);
}

/**
 * The takes of one recording: hear each, see its measured pitch, choose the one a short uses, record
 * another, or have the voice read the part as another text. Choosing writes narration.retakes; reading
 * as writes narration.speech. Make the short again to hear it in place.
 */
export function KanjiTakesPanel({ recording, written, phrase, provider, onChanged, say }: {
  recording: Recording; written: string; phrase: boolean; provider: "fish" | "local"; onChanged: () => void; say: Say;
}) {
  const [takes, setTakes] = useState<Take[] | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState<"record" | "use" | "speech" | null>(null);
  const [readAs, setReadAs] = useState(recording.text === written ? "" : recording.text);
  const load = useCallback(() => loadTakes(recording).then(result => { setTakes(result.takes); setFailure(null); }).catch(setFailure), [recording]);
  useEffect(() => { void load(); }, [load]);
  async function act(kind: "record" | "use" | "speech", work: () => Promise<unknown>) {
    setBusy(kind); setFailure(null);
    try { await work(); } catch (error) { setFailure(error); } finally { setBusy(null); }
  }
  const record = () => act("record", async () => { await recordTake(recording, provider); await load(); });
  const choose = (take: number) => act("use", async () => { await chooseTake(recording.text, take); onChanged(); });
  const saveReadAs = () => act("speech", async () => { await speakAs(written, readAs); onChanged(); });
  return <div className="mt-2 flex flex-col gap-3 rounded-control border border-border bg-surface p-3 sm:ml-[6.5rem]">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <p className="text-sm font-semibold text-foreground">{say("Takes of", "テイク:")} <span lang={recording.locale}>“{recording.text}”</span></p>
      {phrase && <p className="text-xs text-status-info">{say("A phrase: the take you choose is used in every short.", "フレーズ: 選んだテイクはすべてのショートで使われます。")}</p>}
    </div>
    {failure != null && <p role="alert" className="flex gap-2 text-sm text-status-danger"><AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />{errorText(failure, say)}</p>}
    {takes === null ? <p role="status" className="text-sm text-muted-foreground">{say("Loading the takes…", "テイクを読み込んでいます…")}</p>
      : !takes.length ? <p className="text-sm text-muted-foreground">{say("Not recorded yet: it is recorded when the short is made, or record a take now.", "まだ録音されていません。ショートの作成時に録音されます。今すぐ録音することもできます。")}</p>
      : <ul className="flex flex-col gap-2">
        {takes.map(take => {
          const inUse = take.take === recording.take;
          return <li key={take.take} className={"flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control border p-2 " + (inUse ? "border-primary bg-primary/5" : "border-border")}>
            <span className="w-16 shrink-0 text-sm font-semibold text-foreground">{say(`Take ${take.take}`, `テイク ${take.take}`)}</span>
            <audio controls preload="none" src={takeAudio(recording, take.take)} className="h-8 w-full max-w-[14rem]" aria-label={say(`Play take ${take.take}`, `テイク ${take.take} を再生`)} />
            <PitchLine pitch={take.pitch} say={say} />
            <span className="min-w-[10rem] flex-1 text-xs text-muted-foreground">{take.seconds} s · {shapeText(take, say)}</span>
            {inUse ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-status-success"><Check aria-hidden className="size-3.5" />{say("In use", "使用中")}</span>
              : <Button variant="outline" size="sm" isLoading={busy === "use"} onClick={() => void choose(take.take)}>{say("Use this take", "このテイクを使う")}</Button>}
          </li>;
        })}
      </ul>}
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" size="sm" icon={<Mic className="size-4" />} isLoading={busy === "record"} onClick={() => void record()}>{say("Record another take", "別のテイクを録音")}</Button>
      <span className="text-xs text-muted-foreground">{provider === "fish" ? say("Sends this text to Fish Audio, read with your voice.", "このテキストを Fish Audio に送り、設定した音声で読み上げます。")
        : say("Read by the local voice.", "ローカルの音声で読み上げます。")}</span>
    </div>
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void saveReadAs(); }}>
      <label className="flex min-w-[12rem] flex-1 flex-col text-xs font-semibold text-muted-foreground">
        {say(`Read “${written}” as`, `「${written}」の読ませ方`)}
        <input lang="ja" className="mt-1 w-full rounded-control border border-input bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={readAs} onChange={e => setReadAs(e.target.value)} maxLength={40} placeholder={written} />
      </label>
      <Button type="submit" variant="outline" size="sm" isLoading={busy === "speech"}>{say("Save", "保存")}</Button>
      <p className="basis-full text-xs text-muted-foreground">{say("For example 今。 for いま。: the kanji gives the voice the word's accent. Leave it empty to read the text as written.",
        "例: いま。を 今。と読ませると、漢字から正しいアクセントになります。空にすると書いてあるとおりに読みます。")}</p>
    </form>
    <p className="text-xs text-muted-foreground">{say("Make the short again to hear the chosen take in it.", "選んだテイクを動画で聞くには、ショートをもう一度作成してください。")}</p>
  </div>;
}
