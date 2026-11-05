/** Constraint-first editorial text placement, entirely coordinate/metric-based.
 * This computes positions before rendering: no screenshot recognition or LLM.
 * Coordinates use normalized [0,1] rectangles. The measurement adapter MUST
 * use the same loaded font metrics as the renderer (registry/media/text-layout).
 */
import { segmentText } from "../media/text-layout";
import type { MeasureText } from "../media/text-layout";
import type { Rect } from "../motion/types";

export interface ProtectedTextRequest {
  id: string;
  text: string;
  font: string;
  fontSizePx: number;
  lineHeightPx: number;
  viewport: { width: number; height: number };
  /** Projected subject bounds plus any protected action areas. */
  protectedRegions: readonly Rect[];
  maxLines?: number;
  safeMargin?: number;
  /** Explicit content area (e.g. from a ShortSafeFrame profile); replaces the uniform `safeMargin` rect. */
  safeRegion?: Rect;
  /** Regions text may never enter, such as interior reserved app UI. */
  avoidRegions?: readonly Rect[];
  gapPx?: number;
  placement?: readonly ("right" | "left" | "below" | "above")[];
  language?: string;
}
export interface PlacedText {
  id: string;
  lines: string[];
  rect: Rect;
  font: string;
  fontSizePx: number;
  lineHeightPx: number;
  placement: "right" | "left" | "below" | "above";
}
export interface ProtectedTextResult {
  ok: boolean;
  placement?: PlacedText;
  diagnostics: Array<{ code: "layout-impossible" | "text-measurer-unavailable" | "layout-invalid"; message: string }>;
}

export function intersectsRect(a: Rect, b: Rect, epsilon = 0): boolean {
  return Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > epsilon &&
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > epsilon;
}
const valid = (r: Rect) => [r.x, r.y, r.width, r.height].every(Number.isFinite) &&
  r.width >= 0 && r.height >= 0 && r.x >= 0 && r.y >= 0 && r.x + r.width <= 1 + 1e-6 && r.y + r.height <= 1 + 1e-6;

function wrapParagraph(text: string, widthPx: number, font: string, measure: MeasureText, language?: string): string[] | null {
  const words = segmentText(text, language);
  if (!words.length) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (!word.trim() && !line) continue;
    const proposed = (line + word).trimStart();
    if (measure(font, proposed) <= widthPx + 1e-6) { line = proposed; continue; }
    if (!line.trim() || measure(font, word.trim()) > widthPx + 1e-6) return null;
    lines.push(line.trimEnd());
    line = word.trimStart();
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

function wrapText(text: string, widthPx: number, font: string, measure: MeasureText, language?: string): string[] | null {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    const wrapped = wrapParagraph(paragraph, widthPx, font, measure, language);
    if (!wrapped) return null;
    lines.push(...(wrapped.length ? wrapped : [""]));
  }
  return lines;
}

/** Picks the first fitting safe region, not the first pretty-looking overlap.
 * All impossible layouts are explicit errors; never ellipsize or shrink below
 * the authored minimum font to hide the problem.
 */
