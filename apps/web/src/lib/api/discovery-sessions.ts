/** Durable content discovery belongs to a Project (brand), never to a video-named Project. */
import { requireDiscoveryRun, type DiscoveryRun } from "./discovery";

export type DiscoveryPlatform = "youtube" | "youtube_shorts" | "tiktok" | "instagram" | "facebook" | "blog" | "website";
export type DiscoverySessionStatus = "ready" | "queued" | "running" | "paused" | "completed" | "failed" | "cancelled" | "archived" | string;

export interface DiscoverySession {
  id: string;
  projectId: string;
  name: string;
  platforms: DiscoveryPlatform[];
  settingsSnapshot: Record<string, unknown>;
  status: DiscoverySessionStatus;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  ideaCount?: number;
  lastRun?: DiscoveryRun | null;
}

export interface DiscoverySourceSummary {
  id: string;
  title: string;
  url: string;
  provider: string;
  observedAt?: number | null;
  publishedAt?: string | null;
  evidenceState?: "captured" | "lead_only" | string;
}

/** Captured passage supplied to the script-review evidence gate; unverified until editorial review. */
export interface ScriptEvidence {
  claimId: string;
  claimText: string;
  sourceId: string;
  sourceUrl: string;
  quote: string;
  reviewStatus: "verified" | "unverified" | "illustrative" | "disputed";
}

/** Descriptive observations from a dated public YouTube search, including automatic Discovery collection. */
export interface IdeaMarketAssessment {
  runId: string;
  state: "running" | "succeeded" | "failed" | "expired";
  query: string;
  format: "long" | "shorts";
  metricVersion?: string;
  region?: string;
  language?: string;
  nextCollectionAt?: number | null;
  observedAt: number | null;
  searchedVideos: number;
  sampleSize: number;
  distinctChannels: number;
  medianViews: number | null;
  p75Views: number | null;
  medianViewsPerDay: number | null;
  recentUploads90d: number;
  comparisonScore: number | null;
  comparisonCohortSize: number;
  errorCode: string | null;
  videos: Array<{
    videoId: string; title: string; channelTitle: string;
    viewCount: number | null; publishedAt: string; sourceUrl: string;
  }>;
}

/** A within-query Google search-interest change; indices are not keyword volumes. */
export interface IdeaGoogleTrends {
  state: "running" | "succeeded" | "failed" | "unavailable";
  query: string;
  region: string;
  observedAt: number | null;
  recentMean: number | null;
  previousMean: number | null;
  changePercent: number | null;
  points: number;
  metricVersion?: string;
  errorCode: string | null;
}

/** Evidence-based relative opportunity estimate; not a probability or view forecast. */
export interface ViralPotential {
  score: number | null;
  state: "measured" | "partial" | "insufficient_data";
  scoreVersion: "viral-potential-v1";
  format: "long" | "shorts" | null;
  youtubeScore: number | null;
  trendScore: number | null;
  trendChangePercent: number | null;
  coveragePercent: number;
  sampleSize: number;
  distinctChannels: number;
  comparisonCohortSize: number;
  youtubeObservedAt: number | null;
  trendsObservedAt: number | null;
}

export interface DiscoverySessionIdea {
  id: string;
  sessionId: string;
  runId: string;
  rank: number;
  title: string;
  hook: string;
  premise: string;
  whyNow: string;
  angleKey: string;
  confidence: string;
  sourceIds: string[];
  decision: "saved" | "dismissed" | "selected" | "storyboard" | null;
  opportunityScore: number | null;
  scoreVersion: string | null;
  scoreInputs: Record<string, unknown>;
  platformFit: Partial<Record<DiscoveryPlatform, number | null>>;
  sources: DiscoverySourceSummary[];
  evidence?: ScriptEvidence[];
  marketAssessment?: IdeaMarketAssessment | null;
  googleTrends?: IdeaGoogleTrends | null;
  viralPotential?: ViralPotential | null;
}

