import type { LocalContent, LocalProject } from "@/app/catalog-model";
import { parseDiscoveryProviderHealth, type DiscoveryProviderHealth } from "@/app/discovery-provider-health";

export type KeywordKind = "topic" | "query" | "exclusion";
export type KeywordOrigin = "manual" | "model";
export type ProjectKeyword = { id: string; text: string; kind: KeywordKind; origin: KeywordOrigin; active: boolean; manualLock: boolean };
export type KeywordDraft = { text: string; kind: KeywordKind; origin: KeywordOrigin };
export type KeywordPatch = { add?: KeywordDraft[]; remove?: string[]; disable?: string[] };
export type KeywordSuggestion = { text: string; kind: KeywordKind; rationale: string };
export type KeywordSuggestionQuality = {modelRequests:number;batches:number;proposed:number;rejected:number;
  partial:boolean;evidence:"unverified"};
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
  stage: string; createdAt: number; updatedAt: number; errorCode: string | null; providerHealth: DiscoveryProviderHealth;
  candidates: DiscoveryCandidate[] };
const PREFIX = "/api/research/discovery";

/** A local server version mismatch or partial reply must not crash the entire React view. */
export function requireDiscoveryRun(value: unknown): DiscoveryRun {
  const data = value as Partial<DiscoveryRun> | null;
  const object = (item: unknown): item is Record<string, unknown> =>
    !!item && typeof item === "object" && !Array.isArray(item);
  const candidate = (item: unknown): boolean => object(item) &&
    typeof item.id === "string" && Number.isFinite(item.rank) &&
    ["title", "hook", "premise", "whyNow", "angleKey", "confidence"].every(key => typeof item[key] === "string") &&
    (item.decision === null || ["saved", "dismissed", "storyboard"].includes(String(item.decision))) &&
    Array.isArray(item.sourceIds) && item.sourceIds.every(id => typeof id === "string");
  if (!object(data) || typeof data.id !== "string" || typeof data.projectId !== "string" ||
    typeof data.inputRevision !== "string" ||
    !["queued", "running", "paused", "completed", "insufficient_evidence", "failed", "cancelled"].includes(String(data.status)) ||
    typeof data.stage !== "string" || !Number.isFinite(data.createdAt) || !Number.isFinite(data.updatedAt) ||
    (data.errorCode != null && typeof data.errorCode !== "string") ||
    !Array.isArray(data.candidates) || !data.candidates.every(candidate) ||
    (data.providerHealth !== undefined && !object(data.providerHealth))) {
    throw Error("Invalid discovery run response. Restart or rebuild the local server, then retry.");
  }
  return { ...data, errorCode: data.errorCode ?? null,
    providerHealth: parseDiscoveryProviderHealth(data.providerHealth) } as DiscoveryRun;
}

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
export async function suggestProjectKeywords(project: LocalProject, activeKeywords: string[], excludedKeywords:string[]=[]):
  Promise<{suggestions:KeywordSuggestion[];quality?:KeywordSuggestionQuality}> {
  const response = await fetch("/api/contentgen-director/project-keyword-suggestions", {
    method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Contentgen-Director": "local-only" },
    body: JSON.stringify({ name: project.name, description: project.notes, keywords: activeKeywords, excludedKeywords }),
  });
  const data = await response.json() as { suggestions?: KeywordSuggestion[];quality?:KeywordSuggestionQuality; error?: string };
  if (!response.ok) throw Error(data.error ?? `Local keyword model returned ${response.status}.`);
  if(!Array.isArray(data.suggestions))throw Error("Invalid local keyword suggestion response.");
  return {suggestions:data.suggestions,quality:data.quality};
}

export type KeywordBatchProgress = {suggestions:KeywordSuggestion[];quality:KeywordSuggestionQuality;
  step:number;totalSteps:number};

