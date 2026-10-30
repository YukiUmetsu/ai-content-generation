import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileSearch,
  Info,
  ListChecks,
  Loader2,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import { ApiErrorNotice } from "./api-error-notice";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Surface } from "@/components/ui/surface-card";
import { EmptyState } from "@/app/empty-state";
import { formatDiscoveryProviderHealth } from "./discovery-provider-health";
import { translate, formatDateTime } from "@/i18n/messages";
import { listJobs, getJob, cancelJob, ApiError } from "@/lib/api/client";
import { listDiscoverySessions, type DiscoverySession } from "@/lib/api/discovery-sessions";
import type { Job, JobNode, JobAttempt, JobView, JobState, JobEdge, EdgeKind } from "@/lib/api/types";
import type { Locale } from "@/features/registry";

interface JobsWorkspaceProps {
  locale: Locale;
  projects?: { id: string; name: string }[];
}
const EMPTY_PROJECTS: { id: string; name: string }[] = [];

interface DiscoveryJob {
  projectName: string;
  session: DiscoverySession;
  stale?: boolean;
}

type MonitorBucket = "active" | "attention" | "finished";
type MonitorFilter = "all" | MonitorBucket;
type MonitorEntry =
  | { kind: "discovery"; key: string; projectName: string; session: DiscoverySession; stale: boolean;
      bucket: MonitorBucket; updatedAt: number }
  | { kind: "pipeline"; key: string; job: Job;
      bucket: MonitorBucket; updatedAt: number };

function humanize(value: string): string {
  const label = value.replaceAll(/[_-]+/g, " ").trim();
  return label ? label[0].toUpperCase() + label.slice(1) : value;
}

function discoveryBucket(status: string): MonitorBucket {
  if (status === "running" || status === "queued") return "active";
  if (["completed", "cancelled"].includes(status)) return "finished";
  return "attention";
}

function monitorEntries(jobs: Job[], discoveries: DiscoveryJob[]): MonitorEntry[] {
  const entries: MonitorEntry[] = discoveries.flatMap(({ projectName, session, stale }) => {
    const run = session.lastRun;
    if (!run) return [];
    const bucket = discoveryBucket(run.status);
    return [{ kind: "discovery" as const, key: `discovery:${session.projectId}:${session.id}`,
      projectName, session, stale: !!stale, bucket,
      updatedAt: run.updatedAt * 1000 }];
  });
  entries.push(...jobs.map(job => {
    const bucket: MonitorBucket = ACTIVE_STATES.includes(job.state) ? "active"
      : job.state === "FAILED" ? "attention" : "finished";
    return { kind: "pipeline" as const, key: `pipeline:${job.id}`, job, bucket,
      updatedAt: safeTime(job.updatedAt) };
  }));
  return entries.sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key));
}

const videoJobNames:Record<string,[string,string]>={
  "video-production":["Create draft video","下書き動画を生成"],
  "video-asset-download":["Prepare scene media","シーン素材を準備"],
  "video-narration-scene":["Narrate one scene","シーンの音声を作成"],
  "video-render-segment":["Render one scene","シーン映像を作成"],
  "video-thumbnail-concept":["Create thumbnail concept","サムネイル案を作成"],
};
function jobName(kind:string,locale:Locale):string{
  return videoJobNames[kind]?.[locale==="ja"?1:0]??humanize(kind);
}
function monitorName(entry: MonitorEntry,locale:Locale): string {
  return entry.kind === "discovery" ? entry.session.name : jobName(entry.job.jobKind,locale);
}

function monitorStatus(entry: MonitorEntry, locale: Locale): string {
  return entry.kind === "discovery" ? discoveryStatus(entry.session.lastRun?.status ?? "", locale)
    : stateLabel(entry.job.state, locale);
}

function monitorBadgeClasses(entry: MonitorEntry): string {
  if (entry.kind === "pipeline") return stateBadgeClasses(entry.job.state);
  const status = entry.session.lastRun?.status;
  if (status === "completed") return severityBadgeClasses("SUCCEEDED");
  if (status === "running") return severityBadgeClasses("RUNNING");
  if (status === "queued") return severityBadgeClasses("READY");
  if (status === "cancelled") return severityBadgeClasses("CANCELLED");
  return status === "failed" ? severityBadgeClasses("FAILED")
    : "border-status-warning/30 bg-status-warning/10 text-status-warning";
}

function formatRunTime(epochSeconds: number, locale: Locale): string {
  if (!Number.isFinite(epochSeconds)) return "—";
  const date = new Date(epochSeconds * 1000);
  return Number.isFinite(date.getTime()) ? formatDateTime(date.toISOString(), locale) : "—";
}

function relativeTime(timestamp: number, locale: Locale): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0 || !Number.isFinite(new Date(timestamp).getTime())) return "—";
  const elapsed = Math.max(0, Date.now() - timestamp);
  const lang = locale === "ja" ? "ja-JP" : "en-US";
  const unit: Intl.RelativeTimeFormatUnit = elapsed < 60_000 ? "second"
    : elapsed < 3_600_000 ? "minute" : elapsed < 86_400_000 ? "hour" : "day";
  const divisor = unit === "second" ? 1000 : unit === "minute" ? 60_000 : unit === "hour" ? 3_600_000 : 86_400_000;
  const amount = unit === "second" && elapsed < 5000 ? 0 : -Math.floor(elapsed / divisor);
  return new Intl.RelativeTimeFormat(lang, { numeric: "auto", style: "short" }).format(amount, unit);
}

function discoveryStatus(status: string, locale: Locale): string {
  const labels: Record<string, [string, string]> = {
    queued: ["Queued", "待機中"], running: ["Running", "実行中"],
    paused: ["Paused", "一時停止"], completed: ["Completed", "完了"],
    insufficient_evidence: ["Needs review", "確認が必要"],
    failed: ["Failed", "失敗"], cancelled: ["Cancelled", "中止"],
  };
  const pair = labels[status];
  return pair ? pair[locale === "ja" ? 1 : 0] : status.replaceAll("_", " ");
}

function latestDiscoveryJobs(items: DiscoveryJob[]): DiscoveryJob[] {
  const active = (item: DiscoveryJob) =>
    item.session.lastRun?.status === "running" || item.session.lastRun?.status === "queued";
  const sorted = [...items].sort((a, b) =>
    Number(active(b)) - Number(active(a)) || b.session.updatedAt - a.session.updatedAt);
  const running = sorted.filter(active);
  return [...running, ...sorted.filter(item => !active(item)).slice(0, 10)];
}

const POLL_INTERVAL_MS = 1000;
const TERMINAL_STATES: JobState[] = ["SUCCEEDED", "FAILED", "CANCELLED"];
const ACTIVE_STATES: JobState[] = ["PENDING", "READY", "RUNNING"];

