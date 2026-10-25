/** Browser-local authoring cache. Approved publishing releases require a later backend adapter. */
import { PLATFORM_TARGETS, type PlatformOptimizationManifest, type PlatformPackage } from "./model";

export const PLATFORM_OPTIMIZATION_PREFIX = "contentgen:platform-optimization:v1:";
export const MAX_PLATFORM_OPTIMIZATION_BYTES = 512 * 1024;
const ID = /^[a-z0-9][a-z0-9_-]{1,99}$/i;

export function platformOptimizationKey(productionId: string): string {
  if (!ID.test(productionId)) throw new Error("Invalid production ID.");
  return PLATFORM_OPTIMIZATION_PREFIX + productionId;
}

function bounded(raw: string): void {
  if (new TextEncoder().encode(raw).length > MAX_PLATFORM_OPTIMIZATION_BYTES)
    throw new Error("Platform package exceeds the 512 KB local draft limit. Export before continuing.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validPackage(value: unknown): value is PlatformPackage {
  if (!isRecord(value) || !PLATFORM_TARGETS.includes(value.platform as (typeof PLATFORM_TARGETS)[number])) return false;
  if (value.status !== "draft" && value.status !== "approved") return false;
  if (!Number.isInteger(value.revision) || (value.revision as number) < 1) return false;
  if (typeof value.sourceSignature !== "string" || typeof value.stale !== "boolean") return false;
  if (!isRecord(value.fields) || !isRecord(value.assetIds)) return false;
  if (!Array.isArray(value.manualFields) || !value.manualFields.every((field) => typeof field === "string")) return false;
  if (!Array.isArray(value.revisions) || !value.revisions.every((revision) =>
    isRecord(revision) && Number.isInteger(revision.revision) && typeof revision.at === "string" && typeof revision.reason === "string")) return false;
  const fields = value.fields;
  const texts = ["title", "description", "slug", "metaDescription", "playlist", "category", "language", "visibility"];
  if (!texts.every((key) => typeof fields[key] === "string")) return false;
  if (!Array.isArray(fields.tags) || !fields.tags.every((item) => typeof item === "string")) return false;
  if (!Array.isArray(fields.hashtags) || !fields.hashtags.every((item) => typeof item === "string")) return false;
  if (!Array.isArray(fields.chapters) || !fields.chapters.every((chapter) =>
    isRecord(chapter) && Number.isInteger(chapter.seconds) && (chapter.seconds as number) >= 0 && typeof chapter.title === "string")) return false;
  for (const name of ["madeForKids", "paidPromotion", "syntheticContentDisclosure"])
    if (fields[name] !== null && typeof fields[name] !== "boolean") return false;
  if (typeof fields.rightsConfirmed !== "boolean" || typeof fields.platformPolicyReviewed !== "boolean") return false;
  if (!["private", "unlisted", "public"].includes(fields.visibility as string)) return false;
  if (value.approvedRevision !== null && (!Number.isInteger(value.approvedRevision) || (value.approvedRevision as number) < 1)) return false;
  if (value.status === "approved" && value.approvedRevision !== value.revision) return false;
  const assetIds = value.assetIds;
  return ["video", "thumbnail", "captions", "hero"].every((key) =>
    assetIds[key] === null || typeof assetIds[key] === "string");
}

function validateManifest(value: unknown): value is PlatformOptimizationManifest {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.kind !== "contentgen-platform-optimization") return false;
  if (typeof value.productionId !== "string" || !ID.test(value.productionId)) return false;
  if (typeof value.projectId !== "string" || !ID.test(value.projectId)) return false;
  if (value.brandColors !== null) {
    if (!isRecord(value.brandColors) || !["primary", "secondary", "accent", "background", "text"].every((name) => typeof (value.brandColors as Record<string, unknown>)[name] === "string")) return false;
  }
  if (!Array.isArray(value.packages) || value.packages.length > PLATFORM_TARGETS.length || !value.packages.every(validPackage)) return false;
  return new Set(value.packages.map((pkg: PlatformPackage) => pkg.platform)).size === value.packages.length;
}

export function savePlatformOptimization(manifest: PlatformOptimizationManifest): void {
  if (!validateManifest(manifest)) throw new Error("Cannot save an invalid platform package document.");
  const json = JSON.stringify(manifest);
  bounded(json);
  localStorage.setItem(platformOptimizationKey(manifest.productionId), json);
}

export function loadPlatformOptimization(productionId: string, projectId: string): {
  manifest: PlatformOptimizationManifest | null;
  warning: string | null;
} {
  try {
    const raw = localStorage.getItem(platformOptimizationKey(productionId));
    if (!raw) return { manifest: null, warning: null };
    bounded(raw);
    const parsed: unknown = JSON.parse(raw);
    if (!validateManifest(parsed)) throw new Error("Saved platform package has an invalid schema.");
    if (parsed.projectId !== projectId) throw new Error("Saved package belongs to a different project.");
    return { manifest: parsed, warning: null };
  } catch (error) {
    return { manifest: null, warning: error instanceof Error ? error.message : "Could not load saved platform packages." };
  }
}

