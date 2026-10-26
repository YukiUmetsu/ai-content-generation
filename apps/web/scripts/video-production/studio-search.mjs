/** Durable discovery leads. A search result is NOT a captured or verified citation. */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { searchCandidates, publicSourceUrl } from "./research-agent.mjs";
import { configuredSearchEndpoint } from "./local-search-config.mjs";

const DEFAULT_ROOT = fileURLToPath(new URL("../../../../data/studio-research", import.meta.url));
const sha = value => createHash("sha256").update(value).digest("hex");
const SEARCH_ID = /^search_\d{8}T\d{9}Z-[a-f0-9]{12}$/u;
const SEARCH_FILE = /^search_\d{8}T\d{9}Z-[a-f0-9]{12}\.json$/u;
const MAX_SNAPSHOT_BYTES = 64 * 1024;
const safeText = (v, max) => typeof v === "string" && !!v.trim() && v.length <= max &&
  !/[\u0000-\u001f]/u.test(v);
const visible = (value, max) => String(value ?? "").replace(/<[^>]*>/gu, " ")
  .replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, max);

function validateBrief(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
    Object.keys(input).some(key => !["title", "viewerQuestion", "audience", "locale"].includes(key)) ||
    !safeText(input.title, 220) || !safeText(input.viewerQuestion, 240) ||
    !safeText(input.audience, 160) || !["en-US", "ja-JP"].includes(input.locale))
    throw Error("Provide a topic, audience, viewer question and valid locale to search.");
  return { title: input.title.trim(), viewerQuestion: input.viewerQuestion.trim(),
    audience: input.audience.trim(), locale: input.locale };
}

function normalizeLeads(input) {
  if (!Array.isArray(input)) throw Error("Search provider returned an invalid result list.");
  const seen = new Set(), results = [];
  for (const item of input.slice(0, 100)) {
    if (results.length >= 10) break;
    try {
      const url = publicSourceUrl(item?.url);
      const title = visible(item?.title, 240);
      if (!title || seen.has(url)) continue;
      seen.add(url);
      results.push({ title, url, snippet: visible(item?.snippet ?? item?.content, 500) });
    } catch { /* Unsafe search leads are never saved or shown. */ }
  }
  if (!results.length) throw Error("Search returned no usable public sources. Try a different question.");
  return results;
}

function validateDocument(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
    raw.schemaVersion !== 1 || raw.kind !== "studio-search-snapshot" ||
    raw.provider !== "searxng" || !safeText(raw.topic, 220) ||
    !safeText(raw.query, 240) || !safeText(raw.audience, 160) ||
    !["en-US", "ja-JP"].includes(raw.locale) ||
    typeof raw.searchedAt !== "string" || !Number.isFinite(Date.parse(raw.searchedAt)) ||
    !Array.isArray(raw.results) || raw.results.length < 1 || raw.results.length > 10)
    throw Error("Saved search snapshot is invalid.");
  const results = normalizeLeads(raw.results);
  if (results.length !== raw.results.length || results.some((r, i) =>
    r.title !== raw.results[i].title || r.url !== raw.results[i].url || r.snippet !== raw.results[i].snippet))
    throw Error("Saved search snapshot contains invalid or duplicate source leads.");
  return raw;
}

/** One explicit SearXNG request, no local-model lookup or page scraping. */
export async function searchStudioSources(candidate, deps = {}) {
  const brief = validateBrief(candidate);
  const searchEndpoint = deps.searchEndpoint ?? configuredSearchEndpoint();
  if (!searchEndpoint) throw Error("Local SearXNG is not configured. Run pnpm research:up and pnpm research:check.");
  const raw = await (deps.search ?? searchCandidates)(brief.viewerQuestion,
    { provider: "searxng", searchEndpoint, locale: brief.locale }, { signal: deps.signal });
  if (deps.signal?.aborted) throw Error("Search cancelled.");
  const document = validateDocument({
    schemaVersion: 1, kind: "studio-search-snapshot",
    topic: brief.title, query: brief.viewerQuestion, audience: brief.audience,
    locale: brief.locale, provider: "searxng",
    searchedAt: (deps.now ?? (() => new Date()))().toISOString(),
    results: normalizeLeads(raw),
  });
  const bytes = JSON.stringify(document);
  if (Buffer.byteLength(bytes) > MAX_SNAPSHOT_BYTES) throw Error("Search snapshot exceeds storage limit.");
  const timestamp = document.searchedAt.replace(/[-:.]/gu, "");
  const artifactId = `search_${timestamp}-${sha(bytes).slice(0, 12)}`;
  if (!SEARCH_ID.test(artifactId)) throw Error("Search timestamp must use UTC ISO format.");
  const root = deps.root ?? DEFAULT_ROOT;
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = resolve(root, artifactId + ".json");
  try { await writeFile(path, bytes, { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if (error.code !== "EEXIST" || await readFile(path, "utf8") !== bytes) throw error;
  }
  return { ...document, artifactId };
}

/** Immutable file names and matching digest prevent path and content substitution. */
export async function loadStudioSearch(artifactId, { root = DEFAULT_ROOT } = {}) {
  if (typeof artifactId !== "string" || !SEARCH_ID.test(artifactId))
    throw Error("Invalid search artifact ID.");
  const path = resolve(root, artifactId + ".json");
  const bytes = await readFile(path, "utf8");
  if (Buffer.byteLength(bytes) > MAX_SNAPSHOT_BYTES) throw Error("Saved search exceeds storage limit.");
  if (sha(bytes).slice(0, 12) !== artifactId.slice(-12))
    throw Error("Saved search digest mismatch; local artifact may be tampered.");
  const document = validateDocument(JSON.parse(bytes));
  if (document.searchedAt.replace(/[-:.]/gu, "") !== artifactId.slice(7, 26))
    throw Error("Saved search timestamp mismatch.");
  return { ...document, artifactId };
}

export async function listStudioSearches({ root = DEFAULT_ROOT, limit = 20 } = {}) {
  const names = (await readdir(root).catch(error => {
    if (error.code === "ENOENT") return [];
    throw error;
  })).filter(name => SEARCH_FILE.test(name)).sort().reverse().slice(0, Math.max(1, Math.min(20, limit)));
  const items = [];
  for (const name of names) {
    try {
      const snapshot = await loadStudioSearch(basename(name, ".json"), { root });
      items.push({ artifactId: snapshot.artifactId, topic: snapshot.topic, query: snapshot.query,
        audience: snapshot.audience, locale: snapshot.locale,
        searchedAt: snapshot.searchedAt, resultCount: snapshot.results.length });
    } catch { /* Corrupted snapshots cannot appear as restorable entries. */ }
  }
  return items;
}

export function validateStudioSearchMatch(snapshot, candidate) {
  const brief = validateBrief(candidate);
  if (snapshot.topic !== brief.title || snapshot.query !== brief.viewerQuestion ||
    snapshot.audience !== brief.audience || snapshot.locale !== brief.locale)
    throw Error("Saved search does not match the current topic, question, audience or locale. Search again.");
}
