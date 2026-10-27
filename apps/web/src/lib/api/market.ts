/** Typed, validated loopback client for opt-in public YouTube observations. */

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
const PREFIX = "/api/research/market";

export interface MarketStatus {
  apiKeyConfigured: boolean;
  collecting: boolean;
  searchCallsLast24h: number;
  searchCallLimit: number;
}

export interface MarketWatchlistDraft {
  name: string;
  query: string;
  queryMode?: "manual" | "auto";
  queryPlan?: string[];
  queryPlanSource?: "local-model-generated" | "user-edited" | "niche-name fallback";
  region: string;
  language: string;
  enabled: boolean;
}

export interface MarketWatchlist extends MarketWatchlistDraft {
  queryMode: "manual" | "auto";
  queryPlan: string[];
  queryPlanSource: "local-model-generated" | "user-edited" | "niche-name fallback";
  queryIndex: number;
  queryPlanRevision: number;
  lastSearchQuery: string | null;
  nextSearchQuery: string;
  id: string;
  createdAt: number;
  updatedAt: number;
  nextDueAt: number;
  lastFinishedAt: number | null;
  backoffUntil: number;
  errorCode: string | null;
}

export interface MarketVideo {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  durationSeconds: number | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  subscriberCount: number | null;
  sourceUrl: string;
  provider: "youtube-data-api";
  observedAt: number;
  expiresAt: number;
}

export interface RelatedMarketVideo extends MarketVideo {
  watchlistName: string;
  matchedTerms: string[];
}

function obj(raw: unknown, name: string): Record<string, unknown> {
  if (!raw || Array.isArray(raw) || typeof raw !== "object") throw Error(`Invalid ${name} response from local server.`);
  return raw as Record<string, unknown>;
}
function str(value: unknown, field: string): string {
  if (typeof value !== "string") throw Error(`Missing or invalid ${field} from local server.`);
  return value;
}
function num(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw Error(`Missing or invalid ${field} from local server.`);
  return value;
}
function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw Error(`Missing or invalid ${field} from local server.`);
  return value;
}
function nullableString(value: unknown, field: string): string | null {
  return value === null ? null : str(value, field);
}
function nullableNumber(value: unknown, field: string): number | null {
  return value === null ? null : num(value, field);
}

export function parseMarketStatus(raw: unknown): MarketStatus {
  const x = obj(raw, "market status");
  return {
    apiKeyConfigured: bool(x.apiKeyConfigured, "apiKeyConfigured"),
    collecting: bool(x.collecting, "collecting"),
    searchCallsLast24h: num(x.searchCallsLast24h, "searchCallsLast24h"),
    searchCallLimit: num(x.searchCallLimit, "searchCallLimit"),
  };
}

export function parseWatchlist(raw: unknown): MarketWatchlist {
  const x = obj(raw, "watchlist");
  const queryMode = str(x.queryMode, "queryMode");
  if (queryMode !== "manual" && queryMode !== "auto") throw Error("Invalid watchlist query mode.");
  if (!Array.isArray(x.queryPlan) || x.queryPlan.length > 8 ||
      !x.queryPlan.every(v=>typeof v === "string" && v.length >= 3 && v.length <= 160)) {
    throw Error("Invalid watchlist query plan.");
  }
  const queryPlanSource = str(x.queryPlanSource,"queryPlanSource");
  if (!(["local-model-generated","user-edited","niche-name fallback"] as string[]).includes(queryPlanSource)) {
    throw Error("Invalid query plan source.");
  }
  return {
    id: str(x.id, "id"), name: str(x.name, "name"),
    query: str(x.query, "query"), region: str(x.region, "region"),
    queryMode,queryPlan:x.queryPlan as string[],queryPlanSource:queryPlanSource as MarketWatchlist["queryPlanSource"],
    queryIndex:num(x.queryIndex,"queryIndex"),queryPlanRevision:num(x.queryPlanRevision,"queryPlanRevision"),
    lastSearchQuery:nullableString(x.lastSearchQuery,"lastSearchQuery"),nextSearchQuery:str(x.nextSearchQuery,"nextSearchQuery"),
    language: str(x.language, "language"), enabled: bool(x.enabled, "enabled"),
    createdAt: num(x.createdAt, "createdAt"), updatedAt: num(x.updatedAt, "updatedAt"),
    nextDueAt: num(x.nextDueAt, "nextDueAt"),
    lastFinishedAt: nullableNumber(x.lastFinishedAt, "lastFinishedAt"),
    backoffUntil: num(x.backoffUntil, "backoffUntil"),
    errorCode: nullableString(x.errorCode, "errorCode"),
  };
}

export function parseVideos(raw: unknown): MarketVideo[] {
  const x = obj(raw, "market videos");
  if (!Array.isArray(x.videos) || x.videos.length > 100) throw Error("Invalid video list from local server.");
  return x.videos.map((item, i) => {
    const v = obj(item, `video ${i}`);
    const sourceUrl = str(v.sourceUrl, "sourceUrl");
    const videoId = str(v.videoId, "videoId");
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId) ||
        sourceUrl !== `https://www.youtube.com/watch?v=${videoId}`) {
      throw Error("Invalid YouTube source URL from local server.");
    }
    const provider = str(v.provider, "provider");
    if (provider !== "youtube-data-api") throw Error("Unsupported market data provider.");
    return {
      videoId, sourceUrl, provider,
      title: str(v.title, "title"), channelId: str(v.channelId, "channelId"),
      channelTitle: str(v.channelTitle, "channelTitle"),
      publishedAt: str(v.publishedAt, "publishedAt"),
      durationSeconds: nullableNumber(v.durationSeconds, "durationSeconds"),
      viewCount: nullableNumber(v.viewCount, "viewCount"),
      likeCount: nullableNumber(v.likeCount, "likeCount"),
      commentCount: nullableNumber(v.commentCount, "commentCount"),
      subscriberCount: nullableNumber(v.subscriberCount, "subscriberCount"),
      observedAt: num(v.observedAt, "observedAt"),
      expiresAt: num(v.expiresAt, "expiresAt"),
    };
  });
}

