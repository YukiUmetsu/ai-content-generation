import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Clapperboard, Film, Loader2, RefreshCw, Square, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import type { Locale } from "@/features/registry";
import {
  RUN_PHASES, cancelRun, kanjiIn, loadPreviews, loadReleases, loadStatus, loadStudio, releaseMedia, saveSettings, startRun,
  type CatalogKanji, type KanjiPreview, type KanjiRelease, type KanjiSettings, type Run, type RunItem, type StudioState,
} from "./kanji-shorts-api";
import { KanjiSettingsPanel } from "./kanji-settings-panel";
import { changedSettings } from "./kanji-settings-model";
import { languageName, lineName, phaseName, sayer, type Say } from "./kanji-text";

const MAX_KANJI = 10;
const LEVELS = ["N5", "N4", "N3", "all"] as const;
const field = "w-full min-w-0 rounded-control border border-input bg-surface px-3 py-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const heading = "font-serif text-lg font-semibold text-foreground";
const helper = "mt-1 text-xs leading-relaxed text-muted-foreground";

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
        return <li key={kanji.char}>
          <button type="button" aria-pressed={on} onClick={() => onToggle(kanji.char)}
            aria-label={`${kanji.char} ${kanji.name.romaji}, ${kanji.meanings}${kanji.versions ? say(`, made ${kanji.versions} times`, `、${kanji.versions} 回作成済み`) : ""}`}
            title={`${kanji.name.kana} (${kanji.name.romaji}) · ${kanji.meanings}`}
            className="relative flex h-14 w-full flex-col items-center justify-center rounded-control border border-border bg-surface leading-none text-foreground hover:bg-surface-subtle aria-pressed:border-primary aria-pressed:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span lang="ja" className="font-serif text-2xl">{kanji.char}</span>
            <span lang="ja" className="mt-1 max-w-full truncate px-1 text-[11px] text-muted-foreground">{kanji.name.kana}</span>
            {kanji.versions > 0 && <span aria-hidden className="absolute right-1 top-1 size-1.5 rounded-full bg-status-success" />}
          </button>
        </li>;
      })}
    </ul>
  </div>;
}

function PreviewCard({ preview, settings, say }: { preview: KanjiPreview; settings: KanjiSettings; say: Say }) {
  if (!preview.found) return <li className="rounded-control border border-status-warning bg-status-warning/5 p-3 text-sm">
    <span lang="ja" className="font-serif text-lg">{preview.char}</span> {say("is not in the kanji data.", "は漢字データにありません。")}
  </li>;
  return <li className="min-w-0 rounded-control border border-border bg-surface-subtle/50 p-3">
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span lang="ja" className="font-serif text-3xl leading-none text-foreground">{preview.char}</span>
      <span className="text-sm font-semibold text-foreground">{preview.meanings}</span>
      <span className="text-xs text-muted-foreground">JLPT {preview.jlpt ?? "-"} · <span lang="ja">{preview.name.kana}</span> ({preview.name.romaji})</span>
    </div>
    {preview.dataProblems.map(problem => <p key={problem} className="mt-2 text-xs text-status-warning">{problem}</p>)}
    {preview.strokeLinesLeftOut && <p className="mt-2 text-xs text-muted-foreground">{say("Stroke lines appear once the kanji's stroke data is cached.", "筆順データを取得すると画数の行が表示されます。")}</p>}
    <ol className="mt-3 flex flex-col gap-2">
      {preview.lines.map(line => <li key={line.id} className="min-w-0 text-sm">
        <div className="grid items-baseline gap-x-2 sm:grid-cols-[6rem_minmax(0,1fr)]">
          <span className="text-xs font-semibold text-muted-foreground">{lineName(line.id, say)}</span>
          <span lang={line.locale} className="min-w-0 break-words text-foreground">{line.caption}</span>
        </div>
        {(line.split || line.parts.some(part => part.reuse || part.retake)) && <ul className="mt-1 flex flex-wrap gap-1.5 sm:pl-[6.5rem]">
          {line.parts.map((part, i) => <li key={i} className="flex min-w-0 flex-wrap items-center gap-x-1 rounded-control border border-border bg-surface px-2 py-0.5 text-xs text-muted-foreground">
            <span lang={part.locale} className="font-medium text-foreground">{part.text}</span>
            <span>· {voiceLabel(part.voiceId, settings, say)}</span>
            {part.reuse && !part.reuse.skipped && <span className="text-status-success">· {say(`audio from ${lineName(part.reuse.from, say)}`, `${lineName(part.reuse.from, say)}の音声`)}</span>}
            {part.reuse?.skipped && <span title={part.reuse.skipped}>· {say("read on its own", "単独で読む")}</span>}
            {part.retake && <span>· {say(`take ${part.retake}`, `テイク ${part.retake}`)}</span>}
          </li>)}
        </ul>}
      </li>)}
    </ol>
  </li>;
}

