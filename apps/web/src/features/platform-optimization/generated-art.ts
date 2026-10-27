/**
 * Local, deterministic publishing artwork. Kumiki lays out and renders the same
 * document used for both previews and downloads. Diagrams use the approved
 * script's language; thumbnails additionally show the user's edited headline.
 * No guessed factual figures, stock photos or external licensed imagery.
 */
import { buildInfographic } from "@/components/infographic/layout";
import { layoutToPng, layoutToSvg } from "@/components/infographic/svg";
import { documentToPng } from "@/components/media/svg-export";
import { loadExportFontCss } from "@/features/thumbnail-composer/model/export";
import type { MediaDocument } from "@/components/media/document";
import { createCoverArtwork } from "./cover-art";
import type { InfographicLayout, InfographicSource, OutputProfileId, ProcessStep, TemplateId } from "@/components/infographic/types";
import { normalizeTarget, platformSlug, sourceSignature,
  type PlatformAsset, type PlatformOptimizationInput, type PlatformScriptSection, type PlatformTarget } from "./model";

export interface GeneratedArtwork {
  id: string;
  filename: string;
  label: string;
  description: string;
  layout?: InfographicLayout;
  media?: MediaDocument;
  svg: string;
  width: number;
  height: number;
  preview: string;
}

const artProfile: Record<PlatformTarget, OutputProfileId> = {
  youtube: "youtube-landscape", "youtube-shorts": "social-portrait", tiktok: "social-portrait",
  instagram: "social-portrait", facebook: "social-square", blog: "youtube-landscape",
};
// Avoid repeating several costly layouts when Production re-renders its
// platform input. Bounded, in-memory only; approval is checked before lookup.
const artworkCache = new Map<string, GeneratedArtwork[]>();

function sectionsFor(input: PlatformOptimizationInput, platform: PlatformTarget): readonly PlatformScriptSection[] {
  const variants = Object.entries(input.platformScripts ?? {});
  const own = variants.find(([key]) => key.replaceAll("_", "-") === platform)?.[1];
  return own ?? input.scriptSections;
}

export function canExportPlatformArtwork(input: PlatformOptimizationInput, target: PlatformTarget): boolean {
  return Boolean(input.approvedPlatforms?.some((platform) => normalizeTarget(platform) === target));
}

function excerpt(text: string, limit: number): string {
  const single = text.replace(/\s+/gu, " ").trim();
  if (single.length <= limit) return single;
  const fragment = single.slice(0, limit - 1);
  return `${fragment.slice(0, fragment.lastIndexOf(" ") > limit / 2 ? fragment.lastIndexOf(" ") : fragment.length).trimEnd()}…`;
}

function sourceFor(title: string, sections: readonly PlatformScriptSection[], id: string, language: string,
  mode: "sequence" | "summary"): InfographicSource {
  const steps: ProcessStep[] = sections.slice(0, 4).map((section, index) => ({
    id: `${id}-step-${index + 1}`,
    title: excerpt(section.heading, 56) || `Part ${index + 1}`,
    description: excerpt(section.text, 120),
  }));
  return {
    kind: "infographic-source", version: 1, id, title: excerpt(title, 110), language: language || "en",
    thesis: "A visual reading guide drawn from the current script",
    evidence: [],
    sections: mode === "sequence" ? [{ id: `${id}-outline`, kind: "process", heading: "Key ideas, in reading order",
      summary: "This graphic is a reading guide, not an independent factual source or causal claim.",
      steps, layout: "linear", importance: "hero" }] : sections.slice(0, 2).map((section, index) => ({
        id: `${id}-detail-${index}`, kind: "text" as const, heading: excerpt(section.heading, 75),
        summary: "Excerpted from the approved article; read the full section for context.",
        paragraphs: [excerpt(section.text, 300)], importance: index === 0 ? "hero" as const : "supporting" as const,
      })),
  };
}

