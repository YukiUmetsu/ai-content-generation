/**
 * Upload-preparation metadata, not a publisher or a second media composer.
 *
 * This module deliberately derives suggestions only from the supplied script,
 * title, evidence and assets. It never invents search volumes, chapter times,
 * rendered files, policy selections, publication or predicted performance.
 */

export const PLATFORM_TARGETS = ["youtube", "youtube-shorts", "tiktok", "instagram", "facebook", "blog"] as const;
export type PlatformTarget = (typeof PLATFORM_TARGETS)[number];
export type AssetKind = "video" | "thumbnail" | "captions" | "hero";
export interface PlatformAsset {
  id: string;
  kind: AssetKind;
  platform?: string;
  filename?: string;
  sourceRevision?: string;
  /** Local, same-origin download for an actually existing release file. */
  downloadUrl?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
}
export interface PlatformScriptSection {
  id: string;
  heading: string;
  text: string;
  /** An actual confirmed point in the exported video, not an estimate. */
  startSeconds?: number;
}
export interface PlatformBrandColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
  custom?: string[];
}
export interface PlatformOptimizationInput {
  productionId: string;
  projectId: string;
  title: string;
  summary?: string;
  audience?: string;
  primaryKeyword?: string;
  language?: string;
  platforms: readonly string[];
  scriptSections: readonly PlatformScriptSection[];
  /** Optional independently edited script for each destination (aliases accepted). */
  platformScripts?: Record<string, readonly PlatformScriptSection[]>;
  brandColors?: PlatformBrandColors;
  assets?: readonly PlatformAsset[];
  /** The approved source revision, if known. An input signature is also checked. */
  sourceRevision?: string;
}
export interface PlatformChapter {
  seconds: number;
  title: string;
}
export interface PlatformMetadataFields {
  title: string;
  description: string;
  tags: string[];
  hashtags: string[];
  chapters: PlatformChapter[];
  slug: string;
  metaDescription: string;
  playlist: string;
  category: string;
  language: string;
  visibility: "private" | "unlisted" | "public";
  madeForKids: boolean | null;
  paidPromotion: boolean | null;
  syntheticContentDisclosure: boolean | null;
  rightsConfirmed: boolean;
  platformPolicyReviewed: boolean;
}
export type PlatformField = keyof PlatformMetadataFields;
export type PlatformMediaField = keyof PlatformPackage["assetIds"];
export interface PlatformRevision {
  revision: number;
  at: string;
  reason: "prepared" | "edited" | "source-changed" | "asset-changed" | "reviewed" | "approved";
  field?: string;
}
export interface PlatformPackage {
  platform: PlatformTarget;
  status: "draft" | "approved";
  revision: number;
  sourceSignature: string;
  stale: boolean;
  fields: PlatformMetadataFields;
  manualFields: PlatformField[];
  assetIds: { video: string | null; thumbnail: string | null; captions: string | null; hero: string | null };
  approvedRevision: number | null;
  revisions: PlatformRevision[];
}
export interface PlatformOptimizationManifest {
  schemaVersion: 1;
  kind: "contentgen-platform-optimization";
  productionId: string;
  projectId: string;
  brandColors: PlatformBrandColors | null;
  packages: PlatformPackage[];
}
export type PlatformFinding = {
  severity: "error" | "warning";
  code: string;
  message: string;
};

const STOP_WORDS = new Set(["the", "and", "a", "an", "of", "is", "are", "in", "on", "for", "to", "vs", "why", "how", "what", "with", "your", "that", "this", "from", "does", "really", "can", "much", "so"]);
const TARGET_ALIASES: Record<string, PlatformTarget> = {
  youtube: "youtube", "youtube-long": "youtube", "youtube-video": "youtube",
  "youtube-shorts": "youtube-shorts", youtube_shorts: "youtube-shorts", shorts: "youtube-shorts",
  tiktok: "tiktok", "tiktok-ads": "tiktok",
  instagram: "instagram", "instagram-reels": "instagram", "instagram-feed": "instagram", "instagram-story": "instagram",
  facebook: "facebook", "facebook-reels": "facebook", "facebook-feed": "facebook", "facebook-ads-feed": "facebook", "facebook-ads-reels": "facebook",
  blog: "blog", article: "blog",
};

export const PLATFORM_NAMES: Record<PlatformTarget, string> = {
  youtube: "YouTube", "youtube-shorts": "YouTube Shorts", tiktok: "TikTok",
  instagram: "Instagram", facebook: "Facebook", blog: "Blog / Website",
};

