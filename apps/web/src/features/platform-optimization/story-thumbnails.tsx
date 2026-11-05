/** Thumbnails from a film's own objects and numbers, composed with Kumiki's recipes.
 * Illustrations become SVG images, so every layer stays editable and nothing is fetched.
 */
import { renderToStaticMarkup } from "react-dom/server";
import type { FontAsset, ImageAsset } from "@/components/media/document";
import { documentToSvg } from "@/components/media/svg-export";
import { composeThumbnail } from "@/components/media/thumbnail-composition";
import type { ThumbnailRecipeId } from "@/components/media/thumbnail-composition";
import { inspectThumbnail } from "@/components/media/thumbnail-preflight";
import { StoryArt } from "../../video-export/story-art";

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
  return renderToStaticMarkup(<StoryArt name={name} width={SIZE} height={SIZE} />);
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
