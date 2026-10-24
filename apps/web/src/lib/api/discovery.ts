import type { LocalContent, LocalProject } from "@/app/catalog-model";

export type KeywordKind = "topic" | "query" | "exclusion";
export type KeywordOrigin = "manual" | "model";
export type ProjectKeyword = { id: string; text: string; kind: KeywordKind; origin: KeywordOrigin; active: boolean; manualLock: boolean };
export type KeywordDraft = { text: string; kind: KeywordKind; origin: KeywordOrigin };
export type KeywordPatch = { add?: KeywordDraft[]; remove?: string[]; disable?: string[] };
export type KeywordSuggestion = { text: string; kind: KeywordKind; rationale: string };
export type ProjectSummary = { id: string; name: string; notes: string; snapshotRevision: number; contentCount: number };
export type GraphNode = { id: string; kind: string; label: string };
export type GraphAlias = { nodeId: string; alias: string };
export type GraphEdge = { id: string; fromNodeId: string; toNodeId: string; relation: string; status: string };
export type GraphEdgeEvidence = {edgeId:string;sourceId:string;assessment:"supports"|"contradicts"|"unknown";quote:string|null};
export type GraphSource = { id: string; provider: string; title: string; url: string; publishedAt: string | null;
  observedAt: number; evidenceState: "captured" | "lead_only" };
export type GraphOverview = {nodes: GraphNode[]; aliases?: GraphAlias[]; edges: GraphEdge[]; edgeEvidence:GraphEdgeEvidence[];sources: GraphSource[];
  signals: {sourceId:string|null;metric:string;value:number|null;unit:string;collectedAt:number}[];
  topicCount: number; sourceCount: number; supportedEdgeCount: number};
export type DiscoveryCandidate = {id: string; rank: number; title: string; hook: string; premise: string;
  whyNow: string; angleKey: string; sourceIds: string[]; confidence: string; decision: "saved" | "dismissed" | "storyboard" | null};
export type DiscoveryRun = { id: string; projectId: string; inputRevision: string;
  inputSnapshot?: {version:number;projectName:string;description:string;content:{name:string;stage:string}[];
    keywords:ProjectKeyword[];projectRevision:number;graphRevision:number;researchFreshness:number};
  status: "queued" | "running" | "paused" | "completed" | "insufficient_evidence" | "failed" | "cancelled";
  stage: string; createdAt: number; updatedAt: number; errorCode: string | null; providerHealth: Record<string,string>;
  candidates: DiscoveryCandidate[] };
const PREFIX = "/api/research/discovery";