export function placeProtectedText(request: ProtectedTextRequest, measure: MeasureText): ProtectedTextResult {
  const { viewport, protectedRegions, id, font, fontSizePx, lineHeightPx } = request;
  const fail = (code: ProtectedTextResult["diagnostics"][number]["code"], message: string): ProtectedTextResult =>
    ({ ok: false, diagnostics: [{ code, message }] });
  if (!id.trim() || !request.text.trim() || !font.trim() ||
    ![viewport.width, viewport.height, fontSizePx, lineHeightPx].every(x => Number.isFinite(x) && x > 0) ||
    lineHeightPx < fontSizePx || protectedRegions.some(r => !valid(r)) || (request.avoidRegions ?? []).some(r => !valid(r)) ||
    (request.safeRegion !== undefined && (!valid(request.safeRegion) || request.safeRegion.width <= 0 || request.safeRegion.height <= 0)) ||
    !Number.isFinite(request.safeMargin ?? .06) || (request.safeMargin ?? .06) < 0 || (request.safeMargin ?? .06) >= .3)
    return fail("layout-invalid", `Invalid viewport, font, safe margin or protected bounds for "${id}".`);
  const testWidth = measure(font, request.text.trim().slice(0, 1));
  if (!Number.isFinite(testWidth) || testWidth <= 0)
    return fail("text-measurer-unavailable", `"${id}": supply a loaded-font text measurer, not an uninitialized zero-width canvas.`);
  const m = request.safeMargin ?? .06, gapX = (request.gapPx ?? 20) / viewport.width, gapY = (request.gapPx ?? 20) / viewport.height;
  const safe: Rect = request.safeRegion ?? { x: m, y: m, width: 1 - m * 2, height: 1 - m * 2 };
  const blocked = [...protectedRegions, ...(request.avoidRegions ?? [])];
  const subject = protectedRegions[0] ?? { x: .5, y: .5, width: 0, height: 0 };
  const right = subject.x + subject.width, bottom = subject.y + subject.height;
  const rightX = Math.max(safe.x, right + gapX), belowY = Math.max(safe.y, bottom + gapY);
  const leftEnd = Math.min(safe.x + safe.width, subject.x - gapX), aboveEnd = Math.min(safe.y + safe.height, subject.y - gapY);
  const slots = {
    right: { x: rightX, y: safe.y, width: safe.x + safe.width - rightX, height: safe.height },
    left: { x: safe.x, y: safe.y, width: leftEnd - safe.x, height: safe.height },
    below: { x: safe.x, y: belowY, width: safe.width, height: safe.y + safe.height - belowY },
    above: { x: safe.x, y: safe.y, width: safe.width, height: aboveEnd - safe.y },
  } satisfies Record<PlacedText["placement"], Rect>;
  // An avoid region inside a slot (e.g. an app action column) narrows the slot
  // instead of rejecting it: try the slot, then its free sides, largest first.
  const around = (slot: Rect): Rect[] => (request.avoidRegions ?? []).filter(o => intersectsRect(slot, o)).flatMap(o => [
    { x: slot.x, y: slot.y, width: o.x - gapX - slot.x, height: slot.height },
    { x: o.x + o.width + gapX, y: slot.y, width: slot.x + slot.width - o.x - o.width - gapX, height: slot.height },
    { x: slot.x, y: slot.y, width: slot.width, height: o.y - gapY - slot.y },
    { x: slot.x, y: o.y + o.height + gapY, width: slot.width, height: slot.y + slot.height - o.y - o.height - gapY },
  ]).filter(r => r.width > 0 && r.height > 0).sort((a, b) => b.width * b.height - a.width * a.height);
  const choices = request.placement ?? ["right", "left", "below", "above"];
  for (const name of choices) for (const slot of [slots[name], ...(slots[name] ? around(slots[name]) : [])]) {
    if (!slot || slot.width <= 0 || slot.height <= 0) continue;
    const width = slot.width * viewport.width;
    const lines = wrapText(request.text, width, font, measure, request.language);
    if (!lines || !lines.length || (request.maxLines !== undefined && lines.length > request.maxLines)) continue;
    const height = lines.length * lineHeightPx;
    if (height > slot.height * viewport.height + 1e-5) continue;
    const actualWidth = Math.max(...lines.map(line => measure(font, line)));
    if (actualWidth > width + 1e-5) continue;
    const h = height / viewport.height, w = actualWidth / viewport.width;
    const centeredY = Math.max(slot.y, Math.min(slot.y + slot.height - h, subject.y + subject.height / 2 - h / 2));
    const x = name === "left" ? slot.x + slot.width - w : slot.x;
    const y = name === "left" || name === "right" ? centeredY : slot.y;
    const rect = { x, y, width: w, height: h };
    if (blocked.some(item => intersectsRect(rect, item, 1e-8))) continue;
    return { ok: true, placement: { id, lines, rect, font, fontSizePx, lineHeightPx, placement: name }, diagnostics: [] };
  }
  return fail("layout-impossible", `"${id}" cannot fit without covering a protected subject. Change composition, content, or viewport; do not silently truncate.`);
}
