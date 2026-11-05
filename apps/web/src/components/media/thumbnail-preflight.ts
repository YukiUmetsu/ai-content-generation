/**
 * Objective, opt-in inspection for semantic static thumbnail compositions.
 * Works on editable layer geometry; never assumes pixels identify a subject,
 * predicts CTR, grades aesthetics or substitutes for visual acceptance.
 */
import {
  intersectionArea, layerBounds, rectsIntersect,
  type Diagnostic, type Layer, type MediaDocument, type Rect,
} from "./document";
import { createExportMeasurer, preflightExport } from "./svg-export";
import { createCanvasMeasurer, layoutText } from "./text-layout";
import type { ThumbnailCompositionRoles } from "./thumbnail-composition";

/** Legacy and editorial compositions share the same explicit critical-layer roles. */
export interface ThumbnailInspectionTarget {
  document: MediaDocument;
  roles: ThumbnailCompositionRoles & { headlineIds?: readonly string[] };
}

export interface ThumbnailReservedCorner {
  /** Percent of final width/height reserved for downstream UI (e.g. duration badge). */
  widthRatio: number;
  heightRatio: number;
}

export interface ThumbnailPreflightOptions {
  /** Widths actually seen in a destination feed. Every width is checked; defaults to 320/160/96. */
  inspectionWidths?: readonly number[];
  /** Set to null for a destination with no bottom-right UI overlay. */
  reservedCorner?: ThumbnailReservedCorner | null;
  /** Explicit author-approved overlaps; pair order does not matter. */
  intentionalOverlaps?: readonly (readonly [string, string])[];
  /** Optional user-measured focal bounds in *artboard coordinates*, not image pixels. */
  subjectRegions?: Partial<Record<"primary" | "secondary", Rect>>;
  /** Area of the primary subject frame compared to the output canvas. @default .12 */
  minPrimaryAreaRatio?: number;
  /** Minimum readable heading glyph size at *each* inspection width (absolute output px). @default 7 */
  minHeadlineDisplayPx?: number;
  /** Minimum readable cue glyph size at *each* inspection width (absolute output px). @default 5 */
  minCueDisplayPx?: number;
  /** Essential media/text layers above this count are a density risk. @default 6 */
  maxEssentialLayers?: number;
  availableFontFamilies?: readonly string[];
}

function issue(code: string, message: string, severity: Diagnostic["severity"] = "warning", layerId?: string): Diagnostic {
  return { code, severity, message, ...(layerId ? { layerId } : {}) };
}

function isPositiveRect(rect: Rect): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
}

function getLayer(doc: MediaDocument, id: string | undefined): Layer | undefined {
  return id ? doc.layers.find((layer) => layer.id === id && layer.visible) : undefined;
}

function clipping(rect: Rect, frame: Rect): boolean {
  return !isPositiveRect(rect) || rect.x < frame.x || rect.y < frame.y ||
    rect.x + rect.width > frame.x + frame.width || rect.y + rect.height > frame.y + frame.height;
}

function approved(overlaps: ThumbnailPreflightOptions["intentionalOverlaps"], a: string, b: string): boolean {
  return Boolean(overlaps?.some(([first, second]) =>
    (first === a && second === b) || (first === b && second === a)));
}

function validateOptions(options: ThumbnailPreflightOptions): void {
  if (options.reservedCorner && [options.reservedCorner.widthRatio, options.reservedCorner.heightRatio]
    .some((ratio) => !Number.isFinite(ratio) || ratio < 0 || ratio > 1)) {
    throw new RangeError("Reserved corner ratios must be finite numbers in [0,1].");
  }
  if (options.inspectionWidths && (options.inspectionWidths.length === 0 ||
    options.inspectionWidths.some((width) => !Number.isFinite(width) || width <= 0))) {
    throw new RangeError("Inspection widths must be a nonempty list of positive finite pixel values.");
  }
  for (const [name, value, maximum] of [
    ["minPrimaryAreaRatio", options.minPrimaryAreaRatio, 1],
    ["minHeadlineDisplayPx", options.minHeadlineDisplayPx, Infinity],
    ["minCueDisplayPx", options.minCueDisplayPx, Infinity],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > maximum))
      throw new RangeError(`${name} must be a nonnegative finite value no larger than ${maximum}.`);
  }
  if (options.maxEssentialLayers !== undefined && (!Number.isSafeInteger(options.maxEssentialLayers) || options.maxEssentialLayers < 0))
    throw new RangeError("maxEssentialLayers must be a nonnegative integer.");
}

