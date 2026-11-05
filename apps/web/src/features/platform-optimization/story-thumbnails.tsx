/** Thumbnails from a film's own objects and numbers, composed with Kumiki's recipes.
 * Illustrations become SVG images, so every layer stays editable and nothing is fetched.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { FinanceObject2D } from "@/components/domains/finance-object-2d";
import { BusinessObject2D } from "@/components/domains/business-object-2d";
import { TechnologyObject2D } from "@/components/domains/technology-object-2d";
import type { FinanceObjectKind } from "@/components/domains/finance-object-model";
import type { BusinessObjectKind } from "@/components/domains/business-object-model";
import type { TechnologyObjectKind } from "@/components/domains/technology-object-model";
import type { FontAsset, ImageAsset } from "@/components/media/document";
import { documentToSvg } from "@/components/media/svg-export";
import { composeThumbnail } from "@/components/media/thumbnail-composition";
import type { ThumbnailRecipeId } from "@/components/media/thumbnail-composition";
import { inspectThumbnail } from "@/components/media/thumbnail-preflight";

export interface StoryThumbnailConcept {
  id: string;
  label: string;
  recipe: ThumbnailRecipeId;
  headline: string;
  cue?: string;
  primaryArt: string;
  secondaryArt?: string;
}

const FONT: FontAsset = { id: "display", family: "Geist Variable", weight: 800, style: "normal", fallback: ["Arial", "Helvetica", "sans-serif"], availability: "pinned", licenseId: "OFL-1.1" };
const SIZE = 640;

function artMarkup(name: string) {
  const [family, kind] = name.split(":");
  const props = { width: SIZE, height: SIZE, showTitle: false, reducedMotion: true } as const;
  if (family === "finance") return renderToStaticMarkup(<FinanceObject2D spec={{ id: kind, kind: kind as FinanceObjectKind }} {...props} />);
  if (family === "business") return renderToStaticMarkup(<BusinessObject2D spec={{ id: kind, kind: kind as BusinessObjectKind }} {...props} />);
  if (family === "technology") return renderToStaticMarkup(<TechnologyObject2D spec={{ id: kind, kind: kind as TechnologyObjectKind }} {...props} />);
  throw new Error(`Unknown thumbnail art "${name}".`);
}

function asset(id: string, art: string, alt: string): ImageAsset {
  const markup = artMarkup(art);
  const standalone = markup.includes("xmlns=") ? markup : markup.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  return { id, uri: `data:image/svg+xml;base64,${Buffer.from(standalone).toString("base64")}`, mediaType: "image/svg+xml", width: SIZE, height: SIZE, alt, licenseId: "kumiki-original-art" };
}

/** @returns artworks in the shape the thumbnail pipeline already exports, plus preflight findings. */
export function createStoryThumbnails(concepts: readonly StoryThumbnailConcept[]) {
  return concepts.map(concept => {
    const composed = composeThumbnail({ id: concept.id, recipe: concept.recipe, headline: concept.headline, ...(concept.cue ? { cue: concept.cue } : {}), font: FONT,
      primary: asset("primary", concept.primaryArt, concept.headline),
      ...(concept.secondaryArt ? { secondary: asset("secondary", concept.secondaryArt, concept.headline) } : {}) });
    const findings = inspectThumbnail({ document: composed.document, roles: composed.roles }, { availableFontFamilies: ["Geist Variable", "Arial", "Helvetica", "sans-serif"] });
    const output = documentToSvg(composed.document);
    const errors = [...output.diagnostics, ...findings].filter(item => item.severity === "error");
    if (errors.length) throw new Error(`Thumbnail ${concept.id}: ${errors.map(item => item.message).join(" ")}`);
    return { id: concept.id, label: concept.label, media: composed.document, svg: output.svg, width: output.size.width, height: output.size.height,
      findings: findings.map(item => item.code) };
  });
}
