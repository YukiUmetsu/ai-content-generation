/** Durable content discovery belongs to a Project (brand), never to a video-named Project. */
import type { DiscoveryRun } from "./discovery";

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
    lastRun: value.lastRun ?? null };
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
  } as DiscoverySessionIdea;
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
export function discoverSession(projectId: string, sessionId: string,
  input: { projectName: string; description: string; resultBudget?: number;
    content?: { name: string; stage: string }[] }): Promise<DiscoveryRun> {
  return callDirector("/api/contentgen-director/project-discovery", { projectId, sessionId, ...input });
}

export function resumeSessionRun(projectId: string, sessionId: string, runId: string,
  input: { projectName: string; description: string; resultBudget?: number;
    content?: { name: string; stage: string }[] }): Promise<DiscoveryRun> {
  return callDirector(`/api/contentgen-director/project-discovery/${encodeURIComponent(runId)}/resume`,
    { projectId, sessionId, ...input });
}

export function cancelSessionRun(projectId: string, runId: string): Promise<DiscoveryRun> {
  return callDirector(`/api/contentgen-director/project-discovery/${encodeURIComponent(runId)}/cancel`, { projectId });
}

export async function listSessionRuns(projectId: string, sessionId: string, signal?: AbortSignal): Promise<DiscoveryRun[]> {
  const result = await call<{ runs?: DiscoveryRun[] }>(`${sessionPath(projectId, sessionId)}/runs`, "GET", undefined, signal);
  if (!record(result) || !Array.isArray(result.runs)) throw Error("Invalid saved discovery run list.");
  return result.runs;
}

export async function listSessionIdeas(projectId: string, sessionId: string, signal?: AbortSignal): Promise<DiscoverySessionIdea[]> {
  const result = await call<{ ideas?: unknown }>(`${sessionPath(projectId, sessionId)}/ideas`, "GET", undefined, signal);
  if (!record(result) || !Array.isArray(result.ideas)) throw Error("Invalid saved discovery ideas response.");
  return result.ideas.map(requireIdea);
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
