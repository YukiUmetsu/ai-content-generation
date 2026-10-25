import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Clock3, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/features/registry";
import type { LocalContent, LocalProject } from "./catalog-model";
import {
  cancelSessionRun, createDiscoverySession, discoverSession, getDiscoverySession, listDiscoverySessions,
  listSessionIdeas, listSessionRuns, updateDiscoverySession,
  resumeSessionRun,
  type DiscoveryPlatform, type DiscoverySession,
} from "@/lib/api/discovery-sessions";
import type { DiscoveryRun } from "@/lib/api/discovery";

const tr = (locale: Locale, en: string, ja: string) => locale === "ja" ? ja : en;
const inputClass = "w-full rounded-control border border-input bg-surface px-3 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const platformNames: Record<DiscoveryPlatform, string> = {
  youtube: "YouTube", youtube_shorts: "YouTube Shorts", tiktok: "TikTok", instagram: "Instagram",
  facebook: "Facebook", blog: "Blog / Website", website: "Blog / Website",
};

function dateStamp(value: number): string {
  return Number.isFinite(value) ? new Date(value * 1000).toLocaleDateString() : "—";
}

function isRunning(run: DiscoveryRun | null): boolean {
  return run?.status === "queued" || run?.status === "running";
}

export interface DiscoverySessionWorkspaceProps {
  project: LocalProject;
  platforms: DiscoveryPlatform[];
  content?: Pick<LocalContent, "projectId" | "name" | "stage">[];
  locale: Locale;
  selectedSessionId?: string | null;
  onSelectSession: (sessionId: string) => void;
}

interface ActiveSessionDetails {
  sessionId: string;
  run: DiscoveryRun | null;
  runHistory: DiscoveryRun[];
  candidateCount: number | null;
}

/** The Discover stage owns session choice and resumable collection, not a second video Project. */
export function DiscoverySessionWorkspace(props: DiscoverySessionWorkspaceProps) {
  // Each brand owns an independent selection and discovery state lifecycle.
  return <ProjectDiscoverySessions key={props.project.id} {...props} />;
}