function RunRow({ item, active, onShow, say }: { item: RunItem; active: boolean; onShow: (char: string) => void; say: Say }) {
  const step = item.state === "done" ? RUN_PHASES.length : Math.max(0, RUN_PHASES.indexOf((item.phase ?? "") as (typeof RUN_PHASES)[number])) + (item.state === "running" ? 1 : 0);
  const icon = item.state === "done" ? <CheckCircle2 className="size-4 text-status-success" /> : item.state === "failed" ? <XCircle className="size-4 text-status-danger" />
    : item.state === "cancelled" ? <Square className="size-4 text-muted-foreground" /> : item.state === "running" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none text-primary" />
    : <span className="size-4" />;
  const stateText = { queued: say("Waiting", "待機中"), running: phaseName(item.phase, say), done: say("Ready for review", "確認待ち"), failed: say("Stopped", "停止"), cancelled: say("Cancelled", "キャンセル") }[item.state];
  return <li className="min-w-0 rounded-control border border-border p-3" aria-current={active || undefined}>
    <div className="flex items-center gap-3">
      <span aria-hidden>{icon}</span>
      <span lang="ja" className="font-serif text-2xl leading-none">{item.char}</span>
      <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">{stateText}{item.state === "running" && <span className="font-normal text-muted-foreground"> · {say(`step ${step} of ${RUN_PHASES.length}`, `${RUN_PHASES.length} 段階中 ${step}`)}</span>}</span>
      {item.state === "done" && item.folder && <Button variant="outline" size="sm" icon={<Film className="size-4" />} onClick={() => onShow(item.char)}>{say("Watch", "見る")}</Button>}
    </div>
    <div role="progressbar" aria-label={say(`${item.char} progress`, `${item.char} の進行`)} aria-valuemin={0} aria-valuemax={RUN_PHASES.length} aria-valuenow={step}
      aria-valuetext={say(`Step ${step} of ${RUN_PHASES.length}: ${stateText}`, `${RUN_PHASES.length} 段階中 ${step}: ${stateText}`)} className="mt-2 flex gap-0.5">
      {RUN_PHASES.map((phase, i) => <span key={phase} className={"h-1.5 flex-1 rounded-full " + (i < step ? (item.state === "failed" ? "bg-status-danger" : "bg-primary") : "bg-border")} />)}
    </div>
    {item.state === "running" && item.message && <p className="mt-2 truncate text-xs text-muted-foreground" title={item.message}>{item.message}</p>}
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
      <div role="group" aria-label={say("Version", "バージョン")} className="flex flex-wrap gap-1">
        {release.versions.slice(0, 8).map(v => <button key={v.version} type="button" aria-pressed={v.version === shown.version} onClick={() => setVersion(v.version)}
          className="min-h-8 rounded-control border border-border px-2.5 text-xs text-foreground aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">v{v.version}</button>)}
      </div>
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
  const say = sayer(locale);
  const [studio, setStudio] = useState<StudioState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selection, setSelection] = useState("");
  // The last preview answer, for the selection and settings it was made with.
  const [preview, setPreview] = useState<{ key: string; previews: KanjiPreview[]; error: string }>({ key: "", previews: [], error: "" });
  const [run, setRun] = useState<Run | null>(null);
  const [runError, setRunError] = useState("");
  const [starting, setStarting] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const [found, setFound] = useState<{ char: string; release: KanjiRelease | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [settingsVersion, setSettingsVersion] = useState(0);

  const reload = useCallback(() => loadStudio().then(state => { setStudio(state); setRun(state.run); setLoadError(""); })
    .catch((error: Error) => setLoadError(error.message)), []);
  useEffect(() => { void reload(); }, [reload]);

  const chosen = useMemo(() => kanjiIn(selection), [selection]);
  const tooMany = chosen.length > MAX_KANJI;

  // The preview follows the selection and the saved settings, a moment after typing stops. Until the
  // new answer comes, the last one for the same kanji stays on screen, marked busy.
  const selectionKey = chosen.join(""), previewKey = `${settingsVersion}:${selectionKey}`;
  const configured = studio?.configured === true;
  useEffect(() => {
    if (!configured || !selectionKey || tooMany) return;
    let current = true;
    const timer = setTimeout(() => {
      loadPreviews(selectionKey).then(result => { if (current) setPreview({ key: previewKey, previews: result.previews, error: "" }); })
        .catch((error: Error) => { if (current) setPreview({ key: previewKey, previews: [], error: error.message }); });
    }, 350);
    return () => { current = false; clearTimeout(timer); };
  }, [configured, selectionKey, previewKey, tooMany]);
  const sameKanji = preview.key.slice(preview.key.indexOf(":") + 1) === selectionKey;
  const previews = sameKanji ? preview.previews : [], previewError = sameKanji ? preview.error : "";
  const previewing = !!selectionKey && !tooMany && preview.key !== previewKey;

  // A running run is followed every 1.5 s until it ends; then the kanji list and the shown release refresh.
  const running = run?.state === "running";
  useEffect(() => {
    if (!running) return;
    let active = true;
    const timer = setInterval(() => {
      loadStatus().then(result => {
        if (!active) return;
        setRun(result.run);
        if (result.run?.state !== "running") { void reload(); setShown(current => current ?? result.run?.items.find(item => item.state === "done")?.char ?? null); setSettingsVersion(v => v + 1); }
      }).catch(() => { /* a missed poll is retried on the next tick */ });
    }, 1500);
    return () => { active = false; clearInterval(timer); };
  }, [running, reload]);

  // The shown kanji's releases, newest first; refreshed when a run ends.
  useEffect(() => {
    if (!shown) return;
    let current = true;
    loadReleases(shown).then(result => { if (current) setFound({ char: shown, release: result.releases[0] ?? null }); })
      .catch(() => { if (current) setFound({ char: shown, release: null }); });
    return () => { current = false; };
  }, [shown, run?.state, run?.finishedAt]);
  const release = found && found.char === shown ? found.release : null, releaseLoading = !!shown && found?.char !== shown;

  const toggle = (char: string) => {
    setSelection(current => { const chars = kanjiIn(current); return (chars.includes(char) ? chars.filter(c => c !== char) : [...chars, char]).join(""); });
    setShown(char);
  };

  async function make() {
    if (!studio?.configured) return;
    setStarting(true); setRunError("");
    try { setRun((await startRun(chosen.join(""), studio.provider)).run); }
    catch (error) { setRunError(error instanceof Error ? error.message : String(error)); }
    finally { setStarting(false); }
  }
  async function cancel() {
    try { setRun((await cancelRun()).run); } catch (error) { setRunError(error instanceof Error ? error.message : String(error)); }
  }
  async function save(next: KanjiSettings) {
    if (!studio?.configured) return;
    setSaving(true); setSettingsError(""); setSettingsMessage("");
    try {
      const saved = await saveSettings(studio.revision, changedSettings(studio.settings, next));
      setStudio({ ...studio, revision: saved.revision, settings: saved.settings });
      setSettingsMessage(say("Settings saved.", "設定を保存しました。"));
      setSettingsVersion(v => v + 1);
    } catch (error) { setSettingsError(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  }

  const header = <header className="mt-7 flex flex-wrap items-end justify-between gap-3">
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-primary">{say("Shorts", "ショート動画")}</p>
      <h1 className="mt-1 font-serif text-2xl font-semibold text-foreground">{say("Kanji shorts", "漢字ショート")}</h1>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{say(
        "Vertical study shorts: the brush writes the kanji, the voices read its readings and useful words. The same settings and producer as pnpm video:kanji.",
        "縦型の学習ショート。筆が漢字を書き、音声が読みとよく使うことばを読みます。pnpm video:kanji と同じ設定と制作処理です。")}</p>
    </div>
    <Button variant="outline" size="sm" icon={<RefreshCw className="size-4" />} onClick={() => void reload()}>{say("Reload", "再読み込み")}</Button>
  </header>;

  if (!studio) return <div className="pb-10">{header}
    <Surface className="mt-6">{loadError
      ? <p role="alert" className="flex gap-2 text-sm text-foreground"><AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-status-danger" />{loadError}</p>
      : <p role="status" className="text-sm text-muted-foreground">{say("Loading kanji shorts…", "漢字ショートを読み込んでいます…")}</p>}</Surface>
  </div>;
  if (!studio.configured) return <div className="pb-10">{header}
    <Surface className="mt-6" header={<h2 className={heading}>{say("Set up kanji shorts", "漢字ショートの準備")}</h2>}>
      <p role="alert" className="text-sm text-foreground">{studio.problem}</p>
      <p className={helper}>{say("The settings file names the kanji data, the music and the voices. docs/how-to-make-kanji-shorts.md shows how to make one.",
        "設定ファイルには漢字データ、音楽、音声を書きます。作り方は docs/how-to-make-kanji-shorts.md にあります。")}</p>
      <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{studio.configPath}</p>
    </Surface>
  </div>;

  const busy = running || starting;
  return <div className="pb-10">
    {header}
    <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        <Surface header={<div><h2 className={heading}>{say("Choose kanji", "漢字を選ぶ")}</h2>
          <p className={helper}>{say(`Pick or type up to ${MAX_KANJI}. Each becomes its own short.`, `${MAX_KANJI} 字まで選ぶか入力します。1 字ごとに 1 本のショートになります。`)}</p></div>}>
          <div className="flex flex-col gap-4">
            <div>
            <label className="block text-xs font-semibold text-muted-foreground">{say("Kanji to make", "作る漢字")}
              <input className={field + " mt-1 font-serif tracking-widest"} lang="ja" value={selection} onChange={e => setSelection(e.target.value)}
                aria-describedby="kanji-count" placeholder="年今前時友" />
            </label>
            <p id="kanji-count" className={"mt-1.5 text-xs " + (tooMany ? "text-status-danger" : "text-muted-foreground")}>
              {tooMany ? say(`One run makes at most ${MAX_KANJI} kanji; ${chosen.length} are chosen.`, `1 回で作れるのは ${MAX_KANJI} 字までです（${chosen.length} 字選択中）。`)
                : say(`${chosen.length} chosen`, `${chosen.length} 字選択中`)}</p>
            </div>
            <KanjiPicker catalog={studio.catalog} selected={chosen} onToggle={toggle} say={say} />
          </div>
        </Surface>

        <Surface header={<div><h2 className={heading}>{say("What each short says", "各ショートの内容")}</h2>
          <p className={helper}>{say("Each line, the voice that reads each part, and where a reading reuses another line's audio. Nothing is sent to make this preview.",
            "各行と、それぞれを読む音声、別の行の音声を使う箇所。このプレビューでは何も送信しません。")}</p></div>}>
          <div aria-busy={previewing} aria-live="polite">
            {!chosen.length ? <p className="text-sm text-muted-foreground">{say("Choose a kanji to see its short.", "漢字を選ぶと内容が表示されます。")}</p>
              : previewError ? <p role="alert" className="text-sm text-status-danger">{previewError}</p>
              : previewing && !previews.length ? <p className="text-sm text-muted-foreground">{say("Preparing the preview…", "プレビューを準備しています…")}</p>
              : <ul className="flex flex-col gap-3">{previews.map(preview => <PreviewCard key={preview.char} preview={preview} settings={studio.settings} say={say} />)}</ul>}
          </div>
        </Surface>
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <Surface header={<div><h2 className={heading}>{say("Make", "作成")}</h2>
          <p className={helper}>{studio.provider === "fish"
            ? say("Make sends each short's narration text to Fish Audio, read with your voices. Each short takes a few minutes to render. Nothing is published.",
              "「作成」を押すと、各ショートのナレーション文を Fish Audio に送り、設定した音声で読み上げます。1 本の描画に数分かかります。公開はされません。")
            : say("A local voice reads the narration. Each short takes a few minutes to render. Nothing is published.",
              "ローカルの音声がナレーションを読みます。1 本の描画に数分かかります。公開はされません。")}</p></div>}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Button icon={<Clapperboard className="size-4" />} isLoading={starting} disabled={busy || !chosen.length || tooMany} onClick={() => void make()}>
                {chosen.length === 1 ? say("Make 1 short", "1 本作成") : say(`Make ${chosen.length} shorts`, `${chosen.length} 本作成`)}</Button>
              {running && <Button variant="outline" icon={<Square className="size-4" />} onClick={() => void cancel()}>{say("Cancel", "キャンセル")}</Button>}
            </div>
            {runError && <p role="alert" className="rounded-control border border-status-danger bg-status-danger/10 px-3 py-2 text-sm text-foreground">{runError}</p>}
            {run && <div aria-live="polite">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">{run.state === "running" ? say("Making…", "作成中…") : run.state === "cancelled" ? say("Cancelled", "キャンセルしました") : say("Last run", "前回の実行")}</p>
              {run.error && <p role="alert" className="mb-2 text-sm text-status-danger">{run.error}</p>}
              <ul className="flex flex-col gap-2">{run.items.map(item => <RunRow key={item.char} item={item} active={item.char === shown} onShow={setShown} say={say} />)}</ul>
            </div>}
          </div>
        </Surface>

        <Surface header={<div><h2 className={heading}>{say("Watch", "視聴")}</h2>
          <p className={helper}>{shown ? say(`The newest short of ${shown}, and its checks.`, `${shown} の最新のショートとその計測結果。`) : say("Choose a kanji that has been made.", "作成済みの漢字を選んでください。")}</p></div>}>
          {releaseLoading ? <p className="text-sm text-muted-foreground">{say("Loading…", "読み込み中…")}</p>
            : shown && !release ? <p className="text-sm text-muted-foreground">{say(`No short of ${shown} yet.`, `${shown} のショートはまだありません。`)}</p>
            : release ? <ReleasePlayer key={release.folder + release.versions[0]?.version} release={release} say={say} /> : null}
        </Surface>

        <KanjiSettingsPanel settings={studio.settings} provider={studio.provider} saving={saving}
          message={settingsMessage} error={settingsError} onSave={next => void save(next)} say={say} />
      </div>
    </div>
  </div>;
}
