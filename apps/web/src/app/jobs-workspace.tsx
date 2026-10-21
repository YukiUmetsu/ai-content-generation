import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  ListChecks,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { ApiErrorNotice } from "./api-error-notice";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Surface } from "@/components/ui/surface-card";
import { EmptyState } from "@/app/empty-state";
import { translate, formatDateTime } from "@/i18n/messages";
import { listJobs, getJob, cancelJob, ApiError } from "@/lib/api/client";
import type { Job, JobNode, JobAttempt, JobView, JobState, JobEdge, EdgeKind } from "@/lib/api/types";
import type { Locale } from "@/features/registry";

interface JobsWorkspaceProps {
  locale: Locale;
}

const POLL_INTERVAL_MS = 5000;
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
 * Backend order is not meaningful to the operator: surface live work first.
 * Non-terminal jobs come before terminal ones; terminals are newest-updated
 * first. The comparator is stable enough because the API order breaks ties.
 */
function sortJobs(jobs: Job[]): Job[] {
  const stateRank = (state: JobState): number => {
    if (state === "RUNNING") return 0;
    if (state === "READY") return 1;
    if (state === "PENDING") return 2;
    return 3;
  };
  return jobs
    .map((job, index) => ({ job, index }))
    .sort((a, b) => {
      const terminalDelta = Number(isTerminal(a.job.state)) - Number(isTerminal(b.job.state));
      if (terminalDelta !== 0) return terminalDelta;
      const rankDelta = stateRank(a.job.state) - stateRank(b.job.state);
      if (rankDelta !== 0) return rankDelta;
      const aTime = safeTime(a.job.updatedAt);
      const bTime = safeTime(b.job.updatedAt);
      if (aTime !== bTime) {
        if (aTime === Number.NEGATIVE_INFINITY) return 1;
        if (bTime === Number.NEGATIVE_INFINITY) return -1;
        return bTime - aTime;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.job);
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

/** Map opaque node ids to their operator-facing keys, falling back to the id. */
function nodeLabel(nodes: JobNode[], nodeId: string): string {
  return nodes.find((node) => node.id === nodeId)?.nodeKey ?? nodeId;
}

/** Compact list identity: the last 12 characters, with the full id in `title`. */
function compactId(id: string): string {
  return id.length > 12 ? `…${id.slice(-12)}` : id;
}

/** Localized explanation for a failed request, keeping the server code visible. */
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
      return <Loader2 aria-hidden className="size-4 animate-spin text-status-info" />;
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function formatEdgeKind(kind: EdgeKind, locale: Locale): string {
  return kind === "dependency" ? translate(locale, "jobsEdgeDependency") : translate(locale, "jobsEdgeData");
}

export function JobsWorkspace({ locale }: JobsWorkspaceProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<ApiError | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobView, setJobView] = useState<JobView | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<ApiError | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelError, setCancelError] = useState<ApiError | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  const loadList = useCallback(() => {
    setListError(null);
    return listJobs()
      .then((data) => {
        setJobs(data.jobs);
      })
      .catch((err) => {
        setListError(err instanceof ApiError ? err : new ApiError("network", "unknown", String(err)));
      })
      .finally(() => {
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
    };
  }, [loadList, stopPolling, clearDetailRequest]);

  useEffect(() => {
    stopPolling();
    if (!selectedJobId) {
      return;
    }
    loadDetail(selectedJobId);
    return () => stopPolling();
  }, [selectedJobId, loadDetail, stopPolling]);

  useEffect(() => {
    stopPolling();
    if (!jobView || isTerminal(jobView.job.state)) {
      return;
    }
    intervalRef.current = setInterval(() => {
      loadDetail(jobView.job.id, { silent: true });
    }, POLL_INTERVAL_MS);
    return () => stopPolling();
  }, [jobView, loadDetail, stopPolling]);

  function handleSelectJob(jobId: string) {
    if (jobId === selectedJobId) return;
    setSelectedJobId(jobId);
    setJobView(null);
    setCheckedAt(null);
    setDetailLoading(true);
    setDetailError(null);
    setCancelError(null);
  }

  function handleRefreshList() {
    setListLoading(true);
    loadList();
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
    if (!jobView || cancelLoading) return;
    setCancelLoading(true);
    setCancelError(null);
    try {
      const data = await cancelJob(jobView.job.id);
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

  const canCancel = jobView != null && ACTIVE_STATES.includes(jobView.job.state);
  const sortedJobs = sortJobs(jobs);
  const orderedNodes = jobView ? orderNodes(jobView.nodes, jobView.edges) : [];
  const failure = jobView ? jobFailureSummary(jobView, orderedNodes) : null;

  return (
    <section
      id="workspace"
      aria-label={translate(locale, "navJobs")}
      className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row"
    >
      <div className="flex min-h-0 flex-col border-b border-border bg-surface lg:w-80 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 font-medium text-foreground">
            <ListChecks aria-hidden className="size-5" />
            {translate(locale, "jobsList")}
          </h2>
          <Button
            variant="subtle"
            size="icon"
            aria-label={translate(locale, "jobsRefresh")}
            onClick={handleRefreshList}
            isLoading={listLoading}
            loadingLabel={translate(locale, "jobsRefreshing")}
          >
            <RefreshCw aria-hidden className="size-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-auto p-3">
          {listLoading && (
            <Surface variant="outline" className="items-center justify-center py-8 text-center">
              <Loader2 aria-hidden className="mx-auto size-6 animate-spin text-muted-foreground" />
              <p className="mt-2 text-foreground">{translate(locale, "loading")}</p>
            </Surface>
          )}

          {listError && !listLoading && (
            <ApiErrorNotice
              error={listError}
              locale={locale}
              onRetry={handleRefreshList}
              message={failureMessage(listError, locale)}
            />
          )}

          {!listLoading && sortedJobs.length === 0 && !listError && (
            <EmptyState
              title={translate(locale, "jobsEmptyTitle")}
              description={translate(locale, "jobsEmptyBody")}
            />
          )}

          {sortedJobs.length > 0 && !listLoading && (
            <ul className="grid gap-2" aria-label={translate(locale, "jobsList")}>
              {sortedJobs.map((job) => {
                const selected = selectedJobId === job.id;
                return (
                  <li key={job.id} className="min-w-0">
                    <Surface
                      variant={selected ? "solid" : "ghost"}
                      interactive
                      onClick={() => handleSelectJob(job.id)}
                      aria-current={selected ? "true" : undefined}
                      className="w-full text-start"
                    >
                      <div className="grid min-w-0 gap-1 px-4 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className="min-w-0 truncate font-mono text-sm font-medium text-foreground"
                            title={job.id}
                          >
                            {compactId(job.id)}
                          </span>
                          <span
                            className={`shrink-0 rounded-full border px-2 py-0.5 text-sm font-medium ${stateBadgeClasses(job.state)}`}
                            title={job.state}
                          >
                            {stateLabel(job.state, locale)}
                          </span>
                        </div>
                        <p className="break-words text-sm text-muted-foreground">{job.jobKind}</p>
                        <p className="text-sm text-muted-foreground">
                          {translate(locale, "jobsUpdatedAt")}: {formatDateTime(job.updatedAt, locale)}
                        </p>
                      </div>
                    </Surface>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto bg-canvas p-4">
        {!selectedJobId && !detailLoading && (
          <EmptyState
            title={translate(locale, "jobsSelectTitle")}
            description={translate(locale, "jobsSelectBody")}
          />
        )}

        {detailLoading && (
          <Surface variant="outline" className="items-center justify-center py-8 text-center">
            <Loader2 aria-hidden className="mx-auto size-6 animate-spin text-muted-foreground" />
            <p className="mt-2 text-foreground">{translate(locale, "loading")}</p>
          </Surface>
        )}

        {detailError && !detailLoading && (
          <ApiErrorNotice
            error={detailError}
            locale={locale}
            onRetry={handleRetryDetail}
            message={failureMessage(detailError, locale)}
          />
        )}

        {jobView && !detailLoading && (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-serif text-2xl text-foreground">{translate(locale, "jobsTitle")}</h2>
                <p className="break-words text-sm text-muted-foreground">{translate(locale, "jobsIntro")}</p>
              </div>
              <div className="flex min-w-0 flex-col items-start gap-1 text-sm text-muted-foreground sm:items-end">
                <span className="inline-flex flex-wrap items-center gap-1">
                  <Clock aria-hidden className="size-4 shrink-0" />
                  <span>{translate(locale, "jobsUpdatedAt")}:</span>
                  <span className="text-foreground">{formatDateTime(jobView.job.updatedAt, locale)}</span>
                </span>
                {checkedAt && (
                  <span className="inline-flex flex-wrap items-center gap-1">
                    <span>{translate(locale, "jobsChecked")}:</span>
                    <span>{formatDateTime(checkedAt.toISOString(), locale)}</span>
                  </span>
                )}
                <span className="text-start sm:text-end">
                  {isTerminal(jobView.job.state)
                    ? translate(locale, "jobsStopped")
                    : translate(locale, "jobsPolling")}
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
                      <span className="font-mono">{failure.node.nodeKey}</span>{" "}
                      <span className="text-muted-foreground">({failure.node.nodeKind})</span>
                    </p>
                    {failure.errorCode && (
                      <p className="break-all text-sm text-danger">
                        {translate(locale, "jobsErrorCode")}: <code>{failure.errorCode}</code>
                      </p>
                    )}
                    {failure.errorDetail ? (
                      <p className="min-w-0 truncate text-sm text-foreground" title={failure.errorDetail}>
                        {failure.errorDetail}
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

            <Surface variant="outline">
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-sm font-medium ${stateBadgeClasses(jobView.job.state)}`}
                    title={jobView.job.state}
                  >
                    {stateLabel(jobView.job.state, locale)}
                  </span>
                  {canCancel && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleCancelClick}
                      icon={<XCircle aria-hidden className="size-4" />}
                    >
                      {translate(locale, "jobsCancel")}
                    </Button>
                  )}
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">{translate(locale, "jobsJobId")}</dt>
                  <dd className="min-w-0 break-all font-mono text-foreground select-all">{jobView.job.id}</dd>
                  <dt className="text-muted-foreground">{translate(locale, "jobsJobKind")}</dt>
                  <dd className="text-foreground">{jobView.job.jobKind}</dd>
                  <dt className="text-muted-foreground">{translate(locale, "jobsCreated")}</dt>
                  <dd className="text-foreground">{formatDateTime(jobView.job.createdAt, locale)}</dd>
                  <dt className="text-muted-foreground">{translate(locale, "jobsUpdatedAt")}</dt>
                  <dd className="text-foreground">{formatDateTime(jobView.job.updatedAt, locale)}</dd>
                </dl>
              </div>
            </Surface>

            <Surface variant="outline">
              <h3 className="mb-2 font-medium text-foreground">{translate(locale, "jobsProgress")}</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                <CountBox label={translate(locale, "jobsProgressTotal")} value={jobView.progress.total} />
                <CountBox label={translate(locale, "jobsProgressPending")} value={jobView.progress.pending} />
                <CountBox label={translate(locale, "jobsProgressReady")} value={jobView.progress.ready} />
                <CountBox label={translate(locale, "jobsProgressRunning")} value={jobView.progress.running} />
                <CountBox label={translate(locale, "jobsProgressSucceeded")} value={jobView.progress.succeeded} />
                <CountBox label={translate(locale, "jobsProgressFailed")} value={jobView.progress.failed} />
                <CountBox label={translate(locale, "jobsProgressCancelled")} value={jobView.progress.cancelled} />
              </div>
            </Surface>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="grid gap-3">
                <h3 className="font-medium text-foreground">{translate(locale, "jobsNodes")}</h3>
                {jobView.nodes.length === 0 ? (
                  <Surface variant="outline" className="border-status-warning/40 bg-status-warning/5">
                    <div className="flex items-start gap-2">
                      <AlertTriangle aria-hidden className="mt-0.5 size-4 text-status-warning" />
                      <p className="text-foreground">{translate(locale, "jobsNoNodes")}</p>
                    </div>
                  </Surface>
                ) : (
                  <div className="grid gap-3">
                    {orderedNodes.map((node) => (
                      <NodeCard
                        key={node.id}
                        node={node}
                        locale={locale}
                        nodes={jobView.nodes}
                        edges={jobView.edges}
                        attempts={jobView.attempts.filter((a) => a.nodeId === node.id)}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="grid gap-3">
                <h3 className="font-medium text-foreground">{translate(locale, "jobsAttempts")}</h3>
                {jobView.attempts.length === 0 ? (
                  <p className="text-muted-foreground">{translate(locale, "jobsNoAttempts")}</p>
                ) : (
                  <div className="grid gap-2">
                    {jobView.attempts
                      .slice()
                      .sort((a, b) => safeTime(a.startedAt) - safeTime(b.startedAt))
                      .map((attempt) => (
                        <AttemptCard key={attempt.id} attempt={attempt} locale={locale} nodes={jobView.nodes} />
                      ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

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
                    <p className="break-words text-sm text-muted-foreground">{cancelError.hint}</p>
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

function CountBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-control border border-border bg-surface px-3 py-2 text-center">
      <p className="text-2xl font-medium text-foreground">{value}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function nodeStateLabel(node: JobNode, locale: Locale): string {
  if (node.state === "FAILED" && node.attemptCount > 0) {
    return node.attemptCount === 1
      ? translate(locale, "jobsFailedAfterOneAttempt")
      : translate(locale, "jobsFailedAfterAttempts", { count: node.attemptCount });
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

  return (
    <Surface variant="solid">
      <div className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="break-words font-medium text-foreground">{node.nodeKey}</span>
          <span
            className={`rounded-full border px-2 py-0.5 text-sm font-medium ${stateBadgeClasses(node.state)}`}
            title={node.state}
          >
            {nodeStateLabel(node, locale)}
          </span>
        </div>
        <p className="break-words text-sm text-muted-foreground">
          {node.nodeKind} ·{" "}
          {translate(locale, "jobsAttemptsUsed", {
            used: node.attemptCount,
            max: node.maxAttempts,
          })}
        </p>
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

        {attempts.length > 0 && (
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">{translate(locale, "jobsAttempts")}</p>
            <div className="mt-1 grid gap-1">
              {attempts
                .slice()
                .sort((a, b) => a.attemptNumber - b.attemptNumber)
                .map((attempt) => (
                  <div
                    key={attempt.id}
                    className="flex min-w-0 flex-wrap items-center gap-2 rounded-sm px-2 py-1 text-sm text-muted-foreground"
                  >
                    <AttemptStateIcon state={attempt.state} />
                    <span>
                      {translate(locale, "jobsAttemptNumber", {
                        number: attempt.attemptNumber,
                        max: node.maxAttempts,
                      })}
                    </span>
                    {attempt.errorCode && (
                      <span className="break-all text-danger">{attempt.errorCode}</span>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </Surface>
  );
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
            {node && <span className="text-sm text-muted-foreground">({node.nodeKey})</span>}
          </div>
          <span
            className={`rounded-full border px-2 py-0.5 text-sm font-medium ${attemptStateBadgeClasses(attempt.state)}`}
            title={attempt.state}
          >
            {stateLabel(attempt.state, locale)}
          </span>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{translate(locale, "jobsStarted")}</span>
          <span className="text-foreground">{formatDateTime(attempt.startedAt, locale)}</span>
          {attempt.finishedAt && (
            <>
              <span>{translate(locale, "jobsFinished")}</span>
              <span className="text-foreground">{formatDateTime(attempt.finishedAt, locale)}</span>
            </>
          )}
          {attempt.errorCode && (
            <>
              <span>{translate(locale, "jobsErrorCode")}</span>
              <span className="break-all text-danger">{attempt.errorCode}</span>
            </>
          )}
        </div>
        {attempt.errorDetail && (
          <div className="min-w-0 rounded-control bg-surface-subtle p-2 text-sm text-foreground [overflow-wrap:anywhere]">
            <span className="font-medium">{translate(locale, "jobsErrorDetail")}:</span>{" "}
            {attempt.errorDetail}
          </div>
        )}
      </div>
    </Surface>
  );
}