async function request<T>(path: string, method = "GET", data?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(PREFIX + path, {
    method, credentials: "same-origin", signal,
    headers: { ...(method === "GET" ? {} : { "Content-Type": "application/json", "X-Contentgen-Discovery": "local-only" }) },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw Error(body?.error?.message ?? `Local discovery server returned ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

let previousRevision = 0;
export function nextSnapshotRevision(): number {
  previousRevision = Math.max(previousRevision + 1, Date.now());
  return previousRevision;
}

export function syncDiscoveryProject(project: LocalProject, content: LocalContent[],
  signal?: AbortSignal, updatedAt = nextSnapshotRevision()): Promise<ProjectSummary> {
  const items = content.filter(item => item.projectId === project.id).map(item => ({
    id: item.id, name: item.name, notes: item.notes, kind: item.kind,
    stage: item.stage, createdAt: item.createdAt,
  }));
  return request<ProjectSummary>(`/projects/${encodeURIComponent(project.id)}/sync`, "POST", {
    id: project.id, name: project.name, notes: project.notes, updatedAt, content: items,
  }, signal);
}
export function deleteDiscoveryProject(projectId:string):Promise<{deleted:boolean}> {
  return request(`/projects/${encodeURIComponent(projectId)}`,"DELETE");
}

export async function loadProjectKeywords(projectId: string, signal?: AbortSignal): Promise<ProjectKeyword[]> {
  const response = await request<{ keywords: ProjectKeyword[] }>(`/projects/${encodeURIComponent(projectId)}/keywords`, "GET", undefined, signal);
  return response.keywords;
}
export async function patchProjectKeywords(projectId: string, patch: KeywordPatch): Promise<ProjectKeyword[]> {
  const response = await request<{ keywords: ProjectKeyword[] }>(`/projects/${encodeURIComponent(projectId)}/keywords`, "PATCH", patch);
  return response.keywords;
}
export async function loadProjectWatchlists(projectId: string): Promise<string[]> {
  const response = await request<{ watchlistIds: string[] }>(`/projects/${encodeURIComponent(projectId)}/watchlists`);
  return response.watchlistIds;
}
export async function setProjectWatchlists(projectId: string, ids: string[]): Promise<string[]> {
  const response = await request<{ watchlistIds: string[] }>(`/projects/${encodeURIComponent(projectId)}/watchlists`, "PUT", { watchlistIds: ids });
  return response.watchlistIds;
}
export async function suggestProjectKeywords(project: LocalProject, activeKeywords: string[]): Promise<KeywordSuggestion[]> {
  const response = await fetch("/api/contentgen-director/project-keyword-suggestions", {
    method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Contentgen-Director": "local-only" },
    body: JSON.stringify({ name: project.name, description: project.notes, keywords: activeKeywords }),
  });
  const data = await response.json() as { suggestions?: KeywordSuggestion[]; error?: string };
  if (!response.ok) throw Error(data.error ?? `Local keyword model returned ${response.status}.`);
  return data.suggestions ?? [];
}

export function loadProjectGraphOverview(projectId: string): Promise<GraphOverview> {
  return request(`/projects/${encodeURIComponent(projectId)}/graph`);
}
export async function searchProjectGraphNodes(projectId:string,query:string):Promise<GraphNode[]> {
  const response=await request<{nodes:GraphNode[]}>(`/projects/${encodeURIComponent(projectId)}/graph/search?q=${encodeURIComponent(query)}`);
  return response.nodes;
}
export function addProjectGraphAlias(projectId:string,nodeId:string,alias:string):Promise<{saved:boolean}> {
  return request(`/projects/${encodeURIComponent(projectId)}/graph/nodes/${encodeURIComponent(nodeId)}/aliases`,"POST",{alias});
}
export function removeProjectGraphAlias(projectId:string,nodeId:string,alias:string):Promise<{saved:boolean}> {
  return request(`/projects/${encodeURIComponent(projectId)}/graph/nodes/${encodeURIComponent(nodeId)}/aliases`,"DELETE",{alias});
}
export function correctProjectGraphEdge(projectId:string,edgeId:string,status:"rejected"|"hypothesized"|"supported"):Promise<{saved:boolean}> {
  return request(`/projects/${encodeURIComponent(projectId)}/graph/edges/${encodeURIComponent(edgeId)}/correction`,"PATCH",{status});
}

async function directorRequest<T>(route: string, body: object): Promise<T> {
  const response = await fetch(`/api/contentgen-director/${route}`, {
    method: "POST",credentials: "same-origin",
    headers: {"Content-Type":"application/json","X-Contentgen-Director":"local-only"},
    body:JSON.stringify(body),
  });
  const json=await response.json() as T & {error?:string};
  if(!response.ok)throw Error(json.error??`Local AI discovery failed (${response.status}).`);
  return json;
}

export function discoverFiveIdeas(project: LocalProject, content: LocalContent[]): Promise<DiscoveryRun> {
  return directorRequest("project-discovery",{projectId:project.id,projectName:project.name,
    description:project.notes,content:content.filter(item=>item.projectId===project.id)});
}

export async function listDiscoveryRuns(projectId: string): Promise<DiscoveryRun[]> {
  const response=await fetch(`/api/contentgen-director/project-discovery/${encodeURIComponent(projectId)}/runs`);
  if(!response.ok)throw Error("Could not load saved discovery history.");
  return (await response.json() as {runs: DiscoveryRun[]}).runs;
}
export async function loadDiscoveryRun(projectId: string,runId: string): Promise<DiscoveryRun> {
  const response=await fetch(`/api/contentgen-director/project-discovery/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`);
  if(!response.ok)throw Error("Could not reload discovery run.");
  return response.json() as Promise<DiscoveryRun>;
}
export function resumeDiscoveryRun(project: LocalProject,content: LocalContent[],runId: string): Promise<DiscoveryRun> {
  return directorRequest(`project-discovery/${runId}/resume`,{projectId:project.id,projectName:project.name,
    description:project.notes,content:content.filter(item=>item.projectId===project.id)});
}
export function cancelDiscoveryRun(projectId:string,runId:string):Promise<DiscoveryRun> {
  return directorRequest(`project-discovery/${runId}/cancel`,{projectId});
}
export function decideDiscoveryIdea(projectId: string,candidateId: string,decision: "saved" | "dismissed" | "storyboard",reason?: string) {
  return request(`/projects/${encodeURIComponent(projectId)}/ideas/${encodeURIComponent(candidateId)}/decision`,"POST",{decision,reason:reason??null});
}