async function send(path: string, method = "GET", payload?: unknown, options?: {signal?: AbortSignal; timeoutMs?: number}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${PREFIX}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(method === "GET" ? {} : {"X-Contentgen-Market": "local-only"}),
        ...(payload === undefined ? {} : {"Content-Type": "application/json"}),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: options?.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(options?.timeoutMs ?? 15_000)]) : AbortSignal.timeout(options?.timeoutMs ?? 15_000),
    });
  } catch (error) {
    if (options?.signal?.aborted) throw error;
    throw Error("Cannot reach the local ContentGen server. Start it and retry.");
  }
  if (response.status === 204) return null;
  // Axum's JSON extractor can reject a draft before a handler runs; older
  // ContentGen builds return HTTP 422 as text/plain rather than a JSON envelope.
  // Read the body once so the original validation detail is never hidden.
  const bodyText = await response.text();
  let raw: unknown = null;
  let validJson = false;
  try {
    raw = JSON.parse(bodyText);
    validJson = true;
  } catch { /* legacy Rust extractor or an upstream proxy response */ }
  if (!response.ok) {
    const envelope = raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw as Record<string, unknown> : {};
    const error = envelope.error && typeof envelope.error === "object" && !Array.isArray(envelope.error)
      ? envelope.error as Record<string, unknown> : {};
    if (typeof error.message === "string" && error.message.trim()) throw Error(error.message);
    const plainText = (response.headers.get("content-type") ?? "").toLowerCase().startsWith("text/plain")
      ? bodyText.replace(/[\r\n\t]+/g, " ").trim().slice(0, 280) : "";
    const detail = plainText ? ` ${plainText}` : "";
    if (response.status === 422) {
      throw Error(`Watchlist request rejected (HTTP 422).${detail} The local Rust API may be outdated. Rebuild and restart the ContentGen backend, then retry.`);
    }
    throw Error(`Market API request failed (HTTP ${response.status}).${detail}`);
  }
  if (!validJson) throw Error(`Local market API returned HTTP ${response.status} without valid JSON.`);
  return raw;
}

/** One explicit YouTube search; no saved watchlist or local AI request. */
export async function searchMarketVideos(query: string, options?: {signal?: AbortSignal}): Promise<MarketVideo[]> {
  const value = query.trim();
  if ([...value].length < 3 || [...value].length > 160 || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw Error("YouTube search must be 3–160 safe characters.");
  }
  return parseVideos(await send("/explore", "POST", {query:value}, {signal:options?.signal, timeoutMs:50_000}));
}

export async function loadMarketStatus(): Promise<MarketStatus> {
  return parseMarketStatus(await send("/status"));
}
export async function loadMarketWatchlists(): Promise<MarketWatchlist[]> {
  const x = obj(await send("/watchlists"), "watchlists");
  if (!Array.isArray(x.watchlists) || x.watchlists.length > 100) throw Error("Invalid watchlists response.");
  return x.watchlists.map(parseWatchlist);
}
export async function createMarketWatchlist(draft: MarketWatchlistDraft): Promise<MarketWatchlist> {
  return parseWatchlist(await send("/watchlists", "POST", draft));
}
export async function updateMarketWatchlist(id: string, draft: MarketWatchlistDraft): Promise<MarketWatchlist> {
  return parseWatchlist(await send(`/watchlists/${encodeURIComponent(id)}`, "PATCH", draft));
}
export async function deleteMarketWatchlist(id: string): Promise<void> {
  await send(`/watchlists/${encodeURIComponent(id)}`, "DELETE");
}
export async function requestMarketCollection(id: string): Promise<string> {
  const x = obj(await send(`/watchlists/${encodeURIComponent(id)}/collect`, "POST"), "collection");
  return str(x.runId, "runId");
}
export async function loadMarketVideos(id: string): Promise<MarketVideo[]> {
  return parseVideos(await send(`/watchlists/${encodeURIComponent(id)}/videos`));
}

export function parseRelatedMarketVideos(raw: unknown): RelatedMarketVideo[] {
  const result = obj(raw, "related market videos");
  const items = result.videos;
  if (!Array.isArray(items) || items.length > 12) throw Error("Invalid related video list from local server.");
  const standard = parseVideos(raw);
  return standard.map((video, i) => {
    const x = obj(items[i], `related video ${i}`);
    if (!Array.isArray(x.matchedTerms) || x.matchedTerms.length > 20 ||
        !x.matchedTerms.every(term => typeof term === "string" && term.length > 0 && term.length <= 160)) {
      throw Error("Invalid matching terms from local server.");
    }
    const watchlistName = str(x.watchlistName, "watchlistName");
    if (watchlistName.length > 80) throw Error("Invalid watchlist label from local server.");
    return {...video,watchlistName,matchedTerms:x.matchedTerms as string[]};
  });
}

export async function loadRelatedMarketVideos(topic: string, options?: {signal?: AbortSignal}): Promise<RelatedMarketVideo[]> {
  const value = topic.trim();
  if (value.length < 3 || value.length > 160) throw Error("Research topic must be 3–160 characters.");
  return parseRelatedMarketVideos(await send(`/related?topic=${encodeURIComponent(value)}`, "GET", undefined, options));
}