function makeArtwork(label: string, filename: string, id: string, title: string,
  sections: readonly PlatformScriptSection[], language: string, profile: OutputProfileId,
  colors: PlatformOptimizationInput["brandColors"], mode: "sequence" | "summary" = "sequence",
  template?: TemplateId): GeneratedArtwork | null {
  if (!sections.length) return null;
  const source = sourceFor(title, sections, id, language, mode);
  const layout = buildInfographic(source, {
    template: template ?? (mode === "summary" ? "editorial-overview" : "process-journey"), profile, artDirection: "editorial", density: "airy",
    styleOverride: colors ? { color: {
      canvas: colors.background, ink: colors.text, accent: colors.primary,
      accentStrong: colors.secondary, surface: colors.background,
    } } : undefined,
  });
  if (layout.diagnostics.some((item) => item.severity === "error")) return null;
  const output = layoutToSvg(layout);
  if (output.diagnostics.some((item) => item.severity === "error")) return null;
  return { id, label, filename, description: "Editable source-based Kumiki illustration; no stock or AI-generated photo.",
    layout, svg: output.svg, width: output.width, height: output.height,
    preview: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(output.svg)}` };
}

/** Three distinct, downloadable non-blog covers; blog gets an article hero and up to three substantive diagrams. */
export function generatePlatformArtwork(input: PlatformOptimizationInput, target: PlatformTarget, title: string): GeneratedArtwork[] {
  if (!canExportPlatformArtwork(input, target)) return [];
  const key = `${input.productionId}:${target}:${sourceSignature(input, target)}:${title}`;
  const cached = artworkCache.get(key);
  if (cached) return cached;
  const sections = sectionsFor(input, target).filter((section) => section.text.trim());
  if (!sections.length) return [];
  // Stable filename belongs to the production, while the headline in the
  // generated image follows the editable destination title.
  const safeName = platformSlug(input.title).slice(0, 58);
  if (target !== "blog") {
    const result = createCoverArtwork(title,sections,artProfile[target],input.brandColors,target,safeName);
    artworkCache.set(key, result);
    if (artworkCache.size > 16) artworkCache.delete(artworkCache.keys().next().value!);
    return result;
  }
  const cover = makeArtwork("Article hero",`${safeName}-${target}-cover.png`, `cover-${target}`,title,
    sections,input.language || "en",artProfile[target],input.brandColors);
  // Visuals must explain the *existing* script, never hallucinate concepts or
  // introduce unsourced charts. Use overlapping groups to cover the full article.
  const groups = sections.length > 3 ? [sections.slice(0, 2), sections.slice(1, 4), sections.slice(-2)] : [sections];
  const diagrams = groups.map((group, index) => makeArtwork(
    `Article illustration ${index + 1}`, `${safeName}-diagram-${index + 1}.png`,
    `article-${index + 1}`, `${title} · ${group[0]?.heading ?? "Overview"}`, group,
    input.language || "en", "youtube-landscape", input.brandColors,
    index === 1 && groups.length === 3 ? "sequence" : "summary")).filter((value): value is GeneratedArtwork => value !== null);
  const result = [...(cover ? [cover] : []), ...diagrams];
  artworkCache.set(key, result);
  if (artworkCache.size > 16) artworkCache.delete(artworkCache.keys().next().value!);
  return result;
}

/** Blog-ready Markdown with image references and article prose; downloaded PNGs go beside it. */
export function generateBlogMarkdown(input: PlatformOptimizationInput, title: string, artworks: readonly GeneratedArtwork[],
  summary = ""): string {
  if (!canExportPlatformArtwork(input, "blog")) throw new Error("Approve the current blog script before exporting an article.");
  const sections = sectionsFor(input, "blog").filter((section) => section.text.trim());
  const paragraphs = [`# ${title.trim()}`, summary.trim(), artworks[0] ? `![Article overview](${artworks[0].filename})` : ""];
  const diagrams = artworks.slice(1);
  sections.forEach((section, index) => {
    paragraphs.push(`## ${section.heading.trim()}`, section.text.trim());
    if (diagrams.length > 0 && index < diagrams.length) {
      paragraphs.push(`![Key ideas from the article: ${section.heading.trim()}](${diagrams[index].filename})`);
    }
  });
  const sources = blogSources(input);
  if (sources.length) paragraphs.push("## Sources to verify before publication",
    ...sources.map((source, index) => `${index + 1}. [Source ${index + 1}](${source.url.replace(/\)/gu, "%29")})${source.reviewStatus === "verified" ? "" : ` — ${source.reviewStatus}; verify before publishing`}`));
  return `${paragraphs.filter(Boolean).join("\n\n")}\n`;
}