/** Include ordinary export issues first; return only verifiable geometry/legibility risks. */
export function inspectThumbnail(
  result: ThumbnailInspectionTarget,
  options: ThumbnailPreflightOptions = {}
): Diagnostic[] {
  validateOptions(options);
  const { document, roles } = result;
  const issues = preflightExport(document, { availableFontFamilies: options.availableFontFamilies });
  const frame = { x: 0, y: 0, width: document.artboard.width, height: document.artboard.height };
  const primary = getLayer(document, roles.primaryId);
  const secondary = getLayer(document, roles.secondaryId);
  const headlineIds = [...new Set(roles.headlineIds?.length ? roles.headlineIds : [roles.headlineId])];
  const headlines = headlineIds.map((id) => ({ id, layer: getLayer(document, id) }));
  const cue = getLayer(document, roles.cueId);

  for (const [id, layer] of [[roles.primaryId, primary],
    ...headlines.map(({ id, layer }) => [id, layer]),
    ...(roles.secondaryId ? [[roles.secondaryId, secondary]] : [])] as Array<[string, Layer | undefined]>) {
    if (!layer) issues.push(issue("thumbnail-critical-layer-missing", `Essential thumbnail layer is missing or hidden: ${id}.`, "error", id));
  }

  const declaredSubjects = [
    { id: roles.primaryId, layer: primary, bounds: options.subjectRegions?.primary },
    ...(roles.secondaryId ? [{ id: roles.secondaryId, layer: secondary, bounds: options.subjectRegions?.secondary }] : []),
  ];
  for (const subject of declaredSubjects) {
    if (!subject.layer) continue;
    const bounds = subject.bounds ?? layerBounds(subject.layer);
    if (clipping(bounds, frame))
      issues.push(issue("thumbnail-subject-clipped", "Critical subject frame extends outside the output canvas; reframe it or adjust its declared visible bounds.", "error", subject.id));
    if (subject.id === roles.primaryId && bounds.width * bounds.height / (frame.width * frame.height) < (options.minPrimaryAreaRatio ?? .12))
      issues.push(issue("thumbnail-primary-too-small", "Primary subject's declared frame occupies too little of the output; make the visual more prominent.", "warning", subject.id));
  }

  // Text/subject overlaps are risky only for declared essential layers; deliberately
  // painted backgrounds and image transparency cannot be inferred from these boxes.
  for (const textLayer of [...headlines.map((entry) => entry.layer), cue]) {
    if (!textLayer) continue;
    const box = layerBounds(textLayer);
    for (const subject of declaredSubjects) {
      if (!subject.layer || approved(options.intentionalOverlaps, textLayer.id, subject.id)) continue;
      const visual = subject.bounds ?? layerBounds(subject.layer);
      // Touching edges are fine. Ignore barely overlapping bounding boxes (<1%).
      if (rectsIntersect(box, visual) && intersectionArea(box, visual) / (box.width * box.height) > .01)
        issues.push(issue("thumbnail-text-subject-overlap", "Important text overlaps a protected subject's declared frame; move it into negative space or explicitly allow the layering.", "warning", textLayer.id));
    }
  }

  const reserved = options.reservedCorner === null ? null : options.reservedCorner ?? { widthRatio: .18, heightRatio: .12 };
  if (reserved) {
    const region: Rect = { x: frame.width * (1 - reserved.widthRatio), y: frame.height * (1 - reserved.heightRatio),
      width: frame.width * reserved.widthRatio, height: frame.height * reserved.heightRatio };
    for (const layer of [...headlines.map((entry) => entry.layer), cue]) {
      if (layer && rectsIntersect(layerBounds(layer), region))
        issues.push(issue("thumbnail-reserved-region", "Essential text intersects the reserved lower-right UI corner.", "warning", layer.id));
    }
  }

  // Use the SVG exporter's own text measurer to catch layouts that cannot fit
  // even at their declared minimum size. Without a browser canvas, its fallback
  // metrics are approximate; final glyph rendering still needs visual review.
  const widths = [...new Set(options.inspectionWidths ?? [320, 160, 96])].sort((a, b) => a - b);
  const measure = createExportMeasurer(document.fonts);
  if ([...headlines.map((entry) => entry.layer), cue].some((layer) => layer?.kind === "text") &&
    createCanvasMeasurer(document.fonts)("normal 24px sans-serif", "Mm") === 0) {
    issues.push(issue("thumbnail-text-metrics-estimated", "Canvas glyph measurements were unavailable; text size and overflow checks use estimated advances. Verify with the final embedded font in a browser.", "warning"));
  }
  const criticalText: Array<readonly [Layer | undefined, number]> = [
    ...headlines.map(({ layer }): readonly [Layer | undefined, number] => [layer, options.minHeadlineDisplayPx ?? 7]),
    [cue, options.minCueDisplayPx ?? 5],
  ];
  for (const [layer, minimum] of criticalText) {
    if (layer?.kind !== "text") continue;
    const resolved = layoutText(layer.text,
      { width: layer.transform.width, height: layer.transform.height },
      document.fonts, measure);
    if (resolved.overflow || resolved.truncated)
      issues.push(issue("thumbnail-text-overflow", "Essential text cannot fit its box at the declared minimum size; shorten the wording or enlarge the text area.", "error", layer.id));
    for (const checkWidth of widths) {
      const displayed = resolved.size * checkWidth / frame.width;
      if (displayed < minimum)
        issues.push(issue("thumbnail-text-too-small", `Fitted text is approximately ${displayed.toFixed(1)}px at ${checkWidth}px output (minimum ${minimum}px); enlarge the text or simplify the wording.`, "warning", layer.id));
    }
  }

  const essential = document.layers.filter((layer) => layer.visible &&
    (layer.kind === "text" || (layer.kind === "media" && !layer.media.decorative)));
  if (essential.length > (options.maxEssentialLayers ?? 6))
    issues.push(issue("thumbnail-density-risk", `This still has ${essential.length} visible text/media layers; reduce competing elements or stage the information elsewhere.`));
  return issues;
}