/** Read independently useful local batches as they arrive; never write keywords implicitly. */
export async function streamProjectKeywords(project:LocalProject,activeKeywords:string[],{
  onBatch,signal,excludedKeywords=[]}:{onBatch:(batch:KeywordBatchProgress)=>void;signal?:AbortSignal;excludedKeywords?:string[]}
):Promise<KeywordSuggestionQuality> {
  const response=await fetch("/api/contentgen-director/project-keyword-suggestions/stream",{
    method:"POST",credentials:"same-origin",signal,
    headers:{"Content-Type":"application/json","X-Contentgen-Director":"local-only"},
    body:JSON.stringify({name:project.name,description:project.notes,keywords:activeKeywords,excludedKeywords}),
  });
  if(!response.ok){
    const error=await response.json().catch(()=>null) as {error?:string}|null;
    throw Error(error?.error??`Local keyword stream returned ${response.status}. Restart the Studio server if it is outdated.`);
  }
  if(!response.body||!response.headers.get("content-type")?.includes("application/x-ndjson"))
    throw Error("Local keyword streaming is unavailable. Restart the Studio server.");
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let buffer="",bytes=0,final:KeywordSuggestionQuality|null=null;
  const validQuality=(value:unknown):value is KeywordSuggestionQuality=>{
    const q=value as Partial<KeywordSuggestionQuality>|null;
    return !!q&&[q.modelRequests,q.batches,q.proposed,q.rejected].every(n=>typeof n==="number"&&Number.isInteger(n)&&n>=0)&&
      typeof q.partial==="boolean"&&q.evidence==="unverified";
  };
  const acceptLine=(line:string)=>{
    if(!line.trim())return;
    let event:Record<string,unknown>;
    try{event=JSON.parse(line) as Record<string,unknown>;}catch{throw Error("Invalid local keyword progress data.");}
    if(!event||typeof event!=="object"||Array.isArray(event))throw Error("Invalid local keyword progress data.");
    if(event.type==="error")throw Error(typeof event.message==="string"?event.message:"Local keyword generation failed.");
    if(event.type==="done"&&validQuality(event.quality)){final=event.quality;return;}
    if(event.type==="batch"&&validQuality(event.quality)&&Array.isArray(event.suggestions)&&
      event.suggestions.length<=2&&Number.isInteger(event.step)&&Number.isInteger(event.totalSteps)){
      const entries=event.suggestions as unknown[];
      if(!entries.every(value=>{
        const item=value as Partial<KeywordSuggestion>|null;
        return !!item&&typeof item.text==="string"&&item.text.length<=160&&item.text.length>=2&&
          ["topic","query","exclusion"].includes(String(item.kind))&&
          typeof item.rationale==="string"&&item.rationale.length<=240;
      }))throw Error("Invalid local keyword progress data.");
      if(final)throw Error("Unexpected keyword data after completion.");
      onBatch({suggestions:entries as KeywordSuggestion[],quality:event.quality,
        step:event.step as number,totalSteps:event.totalSteps as number});return;
    }
    throw Error("Invalid local keyword progress data.");
  };
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>100000)throw Error("Local keyword progress exceeded the size limit.");
      buffer+=decoder.decode(value,{stream:true});
      if(buffer.length>20000&&!buffer.includes("\n"))throw Error("Local keyword progress frame is too large.");
      let end;
      while((end=buffer.indexOf("\n"))>=0){
        acceptLine(buffer.slice(0,end));buffer=buffer.slice(end+1);
      }
    }
    buffer+=decoder.decode();
    if(buffer.trim())acceptLine(buffer);
    if(!final)throw Error("Keyword stream ended incomplete. Earlier suggestions are still available.");
    return final;
  }catch(error){
    // Parsing failures must stop the active local model response, not only
    // release our reader while the producer keeps writing into the stream.
    await reader.cancel().catch(()=>{});
    throw error;
  }finally{reader.releaseLock();}
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

export async function discoverFiveIdeas(project: LocalProject, content: LocalContent[]): Promise<DiscoveryRun> {
  return requireDiscoveryRun(await directorRequest("project-discovery",{projectId:project.id,projectName:project.name,
    description:project.notes,content:content.filter(item=>item.projectId===project.id)}));
}

export async function listDiscoveryRuns(projectId: string): Promise<DiscoveryRun[]> {
  const response=await fetch(`/api/contentgen-director/project-discovery/${encodeURIComponent(projectId)}/runs`);
  if(!response.ok)throw Error("Could not load saved discovery history.");
  const result=await response.json() as {runs?:unknown};
  if(!Array.isArray(result?.runs))throw Error("Invalid discovery run history. Restart or rebuild the local server.");
  return result.runs.map(requireDiscoveryRun);
}
export async function loadDiscoveryRun(projectId: string,runId: string): Promise<DiscoveryRun> {
  const response=await fetch(`/api/contentgen-director/project-discovery/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`);
  if(!response.ok)throw Error("Could not reload discovery run.");
  return requireDiscoveryRun(await response.json());
}
export async function resumeDiscoveryRun(project: LocalProject,content: LocalContent[],runId: string): Promise<DiscoveryRun> {
  return requireDiscoveryRun(await directorRequest(`project-discovery/${runId}/resume`,{projectId:project.id,projectName:project.name,
    description:project.notes,content:content.filter(item=>item.projectId===project.id)}));
}
export async function cancelDiscoveryRun(projectId:string,runId:string):Promise<DiscoveryRun> {
  return requireDiscoveryRun(await directorRequest(`project-discovery/${runId}/cancel`,{projectId}));
}
export function decideDiscoveryIdea(projectId: string,candidateId: string,decision: "saved" | "dismissed" | "storyboard",reason?: string) {
  return request(`/projects/${encodeURIComponent(projectId)}/ideas/${encodeURIComponent(candidateId)}/decision`,"POST",{decision,reason:reason??null});
}
