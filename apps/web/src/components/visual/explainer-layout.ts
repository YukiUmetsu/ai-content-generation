import { placeProtectedText } from "./protected-text";
import type { PlacedText, ProtectedTextRequest, ProtectedTextResult } from "./protected-text";
import type { MeasureText } from "../media/text-layout";
import type { Rect } from "../motion/types";

export interface ProtectedSubjectRegion {
  id: string;
  /** Normalized output-space bounds, including the action area to protect. */
  region: Rect;
  portraitRegion?: Rect;
}
export interface ExplainerLayoutRequest extends Omit<ProtectedTextRequest, "id" | "protectedRegions"> {
  subjects: readonly ProtectedSubjectRegion[];
  protect: readonly string[];
}
export type ExplainerLayoutResult =
  | { ok: true; orientation: "landscape" | "portrait"; text: PlacedText; subjects: Array<{ id: string; region: Rect }> }
  | { ok: false; diagnostics: ProtectedTextResult["diagnostics"] };

/** Pure composition decision. The renderer supplies actual loaded-font widths. */
export function planExplainerLayout(request: ExplainerLayoutRequest, measure: MeasureText): ExplainerLayoutResult {
  const invalid = (message: string): ExplainerLayoutResult => ({ ok: false, diagnostics: [{ code: "layout-invalid", message }] });
  const orientation = request.viewport.width >= request.viewport.height ? "landscape" : "portrait";
  const byId = new Map<string, Rect>();
  for (const subject of request.subjects) {
    if (!subject.id.trim() || byId.has(subject.id)) return invalid(`Subject "${subject.id}" needs a unique nonempty semantic ID.`);
    const region = orientation === "portrait" ? subject.portraitRegion ?? subject.region : subject.region;
    if (![region.x, region.y, region.width, region.height].every(Number.isFinite) || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 || region.x + region.width > 1 || region.y + region.height > 1)
      return invalid(`Subject "${subject.id}" needs positive normalized bounds inside the output. Correct its projected region.`);
    byId.set(subject.id, region);
  }
  if (request.maxLines !== undefined && (!Number.isSafeInteger(request.maxLines) || request.maxLines < 1)) return invalid("maxLines must be a positive integer. Increase the line budget or shorten the explanation.");
  if (!Number.isFinite(request.gapPx ?? 20) || (request.gapPx ?? 20) < 0) return invalid("gapPx must be finite and nonnegative.");
  const subjects: Array<{ id: string; region: Rect }> = [];
  for (const id of new Set(request.protect)) {
    const region = byId.get(id);
    if (!region) return invalid(`Protected subject "${id}" is missing. Declare its output-space region in subjects.`);
    subjects.push({ id, region });
  }
  // Anchor candidates around the complete protected union, avoiding dependence
  // on declaration order. This deliberately favors conservative safe regions.
  const regions = subjects.map(subject => subject.region);
  if (regions.length > 1) {
    const x = Math.min(...regions.map(r => r.x)), y = Math.min(...regions.map(r => r.y));
    regions.unshift({ x, y, width: Math.max(...regions.map(r => r.x + r.width)) - x, height: Math.max(...regions.map(r => r.y + r.height)) - y });
  }
  try {
    const measured: MeasureText = (font, text) => {
      const width = measure(font, text);
      if (!Number.isFinite(width) || width < 0) throw new Error("Font measurement is unavailable. Load the rendering font and retry layout.");
      return width;
    };
    const result = placeProtectedText({ ...request, id: "explainer-text", protectedRegions: regions,
      placement: request.placement ?? (orientation === "portrait" ? ["below", "above", "right", "left"] : ["right", "left", "below", "above"]) }, measured);
    return result.ok && result.placement ? { ok: true, orientation, text: result.placement, subjects } : { ok: false, diagnostics: result.diagnostics };
  } catch (cause) {
    return { ok: false, diagnostics: [{ code: "text-measurer-unavailable", message: `Cannot measure explanation: ${cause instanceof Error ? cause.message : String(cause)}` }] };
  }
}
