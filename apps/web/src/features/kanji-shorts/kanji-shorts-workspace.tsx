import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Clapperboard, Film, Loader2, Mic, RefreshCw, Square, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import type { Locale } from "@/features/registry";
import {
  RUN_PHASES, cancelRun, kanjiIn, lostRun, loadPreviews, loadReleases, loadStatus, loadStudio, releaseMedia, saveSettings, setName, startRun,
  type CatalogKanji, type KanjiPreview, type KanjiRelease, type KanjiSettings, type Run, type RunItem, type StudioState,
} from "./kanji-shorts-api";
import { KanjiSettingsPanel } from "./kanji-settings-panel";
import { KanjiTakesPanel } from "./kanji-takes-panel";
import { keptChoice } from "./kanji-drafts";
import { errorText, languageName, lineName, phaseName, sayer, type Say } from "./kanji-text";

const MAX_KANJI = 10;
const LEVELS = ["N5", "N4", "N3", "all"] as const;
/** Failed status checks in a row before the page says it cannot reach the server. */
const MISSED_POLLS = 3;
const field = "w-full min-w-0 rounded-control border border-input bg-surface px-3 py-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const heading = "font-serif text-lg font-semibold text-foreground";
const helper = "mt-1 text-xs leading-relaxed text-muted-foreground";
const alertBox = "flex gap-2 rounded-control border border-status-danger bg-status-danger/10 px-3 py-2 text-sm text-foreground";


/** Which voice reads a part: the language whose voice it is, or the voice for other languages. */
function voiceLabel(voiceId: string, settings: KanjiSettings, say: Say) {
  const language = Object.entries(settings["voice.voiceIds"] ?? {}).find(([, id]) => id === voiceId)?.[0];
  return `${language ? say(`${languageName(language, say)} voice`, `${languageName(language, say)}の音声`) : say("Default voice", "既定の音声")} · ${voiceId.slice(0, 8)}…`;
}

