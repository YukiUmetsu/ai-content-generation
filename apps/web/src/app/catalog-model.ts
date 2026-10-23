/** Local metadata catalog for Studio navigation. Not the production backend or a media store.
 * Deliberately NO credentials, upload bytes, publishing tokens, fabricated analytics.
 */
export const CATALOG_KEY = "contentgen:studio-catalog:v1";
export const MAX_CATALOG_BYTES = 512 * 1024;

export type ContentKind = "video" | "short" | "article" | "thumbnail" | "other";
export type ContentStage = "idea" | "draft" | "review" | "ready" | "published";
export type AssetKind = "image" | "audio" | "video" | "document" | "other";
export type Rights = "unknown" | "cleared" | "restricted" | "denied";
export type ProductKind = "course" | "download" | "membership" | "service" | "other";
export type ProductStage = "idea" | "planned" | "active" | "retired";

interface BaseEntry { id: string; projectId: string; name: string; notes: string; createdAt: string }
export interface LocalProject { id: string; name: string; notes: string; createdAt: string }
export interface LocalContent extends BaseEntry { kind: ContentKind; stage: ContentStage }
export interface LocalAsset extends BaseEntry { kind: AssetKind; rights: Rights; source: string }
export interface LocalProduct extends BaseEntry { kind: ProductKind; stage: ProductStage }
export interface StudioCatalog {
  version: 1;
  activeProjectId: string;
  projects: LocalProject[];
  content: LocalContent[];
  assets: LocalAsset[];
  products: LocalProduct[];
}
export type CatalogCollection = "content" | "assets" | "products";

const CONTENT_KINDS: readonly string[] = ["video", "short", "article", "thumbnail", "other"];
const CONTENT_STAGES: readonly string[] = ["idea", "draft", "review", "ready", "published"];
const ASSET_KINDS: readonly string[] = ["image", "audio", "video", "document", "other"];
const RIGHTS: readonly string[] = ["unknown", "cleared", "restricted", "denied"];
const PRODUCT_KINDS: readonly string[] = ["course", "download", "membership", "service", "other"];
const PRODUCT_STAGES: readonly string[] = ["idea", "planned", "active", "retired"];
const IDENTIFIER = /^[a-z0-9][a-z0-9-]{1,79}$/i;

function record(value: unknown, fields: readonly string[], location: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(location + " must be an object.");
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!fields.includes(key)) throw new Error("Unexpected field in " + location + ": " + key);
  for (const key of fields) if (!(key in input)) throw new Error("Missing " + location + "." + key);
  return input;
}
function text(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== "string" || value.trim().length < min || value.length > max || /[\u0000-\u0008\u000e-\u001f]/u.test(value)) {
    throw new Error(label + " must contain " + min + "–" + max + " characters without control codes.");
  }
  return value.trim();
}
function id(value: unknown, label: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) throw new Error(label + " has an invalid identifier.");
  return value;
}
function oneOf<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new Error(label + " has an unsupported value.");
  return value as T;
}
function when(value: unknown, label: string) {
  const iso = text(value, label, 10, 40);
  if (!Number.isFinite(Date.parse(iso))) throw new Error(label + " requires a valid ISO date.");
  return iso;
}
function entry(value: unknown, location: string, extra: readonly string[]) {
  const input = record(value, ["id", "projectId", "name", "notes", "createdAt", ...extra], location);
  return { id: id(input.id, location + ".id"), projectId: id(input.projectId, location + ".projectId"),
    name: text(input.name, location + ".name", 1, 120), notes: text(input.notes, location + ".notes", 0, 2000),
    createdAt: when(input.createdAt, location + ".createdAt") };
}
function collection(value: unknown, label: string, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error(label + " exceeds its entry limit.");
  return value;
}
function uniqueIds(records: readonly {id:string}[], label: string) {
  if (new Set(records.map(item => item.id)).size !== records.length) throw new Error(label + " has repeated IDs.");
}
function validateBytes(json: string) {
  if (new TextEncoder().encode(json).length > MAX_CATALOG_BYTES) throw new Error("Catalog exceeds the 512 KB local metadata limit.");
}