function isTerminal(state: JobState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** Human-readable state; PENDING/READY both read as "Queued" per the UI vocabulary. */
function stateLabel(state: JobState, locale: Locale): string {
  switch (state) {
    case "PENDING":
    case "READY":
      return translate(locale, "jobsStateQueued");
    case "RUNNING":
      return translate(locale, "jobsStateRunning");
    case "SUCCEEDED":
      return translate(locale, "jobsStateSucceeded");
    case "FAILED":
      return translate(locale, "jobsStateFailed");
    case "CANCELLED":
      return translate(locale, "jobsStateCancelled");
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

/** Date.parse that never produces NaN; unparseable timestamps sort last. */
function safeTime(iso: string): number {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value;
}

/**
 * Stable topological order (dependencies before dependants). Ties keep the
 * API order. Nodes left over by a cycle or unknown dependency are appended in
 * API order instead of being dropped.
 */
function orderNodes(nodes: JobNode[], edges: JobEdge[]): JobNode[] {
  const known = new Set(nodes.map((node) => node.id));
  const indegree = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  const seen = new Set<string>();

  for (const edge of edges) {
    if (!known.has(edge.fromNodeId) || !known.has(edge.toNodeId)) continue;
    if (edge.fromNodeId === edge.toNodeId) continue;
    const edgeKey = `${edge.fromNodeId}>${edge.toNodeId}`;
    if (seen.has(edgeKey)) continue;
    seen.add(edgeKey);
    outgoing.get(edge.fromNodeId)?.push(edge.toNodeId);
    indegree.set(edge.toNodeId, (indegree.get(edge.toNodeId) ?? 0) + 1);
  }

  const remaining = nodes.slice();
  const ordered: JobNode[] = [];
  while (remaining.length > 0) {
    const index = remaining.findIndex((node) => (indegree.get(node.id) ?? 0) === 0);
    if (index === -1) break;
    const [node] = remaining.splice(index, 1);
    ordered.push(node);
    for (const next of outgoing.get(node.id) ?? []) {
      indegree.set(next, (indegree.get(next) ?? 1) - 1);
    }
  }
  return [...ordered, ...remaining];
}

const productionStageLabels:Record<string,string>={
  "scene-plan":"Prepare scene plan","visual-planning":"Prepare visual layouts",
  "asset-search":"Find suitable imagery","asset-preparation":"Prepare scene assets",
  "asset-download":"Download scene photo",
  "thumbnail-concept":"Export one thumbnail concept",
  narration:"Generate narration",timeline:"Synchronize scene timing",
  "sound-mix":"Mix audio",captions:"Create captions",
  "scene-render":"Render video scenes",thumbnails:"Create three thumbnails",
  "narration-scene":"Narrate one scene","render-segment":"Render one scene segment",
  "final-mux":"Assemble final video","technical-qa":"Check video quality",
  "export-package":"Save video and publishing files",
};
const friendlyStage=(key:string)=>productionStageLabels[key]??key;
/** Map opaque node ids to operator-facing stage names, falling back to the id. */
function nodeLabel(nodes: JobNode[], nodeId: string): string {
  return friendlyStage(nodes.find((node) => node.id === nodeId)?.nodeKey ?? nodeId);
}

/** Compact list identity: the last 12 characters, with the full id in `title`. */
function compactId(id: string): string {
  return id.length > 12 ? `…${id.slice(-12)}` : id;
}

/** Localized explanation for a failed request, keeping the server code visible. */
function attemptDetail(detail: string, locale: Locale): string {
  if(detail === "Scene timing failed. Reopen the visual editor, check the affected scenes and retry.")
    return locale === "ja" ? "この以前の試行では具体的な原因やシーンが記録されていません。再試行すると詳細を確認できます。" :
      "This earlier attempt did not record the specific cause or scene. Retry to check for more details.";
  return detail;
}

function failureMessage(error: ApiError, locale: Locale): string {
  switch (error.kind) {
    case "network":
      return translate(locale, "apiOffline");
    case "timeout":
      return translate(locale, "requestTimedOut");
    case "aborted":
      return translate(locale, "requestCancelled");
    case "invalid_payload":
      return translate(locale, "invalidPayload");
    default:
      return error.message;
  }
}

interface JobFailureSummary {
  node: JobNode;
  errorCode: string | null;
  errorDetail: string | null;
  failureCount: number;
}

/**
 * Only a terminal FAILED job gets a summary. The failed node is chosen in
 * topological order (the earliest pipeline break), and its detail comes from
 * the most recent attempt that actually recorded one.
 */
function jobFailureSummary(jobView: JobView, orderedNodes: JobNode[]): JobFailureSummary | null {
  if (jobView.job.state !== "FAILED") return null;
  const failedNodes = orderedNodes.filter((node) => node.state === "FAILED");
  if (failedNodes.length === 0) return null;
  const node = failedNodes[0];
  const nodeAttempts = jobView.attempts
    .filter((attempt) => attempt.nodeId === node.id)
    .sort((a, b) => safeTime(b.startedAt) - safeTime(a.startedAt));
  const detailAttempt = nodeAttempts.find((attempt) => attempt.errorDetail !== null);
  const codeAttempt = nodeAttempts.find((attempt) => attempt.errorCode !== null);
  return {
    node,
    errorCode: node.errorCode ?? codeAttempt?.errorCode ?? null,
    errorDetail: detailAttempt?.errorDetail ?? null,
    failureCount: failedNodes.length,
  };
}

function stateBadgeClasses(state: JobState): string {
  return severityBadgeClasses(state);
}

function attemptStateBadgeClasses(state: JobAttempt["state"]): string {
  return severityBadgeClasses(state);
}

function severityBadgeClasses(state: JobState | JobAttempt["state"]): string {
  switch (state) {
    case "SUCCEEDED":
      return "bg-status-success/10 text-status-success border-status-success/30";
    case "FAILED":
      return "bg-danger/10 text-danger border-danger/30";
    case "CANCELLED":
      return "bg-surface-inset text-muted-foreground border-border";
    case "RUNNING":
      return "bg-status-info/10 text-status-info border-status-info/30";
    case "READY":
      return "bg-status-warning/10 text-status-warning border-status-warning/30";
    case "PENDING":
      return "bg-surface-inset text-muted-foreground border-border";
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function AttemptStateIcon({ state }: { state: JobAttempt["state"] }) {
  switch (state) {
    case "SUCCEEDED":
      return <CheckCircle2 aria-hidden className="size-4 text-status-success" />;
    case "FAILED":
      return <XCircle aria-hidden className="size-4 text-danger" />;
    case "CANCELLED":
      return <Info aria-hidden className="size-4 text-muted-foreground" />;
    case "RUNNING":
      return <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none text-status-info" />;
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function formatEdgeKind(kind: EdgeKind, locale: Locale): string {
  return kind === "dependency" ? translate(locale, "jobsEdgeDependency") : translate(locale, "jobsEdgeData");
}

export function JobsWorkspace({ locale, projects = EMPTY_PROJECTS }: JobsWorkspaceProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [discoveryJobs, setDiscoveryJobs] = useState<DiscoveryJob[]>([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(true);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState<ApiError | null>(null);
  const [selectedEntryKey, setSelectedEntryKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<MonitorFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [jobView, setJobView] = useState<JobView | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<ApiError | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [retryLoading, setRetryLoading] = useState(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [retryFindings, setRetryFindings] = useState<string[]>([]);
  const [cancelError, setCancelError] = useState<ApiError | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listAbortRef = useRef<AbortController | null>(null);
  const discoveryInFlight = useRef(false);
  const workspaceRef = useRef<HTMLElement | null>(null);

  useEffect(()=>{workspaceRef.current?.focus();},[]);

  const entries = useMemo(() => monitorEntries(jobs, discoveryJobs), [jobs, discoveryJobs]);
  const filteredEntries = useMemo(() => {
    const search = searchQuery.trim().toLocaleLowerCase();
    return entries.filter(entry => {
      if (filter !== "all" && entry.bucket !== filter) return false;
      if (!search) return true;
      const content = entry.kind === "discovery"
        ? [entry.session.name, entry.projectName, entry.session.lastRun?.stage,
          humanize(entry.session.lastRun?.stage ?? ""), entry.session.lastRun?.id]
        : [entry.job.jobKind, humanize(entry.job.jobKind),jobName(entry.job.jobKind,locale), entry.job.id];
      return content.some(value => value?.toLocaleLowerCase().includes(search));
    });
  }, [entries, filter, searchQuery, locale]);
  const selectedEntry = entries.find(entry => entry.key === selectedEntryKey) ?? null;
  const selectedJobId = detailOpen && selectedEntry?.kind === "pipeline" ? selectedEntry.job.id : null;
  const selectedJobView = selectedJobId && jobView?.job.id === selectedJobId ? jobView : null;
  const selectedJobIdRef = useRef(selectedJobId);
  useEffect(() => { selectedJobIdRef.current = selectedJobId; }, [selectedJobId]);

  const loadDiscoveryJobs = useCallback(async (signal?: AbortSignal) => {
    if (discoveryInFlight.current) return;
    if (projects.length === 0) {
      setDiscoveryJobs([]);setDiscoveryError(null);setDiscoveryLoading(false);return;
    }
    discoveryInFlight.current = true;
    try {
      const results = await Promise.allSettled(projects.map(project =>
        listDiscoverySessions(project.id, signal)));
      if (signal?.aborted) return;
      const available = results.flatMap((result, index) => result.status === "fulfilled"
        ? result.value.filter(session => session.lastRun).map(session =>
            ({ projectName: projects[index].name, session, stale: false })) : []);
      const failures = results.filter(result => result.status === "rejected").length;
      const unavailableProjectIds = new Set(results.flatMap((result, index) =>
        result.status === "rejected" ? [projects[index].id] : []));
      setDiscoveryJobs(previous => latestDiscoveryJobs([
        ...available,
        ...previous.filter(item => unavailableProjectIds.has(item.session.projectId))
          .map(item => ({ ...item, stale: true })),
      ]));
      setDiscoveryError(failures > 0
        ? (locale === "ja" ? `${failures} 件のプロジェクトの検索ジョブを取得できませんでした。`
          : `Could not load discovery jobs for ${failures} project(s).`)
        : null);
    } finally {
      discoveryInFlight.current = false;
      if (!signal?.aborted) setDiscoveryLoading(false);
    }
  }, [projects, locale]);

  const clearDetailRequest = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const loadList = useCallback((options?: { force?: boolean }) => {
    if (listAbortRef.current && !options?.force) return Promise.resolve();
    if (options?.force) listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;
    return listJobs({ signal: controller.signal })
      .then((data) => {
        if (listAbortRef.current !== controller || controller.signal.aborted) return;
        setJobs(data.jobs);
        setListError(null);
      })
      .catch((err) => {
        if (listAbortRef.current !== controller || controller.signal.aborted) return;
        setListError(err instanceof ApiError ? err : new ApiError("network", "unknown", String(err)));
      })
      .finally(() => {
        if (listAbortRef.current !== controller) return;
        listAbortRef.current = null;
        setListLoading(false);
      });
  }, []);

  const loadDetail = useCallback(
    (jobId: string, options?: { silent?: boolean }) => {
      clearDetailRequest();
      const controller = new AbortController();
      abortRef.current = controller;
      return getJob(jobId, { signal: controller.signal })
        .then((data) => {
          setJobView(data);
          setCheckedAt(new Date());
          setDetailError(null);
        })
        .catch((err) => {
          if (err instanceof ApiError && err.kind === "aborted") {
            return;
          }
          setDetailError(err instanceof ApiError ? err : new ApiError("network", "unknown", String(err)));
        })
        .finally(() => {
          if (abortRef.current === controller) {
            abortRef.current = null;
          }
          if (!options?.silent && !controller.signal.aborted) {
            setDetailLoading(false);
          }
        });
    },
    [clearDetailRequest],
  );

  useEffect(() => {
    const timer = setTimeout(loadList, 0);
    return () => {
      clearTimeout(timer);
      stopPolling();
      clearDetailRequest();
      listAbortRef.current?.abort();
      listAbortRef.current = null;
    };
  }, [loadList, stopPolling, clearDetailRequest]);

  useEffect(() => {
    const controller = new AbortController();
    const initial = setTimeout(() => { void loadDiscoveryJobs(controller.signal); }, 0);
    const interval = setInterval(() => { void loadDiscoveryJobs(controller.signal); }, POLL_INTERVAL_MS);
    return () => { controller.abort();clearTimeout(initial);clearInterval(interval); };
  }, [loadDiscoveryJobs]);

  useEffect(() => {
    const interval = setInterval(() => { void loadList(); }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadList]);

  useEffect(() => {
    stopPolling();
    if (!selectedJobId) {
      clearDetailRequest();
      return;
    }
    loadDetail(selectedJobId);
    return () => stopPolling();
  }, [selectedJobId, loadDetail, stopPolling, clearDetailRequest]);

  useEffect(() => {
    stopPolling();
    if (!selectedJobView) {
      return;
    }
    intervalRef.current = setInterval(() => {
      // Never abort an in-flight read: a detail response slower than the poll
      // interval would otherwise be cancelled by every tick and never finish.
      if (abortRef.current) return;
      loadDetail(selectedJobView.job.id, { silent: true });
    }, POLL_INTERVAL_MS);
    return () => stopPolling();
  }, [selectedJobView, loadDetail, stopPolling]);

  function handleSelectEntry(key: string) {
    setSelectedEntryKey(key);
    setDetailOpen(true);
    setDetailError(null);
    setCancelError(null);
    setRetryMessage(null);
    setRetryError(null);
    setRetryFindings([]);
  }

  function handleRefreshList() {
    setRefreshing(true);
    void Promise.allSettled([loadList({ force: true }), loadDiscoveryJobs()]).finally(() => setRefreshing(false));
  }

  function handleRetryDetail() {
    if (!selectedJobId) return;
    setDetailLoading(true);
    setDetailError(null);
    loadDetail(selectedJobId);
  }

  function handleCancelClick() {
    setCancelDialogOpen(true);
    setCancelError(null);
  }

  async function handleConfirmCancel() {
    if (!selectedJobView || cancelLoading) return;
    setCancelLoading(true);
    setCancelError(null);
    try {
      const data = await cancelJob(selectedJobView.job.id);
      setJobView(data);
      setCheckedAt(new Date());
      setDetailError(null);
      setCancelDialogOpen(false);
      loadList();
    } catch (err) {
      setCancelError(err instanceof ApiError ? err : new ApiError("network", "unknown", String(err)));
    } finally {
      setCancelLoading(false);
    }
  }

  async function handleRetryProduction() {
    if (!selectedJobView || retryLoading) return;
    const jobId = selectedJobView.job.id;
    setRetryLoading(true); setRetryError(null); setRetryMessage(null); setRetryFindings([]);
    try {
      const response = await fetch("/api/contentgen-video/jobs/retry", {
        method: "POST", headers: {"Content-Type":"application/json", "X-Contentgen-Director":"local-only"},
        body: JSON.stringify({jobId}), signal: AbortSignal.timeout(360_000),
      });
      const result: unknown = await response.json();
      if (selectedJobIdRef.current !== jobId) { void loadList(); return; }
      if (!response.ok || !result || typeof result !== "object" || !("started" in result) || result.started !== true ||
        !("jobId" in result) || result.jobId !== jobId) {
        const message = result && typeof result === "object" && "error" in result && typeof result.error === "string"
          ? result.error : (locale === "ja" ? "再試行を開始できませんでした。ローカル制作サービスを確認してください。" : "Could not start the retry. Check the local production service.");
        if (result && typeof result === "object" && "findings" in result && Array.isArray(result.findings)) {
          setRetryFindings(result.findings.flatMap((finding: unknown) => finding && typeof finding === "object" &&
            "message" in finding && typeof finding.message === "string" ? [finding.message] : []).slice(0,12));
        }
        if (result && typeof result === "object" && "changedInputs" in result && Array.isArray(result.changedInputs)) {
          setRetryFindings(result.changedInputs.filter((item: unknown): item is string => typeof item === "string").slice(0, 8));
        }
        throw new Error(message);
      }
      if (selectedJobIdRef.current !== jobId) { void loadList(); return; }
      setRetryMessage(locale === "ja" ? "再試行を開始しました。ジョブの状態を更新しています。" : "Retry started. Job status is updating.");
      await Promise.allSettled([loadDetail(jobId, {silent:true}), loadList()]);
    } catch (error) {
      if (selectedJobIdRef.current !== jobId) return;
      setRetryError(error instanceof Error && error.name === "TimeoutError"
        ? (locale === "ja" ? "再試行の確認がタイムアウトしました。ジョブの状態を確認してください。" : "Retry confirmation timed out. Check the job status before trying again.")
        : error instanceof TypeError ? (locale === "ja" ? "ローカル制作サービスに接続できません。起動して再試行してください。" : "Cannot reach the local production service. Start it and retry.")
        : error instanceof Error ? error.message : (locale === "ja" ? "再試行を開始できませんでした。" : "Could not start the retry."));
    } finally { setRetryLoading(false); }
  }

  const canRetry = selectedJobView?.job.jobKind === "video-production" &&
    (selectedJobView.job.state === "FAILED" || (selectedJobView.job.state === "RUNNING" &&
      !selectedJobView.nodes.some(node => node.state === "RUNNING") &&
      selectedJobView.nodes.some(node => node.state === "READY" && node.errorCode !== null)));
  const canCancel = selectedJobView != null && ACTIVE_STATES.includes(selectedJobView.job.state);
  const emptyList = !listLoading && !discoveryLoading && !listError && !discoveryError &&
    entries.length === 0;
  const orderedNodes = selectedJobView ? orderNodes(selectedJobView.nodes, selectedJobView.edges) : [];
  const failure = selectedJobView ? jobFailureSummary(selectedJobView, orderedNodes) : null;

  return (
    <section
      ref={workspaceRef}
      id="workspace"
      tabIndex={-1}
      aria-label={translate(locale, "navJobs")}
      className="flex min-h-0 flex-1 flex-col overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-surface">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <ListChecks aria-hidden className="size-[18px] text-muted-foreground" />
            {translate(locale, "jobsList")}
            {entries.some(entry => entry.bucket === "active") && (
              <span className="rounded-full bg-status-info/10 px-2 py-0.5 text-xs font-medium text-status-info">
                {entries.filter(entry => entry.bucket === "active").length} {locale === "ja" ? "件実行中" : "active"}
              </span>
            )}
          </h2>
          <Button
            variant="subtle"
            size="icon"
            aria-label={translate(locale, "jobsRefresh")}
            onClick={handleRefreshList}
            isLoading={refreshing}
            loadingLabel={translate(locale, "jobsRefreshing")}
          >
            <RefreshCw aria-hidden className="size-4" />
          </Button>
        </div>
        <div className="grid gap-3 border-b border-border bg-canvas/50 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6">
          <label className="relative block">
            <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <span className="sr-only">{locale === "ja" ? "ジョブを検索" : "Search jobs"}</span>
            <input
              type="search"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder={locale === "ja" ? "ジョブを検索" : "Search jobs"}
              className="h-9 w-full rounded-control border border-border bg-canvas pe-3 ps-9 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </label>
          <div role="group" aria-label={locale === "ja" ? "ジョブの状態で絞り込み" : "Filter job status"}
            className="flex gap-1 rounded-control border border-border bg-surface p-1">
            {(["all", "active", "attention", "finished"] as const).map(value => {
              const label = locale === "ja"
                ? { all: "すべて", active: "実行中", attention: "要確認", finished: "終了" }[value]
                : { all: "All", active: "Active", attention: "Attention", finished: "Finished" }[value];
              return <button key={value} type="button" aria-pressed={filter === value}
                aria-label={value === "attention" && locale === "en" ? "Needs attention" : undefined}
                onClick={() => setFilter(value)}
                className={`min-h-9 min-w-0 flex-1 rounded-control px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${filter === value
                  ? "bg-foreground text-canvas" : "text-muted-foreground hover:bg-surface-inset hover:text-foreground"}`}>
                {label}
              </button>;
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto" aria-live="off">
          {discoveryError && (
            <div role="alert" aria-label={locale === "ja" ? "検索状況" : "Discovery status"}
              className="m-3 rounded-control border border-status-warning/25 bg-status-warning/5 px-3 py-2 text-xs text-status-warning">
              {discoveryError}
              <button type="button" onClick={handleRefreshList}
                className="ms-2 font-semibold underline underline-offset-2">
                {locale === "ja" ? "再試行" : "Retry"}
              </button>
            </div>
          )}
          {listError && (
            <div className="mx-3 mt-3 rounded-control border border-danger/25 bg-danger/5 p-3 text-xs text-danger" role="alert">
              {failureMessage(listError, locale)}
              <button type="button" onClick={handleRefreshList} className="ms-2 font-semibold underline underline-offset-2">
                {locale === "ja" ? "再試行" : "Retry"}
              </button>
            </div>
          )}
          {(listLoading || discoveryLoading) && entries.length === 0 && (
            <p role="status" className="flex items-center gap-2 px-5 py-8 text-sm text-muted-foreground">
              <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
              {translate(locale, "loading")}
            </p>
          )}
          {emptyList && <EmptyState title={translate(locale, "jobsEmptyTitle")} description={translate(locale, "jobsEmptyBody")} />}
          {entries.length > 0 && filteredEntries.length === 0 && (
            <p className="px-5 py-8 text-sm text-muted-foreground">
              {locale === "ja" ? "条件に一致するジョブはありません。" : "No jobs match these filters."}
            </p>
          )}
          <ul aria-label={translate(locale, "jobsList")} className="divide-y divide-border/70">
            {filteredEntries.map(entry => {
              const selected = selectedEntry?.key === entry.key;
              const stage = entry.kind === "discovery" ? entry.session.lastRun?.stage : null;
              const subtitle = entry.kind === "discovery"
                ? entry.projectName : `${locale === "ja" ? "パイプライン" : "Pipeline"} · ${compactId(entry.job.id)}`;
              const absoluteTime = entry.kind === "discovery"
                ? formatRunTime(entry.session.lastRun?.updatedAt ?? entry.session.updatedAt, locale)
                : formatDateTime(entry.job.updatedAt, locale);
              return <li key={entry.key} className="min-w-0">
                <button type="button"
                  aria-current={selected ? "true" : undefined}
                  onClick={() => handleSelectEntry(entry.key)}
                  className={`group relative flex w-full min-w-0 items-start gap-4 px-4 py-4 text-start outline-none transition-colors sm:px-6 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selected
                    ? "bg-surface-inset/80" : "hover:bg-surface-subtle"}`}>
                  {selected && <span aria-hidden className="absolute inset-y-2 start-0 w-[3px] rounded-e-full bg-primary" />}
                  <span className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-control ${entry.bucket === "active"
                    ? "bg-status-info/10 text-status-info" : entry.bucket === "attention"
                      ? "bg-status-warning/10 text-status-warning" : "bg-surface-subtle text-muted-foreground"}`}>
                    {entry.kind === "discovery" ? <FileSearch aria-hidden className="size-[18px]" />
                      : <ListChecks aria-hidden className="size-[18px]" />}
                  </span>
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block truncate text-[15px] font-semibold text-foreground" title={monitorName(entry,locale)}>{monitorName(entry,locale)}</span>
                    <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
                    <span className="flex min-w-0 items-center gap-2 pt-1">
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${monitorBadgeClasses(entry)}`}>
                        {monitorStatus(entry, locale)}
                      </span>
                      {stage && <span className="min-w-0 truncate text-xs text-muted-foreground">{humanize(stage)}</span>}
                    </span>
                    {entry.kind === "discovery" && entry.stale && (
                      <span className="block text-xs text-status-warning">
                        {locale === "ja" ? "前回取得時点" : "Last known"}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-2">
                    <time title={absoluteTime} className="text-xs text-muted-foreground">{relativeTime(entry.updatedAt, locale)}</time>
                    <span className="flex items-center gap-1 text-xs font-medium text-foreground">{locale === "ja" ? "詳細を見る" : "View details"}<ChevronRight aria-hidden className="size-4" /></span>
                  </span>
                </button>
              </li>;
            })}
          </ul>
        </div>
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}
        title={locale === "ja" ? "ジョブの詳細" : "Job details"}
        size="lg" className="!max-w-6xl" closeLabel={locale === "ja" ? "閉じる" : "Close"}>
        <div className="min-w-0 space-y-5">
        {!selectedEntry && !listLoading && !discoveryLoading && (
          <EmptyState
            title={translate(locale, "jobsSelectTitle")}
            description={translate(locale, "jobsSelectBody")}
          />
        )}

        {selectedEntry?.kind === "discovery" && selectedEntry.session.lastRun && (
          <DiscoveryJobDetail locale={locale} entry={selectedEntry} />
        )}

        {selectedJobId && !detailError && (!selectedJobView || detailLoading) && (
          <Surface variant="outline" className="items-center justify-center py-8 text-center">
            <Loader2 aria-hidden className="mx-auto size-6 animate-spin motion-reduce:animate-none text-muted-foreground" />
            <p className="mt-2 text-foreground">{translate(locale, "loading")}</p>
          </Surface>
        )}

        {selectedJobId && detailError && !detailLoading && (
          <ApiErrorNotice
            error={detailError}
            locale={locale}
            onRetry={handleRetryDetail}
            message={failureMessage(detailError, locale)}
          />
        )}

        {selectedJobView && !detailLoading && (
          <div className="mx-auto grid w-full max-w-5xl gap-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {locale === "ja" ? "パイプラインジョブ" : "Pipeline job"}
                </p>
                <h2 className="font-serif text-3xl leading-tight text-foreground">{jobName(selectedJobView.job.jobKind,locale)}</h2>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground" title={selectedJobView.job.id}>
                  {compactId(selectedJobView.job.id)}
                </p>
              </div>
              <div className="flex min-w-0 flex-col items-start gap-1 text-sm text-muted-foreground sm:items-end">
                <span className="inline-flex flex-wrap items-center gap-1">
                  <Clock aria-hidden className="size-4 shrink-0" />
                  <span>{translate(locale, "jobsUpdatedAt")}:</span>
                  <span className="text-foreground">{formatDateTime(selectedJobView.job.updatedAt, locale)}</span>
                </span>
                {checkedAt && (
                  <span className="inline-flex flex-wrap items-center gap-1">
                    <span>{translate(locale, "jobsChecked")}:</span>
                    <span>{formatDateTime(checkedAt.toISOString(), locale)}</span>
                  </span>
                )}
                <span className="text-start sm:text-end">
                  {translate(locale, "jobsPolling")}
                </span>
              </div>
            </div>

            {failure && (
              <Surface variant="outline" className="border-danger/40 bg-danger/5">
                <div className="flex items-start gap-3">
                  <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" />
                  <div className="grid min-w-0 flex-1 gap-1">
                    <p className="font-medium text-foreground">{translate(locale, "jobsFailureSummary")}</p>
                    <p className="break-words text-sm text-foreground">
                      <span className="text-muted-foreground">{translate(locale, "jobsFailureNode")}: </span>
                      <span>{friendlyStage(failure.node.nodeKey)}</span>
                    </p>
                    {failure.errorCode && (
                      <p className="break-all text-sm text-danger">
                        {translate(locale, "jobsErrorCode")}: <code>{failure.errorCode}</code>
                      </p>
                    )}
                    {failure.errorDetail ? (
                      <p className="min-w-0 break-words text-sm text-foreground">
                        {attemptDetail(failure.errorDetail, locale)}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {translate(locale, "jobsFailureNoDetail")}
                      </p>
                    )}
                    {failure.failureCount > 1 && (
                      <p className="text-sm text-muted-foreground">
                        {failure.failureCount === 2
                          ? translate(locale, "jobsFailureMoreOne")
                          : translate(locale, "jobsFailureMore", { count: failure.failureCount - 1 })}
                      </p>
                    )}
                  </div>
                </div>
              </Surface>
            )}

            {retryError && <div role="alert" className="rounded-control border border-danger/40 bg-danger/5 p-3 text-sm text-danger"><p>{retryError}</p>{retryFindings.length > 0 && <ul className="mt-2 list-disc space-y-1 ps-5">{retryFindings.map((finding,index)=><li key={index}>{finding}</li>)}</ul>}</div>}
            {retryMessage && <p role="status" className="rounded-control border border-status-success/30 bg-status-success/5 p-3 text-sm text-foreground">{retryMessage}</p>}
            <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`rounded-full border px-2.5 py-1 text-sm font-medium ${stateBadgeClasses(selectedJobView.job.state)}`} title={selectedJobView.job.state}>
                  {stateLabel(selectedJobView.job.state, locale)}
                </span>
                <span className="text-sm text-muted-foreground">{translate(locale, "jobsCreated")}: {formatDateTime(selectedJobView.job.createdAt, locale)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
              {canRetry && <Button variant="outline" size="sm" onClick={()=>void handleRetryProduction()} isLoading={retryLoading}
                loadingLabel={locale === "ja" ? "再試行を準備中" : "Preparing retry"} disabled={retryLoading}>
                {locale === "ja" ? "制作を再試行" : "Retry production"}
              </Button>}
              {canCancel && <Button variant="destructive" size="sm" onClick={handleCancelClick} disabled={retryLoading} icon={<XCircle aria-hidden className="size-4" />}>
                {translate(locale, "jobsCancel")}
              </Button>}
              </div>
            </div>

            <QueueStatus jobView={selectedJobView} locale={locale} />
            <PipelineGraph nodes={orderedNodes} edges={selectedJobView.edges} locale={locale} />

            <Surface variant="outline">
              <h3 className="mb-3 font-medium text-foreground">{translate(locale, "jobsProgress")}</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
                <CountBox label={translate(locale, "jobsProgressTotal")} value={selectedJobView.progress.total} />
                <CountBox label={translate(locale, "jobsProgressPending")} value={selectedJobView.progress.pending} />
                <CountBox label={translate(locale, "jobsProgressReady")} value={selectedJobView.progress.ready} />
                <CountBox label={translate(locale, "jobsProgressRunning")} value={selectedJobView.progress.running} />
                <CountBox label={translate(locale, "jobsProgressSucceeded")} value={selectedJobView.progress.succeeded} />
                <CountBox label={translate(locale, "jobsProgressFailed")} value={selectedJobView.progress.failed} />
                <CountBox label={translate(locale, "jobsProgressCancelled")} value={selectedJobView.progress.cancelled} />
              </div>
            </Surface>

            <details className="group rounded-surface border border-border bg-surface px-4 py-3">
              <summary className="cursor-pointer text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{locale === "ja" ? "ジョブ情報" : "Job information"}</summary>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{translate(locale, "jobsJobId")}</dt><dd className="min-w-0 break-all font-mono select-all">{selectedJobView.job.id}</dd>
                <dt className="text-muted-foreground">{translate(locale, "jobsJobKind")}</dt><dd>{selectedJobView.job.jobKind}</dd>
                <dt className="text-muted-foreground">{translate(locale, "jobsCreated")}</dt><dd>{formatDateTime(selectedJobView.job.createdAt, locale)}</dd>
                <dt className="text-muted-foreground">{translate(locale, "jobsUpdatedAt")}</dt><dd>{formatDateTime(selectedJobView.job.updatedAt, locale)}</dd>
              </dl>
            </details>

            <div className="grid gap-3">
                <h3 className="font-medium text-foreground">{translate(locale, "jobsNodes")}</h3>
                {selectedJobView.nodes.length === 0 ? (
                  <Surface variant="outline" className="border-status-warning/40 bg-status-warning/5">
                    <div className="flex items-start gap-2">
                      <AlertTriangle aria-hidden className="mt-0.5 size-4 text-status-warning" />
                      <p className="text-foreground">{translate(locale, "jobsNoNodes")}</p>
                    </div>
                  </Surface>
                ) : (
                  <div className="grid gap-3">
                    {orderedNodes.map((node) => (
                      <div key={node.id} id={`job-node-${node.id}`} role="region" aria-label={friendlyStage(node.nodeKey)} tabIndex={-1} className="rounded-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <NodeCard
                        key={node.id}
                        node={node}
                        locale={locale}
                        nodes={selectedJobView.nodes}
                        edges={selectedJobView.edges}
                        attempts={selectedJobView.attempts.filter((a) => a.nodeId === node.id)}
                      />
                      </div>
                    ))}
                  </div>
                )}
              </div>
          </div>
        )}
        </div>
      </Dialog>

      <Dialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        title={translate(locale, "jobsCancel")}
        description={translate(locale, "jobsCancelConfirm")}
        size="sm"
      >
        <div className="grid gap-4">
          {cancelError && (
            <Surface variant="outline" role="alert" className="border-danger/40 bg-danger/5">
              <div className="flex items-start gap-2">
                <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
                <div className="grid min-w-0 gap-1">
                  <p className="font-medium text-foreground">{translate(locale, "jobsCancelFailed")}</p>
                  <p className="break-words text-sm text-foreground">{translate(locale, "jobsCancelFailedBody")}</p>
                  <p className="break-words text-sm text-muted-foreground">
                    {failureMessage(cancelError, locale)}
                  </p>
                  <p className="break-all text-sm text-muted-foreground">
                    {translate(locale, "errorCode")}:{" "}
                    <code className="text-foreground">{cancelError.code}</code>
                    {cancelError.status != null && (
                      <>
                        {" · "}
                        {translate(locale, "httpStatus")}:{" "}
                        <span className="text-foreground">{cancelError.status}</span>
                      </>
                    )}
                  </p>
                  {cancelError.hint && (
                    <p className="break-words text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{translate(locale, "errorServerDetail")}: </span>
                      {cancelError.hint}
                    </p>
                  )}
                </div>
              </div>
            </Surface>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>
              {translate(locale, "jobsCancelNo")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmCancel}
              isLoading={cancelLoading}
              loadingLabel={translate(locale, "jobsCancelling")}
            >
              {translate(locale, "jobsCancelYes")}
            </Button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}

function DiscoveryJobDetail({ entry, locale }: {
  entry: Extract<MonitorEntry, { kind: "discovery" }>;
  locale: Locale;
}) {
  const { session, projectName } = entry;
  const run = session.lastRun;
  if (!run) return null;
  const health = Object.entries(run.providerHealth ?? {});
  const ideaCount = session.ideaCount ?? 0;
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {locale === "ja" ? "検索ジョブ · " : "Discovery search · "}{projectName}
          </p>
          <h2 className="font-serif text-3xl leading-tight text-foreground [overflow-wrap:anywhere]">{session.name}</h2>
        </div>
        <span className={`mt-1 rounded-full border px-3 py-1 text-sm font-medium ${monitorBadgeClasses(entry)}`}>
          {discoveryStatus(run.status, locale)}
        </span>
      </header>

      {entry.stale && (
        <p role="status" className="rounded-control border border-status-warning/25 bg-status-warning/5 px-3 py-2 text-sm text-status-warning">
          {locale === "ja" ? "プロジェクトに接続できません。前回取得した状態を表示しています。"
            : "Project unavailable. Showing the last known status."}
        </p>
      )}

      {run.errorCode && (
        <div role="alert" className="flex items-start gap-3 rounded-surface border border-danger/30 bg-danger/5 px-4 py-3">
          <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{locale === "ja" ? "検索の問題" : "Discovery needs attention"}</p>
            <p className="mt-1 break-all font-mono text-sm text-danger">{run.errorCode}</p>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(160px,1fr)]">
        <section aria-label={locale === "ja" ? "現在の処理" : "Current stage"}
          className="min-w-0 rounded-surface border border-border bg-surface p-5">
          <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
            {locale === "ja" ? "現在の処理" : "Current stage"}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <span className={`flex size-10 shrink-0 items-center justify-center rounded-control ${run.status === "cancelled"
              ? "bg-surface-subtle text-muted-foreground" : entry.bucket === "active"
              ? "bg-status-info/10 text-status-info" : entry.bucket === "attention"
                ? "bg-status-warning/10 text-status-warning" : "bg-status-success/10 text-status-success"}`}>
              {run.status === "cancelled" ? <XCircle aria-hidden className="size-5" />
                : entry.bucket === "active" ? <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
                : entry.bucket === "attention" ? <AlertTriangle aria-hidden className="size-5" />
                  : <CheckCircle2 aria-hidden className="size-5" />}
            </span>
            <h3 className="min-w-0 text-lg font-semibold text-foreground [overflow-wrap:anywhere]">{humanize(run.stage)}</h3>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {locale === "ja" ? "最終更新" : "Last updated"} · {formatRunTime(run.updatedAt, locale)}
          </p>
        </section>
        <section aria-label={locale === "ja" ? "セッション内のアイデア" : "Ideas in session"}
          className="rounded-surface border border-border bg-surface p-5">
          <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
            {locale === "ja" ? "セッション内のアイデア" : "Ideas in session"}
          </p>
          <p className="mt-2 font-serif text-4xl tabular-nums text-foreground">{ideaCount}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {locale === "ja" ? `セッション内のアイデア: ${ideaCount} 件`
              : `${ideaCount} ideas in this session`}
          </p>
        </section>
      </div>

      <section aria-label={locale === "ja" ? "実行情報" : "Run information"}
        className="rounded-surface border border-border bg-surface px-5 py-4">
        <h3 className="mb-4 text-sm font-semibold text-foreground">{locale === "ja" ? "実行情報" : "Run information"}</h3>
        <dl className="grid gap-x-5 gap-y-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
          <dt className="text-muted-foreground">{locale === "ja" ? "開始日時" : "Started"}</dt>
          <dd className="text-foreground">{formatRunTime(run.createdAt, locale)}</dd>
          <dt className="text-muted-foreground">{locale === "ja" ? "実行 ID" : "Run ID"}</dt>
          <dd className="break-all font-mono text-xs text-foreground select-all">{run.id}</dd>
          <dt className="text-muted-foreground">{locale === "ja" ? "プロジェクト" : "Project"}</dt>
          <dd className="text-foreground">{projectName}</dd>
        </dl>
      </section>

      {health.length > 0 && (
        <section aria-label={locale === "ja" ? "プロバイダーの状態" : "Provider health"}
          className="rounded-surface border border-border bg-surface px-5 py-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">
            {locale === "ja" ? "プロバイダーの状態" : "Provider health"}
          </h3>
          <dl className="grid gap-2 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            {health.map(([provider, status]) => <div key={provider} className="contents">
              <dt className="break-words text-muted-foreground">{provider}</dt>
              <dd className="break-words text-foreground">{formatDiscoveryProviderHealth(status, locale)}</dd>
            </div>)}
          </dl>
        </section>
      )}
    </div>
  );
}

function CountBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-control border border-border bg-surface px-3 py-2 text-center">
      <p className="text-2xl font-medium text-foreground">{value}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

/** Persisted node state is the queue view: READY has no worker claim;
 * RUNNING has a claimed attempt. No queue position or start ETA is stored. */
function QueueStatus({jobView, locale}: {jobView: JobView; locale: Locale}) {
  const queued = jobView.nodes.filter(node => node.state === "READY");
  const running = jobView.nodes.filter(node => node.state === "RUNNING");
  const pending = jobView.nodes.filter(node => node.state === "PENDING");
  return <section aria-label={locale === "ja" ? "待機と実行状況" : "Queue and worker status"} className="rounded-surface border border-border bg-surface p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-base font-semibold">{locale === "ja" ? "待機と実行状況" : "Queue and worker status"}</h3><span className="text-xs font-medium tabular-nums text-muted-foreground">{locale === "ja" ? "実行中" : "Active steps"}: {queued.length + running.length}</span></div>
    <p className="mt-1 text-sm text-muted-foreground">{locale === "ja" ? "保存された状態を表示しています。待ち順と開始予定時刻は記録されていません。" : "Based on saved job state. Queue position and start time are not recorded."}</p>
    <div className="mt-4 grid gap-3 md:grid-cols-3">
      {([ [locale === "ja" ? "実行待ち" : "Ready for a worker", queued], [locale === "ja" ? "実行中" : "Running", running], [locale === "ja" ? "依存待ち" : "Waiting for dependencies", pending] ] as const).map(([title, items]) =>
        <div key={title} className="rounded-control border border-border bg-canvas p-4">
          <h4 className="flex items-center justify-between gap-2 text-sm font-semibold">{title} <span className="rounded-full bg-surface-inset px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{items.length}</span></h4>
          {items.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">{locale === "ja" ? "なし" : "None"}</p> :
            <ul className="mt-2 space-y-3">{items.map(node => <li key={node.id} className="text-sm">
              <p className="font-medium break-words">{friendlyStage(node.nodeKey)}</p>
              <p className="mt-1 text-muted-foreground">{node.state === "READY" && node.attemptCount > 0 && node.errorCode
                ? (locale === "ja" ? "再試行はまだワーカーに取得されていません。開始時刻は不明です。長く変わらない場合はローカル制作サービスを確認し、「制作を再試行」を選択してください。" : "No worker has claimed this retry. Its start time is unknown. If it stays here, check the local production service and select Retry production.")
                : node.state === "READY" ? (locale === "ja" ? "ワーカーの取得を待っています。" : "Waiting for a worker to claim this step.")
                : node.state === "RUNNING" ? (locale === "ja" ? `試行 ${node.attemptCount} は実行中と記録されています。ワーカーの稼働は未確認です。` : `Attempt ${node.attemptCount} is recorded as running; worker liveness is not verified.`)
                : (locale === "ja" ? "先行ステップの完了を待っています。" : "Waiting for prerequisite steps to finish.")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{locale === "ja" ? "最終更新" : "Last updated"}: {formatDateTime(node.updatedAt, locale)}</p>
            </li>)}</ul>}
        </div>)}
    </div>
  </section>;
}

/** Layered dependency graph: each edge comes from the persisted DAG. */
function PipelineGraph({nodes, edges, locale}: {nodes: JobNode[]; edges: JobEdge[]; locale: Locale}) {
  const depths = new Map<string, number>();
  const rows = new Map<number, number>();
  const positions = new Map<string, {x:number;y:number}>();
  const nodeWidth = 190, nodeHeight = 80, columnWidth = 240, rowHeight = 110;
  for (const node of nodes) {
    const parents = edges.filter(edge => edge.toNodeId === node.id && depths.has(edge.fromNodeId));
    const depth = parents.length ? Math.max(...parents.map(edge => (depths.get(edge.fromNodeId) ?? 0) + 1)) : 0;
    depths.set(node.id, depth);
    const row = rows.get(depth) ?? 0;
    rows.set(depth, row + 1);
    positions.set(node.id, {x: 16 + depth * columnWidth, y: 16 + row * rowHeight});
  }
  const width = Math.max(220, 32 + (Math.max(0, ...depths.values()) * columnWidth) + nodeWidth);
  const height = Math.max(112, 32 + Math.max(0, ...rows.values()) * rowHeight - (rowHeight - nodeHeight));
  return <section aria-label={locale === "ja" ? "パイプライングラフ" : "Pipeline graph"} className="min-w-0 rounded-surface border border-border bg-surface p-4 sm:p-5">
    <h3 className="text-base font-semibold">{locale === "ja" ? "パイプライングラフ" : "Pipeline graph"}</h3>
    <p className="mt-1 text-sm text-muted-foreground">{locale === "ja" ? "矢印は依存関係を示します。スクロールして全体を確認し、ステップを選択すると詳細に移動します。" : "Arrows show dependencies. Scroll to see the whole graph, and select a step to inspect its details."}</p>
    {nodes.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">{translate(locale, "jobsNoNodes")}</p> :
      <div className="mt-4 max-w-full overflow-auto rounded-control border border-border bg-surface-subtle" tabIndex={0}>
        <div className="relative" style={{width, height}}>
          <svg className="absolute inset-0" width={width} height={height} aria-hidden="true">
            <defs><marker id="job-graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
            {edges.map((edge,index) => {const from=positions.get(edge.fromNodeId),to=positions.get(edge.toNodeId); if(!from||!to)return null;
              const x1=from.x+nodeWidth,y1=from.y+nodeHeight/2,x2=to.x,y2=to.y+nodeHeight/2,mid=(x1+x2)/2;
              return <path key={`${edge.fromNodeId}-${edge.toNodeId}-${index}`} data-edge="" d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`} fill="none" stroke="currentColor" strokeWidth="1.5" markerEnd="url(#job-graph-arrow)" className="text-muted-foreground" />;
            })}
          </svg>
          {nodes.map(node => {const position=positions.get(node.id)!; return <button type="button" key={node.id}
            onClick={()=>{const detail=document.getElementById(`job-node-${node.id}`);detail?.scrollIntoView?.({block:"center",behavior:"auto"});detail?.focus({preventScroll:true});}}
            title={friendlyStage(node.nodeKey)}
            className="absolute flex flex-col items-start justify-center gap-2 rounded-control border border-border bg-surface px-3 text-start shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-primary hover:bg-surface-elevated"
            style={{left:position.x,top:position.y,width:nodeWidth,height:nodeHeight}}>
            <span className="line-clamp-2 text-sm font-semibold">{friendlyStage(node.nodeKey)}</span>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${stateBadgeClasses(node.state)}`}>{node.state === "RUNNING" && <Loader2 data-running-indicator="" aria-hidden className="size-3 animate-spin motion-reduce:animate-none" />}{nodeStateLabel(node,locale)}</span>
          </button>;})}
        </div>
      </div>}
  </section>;
}

function nodeStateLabel(node: JobNode, locale: Locale): string {
  if (node.state === "FAILED" && node.attemptCount > 0) {
    return node.attemptCount === 1
      ? translate(locale, "jobsFailedAfterOneAttempt")
      : translate(locale, "jobsFailedAfterAttempts", { count: node.attemptCount });
  }
  if (node.state === "READY" && node.attemptCount > 0 && node.errorCode) {
    return locale === "ja" ? "再試行を待機中" : "Retry queued";
  }
  if (node.attemptCount > 1 && !isTerminal(node.state)) {
    const retrying = translate(locale, "jobsRetrying", {
      used: node.attemptCount,
      max: node.maxAttempts,
    });
    return `${stateLabel(node.state, locale)} · ${retrying}`;
  }
  return stateLabel(node.state, locale);
}

function NodeCard({
  node,
  locale,
  nodes,
  edges,
  attempts,
}: {
  node: JobNode;
  locale: Locale;
  nodes: JobNode[];
  edges: JobEdge[];
  attempts: JobAttempt[];
}) {
  const incoming = edges.filter((e) => e.toNodeId === node.id);
  const firstTrySuccess = node.state === "SUCCEEDED" && node.attemptCount === 1 && attempts.length === 1 &&
    attempts[0].attemptNumber === 1 && attempts[0].state === "SUCCEEDED";
  const sceneId=node.input&&typeof node.input==="object"&&"sceneId" in node.input&&
    typeof node.input.sceneId==="string"&&/^[\w.-]{1,80}$/u.test(node.input.sceneId)?node.input.sceneId:null;

  return (
    <Surface variant="solid">
      <div className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="break-words font-medium text-foreground">{friendlyStage(node.nodeKey)}</span>
          <span
            className={`rounded-full border px-2 py-0.5 text-sm font-medium ${stateBadgeClasses(node.state)}`}
            title={node.state}
          >
            {nodeStateLabel(node, locale)}
          </span>
        </div>
        {sceneId&&<p className="break-words text-sm text-muted-foreground">Scene: {sceneId}</p>}
        {!firstTrySuccess && <p className="break-words text-sm text-muted-foreground">
          {translate(locale, "jobsAttemptsUsed", {
            used: node.attemptCount,
            max: node.maxAttempts,
          })}
        </p>}
        {node.errorCode && (
          <p className="break-all text-sm text-danger">
            {translate(locale, "jobsErrorCode")}: {node.errorCode}
          </p>
        )}

        {incoming.length > 0 && (
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">{translate(locale, "jobsEdges")}</p>
            <ul className="mt-1 list-disc space-y-1 ps-4 text-sm text-muted-foreground">
              {incoming.map((edge, i) => {
                const fromLabel = nodeLabel(nodes, edge.fromNodeId);
                const toLabel = nodeLabel(nodes, edge.toNodeId);
                return (
                  <li
                    key={`${edge.fromNodeId}-${edge.toNodeId}-${edge.edgeKind}-${i}`}
                    className="min-w-0 [overflow-wrap:anywhere]"
                  >
                    {formatEdgeKind(edge.edgeKind, locale)}:{" "}
                    <span
                      className="font-mono"
                      title={fromLabel === edge.fromNodeId ? undefined : edge.fromNodeId}
                    >
                      {fromLabel}
                    </span>{" "}
                    <span aria-hidden>→</span>{" "}
                    <span
                      className="font-mono"
                      title={toLabel === edge.toNodeId ? undefined : edge.toNodeId}
                    >
                      {toLabel}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {node.output !== null && typeof node.output === "object" && "timingAdjustments" in node.output &&
          Array.isArray(node.output.timingAdjustments) && node.output.timingAdjustments.length > 0 && (
          <div className="rounded-control bg-status-info/10 p-3 text-sm text-foreground">
            <p className="font-medium">{locale === "ja" ? "自動でシーンの長さを調整" : "Scene duration adjusted automatically"}</p>
            <ul className="mt-1 list-disc ps-5">{node.output.timingAdjustments.map((value: unknown,index: number) => {
              if(!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string" ||
                !("addedPauseMs" in value) || typeof value.addedPauseMs !== "number") return null;
              return <li key={index}>{locale === "ja" ? `シーン ${value.id}: 無音を ${value.addedPauseMs} ミリ秒追加` :
                `Scene ${value.id}: added ${value.addedPauseMs} ms of silence after narration.`}</li>;
            })}</ul>
          </div>
        )}
        {firstTrySuccess ? <AttemptTimeRange attempt={attempts[0]} locale={locale} /> : <div className="min-w-0">
          <p className="mb-2 text-sm font-semibold text-foreground">{translate(locale, "jobsAttempts")}</p>
          {attempts.length === 0 ? <p className="text-sm text-muted-foreground">{translate(locale, "jobsNoAttempts")}</p> :
            <div className="grid gap-2">{attempts.slice().sort((a,b)=>a.attemptNumber-b.attemptNumber)
              .map(attempt=><AttemptCard key={attempt.id} attempt={attempt} locale={locale} nodes={nodes}/>)}</div>}
        </div>}
      </div>
    </Surface>
  );
}

function AttemptTimeRange({attempt, locale}: {attempt: JobAttempt; locale: Locale}) {
  const start = new Date(attempt.startedAt);
  const end = attempt.finishedAt ? new Date(attempt.finishedAt) : null;
  const validStart = Number.isFinite(start.getTime());
  const validEnd = end !== null && Number.isFinite(end.getTime());
  const sameDay = validStart && validEnd && start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() && start.getDate() === end.getDate() &&
    start.getTimezoneOffset() === end.getTimezoneOffset();
  const showSeconds = sameDay && start.getTime() !== end.getTime() &&
    Math.floor(start.getTime() / 60000) === Math.floor(end.getTime() / 60000);
  const language = locale === "ja" ? "ja-JP" : "en-US";
  const full = new Intl.DateTimeFormat(language, {year:"numeric",month:"short",day:"numeric",
    hour:"2-digit",minute:"2-digit",...(showSeconds ? {second:"2-digit"} : {})});
  const clock = new Intl.DateTimeFormat(language, {hour:"2-digit",minute:"2-digit",
    ...(showSeconds ? {second:"2-digit"} : {})});
  const startText = validStart ? full.format(start) : attempt.startedAt;
  const endText = end && validEnd ? (sameDay ? clock.format(end) : full.format(end)) : attempt.finishedAt;
  const label = `${translate(locale, "jobsStarted")}: ${startText}${endText ? `; ${translate(locale, "jobsFinished")}: ${validEnd && end ? full.format(end) : endText}` : ""}`;
  return <p role="group" aria-label={label} title={label} className="flex flex-wrap items-center gap-x-1.5 text-sm tabular-nums text-muted-foreground">
    <Clock aria-hidden className="size-4 shrink-0" />
    {!endText && <span>{translate(locale, "jobsStarted")}</span>}
    <time dateTime={attempt.startedAt}>{startText}</time>
    {endText && <><span aria-hidden>–</span><time dateTime={attempt.finishedAt ?? undefined}>{endText}</time></>}
  </p>;
}

function AttemptCard({
  attempt,
  locale,
  nodes,
}: {
  attempt: JobAttempt;
  locale: Locale;
  nodes: JobNode[];
}) {
  const node = nodes.find((n) => n.id === attempt.nodeId);
  return (
    <Surface variant="outline">
      <div className="grid min-w-0 gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <AttemptStateIcon state={attempt.state} />
            <span className="font-medium text-foreground">
              {node
                ? translate(locale, "jobsAttemptNumber", {
                    number: attempt.attemptNumber,
                    max: node.maxAttempts,
                  })
                : translate(locale, "attemptNumber", { number: attempt.attemptNumber })}
            </span>
          </div>
          <span
            className={`rounded-full border px-2 py-0.5 text-sm font-medium ${attemptStateBadgeClasses(attempt.state)}`}
            title={attempt.state}
          >
            {stateLabel(attempt.state, locale)}
          </span>
        </div>
        <AttemptTimeRange attempt={attempt} locale={locale} />
        {attempt.errorCode && <p className="break-all text-sm text-danger">{translate(locale, "jobsErrorCode")}: {attempt.errorCode}</p>}
        {attempt.errorDetail && (
          <div className="min-w-0 rounded-control bg-surface-subtle p-2 text-sm text-foreground [overflow-wrap:anywhere]">
            <span className="font-medium">{translate(locale, "jobsErrorDetail")}:</span>{" "}
            {attemptDetail(attempt.errorDetail, locale)}
          </div>
        )}
      </div>
    </Surface>
  );
}