export function normalizeTarget(value: string): PlatformTarget | null {
  return TARGET_ALIASES[value.trim().toLowerCase()] ?? null;
}

function distinctTargets(platforms: readonly string[]): PlatformTarget[] {
  const selected = new Set<PlatformTarget>();
  for (const value of platforms) {
    const target = normalizeTarget(value);
    if (target) selected.add(target);
  }
  return [...selected];
}

function trimText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1).trimEnd();
  return cut + "…";
}

function normalizedTokens(text: string): string[] {
  const found = text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(found.filter((word) => word.length > 2 && !STOP_WORDS.has(word)))];
}

function derivedTags(input: PlatformOptimizationInput): string[] {
  const phrase = trimText(input.primaryKeyword);
  const tokens = normalizedTokens(`${input.title} ${phrase}`);
  return [...new Set([...(phrase ? [phrase] : []), ...tokens.slice(0, 8)])].slice(0, 10);
}

function derivedHashtags(input: PlatformOptimizationInput): string[] {
  return derivedTags(input).filter((value) => !value.includes(" ")).slice(0, 4).map((tag) => `#${tag.replace(/[^\p{L}\p{N}_]/gu, "")}`).filter((tag) => tag.length > 1);
}

export function platformSlug(title: string): string {
  const cleaned = title.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 100).replace(/-$/g, "");
  return cleaned || "untitled-article";
}