/** Import and storage validator: strict, bounded, referentially complete. Never eval, fetch or accept secret-shaped fields. */
export function validateCatalog(value: unknown): StudioCatalog {
  const raw = record(value, ["version", "activeProjectId", "projects", "content", "assets", "products"], "catalog");
  if (raw.version !== 1) throw new Error("Unsupported catalog version.");
  const projects = collection(raw.projects, "Projects", 200).map((source, index) => {
    const label = "projects[" + index + "]";
    const project = record(source, ["id", "name", "notes", "createdAt"], label);
    return { id: id(project.id, label + ".id"), name: text(project.name, label + ".name", 1, 120),
      notes: text(project.notes, label + ".notes", 0, 2000), createdAt: when(project.createdAt, label + ".createdAt") };
  });
  if (!projects.length) throw new Error("At least one project is required.");
  uniqueIds(projects, "Projects");
  const activeProjectId = id(raw.activeProjectId, "activeProjectId");
  const projectIds = new Set(projects.map(x => x.id));
  if (!projectIds.has(activeProjectId)) throw new Error("Active project does not exist.");
  const content = collection(raw.content, "Content", 2000).map((x, i) => {
    const label = "content[" + i + "]", data = record(x, ["id","projectId","name","notes","createdAt","kind","stage"], label);
    return { ...entry(x, label, ["kind", "stage"]), kind: oneOf(data.kind, CONTENT_KINDS, label + ".kind") as ContentKind,
      stage: oneOf(data.stage, CONTENT_STAGES, label + ".stage") as ContentStage };
  });
  const assets = collection(raw.assets, "Assets", 2000).map((x, i) => {
    const label = "assets[" + i + "]", data = record(x, ["id","projectId","name","notes","createdAt","kind","rights","source"], label);
    return { ...entry(x, label, ["kind", "rights", "source"]), kind: oneOf(data.kind, ASSET_KINDS, label + ".kind") as AssetKind,
      rights: oneOf(data.rights, RIGHTS, label + ".rights") as Rights,
      source: text(data.source, label + ".source", 0, 500) };
  });
  const products = collection(raw.products, "Products", 500).map((x, i) => {
    const label = "products[" + i + "]", data = record(x, ["id","projectId","name","notes","createdAt","kind","stage"], label);
    return { ...entry(x, label, ["kind", "stage"]), kind: oneOf(data.kind, PRODUCT_KINDS, label + ".kind") as ProductKind,
      stage: oneOf(data.stage, PRODUCT_STAGES, label + ".stage") as ProductStage };
  });
  for (const [key, rows] of [["content", content], ["assets", assets], ["products", products]] as const) {
    uniqueIds(rows, key);
    for (const item of rows) if (!projectIds.has(item.projectId)) throw new Error(key + " references a missing project.");
  }
  const parsed: StudioCatalog = {version:1,activeProjectId,projects,content,assets,products};
  validateBytes(JSON.stringify(parsed));
  return parsed;
}
export function newCatalog(now = new Date().toISOString()): StudioCatalog {
  return { version: 1, activeProjectId: "project-local",
    projects: [{ id: "project-local", name: "My project", notes: "", createdAt: now }],
    content: [], assets: [], products: [] };
}
export function loadCatalog(): { catalog: StudioCatalog; warning: string | null } {
  try {
    const raw = localStorage.getItem(CATALOG_KEY);
    return { catalog: raw ? parseCatalog(raw) : newCatalog(), warning: null };
  } catch (error) {
    return {catalog:newCatalog(), warning:"Stored catalog could not be loaded: " + String(error instanceof Error ? error.message : error)};
  }
}
export function parseCatalog(raw: string): StudioCatalog {
  validateBytes(raw);
  return validateCatalog(JSON.parse(raw) as unknown);
}
export function persistCatalog(catalog: StudioCatalog) {
  const clean = validateCatalog(catalog);
  const serialized = JSON.stringify(clean);
  validateBytes(serialized);
  localStorage.setItem(CATALOG_KEY, serialized);
}
export function makeCatalogId(prefix: "project" | "item"): string {
  const seed = globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  return prefix + "-" + seed.toLowerCase();
}
export function withoutProject(catalog: StudioCatalog, projectId: string): StudioCatalog {
  if (catalog.projects.length === 1) throw new Error("The final project cannot be deleted.");
  if (!catalog.projects.some(item => item.id === projectId)) throw new Error("Project does not exist.");
  const projects = catalog.projects.filter(item => item.id !== projectId);
  return validateCatalog({ ...catalog, projects,
    activeProjectId: catalog.activeProjectId === projectId ? projects[0].id : catalog.activeProjectId,
    content: catalog.content.filter(item => item.projectId !== projectId),
    assets: catalog.assets.filter(item => item.projectId !== projectId),
    products: catalog.products.filter(item => item.projectId !== projectId) });
}
/** Studio-only inventory counts; never impressions, CTR, revenue or predictions. */
export function catalogCounts(catalog: StudioCatalog, projectId: string) {
  const content = catalog.content.filter(item => item.projectId === projectId);
  const assets = catalog.assets.filter(item => item.projectId === projectId);
  const products = catalog.products.filter(item => item.projectId === projectId);
  return { content: content.length, assets: assets.length, products: products.length,
    ready: content.filter(item => item.stage === "ready").length,
    published: content.filter(item => item.stage === "published").length,
    rightsCleared: assets.filter(item => item.rights === "cleared").length,
    rightsNeedsReview: assets.filter(item => item.rights !== "cleared").length };
}