export function blogSources(input: PlatformOptimizationInput): {url: string; reviewStatus: string}[] {
  const cited = new Set(sectionsFor(input, "blog").flatMap((section) => section.sourceRefs ?? []));
  const seen = new Set<string>();
  return (input.sourceEvidence ?? []).filter((source) => cited.has(source.sourceId)).flatMap((source) => {
    let url: URL;
    try { url = new URL(source.sourceUrl); } catch { return []; }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || seen.has(url.href)) return [];
    seen.add(url.href);
    return [{url: url.href, reviewStatus: source.reviewStatus}];
  });
}

/** Offline, self-contained illustrated HTML. Escape everything originating in a script. */
export function generateBlogHtml(input: PlatformOptimizationInput, title: string, summary: string,
  description: string, artworks: readonly GeneratedArtwork[]): string {
  if (!canExportPlatformArtwork(input, "blog")) throw new Error("Approve the current blog script before exporting an article.");
  const escape = (value: string) => value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
  const blocks = (value: string) => value.trim().split(/\n\s*\n/gu).filter(Boolean).map((block) => {
    const heading = block.match(/^#{2,4}\s+([^\n]+)$/u);
    return heading ? `<h3>${escape(heading[1])}</h3>` : `<p>${escape(block).replace(/\n/gu, "<br>")}</p>`;
  }).join("\n");
  const sections = sectionsFor(input, "blog").filter((section) => section.text.trim());
  const content = sections.map((section, index) => `<section><h2>${escape(section.heading)}</h2>${blocks(section.text)}${artworks[index + 1] ? `<figure><img src="${artworks[index + 1].preview}" alt="${escape(artworks[index + 1].label)}"></figure>` : ""}</section>`).join("\n");
  const hero = artworks[0] ? `<figure><img src="${artworks[0].preview}" alt="Overview of the article"></figure>` : "";
  const sources = blogSources(input);
  const links = sources.length ? `<section><h2>Sources to verify before publication</h2><ol>${sources.map((source, index) =>
    `<li><a href="${escape(source.url)}" rel="noopener noreferrer">Source ${index + 1}</a>${source.reviewStatus === "verified" ? "" : ` — ${escape(source.reviewStatus)}; verify before publishing`}</li>`).join("")}</ol></section>` : "";
  const language = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$/u.test(input.language || "en") ? input.language : "en";
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${escape(title)}</title><meta name="description" content="${escape(description)}"><style>body{font:18px/1.75 system-ui,sans-serif;max-width:780px;margin:5rem auto;padding:0 1.5rem;color:#172635}h1,h2,h3{line-height:1.2}h1{font-size:clamp(2rem,5vw,3.5rem)}h2{margin-top:3rem}h3{margin-top:2rem}figure{margin:2rem 0}img{max-width:100%;height:auto;border-radius:16px}p{white-space:pre-wrap}</style></head><body><article><h1>${escape(title)}</h1><p>${escape(summary)}</p>${hero}${content}${links}</article></body></html>`;
}

/** Kumiki's optional browser adapter produces actual PNGs, not a JSON-only reference. */
export async function artworkPng(art: GeneratedArtwork): Promise<Blob> {
  if(art.media){
    const fontCss=await loadExportFontCss();
    return (await documentToPng(art.media,{pixelRatio:1,...(fontCss?{fontCss}:{})})).blob;
  }
  if(art.layout)return layoutToPng(art.layout,{pixelRatio:1});
  throw Error("The selected artwork has no exportable layout.");
}

export function generatedArtworkCatalog(input: PlatformOptimizationInput): PlatformAsset[] {
  const targets = [...new Set(input.platforms.map(normalizeTarget).filter((p): p is PlatformTarget => p !== null))];
  return targets.flatMap((target) => {
    const art = generatePlatformArtwork(input, target, input.title)[0];
    if (!art) return [];
    return [{ id: `kumiki-art-${sourceSignature(input, target)}-${target}`, kind: target === "blog" ? "hero" as const : "thumbnail" as const,
      platform: target, filename: art.filename, width: art.width, height: art.height }];
  });
}