function KanjiPicker({ catalog, selected, onToggle, say }: { catalog: CatalogKanji[]; selected: string[]; onToggle: (char: string) => void; say: Say }) {
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("N5");
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter(kanji => (level === "all" || kanji.jlpt === level) &&
      (!q || kanji.char === q || kanji.name.kana.includes(q) || kanji.name.romaji.toLowerCase().includes(q) || kanji.meanings.toLowerCase().includes(q)));
  }, [catalog, level, query]);
  return <div className="flex flex-col gap-3">
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label={say("JLPT level", "JLPT レベル")} className="flex flex-wrap gap-1">
        {LEVELS.map(value => <button key={value} type="button" aria-pressed={level === value} onClick={() => setLevel(value)}
          className="min-h-9 rounded-control border border-border px-3 text-sm text-foreground aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {value === "all" ? say("All", "すべて") : value}</button>)}
      </div>
      <label className="min-w-[12rem] flex-1">
        <span className="sr-only">{say("Search kanji", "漢字を検索")}</span>
        <input className={field + " text-sm"} type="search" value={query} onChange={e => setQuery(e.target.value)}
          placeholder={say("Search: 水, mizu, water", "検索: 水、みず、water")} />
      </label>
    </div>
    <p className="text-xs text-muted-foreground" aria-live="polite">{say(`${shown.length} kanji · a dot marks one already made`, `${shown.length} 字 · 点は作成済み`)}</p>
    <ul className="grid max-h-72 grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-1.5 overflow-y-auto pr-1" aria-label={say("Kanji", "漢字")}>
      {shown.map(kanji => {
        const on = selected.includes(kanji.char);
        const name = kanji.problem ? say(`${kanji.char}, cannot be made: ${kanji.problem}`, `${kanji.char}、作成できません: ${kanji.problem}`)
          : `${kanji.char} ${kanji.name.romaji}, ${kanji.meanings}${kanji.versions ? say(`, made ${kanji.versions} times`, `、${kanji.versions} 回作成済み`) : ""}` +
            (kanji.nameProblem ? say(`; its set name needs fixing: ${kanji.nameProblem}`, `。設定された呼び方を直す必要があります: ${kanji.nameProblem}`) : "");
        return <li key={kanji.char}>
          <button type="button" aria-pressed={on} disabled={!!kanji.problem && !on} onClick={() => onToggle(kanji.char)} aria-label={name}
            title={kanji.problem ?? kanji.nameProblem ?? `${kanji.name.kana} (${kanji.name.romaji}) · ${kanji.meanings}`}
            className="relative flex h-14 w-full flex-col items-center justify-center rounded-control border border-border bg-surface leading-none text-foreground hover:bg-surface-subtle disabled:cursor-not-allowed disabled:border-dashed disabled:opacity-50 aria-pressed:border-primary aria-pressed:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span lang="ja" className="font-serif text-2xl">{kanji.char}</span>
            <span lang="ja" className={"mt-1 max-w-full truncate px-1 text-[11px] " + (kanji.nameProblem ? "text-status-warning" : "text-muted-foreground")}>{kanji.problem ? "—" : kanji.nameProblem ? "?" : kanji.name.kana}</span>
            {kanji.versions > 0 && <span aria-hidden className="absolute right-1 top-1 size-1.5 rounded-full bg-status-success" />}
          </button>
        </li>;
      })}
    </ul>
  </div>;
}

function PreviewCard({ preview, settings, provider, onChanged, say }: { preview: KanjiPreview; settings: KanjiSettings; provider: "fish" | "local"; onChanged: () => void; say: Say }) {
  // The part whose takes are open, by line and part: one at a time.
  const [open, setOpen] = useState<string | null>(null);
  const [naming, setNaming] = useState<{ busy: boolean; failure: unknown }>({ busy: false, failure: null });
  const choices = preview.found ? preview.nameChoices ?? [] : [];
  const current = preview.found && !("problem" in preview) ? preview.name.kana : null;
  // The name picked in the list, applied with its button (an arrow key in a closed list never saves);
  // it shows until the refreshed preview says the same.
  const [picked, setPicked] = useState<string | null>(null);
  const [seen, setSeen] = useState(current);
  if (seen !== current) { setSeen(current); setPicked(null); }
  const selectRef = useRef<HTMLSelectElement>(null), alertRef = useRef<HTMLParagraphElement>(null);
  const cardRef = useRef<HTMLLIElement>(null), headRef = useRef<HTMLSpanElement>(null);
  // Focus goes where the result is: the error; or the select (the kanji itself when it has a single
  // name), once the reloaded preview shows it. Only while the person has not moved elsewhere meanwhile.
  const [focusAfter, setFocusAfter] = useState<"select" | "alert" | null>(null);
  useEffect(() => {
    if (!focusAfter) return;
    const active = document.activeElement;
    if (active && active !== document.body && !cardRef.current?.contains(active)) { setFocusAfter(null); return; }
    const target = focusAfter === "alert" ? alertRef.current : current === null ? null : selectRef.current ?? headRef.current;
    if (target) { target.focus(); setFocusAfter(null); }
    // Again when the preview changes: the reset card becomes a preview with the reloaded name.
  }, [focusAfter, current, naming.failure]);
  async function callBy(kana: string) {
    if (!preview.found) return;
    setNaming({ busy: true, failure: null });
    // The data's own choice (its first reading) is the default: choosing it removes the setting.
    try { await setName(preview.char, kana === choices[0]?.kana ? "" : kana); setNaming({ busy: false, failure: null }); setFocusAfter("select"); onChanged(); }
    catch (failure) { setNaming({ busy: false, failure }); setFocusAfter("alert"); }
  }
  const nameAlert = naming.failure != null && <p ref={alertRef} tabIndex={-1} role="alert" className="mt-2 text-xs text-status-danger focus:outline-none">{errorText(naming.failure, say)}</p>;
  if (!preview.found || "problem" in preview) return <li ref={cardRef} className="rounded-control border border-status-warning bg-status-warning/5 p-3 text-sm text-foreground">
    <span lang="ja" className="font-serif text-lg">{preview.char}</span>{" "}
    {preview.found ? say(`cannot be made: ${preview.problem}`, `は作成できません: ${preview.problem}`) : say("is not in the kanji data.", "は漢字データにありません。")}
    {/* A name it no longer has (the data changed) is fixed here: back to its default name. */}
    {preview.found && preview.badName && <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" isLoading={naming.busy} onClick={() => void callBy(choices[0]?.kana ?? "")}>
        {say(`Call it ${choices[0]?.kana ?? "by its default name"} again`, `呼び方を ${choices[0]?.kana ?? "既定"} に戻す`)}</Button>
    </div>}
    {nameAlert}
  </li>;
  return <li ref={cardRef} className="min-w-0 rounded-control border border-border bg-surface-subtle/50 p-3">
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span ref={headRef} tabIndex={-1} lang="ja" className="rounded-control font-serif text-3xl leading-none text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">{preview.char}</span>
      <span className="text-sm font-semibold text-foreground">{preview.meanings}</span>
      <span className="text-xs text-muted-foreground">JLPT {preview.jlpt ?? "-"}</span>
    </div>
    {/* The reading the kanji is called by in its question and typed intro: its word's reading or an on'yomi. */}
    {choices.length > 1 && <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
      <label className="flex min-w-0 flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
        <span className="whitespace-nowrap">{say("Called by", "呼び方")}</span>
        <select ref={selectRef} className="min-h-9 min-w-0 max-w-full rounded-control border border-input bg-surface px-2 text-sm font-normal text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={picked ?? preview.name.kana} onChange={e => setPicked(e.target.value === preview.name.kana ? null : e.target.value)} aria-busy={naming.busy || undefined}>
          {choices.map(choice => <option key={choice.kana} value={choice.kana}>
            {choice.kana} ({choice.romaji}) · {{ word: say("its word", "単語の読み"), on: say("on'yomi", "音読み"), kun: say("kun'yomi", "訓読み") }[choice.kind]}</option>)}
        </select>
      </label>
      {picked && <Button variant="outline" size="sm" isLoading={naming.busy} onClick={() => void callBy(picked)}>
        {say(`Call it ${picked}`, `${picked} と呼ぶ`)}</Button>}
    </div>}
    {nameAlert}
    {preview.dataProblems.map(problem => <p key={problem} className="mt-2 text-xs text-status-warning">{problem}</p>)}
    {preview.strokeLinesLeftOut && <p className="mt-2 text-xs text-muted-foreground">{say("Stroke lines appear once the kanji's stroke data is cached.", "筆順データを取得すると画数の行が表示されます。")}</p>}
    <ol className="mt-3 flex flex-col gap-2">
      {preview.lines.map(line => <li key={line.id} className="min-w-0 text-sm">
        <div className="grid items-baseline gap-x-2 sm:grid-cols-[6rem_minmax(0,1fr)]">
          <span className="text-xs font-semibold text-muted-foreground">{lineName(line.id, say)}</span>
          <span lang={line.locale} className="min-w-0 break-words text-foreground">{line.caption}</span>
        </div>
        <ul className="mt-1 flex flex-wrap gap-1.5 sm:pl-[6.5rem]">
          {line.parts.map((part, i) => {
            const key = `${line.id}:${i}`, reused = !!part.reuse && !part.reuse.skipped, panel = `takes-${preview.char}-${line.id}-${i}`;
            return <li key={i} className="flex min-w-0 flex-wrap items-center gap-x-1 rounded-control border border-border bg-surface py-0.5 pl-2 pr-0.5 text-xs text-muted-foreground">
              <span lang={part.locale} className="font-medium text-foreground">{part.text}</span>
              {part.spoken && <span lang={part.locale}>· {say(`read as ${part.spoken}`, `「${part.spoken}」と読む`)}</span>}
              <span>· {voiceLabel(part.voiceId, settings, say)}</span>
              {part.phrase && <span className="text-status-info">· {say("phrase, recorded once", "フレーズ（1 回だけ録音）")}</span>}
              {reused && <span className="text-status-success">· {say(`audio from ${lineName(part.reuse!.from, say)}`, `${lineName(part.reuse!.from, say)}の音声`)}</span>}
              {part.reuse?.skipped && <span title={part.reuse.skipped}>· {say("read on its own", "単独で読む")}</span>}
              {part.recording.take > 1 && <span>· {say(`take ${part.recording.take}`, `テイク ${part.recording.take}`)}</span>}
              <button type="button" aria-expanded={open === key} aria-controls={panel} onClick={() => setOpen(open === key ? null : key)}
                aria-label={say(`Takes of ${part.recording.text} (${lineName(line.id, say)}, ${preview.char})`, `「${part.recording.text}」のテイク（${preview.char}・${lineName(line.id, say)}）`)}
                className="ml-1 inline-flex min-h-9 items-center gap-1 rounded-control px-2 text-xs font-semibold text-primary hover:bg-primary/10 aria-expanded:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Mic aria-hidden className="size-3.5" />{say("Takes", "テイク")}</button>
            </li>;
          })}
        </ul>
        {line.parts.map((part, i) => open === `${line.id}:${i}` && <div key={i}>
          {part.reuse && !part.reuse.skipped && <p className="mt-2 text-xs text-muted-foreground sm:ml-[6.5rem]">{say(`This part is heard from ${lineName(part.reuse.from, say)}'s recording: its takes are these.`,
            `この部分は${lineName(part.reuse.from, say)}の録音を使います。そのテイクです。`)}</p>}
          <KanjiTakesPanel id={`takes-${preview.char}-${line.id}-${i}`}
            recording={part.recording} phrase={part.phrase && !(part.reuse && !part.reuse.skipped)} provider={provider} onChanged={onChanged} say={say} />
        </div>)}
      </li>)}
    </ol>
  </li>;
}

function RunRow({ item, active, onShow, say }: { item: RunItem; active: boolean; onShow: (char: string) => void; say: Say }) {
  const step = item.state === "done" ? RUN_PHASES.length : Math.max(0, RUN_PHASES.indexOf((item.phase ?? "") as (typeof RUN_PHASES)[number])) + (item.state === "running" ? 1 : 0);
  const icon = item.state === "done" ? <CheckCircle2 className="size-4 text-status-success" /> : item.state === "failed" ? <XCircle className="size-4 text-status-danger" />
    : item.state === "unknown" ? <AlertCircle className="size-4 text-status-warning" />
    : item.state === "cancelled" ? <Square className="size-4 text-muted-foreground" /> : item.state === "running" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none text-primary" />
    : <span className="size-4" />;
  const stateText = { queued: say("Waiting", "待機中"), running: phaseName(item.phase, say), done: say("Ready for review", "確認待ち"), failed: say("Stopped", "停止"), cancelled: say("Cancelled", "キャンセル"),
    unknown: say("Unknown: check Jobs and Watch", "不明（ジョブと視聴を確認）") }[item.state];
  const english = say("en", "ja") === "en";
  return <li className="min-w-0 rounded-control border border-border p-3" aria-current={active || undefined}>
    <div className="flex items-center gap-3">
      <span aria-hidden>{icon}</span>
      <span lang="ja" className="font-serif text-2xl leading-none">{item.char}</span>
      <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">{stateText}{item.state === "running" && <span className="font-normal text-muted-foreground"> · {say(`step ${step} of ${RUN_PHASES.length}`, `${RUN_PHASES.length} 段階中 ${step}`)}</span>}</span>
      {item.state === "done" && item.folder && <Button variant="outline" size="sm" icon={<Film className="size-4" />} onClick={() => onShow(item.char)}>{say("Watch", "見る")}</Button>}
    </div>
    {item.state !== "unknown" && <div role="progressbar" aria-label={say(`${item.char} progress`, `${item.char} の進行`)} aria-valuemin={0} aria-valuemax={RUN_PHASES.length} aria-valuenow={step}
      aria-valuetext={say(`Step ${step} of ${RUN_PHASES.length}: ${stateText}`, `${RUN_PHASES.length} 段階中 ${step}: ${stateText}`)} className="mt-2 flex gap-0.5">
      {RUN_PHASES.map((phase, i) => <span key={phase} className={"h-1.5 flex-1 rounded-full " + (i < step ? (item.state === "failed" ? "bg-status-danger" : "bg-primary") : "bg-border")} />)}
    </div>}
    {/* The producer's own step text is English; the step name above says the same in Japanese. */}
    {english && item.state === "running" && item.message && <p className="mt-2 truncate text-xs text-muted-foreground" title={item.message}>{item.message}</p>}
    {item.error && <p className="mt-2 break-words text-xs text-status-danger">{item.error}</p>}
    {item.note && <p className="mt-2 break-words text-xs text-status-warning">{item.note}</p>}
    {item.state !== "queued" && item.tracked === false && <p className="mt-1 text-xs text-muted-foreground">{say("Not tracked in Jobs: the local Jobs server is not running.", "ジョブには記録されていません（ローカルのジョブサーバーが停止中）。")}</p>}
  </li>;
}

function ReleasePlayer({ release, say }: { release: KanjiRelease; say: Say }) {
  const [version, setVersion] = useState(release.versions[0]?.version);
  const shown = release.versions.find(v => v.version === version) ?? release.versions[0];
  if (!shown) return null;
  const qa = shown.qa;
  const facts: [string, string][] = qa ? [
    [say("Length", "長さ"), qa.seconds != null ? `${qa.seconds.toFixed(1)} s` : "–"],
    [say("Loudness", "ラウドネス"), qa.lufs != null ? `${qa.lufs} LUFS` : "–"],
    [say("Longest still", "最長の静止"), qa.longestStill != null ? `${qa.longestStill} s` : "–"],
    [say("Name", "名前"), qa.nameReusedFrom ? say(`audio from ${lineName(qa.nameReusedFrom, say)}`, `${lineName(qa.nameReusedFrom, say)}の音声`) : say("read on its own", "単独で読む")],
  ] : [];
  return <div className="flex min-w-0 flex-col gap-4 sm:flex-row lg:flex-col">
    <video key={`${release.folder}/${shown.version}`} className="aspect-[9/16] w-full max-w-[15rem] self-center rounded-control border border-border bg-black sm:self-start"
      controls preload="metadata" poster={releaseMedia(release.folder, shown.version, "poster.png")} src={releaseMedia(release.folder, shown.version, "video.mp4")}
      aria-label={say(`${release.char} short, version ${shown.version}`, `${release.char} のショート v${shown.version}`)} />
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <label className="flex flex-col text-xs font-semibold text-muted-foreground">{say(`Version (${release.versions.length})`, `バージョン（${release.versions.length}）`)}
        <select className={field + " mt-1 text-sm"} value={shown.version} onChange={e => setVersion(Number(e.target.value))}>
          {release.versions.map(v => <option key={v.version} value={v.version}>v{v.version}{v === release.versions[0] ? say(" · newest", " · 最新") : ""}</option>)}
        </select>
      </label>
      {qa ? <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {facts.map(([name, value]) => <div key={name} className="contents"><dt className="text-muted-foreground">{name}</dt><dd className="text-foreground">{value}</dd></div>)}
      </dl> : <p className="text-sm text-muted-foreground">{say("This release has no QA report.", "この版には QA レポートがありません。")}</p>}
      {qa?.warnings.map(warning => <p key={warning} className="flex gap-2 text-xs text-status-warning"><AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />{warning}</p>)}
      <p className="text-xs leading-relaxed text-muted-foreground">{say(
        "A draft: watch and listen to every line before publishing. Nothing is published from here.",
        "下書きです。公開前に全体を見て、すべての行を聞いて確認してください。ここからは公開されません。")}</p>
      <p className="break-all font-mono text-[11px] text-muted-foreground">{shown.releaseDir}</p>
    </div>
  </div>;
}

/** The Studio page for kanji study shorts: pick kanji, preview what each says, make them, watch them, and edit the settings. */
export function KanjiShortsWorkspace({ locale }: { locale: Locale }) {
  const say = useMemo(() => sayer(locale), [locale]);
  const [studio, setStudio] = useState<StudioState | null>(null);
  const [loadFailure, setLoadFailure] = useState<unknown>(null);
  const [reloads, setReloads] = useState(0);
  const [selection, setSelectionState] = useState(keptChoice.selection);
  const [preview, setPreview] = useState<{ key: string; previews: KanjiPreview[]; error: string }>({ key: "", previews: [], error: "" });
  const [run, setRun] = useState<Run | null>(null);
  const [runError, setRunError] = useState<unknown>(null);
  const [missedPolls, setMissedPolls] = useState(0);
  const [starting, setStarting] = useState(false);
  const [shown, setShownState] = useState<string | null>(keptChoice.shown);
  const [found, setFound] = useState<{ key: string; release: KanjiRelease | null; error: string } | null>(null);
  const [watchRequests, setWatchRequests] = useState(0);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const runHeading = useRef<HTMLParagraphElement>(null), focusRun = useRef(false);
  const setSelection = (next: string | ((current: string) => string)) => setSelectionState(current => {
    const value = typeof next === "function" ? next(current) : next;
    keptChoice.selection = value;
    return value;
  });
  const setShown = (char: string | null) => { keptChoice.shown = char; setShownState(char); setWatchRequests(n => n + 1); };

  const reload = useCallback(() => loadStudio().then(state => {
    setStudio(state); setLoadFailure(null);
    // A run the page knew as running that the server no longer has: say so, never drop it silently.
    setRun(current => state.run ?? (current?.state === "running" ? lostRun(current) : current));
  }).catch((error: unknown) => setLoadFailure(error)), []);
  useEffect(() => { void reload(); }, [reload]);
  const reloadAll = () => { setReloads(n => n + 1); void reload(); };
  const loadError = loadFailure == null ? "" : errorText(loadFailure, say);

  const chosen = useMemo(() => kanjiIn(selection), [selection]);
  const tooMany = chosen.length > MAX_KANJI;

  // The preview follows the selection, the saved settings and Reload, a moment after typing stops.
  // Until the new answer comes, the last one for the same kanji stays on screen, marked busy.
  const selectionKey = chosen.join(""), previewKey = `${reloads}:${studio?.configured ? studio.revision : ""}:${selectionKey}`;
  const configured = studio?.configured === true;
  useEffect(() => {
    if (!configured || !selectionKey || tooMany) return;
    let current = true;
    const timer = setTimeout(() => {
      loadPreviews(selectionKey).then(result => { if (current) setPreview({ key: previewKey, previews: result.previews, error: "" }); })
        .catch((error: unknown) => { if (current) setPreview({ key: previewKey, previews: [], error: errorText(error, say) }); });
    }, 350);
    return () => { current = false; clearTimeout(timer); };
  }, [configured, selectionKey, previewKey, tooMany, say]);
  const sameKanji = preview.key.slice(preview.key.lastIndexOf(":") + 1) === selectionKey;
  const previews = sameKanji ? preview.previews : [], previewError = sameKanji ? preview.error : "";
  const previewing = !!selectionKey && !tooMany && preview.key !== previewKey;

  useEffect(() => { if (focusRun.current && run) { focusRun.current = false; runHeading.current?.focus(); } }, [run]);

  // A running run is followed every 1.5 s until it ends. Missed checks are counted and shown after a few;
  // a run the server no longer knows is shown as lost. When the run ends, the kanji list refreshes.
  const running = run?.state === "running";
  useEffect(() => {
    if (!running) return;
    let active = true;
    const timer = setInterval(() => {
      loadStatus().then(result => {
        if (!active) return;
        setMissedPolls(0);
        setRun(current => result.run && result.run.id === current?.id ? result.run : current ? lostRun(current) : result.run);
        if (result.run?.state !== "running") void reload();
      }).catch(() => { if (active) setMissedPolls(n => n + 1); });
    }, 1500);
    return () => { active = false; clearInterval(timer); };
  }, [running, reload]);

  // The shown kanji's releases, newest first: again when asked (Watch) and when one of its shorts is made.
  const madeOfShown = run?.items.filter(item => item.char === shown && item.state === "done").length ?? 0;
  const releaseKey = `${shown}:${watchRequests}:${madeOfShown}:${reloads}`;
  useEffect(() => {
    if (!shown) return;
    let current = true;
    loadReleases(shown).then(result => { if (current) setFound({ key: releaseKey, release: result.releases[0] ?? null, error: "" }); })
      .catch((error: unknown) => { if (current) setFound({ key: releaseKey, release: null, error: errorText(error, say) }); });
    return () => { current = false; };
  }, [shown, releaseKey, say]);
  const foundNow = found && found.key.startsWith(`${shown}:`) ? found : null;

  const toggle = (char: string) => {
    setSelection(current => { const chars = kanjiIn(current); return (chars.includes(char) ? chars.filter(c => c !== char) : [...chars, char]).join(""); });
    setShown(char);
  };

  async function make() {
    if (!studio?.configured) return;
    setStarting(true); setRunError(null);
    try { setRun((await startRun(chosen.join(""), studio.provider)).run); setMissedPolls(0); focusRun.current = true; }
    catch (error) { setRunError(error); }
    finally { setStarting(false); }
  }
  async function cancel() {
    try { setRun((await cancelRun()).run); } catch (error) { setRunError(error); }
  }
  const save = useCallback(async (changes: Partial<KanjiSettings>): Promise<{ saved: KanjiSettings } | { error: string }> => {
    if (!studio?.configured) return { error: say("The settings are not loaded.", "設定が読み込まれていません。") };
    try {
      const saved = await saveSettings(studio.revision, changes);
      setStudio({ ...studio, revision: saved.revision, settings: saved.settings });
      return { saved: saved.settings };
    } catch (error) {
      const conflict = (error as { status?: number }).status === 409;
      return { error: conflict ? say("The settings file changed since this page loaded it. Press Reload: your unsaved changes stay in the form, then save again.",
        "このページを読み込んだ後に設定ファイルが変更されました。「再読み込み」を押してから、もう一度保存してください（未保存の変更はフォームに残ります）。") : errorText(error, say) };
    }
  }, [studio, say]);

  const header = <header className="mt-7 flex flex-wrap items-end justify-between gap-3">
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-primary">{say("Shorts", "ショート動画")}</p>
      <h1 className="mt-1 font-serif text-2xl font-semibold text-foreground">{say("Kanji shorts", "漢字ショート")}</h1>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{say(
        "Vertical study shorts: the brush writes the kanji, the voices read its readings and useful words. The same settings and producer as pnpm video:kanji.",
        "縦型の学習ショート。筆が漢字を書き、音声が読みとよく使うことばを読みます。pnpm video:kanji と同じ設定と制作処理です。")}</p>
    </div>
    <Button variant="outline" size="sm" icon={<RefreshCw className="size-4" />} onClick={reloadAll}>{say("Reload", "再読み込み")}</Button>
  </header>;

  if (!studio) return <div className="pb-10">{header}
    <Surface className="mt-6">{loadError
      ? <p role="alert" className="flex gap-2 text-sm text-foreground"><AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-status-danger" />{loadError}</p>
      : <p role="status" className="text-sm text-muted-foreground">{say("Loading kanji shorts…", "漢字ショートを読み込んでいます…")}</p>}</Surface>
  </div>;
  if (!studio.configured) return <div className="pb-10">{header}
    {loadError && <p role="alert" className={alertBox + " mt-6"}><AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-status-danger" />{loadError}</p>}
    <Surface className="mt-6" header={<h2 className={heading}>{say("Set up kanji shorts", "漢字ショートの準備")}</h2>}>
      <p role="alert" className="text-sm text-foreground">{studio.problem}</p>
      <p className={helper}>{say("The settings file names the kanji data, the music and the voices. docs/how-to-make-kanji-shorts.md shows how to make one.",
        "設定ファイルには漢字データ、音楽、音声を書きます。作り方は docs/how-to-make-kanji-shorts.md にあります。")}</p>
      <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{studio.configPath}</p>
    </Surface>
  </div>;

  const busy = running || starting;
  const makeBlocked = busy || !chosen.length || tooMany || settingsDirty;
  return <div className="pb-10">
    {header}
    {loadError && <p role="alert" className={alertBox + " mt-6"}><AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-status-danger" />{loadError}</p>}
    <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        <Surface header={<div><h2 className={heading}>{say("Choose kanji", "漢字を選ぶ")}</h2>
          <p className={helper}>{say(`Pick or type up to ${MAX_KANJI}. Each becomes its own short.`, `${MAX_KANJI} 字まで選ぶか入力します。1 字ごとに 1 本のショートになります。`)}</p></div>}>
          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground">{say("Kanji to make", "作る漢字")}
                <input className={field + " mt-1 font-serif tracking-widest"} lang="ja" value={selection} onChange={e => setSelection(e.target.value)}
                  aria-describedby="kanji-count" aria-invalid={tooMany || undefined} placeholder="年今前時友" />
              </label>
              <p id="kanji-count" aria-live="polite" className={"mt-1.5 text-xs " + (tooMany ? "text-status-danger" : "text-muted-foreground")}>
                {tooMany ? say(`One run makes at most ${MAX_KANJI} kanji; ${chosen.length} are chosen.`, `1 回で作れるのは ${MAX_KANJI} 字までです（${chosen.length} 字選択中）。`)
                  : say(`${chosen.length} chosen`, `${chosen.length} 字選択中`)}</p>
            </div>
            <KanjiPicker catalog={studio.catalog} selected={chosen} onToggle={toggle} say={say} />
          </div>
        </Surface>

        <Surface header={<div><h2 className={heading}>{say("What each short says", "各ショートの内容")}</h2>
          <p className={helper}>{say("Each line, the voice that reads each part, and where a reading reuses another line's audio. Nothing is sent to make this preview.",
            "各行と、それぞれを読む音声、別の行の音声を使う箇所。このプレビューでは何も送信しません。")}</p></div>}>
          <div aria-busy={previewing}>
            {!chosen.length ? <p className="text-sm text-muted-foreground">{say("Choose a kanji to see its short.", "漢字を選ぶと内容が表示されます。")}</p>
              : tooMany ? <p className="text-sm text-status-danger">{say(`Choose at most ${MAX_KANJI} kanji to see their shorts.`, `内容を見るには ${MAX_KANJI} 字以内にしてください。`)}</p>
              : previewError ? <p role="alert" className={alertBox}><AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-status-danger" />{previewError}</p>
              : previewing && !previews.length ? <p role="status" className="text-sm text-muted-foreground">{say("Preparing the preview…", "プレビューを準備しています…")}</p>
              : <ul className="flex flex-col gap-3">{previews.map(item => <PreviewCard key={item.char} preview={item} settings={studio.settings} provider={studio.provider}
                onChanged={() => void reload()} say={say} />)}</ul>}
          </div>
        </Surface>
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <Surface header={<div><h2 className={heading}>{say("Make", "作成")}</h2>
          <p className={helper}>{studio.provider === "fish"
            ? say("Make sends each short's narration text to Fish Audio, read with your voices, and downloads KanjiVG stroke data (from GitHub) for kanji not yet cached. Each short takes a few minutes to render. Nothing is published.",
              "「作成」を押すと、各ショートのナレーション文を Fish Audio に送って設定した音声で読み上げ、まだ取得していない漢字の筆順データ（KanjiVG、GitHub）をダウンロードします。1 本の描画に数分かかります。公開はされません。")
            : say("A local voice reads the narration. Make downloads KanjiVG stroke data (from GitHub) for kanji not yet cached. Each short takes a few minutes to render. Nothing is published.",
              "ローカルの音声がナレーションを読みます。「作成」を押すと、まだ取得していない漢字の筆順データ（KanjiVG、GitHub）をダウンロードします。1 本の描画に数分かかります。公開はされません。")}</p></div>}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Button icon={<Clapperboard className="size-4" />} isLoading={starting} disabled={makeBlocked} onClick={() => void make()}>
                {chosen.length === 1 ? say("Make 1 short", "1 本作成") : say(`Make ${chosen.length} shorts`, `${chosen.length} 本作成`)}</Button>
              {running && <Button variant="outline" icon={<Square className="size-4" />} onClick={() => void cancel()}>{say("Cancel", "キャンセル")}</Button>}
            </div>
            {settingsDirty && !busy && <p className="text-xs text-status-warning">{say("Save or discard the settings changes first: a run uses the saved settings.",
              "先に設定の変更を保存するか破棄してください。作成には保存済みの設定が使われます。")}</p>}
            {runError != null && <p role="alert" className={alertBox}><AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-status-danger" />{errorText(runError, say)}</p>}
            {running && missedPolls >= MISSED_POLLS && <p role="alert" className="text-sm text-status-warning">{say(
              "Cannot reach the Studio server to follow the run; still trying. The shorts keep rendering if the server is busy.",
              "Studio サーバーに接続できず、進行を確認できません（再試行中）。サーバーが処理中なら描画は続いています。")}</p>}
            {run && <div aria-live="polite">
              <p ref={runHeading} tabIndex={-1} className="mb-2 text-xs font-semibold text-muted-foreground focus:outline-none">{run.state === "running" ? say("Making…", "作成中…")
                : run.state === "cancelled" ? say("Cancelled", "キャンセルしました") : run.state === "lost" ? say("Progress lost", "進行が不明") : say("Last run", "前回の実行")}</p>
              {run.state === "lost" && <p role="alert" className="mb-2 text-sm text-status-warning">{say(
                "The Studio server no longer knows this run (it restarted). Shorts already made are listed under Watch; check Jobs for the rest.",
                "Studio サーバーがこの実行を把握していません（再起動されました）。作成済みのショートは「視聴」に表示されます。残りはジョブを確認してください。")}</p>}
              {run.error && <p role="alert" className="mb-2 text-sm text-status-danger">{run.error}</p>}
              <ul className="flex flex-col gap-2">{run.items.map(item => <RunRow key={item.char} item={item} active={item.char === shown} onShow={setShown} say={say} />)}</ul>
            </div>}
          </div>
        </Surface>

        <Surface header={<div><h2 className={heading}>{say("Watch", "視聴")}</h2>
          <p className={helper}>{shown ? say(`The newest short of ${shown}, and its checks.`, `${shown} の最新のショートとその計測結果。`) : say("Choose a kanji that has been made.", "作成済みの漢字を選んでください。")}</p></div>}>
          {!shown ? null
            : !foundNow ? <p role="status" className="text-sm text-muted-foreground">{say("Loading…", "読み込み中…")}</p>
            : foundNow.error ? <p role="alert" className={alertBox}><AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-status-danger" />{say(`Could not load the shorts of ${shown}: ${foundNow.error}`, `${shown} のショートを読み込めませんでした: ${foundNow.error}`)}</p>
            : foundNow.release ? <ReleasePlayer key={foundNow.release.folder + foundNow.release.versions[0]?.version} release={foundNow.release} say={say} />
            : <p className="text-sm text-muted-foreground">{say(`No short of ${shown} yet.`, `${shown} のショートはまだありません。`)}</p>}
        </Surface>

        <KanjiSettingsPanel settings={studio.settings} provider={studio.provider} onSave={save} onDirtyChange={setSettingsDirty} say={say} />
      </div>
    </div>
  </div>;
}