export interface DiscoveryIdeaBrief {
  topic: string;
  title: string;
  angle: string;
  description: string;
  keywords: string[];
  platforms: DiscoveryPlatform[];
}

export interface DiscoveryProduction {
  id: string;
  projectId: string;
  sessionId: string;
  ideaId: string;
  platforms: DiscoveryPlatform[];
  brief: DiscoveryIdeaBrief;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export type CreateSessionInput = { name: string; platforms: DiscoveryPlatform[]; settingsSnapshot?: Record<string, unknown> };
export type CreateProductionInput = {projectId:string;sessionId:string;ideaId:string;brief:DiscoveryIdeaBrief;platforms:DiscoveryPlatform[]};

const base = "/api/research/discovery/projects";
const root = (projectId: string) => `${base}/${encodeURIComponent(projectId)}/sessions`;
const sessionPath = (projectId: string, sessionId: string) => `${root(projectId)}/${encodeURIComponent(sessionId)}`;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

async function call<T>(path: string, method = "GET", body?: object, signal?: AbortSignal,
  editor: "discovery" | "director" = "discovery"): Promise<T> {
  const response = await fetch(path, {
    method, signal, credentials: "same-origin",
    headers: method === "GET" ? undefined : { "Content-Type": "application/json",
      [editor === "director" ? "X-Contentgen-Director" : "X-Contentgen-Discovery"]: "local-only" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = record(result) && typeof result.error === "string" ? result.error
      : record(result) && record(result.error) && typeof result.error.message === "string" ? result.error.message
        : record(result) && typeof result.message === "string" ? result.message
          : `Discovery request failed (${response.status}).`;
    throw Error(message);
  }
  if (result === null) throw Error("The local discovery server returned an invalid response.");
  return result as T;
}

function callDirector<T>(path: string, body: object): Promise<T> {
  return call<T>(path, "POST", body, undefined, "director");
}

function validSession(value: unknown): value is DiscoverySession {
  return record(value) && typeof value.id === "string" && typeof value.projectId === "string" &&
    typeof value.name === "string" && typeof value.status === "string" &&
    Array.isArray(value.platforms) && value.platforms.every(item => typeof item === "string") &&
    Number.isFinite(value.createdAt) && Number.isFinite(value.updatedAt);
}

function requireSession(value: unknown): DiscoverySession {
  if (!validSession(value)) throw Error("The saved discovery session has an invalid response.");
  return { ...value, settingsSnapshot: record(value.settingsSnapshot) ? value.settingsSnapshot : {},
    archivedAt: typeof value.archivedAt === "number" ? value.archivedAt : null,
    lastRun: value.lastRun == null ? null : requireDiscoveryRun(value.lastRun) };
}

function requireIdea(value: unknown): DiscoverySessionIdea {
  if (!record(value) || typeof value.id !== "string" || typeof value.title !== "string" ||
    typeof value.sessionId !== "string" || typeof value.runId !== "string")
    throw Error("A saved discovery idea has an invalid response.");
  return {
    ...value,
    rank: Number.isFinite(value.rank) ? value.rank as number : 0,
    hook: typeof value.hook === "string" ? value.hook : "",
    premise: typeof value.premise === "string" ? value.premise : "",
    whyNow: typeof value.whyNow === "string" ? value.whyNow : "",
    angleKey: typeof value.angleKey === "string" ? value.angleKey : "",
    confidence: typeof value.confidence === "string" ? value.confidence : "unknown",
    sourceIds: Array.isArray(value.sourceIds) ? value.sourceIds.filter(item => typeof item === "string") : [],
    decision: ["saved", "dismissed", "selected", "storyboard"].includes(String(value.decision))
      ? value.decision as DiscoverySessionIdea["decision"] : null,
    opportunityScore: typeof value.opportunityScore === "number" && Number.isFinite(value.opportunityScore) ? value.opportunityScore : null,
    scoreVersion: typeof value.scoreVersion === "string" ? value.scoreVersion : null,
    scoreInputs: record(value.scoreInputs) ? value.scoreInputs : {},
    platformFit: record(value.platformFit) ? value.platformFit as DiscoverySessionIdea["platformFit"] : {},
    sources: Array.isArray(value.sources) ? value.sources.filter(item => record(item) &&
      typeof item.id === "string" && typeof item.title === "string" && typeof item.url === "string" &&
      typeof item.provider === "string") as DiscoverySourceSummary[] : [],
    evidence: Array.isArray(value.evidence) ? value.evidence.slice(0, 100).filter(item => record(item) &&
      ["claimId", "claimText", "sourceId", "sourceUrl", "quote"].every(key => typeof item[key] === "string") &&
      ["verified", "unverified", "illustrative", "disputed"].includes(String(item.reviewStatus))) as ScriptEvidence[] : [],
    marketAssessment: parseIdeaMarketAssessment(value.marketAssessment),
    googleTrends: parseIdeaGoogleTrends(value.googleTrends),
    viralPotential: parseViralPotential(value.viralPotential),
  } as DiscoverySessionIdea;
}

function parseViralPotential(raw: unknown): ViralPotential | null {
  if (!record(raw) || raw.scoreVersion !== "viral-potential-v1" ||
    !["measured", "partial", "insufficient_data"].includes(String(raw.state)) ||
    !(raw.format === null || raw.format === "long" || raw.format === "shorts")) return null;
  const score = raw.score === null ? null : raw.score;
  const numberOrNull = (value: unknown) => value === null ||
    typeof value === "number" && Number.isFinite(value);
  const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  const percent = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
  if (!(score === null || Number.isInteger(score) && percent(score)) ||
    !numberOrNull(raw.youtubeScore) || !numberOrNull(raw.trendScore) ||
    !numberOrNull(raw.trendChangePercent) || !count(raw.coveragePercent) || raw.coveragePercent > 100 ||
    !count(raw.sampleSize) || !count(raw.distinctChannels) || !count(raw.comparisonCohortSize) ||
    !numberOrNull(raw.youtubeObservedAt) || !numberOrNull(raw.trendsObservedAt) ||
    raw.youtubeScore !== null && !percent(raw.youtubeScore) ||
    raw.trendScore !== null && !percent(raw.trendScore) ||
    (score === null) !== (raw.state === "insufficient_data") ||
    (score !== null && (raw.youtubeScore === null || raw.format === null)) ||
    (raw.state === "measured" && (raw.youtubeScore === null || raw.trendScore === null ||
      raw.coveragePercent !== 100)) ||
    (raw.state === "partial" && (raw.youtubeScore === null || raw.trendScore !== null ||
      raw.coveragePercent !== 75)) ||
    (raw.state === "insufficient_data" && raw.youtubeScore !== null) ||
    (raw.youtubeScore !== null && (raw.sampleSize < 8 || raw.distinctChannels < 3 ||
      raw.comparisonCohortSize < 3))) return null;
  return raw as unknown as ViralPotential;
}

function parseIdeaGoogleTrends(raw: unknown): IdeaGoogleTrends | null {
  if (!record(raw) || typeof raw.query !== "string" || !["running", "succeeded", "failed", "unavailable"].includes(String(raw.state)))
    return null;
  const optionalNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
  return {
    state: raw.state as IdeaGoogleTrends["state"], query: raw.query,
    region: typeof raw.region === "string" ? raw.region : "",
    observedAt: typeof raw.observedAt === "number" && Number.isFinite(raw.observedAt) && raw.observedAt >= 0
      ? raw.observedAt : null,
    recentMean: optionalNumber(raw.recentMean), previousMean: optionalNumber(raw.previousMean),
    changePercent: optionalNumber(raw.changePercent),
    points: typeof raw.points === "number" && Number.isFinite(raw.points) && raw.points >= 0 ? raw.points : 0,
    ...(typeof raw.metricVersion === "string" ? {metricVersion:raw.metricVersion} : {}),
    errorCode: typeof raw.errorCode === "string" ? raw.errorCode : null,
  };
}

function parseIdeaMarketAssessment(raw: unknown): IdeaMarketAssessment | null {
  if (!record(raw) || typeof raw.runId !== "string" || typeof raw.query !== "string" ||
    !["running", "succeeded", "failed", "expired"].includes(String(raw.state)) ||
    !["long", "shorts"].includes(String(raw.format))) return null;
  const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
  const optionalNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  const videos = Array.isArray(raw.videos) ? raw.videos.slice(0, 25).filter(video => record(video) &&
    ["videoId", "title", "channelTitle", "publishedAt", "sourceUrl"].every(key => typeof video[key] === "string") &&
    (video.viewCount == null || optionalNumber(video.viewCount) !== null)) : [];
  return {
    runId: raw.runId, state: raw.state as IdeaMarketAssessment["state"], query: raw.query,
    format: raw.format as IdeaMarketAssessment["format"],
    ...(typeof raw.metricVersion === "string" ? { metricVersion: raw.metricVersion } : {}),
    ...(typeof raw.region === "string" ? { region: raw.region } : {}),
    ...(typeof raw.language === "string" ? { language: raw.language } : {}),
    ...(raw.nextCollectionAt === null || typeof raw.nextCollectionAt === "number" && Number.isFinite(raw.nextCollectionAt)
      ? { nextCollectionAt: raw.nextCollectionAt as number | null } : {}),
    observedAt: optionalNumber(raw.observedAt), searchedVideos: count(raw.searchedVideos),
    sampleSize: count(raw.sampleSize), distinctChannels: count(raw.distinctChannels),
    medianViews: optionalNumber(raw.medianViews), p75Views: optionalNumber(raw.p75Views),
    medianViewsPerDay: optionalNumber(raw.medianViewsPerDay),
    recentUploads90d: count(raw.recentUploads90d), comparisonScore: optionalNumber(raw.comparisonScore),
    comparisonCohortSize: count(raw.comparisonCohortSize),
    errorCode: typeof raw.errorCode === "string" ? raw.errorCode : null,
    videos: videos as IdeaMarketAssessment["videos"],
  };
}

export async function listDiscoverySessions(projectId: string, signal?: AbortSignal): Promise<DiscoverySession[]> {
  const result = await call<{ sessions?: unknown }>(root(projectId), "GET", undefined, signal);
  if (!record(result) || !Array.isArray(result.sessions)) throw Error("Invalid saved discovery session list.");
  return result.sessions.map(requireSession);
}

export async function createDiscoverySession(projectId: string, input: CreateSessionInput): Promise<DiscoverySession> {
  if (input.platforms.length === 0) throw Error("Choose at least one publishing platform.");
  return requireSession(await call(root(projectId), "POST", input));
}

export async function getDiscoverySession(projectId: string, sessionId: string, signal?: AbortSignal): Promise<DiscoverySession> {
  return requireSession(await call(sessionPath(projectId, sessionId), "GET", undefined, signal));
}

export async function updateDiscoverySession(projectId: string, sessionId: string,
  change: { name?: string; archived?: boolean }): Promise<DiscoverySession> {
  return requireSession(await call(sessionPath(projectId, sessionId), "PATCH", change));
}

/** Starts the real Node discovery worker; Rust's /discover endpoint alone only queues a run. */
export async function discoverSession(projectId: string, sessionId: string,
  input: { projectName: string; description: string; resultBudget?: number;
    content?: { name: string; stage: string }[] }): Promise<DiscoveryRun> {
  return requireDiscoveryRun(await callDirector("/api/contentgen-director/project-discovery", { projectId, sessionId, ...input }));
}

export async function resumeSessionRun(projectId: string, sessionId: string, runId: string,
  input: { projectName: string; description: string; resultBudget?: number;
    content?: { name: string; stage: string }[] }): Promise<DiscoveryRun> {
  return requireDiscoveryRun(await callDirector(`/api/contentgen-director/project-discovery/${encodeURIComponent(runId)}/resume`,
    { projectId, sessionId, ...input }));
}

export async function cancelSessionRun(projectId: string, runId: string): Promise<DiscoveryRun> {
  return requireDiscoveryRun(await callDirector(`/api/contentgen-director/project-discovery/${encodeURIComponent(runId)}/cancel`, { projectId }));
}

export async function listSessionRuns(projectId: string, sessionId: string, signal?: AbortSignal): Promise<DiscoveryRun[]> {
  const result = await call<{ runs?: DiscoveryRun[] }>(`${sessionPath(projectId, sessionId)}/runs`, "GET", undefined, signal);
  if (!record(result) || !Array.isArray(result.runs)) throw Error("Invalid saved discovery run list.");
  return result.runs.map(requireDiscoveryRun);
}

export async function listSessionIdeas(projectId: string, sessionId: string, signal?: AbortSignal): Promise<DiscoverySessionIdea[]> {
  const result = await call<{ ideas?: unknown }>(`${sessionPath(projectId, sessionId)}/ideas`, "GET", undefined, signal);
  if (!record(result) || !Array.isArray(result.ideas)) throw Error("Invalid saved discovery ideas response.");
  return result.ideas.map(requireIdea);
}

/** Idempotently queue missing provider observations; the Rust worker owns all network requests. */
export async function queueMissingMarketEvidence(projectId: string, sessionId: string):
  Promise<{ state: "queued" | "running" | "no_pending"; queuedRunIds: string[] }> {
  const response = await call<unknown>(`${sessionPath(projectId, sessionId)}/market/backfill`, "POST");
  if (!record(response) || !["queued", "running", "no_pending"].includes(String(response.state)) ||
    !Array.isArray(response.queuedRunIds) || !response.queuedRunIds.every(id => typeof id === "string"))
    throw Error("Invalid market backfill response from local server.");
  return response as { state: "queued" | "running" | "no_pending"; queuedRunIds: string[] };
}

/** One explicit user action consumes at most one shared YouTube search reservation. */
export function validIdeaMarketQuery(value: string): boolean {
  const characters = Array.from(value.trim());
  return characters.length >= 3 && characters.length <= 120 && !characters.some(character => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

export async function collectIdeaMarketEvidence(projectId: string, sessionId: string, ideaId: string,
  input: { query: string; format: "long" | "shorts" }): Promise<void> {
  const query = input.query.trim();
  if (!validIdeaMarketQuery(query))
    throw Error("Use a search phrase between 3 and 120 characters without control characters.");
  await call(`${sessionPath(projectId, sessionId)}/ideas/${encodeURIComponent(ideaId)}/market`, "POST",
    { query, format: input.format });
}

export async function decideSessionIdea(projectId: string, sessionId: string, ideaId: string,
  decision: "saved" | "dismissed" | "selected", reason?: string): Promise<void> {
  await call(`${sessionPath(projectId, sessionId)}/ideas/${encodeURIComponent(ideaId)}/decision`, "POST",
    { decision, ...(reason ? { reason } : {}) });
}

export async function createProduction(input: CreateProductionInput): Promise<DiscoveryProduction> {
  return call<DiscoveryProduction>("/api/productions", "POST", input);
}

export async function getProduction(productionId: string): Promise<DiscoveryProduction> {
  return call<DiscoveryProduction>(`/api/productions/${encodeURIComponent(productionId)}`);
}

export async function listProductions(projectId?: string): Promise<DiscoveryProduction[]> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  const response = await call<{ productions: DiscoveryProduction[] }>(`/api/productions${query}`);
  if (!Array.isArray(response.productions)) throw Error("Invalid production list.");
  return response.productions;
}