export function platformTimestamp(seconds: number): string {
  if (!Number.isInteger(seconds) || seconds < 0) throw new Error("Invalid chapter time.");
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function confirmedChapters(sections: readonly PlatformScriptSection[]): PlatformChapter[] {
  const chapters = sections.filter((section) =>
    Number.isInteger(section.startSeconds) && (section.startSeconds ?? -1) >= 0 && Boolean(section.heading.trim()),
  ).map((section) => ({ seconds: section.startSeconds!, title: section.heading.trim() }));
  return chapters.every((chapter, index) => index === 0 || chapter.seconds > chapters[index - 1].seconds) ? chapters : [];
}

function sectionsForTarget(input: PlatformOptimizationInput, target: PlatformTarget): readonly PlatformScriptSection[] {
  const own = input.platformScripts?.[target] ?? Object.entries(input.platformScripts ?? {})
    .find(([name]) => normalizeTarget(name) === target)?.[1];
  return own ?? input.scriptSections;
}

function summaryFromInput(input: PlatformOptimizationInput, target: PlatformTarget): string {
  const own = input.platformScripts && Object.entries(input.platformScripts).some(([name]) => normalizeTarget(name) === target);
  const relevant = sectionsForTarget(input, target).map((section) => trimText(section.text)).filter(Boolean);
  if (own && relevant.length > 0) return truncate(relevant.slice(0, 2).join(" "), 420);
  const manual = trimText(input.summary);
  if (manual) return manual;
  return truncate(relevant.slice(0, 2).join(" "), 420) || trimText(input.title);
}

function prepareFields(target: PlatformTarget, input: PlatformOptimizationInput): PlatformMetadataFields {
  const title = trimText(input.title) || "Untitled video";
  const summary = summaryFromInput(input, target);
  const chapters = target === "youtube" ? confirmedChapters(sectionsForTarget(input, target)) : [];
  const youtubeChapters = chapters.length > 0 ? `\n\nChapters\n${chapters.map((chapter) => `${platformTimestamp(chapter.seconds)} ${chapter.title}`).join("\n")}` : "";
  const hashtags = derivedHashtags(input);
  let description: string;
  if (target === "youtube") description = `${summary}${youtubeChapters}`;
  else if (target === "youtube-shorts") description = truncate(summary, 360);
  else if (target === "blog") description = summary;
  else description = truncate(summary, 300);
  return {
    title: truncate(title, target === "youtube" || target === "youtube-shorts" ? 100 : 180),
    description,
    tags: target === "youtube" || target === "youtube-shorts" || target === "blog" ? derivedTags(input) : [],
    hashtags: target === "youtube" || target === "blog" ? [] : hashtags,
    chapters,
    slug: target === "blog" ? platformSlug(title) : "",
    metaDescription: target === "blog" ? truncate(summary, 155) : "",
    playlist: "",
    category: "",
    language: trimText(input.language) || "en",
    visibility: "private",
    madeForKids: null,
    paidPromotion: null,
    syntheticContentDisclosure: null,
    rightsConfirmed: false,
    platformPolicyReviewed: false,
  };
}

/** A compact change detector, not an artifact content hash or security checksum. */
export function sourceSignature(input: PlatformOptimizationInput, target?: PlatformTarget): string {
  const text = JSON.stringify({
    title: input.title, summary: input.summary, audience: input.audience,
    keyword: input.primaryKeyword, language: input.language, revision: input.sourceRevision,
    sections: target ? sectionsForTarget(input, target) : input.scriptSections,
    platformScripts: target ? undefined : input.platformScripts,
    assets: target ? input.assets?.filter((asset) => !asset.platform || normalizeTarget(asset.platform) === target) : input.assets,
    colors: input.brandColors,
  });
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  return `source-v1-${hash.toString(16).padStart(8, "0")}`;
}

function suitableAsset(input: PlatformOptimizationInput, target: PlatformTarget, kind: AssetKind): string | null {
  const assets = (input.assets ?? []).filter((asset) => asset.kind === kind);
  const latest = [...assets].reverse();
  const exact = latest.find((asset) => asset.platform?.trim().toLowerCase() === target);
  if (exact) return exact.id;
  const compatible = latest.find((asset) => asset.platform && normalizeTarget(asset.platform) === target);
  return (compatible ?? latest.find((asset) => !asset.platform))?.id ?? null;
}

function initialPackage(target: PlatformTarget, input: PlatformOptimizationInput): PlatformPackage {
  return {
    platform: target, status: "draft", revision: 1, sourceSignature: sourceSignature(input, target), stale: false,
    fields: prepareFields(target, input), manualFields: [],
    assetIds: {
      video: target === "blog" ? null : suitableAsset(input, target, "video"),
      thumbnail: target === "blog" ? null : suitableAsset(input, target, "thumbnail"),
      captions: target === "blog" ? null : suitableAsset(input, target, "captions"),
      hero: target === "blog" ? suitableAsset(input, target, "hero") : null,
    },
    approvedRevision: null,
    revisions: [{ revision: 1, at: new Date().toISOString(), reason: "prepared" }],
  };
}

export function createPlatformOptimizationManifest(input: PlatformOptimizationInput): PlatformOptimizationManifest {
  if (!trimText(input.productionId) || !trimText(input.projectId)) throw new Error("Project and production are required.");
  return {
    schemaVersion: 1, kind: "contentgen-platform-optimization",
    productionId: input.productionId, projectId: input.projectId,
    brandColors: input.brandColors ? { ...input.brandColors, custom: input.brandColors.custom ? [...input.brandColors.custom] : undefined } : null,
    packages: distinctTargets(input.platforms).map((target) => initialPackage(target, input)),
  };
}

function newRevision(pkg: PlatformPackage, reason: PlatformRevision["reason"], field?: string): PlatformPackage {
  const revision = pkg.revision + 1;
  return {
    ...pkg, revision, status: "draft", approvedRevision: null,
    revisions: [...pkg.revisions.slice(-29), { revision, at: new Date().toISOString(), reason, field }],
  };
}

function replacePackage(manifest: PlatformOptimizationManifest, target: PlatformTarget,
  update: (pkg: PlatformPackage) => PlatformPackage): PlatformOptimizationManifest {
  if (!manifest.packages.some((pkg) => pkg.platform === target)) throw new Error(`No ${target} package exists.`);
  return { ...manifest, packages: manifest.packages.map((pkg) => pkg.platform === target ? update(pkg) : pkg) };
}

export function updatePlatformField<K extends PlatformField>(manifest: PlatformOptimizationManifest, target: PlatformTarget,
  field: K, value: PlatformMetadataFields[K]): PlatformOptimizationManifest {
  return replacePackage(manifest, target, (pkg) => {
    if (JSON.stringify(pkg.fields[field]) === JSON.stringify(value)) return pkg;
    const updated = newRevision(pkg, "edited", field);
    return {
      ...updated, fields: { ...updated.fields, [field]: value },
      manualFields: [...new Set([...updated.manualFields, field])],
    };
  });
}

/** Explicitly restore one generated suggestion; all other hand edits survive. */
export function resetPlatformField(manifest: PlatformOptimizationManifest, target: PlatformTarget,
  field: PlatformField, input: PlatformOptimizationInput): PlatformOptimizationManifest {
  return replacePackage(manifest, target, (pkg) => {
    const source = prepareFields(target, input);
    const revision = newRevision(pkg, "edited", field);
    return {
      ...revision,
      fields: { ...pkg.fields, [field]: source[field] },
      manualFields: pkg.manualFields.filter((key) => key !== field),
    };
  });
}

export function updatePlatformAsset(manifest: PlatformOptimizationManifest, target: PlatformTarget,
  kind: PlatformMediaField, assetId: string | null): PlatformOptimizationManifest {
  return replacePackage(manifest, target, (pkg) => pkg.assetIds[kind] === assetId ? pkg : {
    ...newRevision(pkg, "asset-changed", kind), assetIds: { ...pkg.assetIds, [kind]: assetId },
  });
}

export function reconcilePlatformOptimizationManifest(manifest: PlatformOptimizationManifest,
  input: PlatformOptimizationInput): PlatformOptimizationManifest {
  if (manifest.productionId !== input.productionId || manifest.projectId !== input.projectId) {
    throw new Error("Saved packages belong to a different production.");
  }
  const existing = new Map(manifest.packages.map((pkg) => [pkg.platform, pkg]));
  const packages = distinctTargets(input.platforms).map((target) => {
    const signature = sourceSignature(input, target);
    const pkg = existing.get(target);
    if (!pkg) return initialPackage(target, input);
    if (pkg.sourceSignature === signature) return pkg;
    const generatedFields = prepareFields(target, input);
    const fields = { ...pkg.fields };
    for (const key of Object.keys(generatedFields) as PlatformField[]) {
      if (!pkg.manualFields.includes(key) && key !== "rightsConfirmed" && key !== "platformPolicyReviewed" && key !== "madeForKids" && key !== "paidPromotion" && key !== "syntheticContentDisclosure") {
        // This field originated from the previous source; refresh it.
        // Manual fields always survive regeneration/source changes.
        (fields as unknown as Record<string, unknown>)[key] = generatedFields[key];
      }
    }
    const updated = newRevision(pkg, "source-changed");
    return { ...updated, sourceSignature: signature, stale: true, fields,
      assetIds: {
        video: pkg.assetIds.video ?? (target === "blog" ? null : suitableAsset(input, target, "video")),
        thumbnail: pkg.assetIds.thumbnail ?? (target === "blog" ? null : suitableAsset(input, target, "thumbnail")),
        captions: pkg.assetIds.captions ?? (target === "blog" ? null : suitableAsset(input, target, "captions")),
        hero: pkg.assetIds.hero ?? (target === "blog" ? suitableAsset(input, target, "hero") : null),
      },
    };
  });
  return { ...manifest, brandColors: input.brandColors ? { ...input.brandColors } : null, packages };
}

export function markPlatformReviewed(manifest: PlatformOptimizationManifest, target: PlatformTarget): PlatformOptimizationManifest {
  return replacePackage(manifest, target, (pkg) => {
    if (!pkg.stale) return pkg;
    return { ...newRevision(pkg, "reviewed"), stale: false };
  });
}

function issue(severity: PlatformFinding["severity"], code: string, message: string): PlatformFinding {
  return { severity, code, message };
}

export function reviewPlatformPackage(pkg: PlatformPackage, input: PlatformOptimizationInput): {
  issues: PlatformFinding[];
  metadataReady: boolean;
  readyToUpload: boolean;
} {
  const issues: PlatformFinding[] = [];
  const f = pkg.fields;
  const isBlog = pkg.platform === "blog";
  if (!f.title.trim()) issues.push(issue("error", "title-missing", "Enter a title."));
  if (!f.description.trim()) issues.push(issue("error", "description-missing", "Enter a description or caption."));
  if ((pkg.platform === "youtube" || pkg.platform === "youtube-shorts") && f.title.length > 100)
    issues.push(issue("error", "youtube-title-too-long", "YouTube titles cannot exceed 100 characters."));
  if ((pkg.platform === "youtube" || pkg.platform === "youtube-shorts") && f.description.length > 5000)
    issues.push(issue("error", "youtube-description-too-long", "YouTube descriptions cannot exceed 5,000 characters."));
  if (pkg.platform === "tiktok" && composedPlatformCaption(pkg).length > 2200)
    issues.push(issue("warning", "tiktok-caption-length", "Check the caption length and account-specific limits on TikTok."));
  if (isBlog && !f.slug.trim()) issues.push(issue("error", "blog-slug-missing", "Enter a URL slug."));
  if (isBlog && !f.metaDescription.trim()) issues.push(issue("warning", "meta-description-missing", "Add a search-result description."));
  if (pkg.stale) issues.push(issue("error", "source-needs-review", "Script, palette or assets changed; review this destination again."));
  if (!f.rightsConfirmed) issues.push(issue("error", "rights-unreviewed", "Confirm you have publication rights for the selected media."));
  if (!f.platformPolicyReviewed) issues.push(issue("error", "platform-policy-unreviewed", "Check destination policies, attribution and disclosures."));
  if ((pkg.platform === "youtube" || pkg.platform === "youtube-shorts") && f.madeForKids === null)
    issues.push(issue("error", "audience-unreviewed", "Select whether this video is made for children."));
  if (!isBlog && !pkg.assetIds.video) issues.push(issue("error", "video-missing", "Attach a rendered destination-ready video in Produce or Export."));
  if (!isBlog && !pkg.assetIds.thumbnail) issues.push(issue("warning", "cover-missing", "Choose a destination cover or thumbnail."));
  if (!isBlog && !pkg.assetIds.captions) issues.push(issue("warning", "captions-missing", "Check accessibility captions/subtitles before upload."));
  if (isBlog && !pkg.assetIds.hero) issues.push(issue("warning", "hero-missing", "Choose a licensed article hero image if the destination uses one."));
  if (platformHasInvalidChapters(pkg)) issues.push(issue("error", "chapters-invalid", "Chapter times must be non-negative and strictly increasing."));
  if (!isBlog && pkg.assetIds.video && !input.assets?.some((asset) => asset.id === pkg.assetIds.video))
    issues.push(issue("error", "video-unavailable", "The selected video cannot be found among current exported assets."));
  if (f.paidPromotion === null) issues.push(issue("warning", "paid-promotion-review", "Confirm whether a paid-promotion disclosure is needed."));
  if (f.syntheticContentDisclosure === null) issues.push(issue("warning", "synthetic-content-review", "Check the destination's altered/synthetic-content disclosure requirements."));
  // Metadata review is useful even before the render pipeline provides real
  // files. Media rights and existence are separate upload/release gates.
  const metadataReady = !issues.some((finding) => finding.severity === "error" &&
    !["rights-unreviewed", "video-missing", "video-unavailable"].includes(finding.code));
  const readyToUpload = pkg.status === "approved" && !issues.some((finding) => finding.severity === "error") &&
    f.paidPromotion !== null && f.syntheticContentDisclosure !== null;
  return { issues, metadataReady, readyToUpload };
}

function platformHasInvalidChapters(pkg: PlatformPackage): boolean {
  return pkg.platform === "youtube" && pkg.fields.chapters.some((chapter, index, chapters) =>
    !Number.isInteger(chapter.seconds) || chapter.seconds < 0 || !chapter.title.trim() || (index > 0 && chapter.seconds <= chapters[index - 1].seconds));
}

export function approvePlatformPackage(manifest: PlatformOptimizationManifest, target: PlatformTarget,
  input: PlatformOptimizationInput): PlatformOptimizationManifest {
  return replacePackage(manifest, target, (pkg) => {
    const check = reviewPlatformPackage(pkg, input);
    if (!check.metadataReady) throw new Error("Resolve the metadata review checks before approval.");
    const approved = newRevision(pkg, "approved");
    return { ...approved, status: "approved", approvedRevision: approved.revision };
  });
}

/** Compose social captions once, so displayed hashtags are not duplicated in the editor. */
export function composedPlatformCaption(pkg: PlatformPackage): string {
  const description = pkg.fields.description.trim();
  const tags = pkg.fields.hashtags.filter(Boolean).join(" ");
  return tags ? `${description}\n\n${tags}`.trim() : description;
}

/** The exported plan references media assets; it never contains uploaded files or credentials. */
export function platformExportManifest(manifest: PlatformOptimizationManifest, input: PlatformOptimizationInput) {
  return {
    ...manifest,
    exportNotice: "Metadata preparation only. No files were rendered, uploaded, scheduled or published.",
    destinations: manifest.packages.map((pkg) => ({
      platform: pkg.platform, status: pkg.status, revision: pkg.revision,
      metadata: pkg.fields,
      readyToPasteCaption: composedPlatformCaption(pkg),
      selectedAssets: Object.fromEntries(Object.entries(pkg.assetIds).map(([kind, id]) => [kind, id ? input.assets?.find((asset) => asset.id === id) ?? { id, missing: true } : null])),
      checks: reviewPlatformPackage(pkg, input),
    })),
  };
}