function ProjectDiscoverySessions({ project, platforms, content = [], locale, selectedSessionId, onSelectSession }:
  DiscoverySessionWorkspaceProps) {
  const [sessions, setSessions] = useState<DiscoverySession[]>([]);
  const [localSelection, setLocalSelection] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [name, setName] = useState("");
  const [resultBudget, setResultBudget] = useState(12);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [activeDetails, setActiveDetails] = useState<ActiveSessionDetails | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const currentId = selectedSessionId ?? localSelection;
  // An external selection can change without a click in this component.
  // Do not display the previous session's run while the new one is fetched.
  const currentDetails = activeDetails?.sessionId === currentId ? activeDetails : null;
  const run = currentDetails?.run ?? null;
  const runHistory = currentDetails?.runHistory ?? [];
  const candidateCount = currentDetails?.candidateCount ?? null;
  const selected = useMemo(() => sessions.find(item => item.id === currentId) ?? null, [currentId, sessions]);
  const visibleSessions = useMemo(() => sessions.filter(item => showArchived || item.archivedAt === null), [sessions, showArchived]);
  const archivedCount = sessions.filter(item => item.archivedAt !== null).length;

  const refreshList = useCallback(async () => {
    const saved = await listDiscoverySessions(project.id);
    setSessions(saved);
    return saved;
  }, [project.id]);

  useEffect(() => {
    let alive = true;
    void listDiscoverySessions(project.id).then(saved => {
      if (!alive) return;
      setSessions(saved);
      setLoading(false);
    }).catch(failure => {
      if (!alive) return;
      setError(failure instanceof Error ? failure.message : "Could not load sessions.");
      setLoading(false);
    });
    return () => { alive = false; };
  }, [project.id]);

  const refreshActive = useCallback(async (sessionId: string, signal?: AbortSignal) => {
    const [detail, runs] = await Promise.all([
      getDiscoverySession(project.id, sessionId, signal), listSessionRuns(project.id, sessionId, signal),
    ]);
    // Session detail already includes the server-calculated total; avoid
    // fetching every captured source passage again on each status poll.
    const count = typeof detail.ideaCount === "number" ? detail.ideaCount
      : (await listSessionIdeas(project.id, sessionId, signal)).length;
    if (signal?.aborted) return;
    setSessions(previous => previous.map(item => item.id === detail.id ? detail : item));
    setActiveDetails({ sessionId, runHistory: runs, run: runs[0] ?? detail.lastRun ?? null,
      candidateCount: count });
  }, [project.id]);

  useEffect(() => {
    if (!currentId) return;
    let alive = true;
    const controller = new AbortController();
    const load = async () => {
      try { if (alive) await refreshActive(currentId, controller.signal); }
      catch (failure) { if (alive) setError(failure instanceof Error ? failure.message : "Could not load session details."); }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 3500);
    return () => { alive = false; controller.abort(); window.clearInterval(timer); };
  }, [currentId, refreshActive]);

  const selectSession = (sessionId: string) => {
    setLocalSelection(sessionId);
    setActiveDetails(null);
    setNotice("");
    setError(null);
    onSelectSession(sessionId);
  };

  const create = async () => {
    setBusy(true); setError(null); setNotice("");
    try {
      const created = await createDiscoverySession(project.id,
        { name: name.trim(), platforms, settingsSnapshot: { version: 1, resultBudget } });
      setSessions(items => [created, ...items.filter(item => item.id !== created.id)]);
      setShowCreate(false); setName("");
      selectSession(created.id);
      setNotice(tr(locale, "Session saved. You can start discovery now.", "セッションを保存しました。調査を開始できます。"));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not create session."); }
    finally { setBusy(false); }
  };

  const saveName = async () => {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      const changed = await updateDiscoverySession(project.id, selected.id, { name: renameDraft.trim() });
      setSessions(items => items.map(item => item.id === changed.id ? changed : item));
      setRenaming(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not rename session."); }
    finally { setBusy(false); }
  };

  const setArchived = async (archived: boolean) => {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      const changed = await updateDiscoverySession(project.id, selected.id, { archived });
      setSessions(items => items.map(item => item.id === changed.id ? changed : item));
      if (archived) setShowArchived(true);
      setNotice(archived ? tr(locale, "Session archived. Its results can be restored any time.",
        "アーカイブしました。いつでも復元できます。") :
        tr(locale, "Session restored with its original results.", "元の結果を保持したまま復元しました。"));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update session."); }
    finally { setBusy(false); }
  };

  const discover = async () => {
    if (!selected) return;
    setBusy(true); setError(null); setNotice("");
    try {
      const budget = Number(selected.settingsSnapshot.resultBudget);
      const started = await discoverSession(project.id, selected.id,
        { projectName: project.name, description: project.notes,
          resultBudget: Number.isInteger(budget) && budget >= 3 && budget <= 30 ? budget : 12,
          content: content.filter(item => item.projectId === project.id).map(({name,stage}) => ({name,stage})) });
      setActiveDetails(current => ({
        sessionId: selected.id,
        run: started,
        runHistory: [started, ...(current?.sessionId === selected.id
          ? current.runHistory.filter(item => item.id !== started.id) : [])],
        candidateCount: current?.sessionId === selected.id ? current.candidateCount : null,
      }));
      await refreshList();
      setNotice(tr(locale, "Discovery job started. Collected results are saved as they arrive.",
        "調査ジョブを開始しました。収集済みの結果は順次保存されます。"));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not start discovery."); }
    finally { setBusy(false); }
  };

  const controlRun = async (action: "cancel" | "resume") => {
    if (!selected || !run) return;
    setBusy(true); setError(null); setNotice("");
    try {
      const budget = Number(selected.settingsSnapshot.resultBudget);
      const updated = action === "cancel" ? await cancelSessionRun(project.id, run.id)
        : await resumeSessionRun(project.id, selected.id, run.id,
          { projectName: project.name, description: project.notes,
            resultBudget: Number.isInteger(budget) && budget >= 3 && budget <= 30 ? budget : 12,
            content: content.filter(item => item.projectId === project.id).map(({name,stage}) => ({name,stage})) });
      setActiveDetails(current => current?.sessionId === selected.id ? {
        ...current, run: updated,
        runHistory: current.runHistory.map(item => item.id === updated.id ? updated : item),
      } : current);
      setNotice(action === "cancel" ? tr(locale, "Run cancelled. Saved ideas and evidence were kept.",
        "ジョブを中止しました。保存済みのアイデアと根拠は保持されます。") :
        tr(locale, "Resuming the saved discovery job.", "保存済みジョブを再開中です。"));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update run."); }
    finally { setBusy(false); }
  };

  return <section aria-label={tr(locale, "Content discovery sessions", "コンテンツ発見セッション")} className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.12em] text-muted-foreground">
          <Sparkles className="size-4" aria-hidden="true" /> {tr(locale, "Discovery", "発見")}
        </div>
        <h2 className="font-serif text-2xl font-semibold text-foreground">{tr(locale, "Find your next original story", "次のアイデアを見つける")}</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{tr(locale,
          "Create a saved session for this brand. Search, market observations and source evidence stay with the session for future productions.",
          "ブランドごとに調査セッションを保存します。市場データと出典を再利用できます。")}</p>
      </div>
      <Button onClick={() => { setShowCreate(value => !value); setError(null); }}>
        {tr(locale, "New discovery session", "新規調査セッション")}
      </Button>
    </div>

    {showCreate && <form aria-label={tr(locale, "Create discovery session", "調査セッションを作成")}
      onSubmit={event => { event.preventDefault(); void create(); }}
      className="rounded-control border border-primary/30 bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-56 flex-1 text-sm font-medium">{tr(locale, "Session name", "セッション名")}
          <input className={`mt-2 ${inputClass}`} value={name} maxLength={120} onChange={event => setName(event.target.value)}
            placeholder={tr(locale, "Optional, e.g. Insurance questions", "任意（例：保険の疑問）")} />
        </label>
        <Button type="submit" disabled={busy || platforms.length === 0}>{tr(locale, "Create session", "セッションを作成")}</Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2" aria-label={tr(locale, "Selected platforms", "選択したプラットフォーム")}>
        {platforms.map(item => <span key={item} className="rounded-full bg-muted px-3 py-1 text-xs font-medium">{platformNames[item]}</span>)}
        {platforms.length === 0 && <p role="alert" className="text-sm text-danger">{tr(locale, "Choose a platform in Setup first.", "設定で配信先を選んでください。")}</p>}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{tr(locale,
        "The server creates the session ID automatically. Discovery runs only when you request it.",
        "セッション ID は自動生成されます。調査は開始操作後に実行されます。")}</p>
      <details className="mt-3 text-sm text-muted-foreground">
        <summary className="cursor-pointer font-medium">{tr(locale, "Discovery options", "調査オプション")}</summary>
        <label className="mt-3 block max-w-xs text-xs font-medium">{tr(locale, "Idea budget", "アイデア件数")}
          <select value={resultBudget} onChange={event => setResultBudget(Number(event.target.value))}
            className={`mt-1 ${inputClass}`}>
            <option value={6}>6</option><option value={12}>12</option><option value={18}>18</option>
          </select>
        </label>
        <p className="mt-1 text-xs">{tr(locale,
          "An upper target, not a guaranteed number. Only distinct, supported ideas are saved.",
          "上限目標であり件数は保証されません。重複を省き、根拠がある提案のみ保存します。")}</p>
      </details>
    </form>}

    <div className="grid gap-5 xl:grid-cols-[minmax(260px,0.78fr)_minmax(0,1.52fr)]">
      <section aria-label={tr(locale, "Saved sessions", "保存済みセッション")} className="min-w-0 rounded-control border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="font-semibold">{tr(locale, "Saved sessions", "保存済みセッション")}</h3>
          <div className="flex items-center gap-2">
            {archivedCount > 0 && <Button variant="subtle" size="sm" onClick={() => setShowArchived(value => !value)}>
              {showArchived ? tr(locale, "Hide archived", "アーカイブを非表示") : tr(locale, `Show archived (${archivedCount})`, `アーカイブを表示 (${archivedCount})`)}</Button>}
            <Button variant="subtle" size="sm" disabled={loading} onClick={() => void refreshList().catch(failure =>
              setError(failure instanceof Error ? failure.message : "Could not refresh sessions."))} aria-label={tr(locale, "Refresh sessions", "セッションを更新")}>
              <RefreshCw className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
        {loading && <p role="status" className="text-sm text-muted-foreground">{tr(locale, "Loading sessions…", "読み込み中…")}</p>}
        {!loading && visibleSessions.length === 0 && <p className="rounded-control bg-muted/30 px-4 py-6 text-sm text-muted-foreground">{tr(locale,
          "No sessions yet. Start with one topic area or let the AI explore your brand's niche.", "セッションはまだありません。ブランドの分野から探索しましょう。")}</p>}
        <div className="space-y-2">{visibleSessions.map(item => <button key={item.id} type="button" onClick={() => selectSession(item.id)}
          aria-current={currentId === item.id ? "true" : undefined}
          className={`w-full rounded-control border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${currentId === item.id ? "border-primary bg-primary/5" : "border-border hover:bg-surface-subtle"} ${item.archivedAt !== null ? "opacity-65" : ""}`}>
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0 break-words text-sm font-semibold">{item.name || tr(locale, "Untitled session", "名称未設定")}</span>
            {currentId === item.id ? <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              : <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
          </span>
          <span className="mt-1 block text-xs text-muted-foreground"><Clock3 className="mr-1 inline size-3.5" aria-hidden="true" />
            {dateStamp(item.createdAt)} · {item.status.replaceAll("_", " ")}
            {typeof item.ideaCount === "number" ? ` · ${item.ideaCount} ${tr(locale,"ideas","件のアイデア")}` : ""}</span>
          <span className="mt-2 flex flex-wrap gap-1">{item.platforms.map(target =>
            <span key={target} className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{platformNames[target] ?? target}</span>)}</span>
        </button>)}</div>
      </section>

      <section aria-label={tr(locale, "Session details", "セッション詳細")} className="min-w-0 rounded-control border border-border bg-surface p-5">
        {!selected ? <div className="grid min-h-60 place-content-center gap-2 text-center">
          <Sparkles className="mx-auto size-7 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">{tr(locale, "Select a saved session", "保存済みセッションを選択")}</p>
          <p className="text-sm text-muted-foreground">{tr(locale, "Or create a new one to begin discovery.", "または新しいセッションを作成してください。")}</p>
        </div> : <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr(locale, "Current session", "現在のセッション")}</p>
              <p className="mt-1 text-lg font-semibold">{tr(locale, "Research and evidence", "調査と根拠")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{tr(locale, "Saved", "保存日")}: {dateStamp(selected.createdAt)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => { setRenameDraft(selected.name); setRenaming(value => !value); }}>
                {tr(locale, "Rename", "名前を変更")}</Button>
              <Button size="sm" variant="subtle" disabled={busy} onClick={() => void setArchived(selected.archivedAt === null)}>
                {selected.archivedAt === null ? tr(locale, "Archive session", "アーカイブする") : tr(locale, "Restore session", "復元する")}</Button>
            </div>
          </div>
          {renaming && <form onSubmit={event => { event.preventDefault(); void saveName(); }} className="flex flex-wrap items-end gap-2">
            <label className="min-w-44 flex-1 text-sm">{tr(locale, "Session name", "セッション名")}
              <input className={`mt-1 ${inputClass}`} value={renameDraft} maxLength={120} onChange={event => setRenameDraft(event.target.value)}/>
            </label>
            <Button size="sm" type="submit" disabled={busy}>{tr(locale, "Save name", "名前を保存")}</Button>
          </form>}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-control bg-muted/40 p-3"><p className="text-xs text-muted-foreground">{tr(locale, "Status", "状態")}</p>
              <p className="mt-1 text-sm font-semibold capitalize">{run?.status.replaceAll("_", " ") ?? selected.status.replaceAll("_", " ")}</p></div>
            <div className="rounded-control bg-muted/40 p-3"><p className="text-xs text-muted-foreground">{tr(locale, "Saved ideas", "保存したアイデア")}</p>
              <p className="mt-1 text-sm font-semibold">{candidateCount === null ? tr(locale, "Loading…", "読み込み中…") : candidateCount}</p></div>
            <div className="rounded-control bg-muted/40 p-3"><p className="text-xs text-muted-foreground">{tr(locale, "Discovery runs", "調査回数")}</p>
              <p className="mt-1 text-sm font-semibold">{runHistory.length}</p></div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={busy || isRunning(run) || run?.status === "paused" || selected.archivedAt !== null}
              onClick={() => void discover()}>
              <Sparkles className="size-4" aria-hidden="true" /> {isRunning(run) ? tr(locale, "Discovery running…", "調査中…")
                : tr(locale, "Discover opportunities", "アイデアを探す")}</Button>
            {isRunning(run) && <Button variant="outline" disabled={busy}
              onClick={() => void controlRun("cancel")}>{tr(locale, "Cancel run", "ジョブを中止")}</Button>}
            {(run?.status === "paused" || run?.status === "failed") && <Button variant="outline" disabled={busy}
              onClick={() => void controlRun("resume")}>{tr(locale, "Resume saved run", "保存済みジョブを再開")}</Button>}
            <p className="text-xs text-muted-foreground">{tr(locale,
              "Previous results remain saved when you run discovery again.", "再実行しても以前の結果は保存されます。")}</p>
          </div>
          {run && <div role="status" className="rounded-control border border-border px-4 py-3 text-sm">
            <p className="font-medium">{tr(locale, "Latest job", "直近のジョブ")}: {run.status.replaceAll("_", " ")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{tr(locale, "Current operation", "現在の操作")}: {run.stage.replaceAll("_", " ")}</p>
            {run.errorCode && <p className="mt-2 text-sm text-danger">{run.errorCode}</p>}
            {run.providerHealth && Object.keys(run.providerHealth).length > 0 && <details className="mt-2 text-xs text-muted-foreground">
              <summary className="cursor-pointer">{tr(locale, "Provider availability and evidence gaps", "データ提供元・根拠の不足")}</summary>
              <ul className="mt-2 space-y-1">{Object.entries(run.providerHealth).map(([provider, status]) =>
                <li key={provider}>{provider}: {status}</li>)}</ul>
            </details>}
          </div>}
          <p className="text-xs text-muted-foreground">{tr(locale,
            "Next, open Select Idea to compare results, inspect sources and choose what to produce.",
            "次に『アイデア選択』で結果と出典を確認し、制作テーマを選びます。")}</p>
        </div>}
      </section>
    </div>
    {notice && <p role="status" className="text-sm text-success">{notice}</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </section>;
}

