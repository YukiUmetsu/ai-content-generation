/**
 * Text outlines for `AdvancedShapeMorph` (registry item `shape-morph`).
 *
 * `traceTextOutline` draws text with any font that the page can render (Latin, CJK, Arabic, emoji-free
 * scripts) and traces the glyph edges from the antialiasing coverage with sub-pixel accuracy. The result is
 * a list of point rings that `AdvancedShapeMorph` accepts directly; nesting finds the counters (holes) of
 * letters such as `A`, `B`, `O` and `口`. No font file and no parser dependency are needed.
 *
 * When exact vector outlines are available, pass SVG path data to the morph instead, for example
 * `font.getPath(text, 0, 0, size).toPathData()` from a font parser.
 *
 * Load the font before tracing (`await document.fonts.load(font)`), otherwise the browser draws a fallback
 * face.
 */

/** Drawing surface: an `OffscreenCanvas`, an `HTMLCanvasElement` or a compatible server-side canvas. */
export interface MorphTextCanvas {
  width: number;
  height: number;
  getContext(type: "2d", options?: { willReadFrequently?: boolean }): MorphTextContext | null;
}

/** The subset of the Canvas 2D API that the tracer uses. */
export interface MorphTextContext {
  font: string;
  textBaseline: CanvasTextBaseline;
  fillStyle: string | CanvasGradient | CanvasPattern;
  letterSpacing?: string;
  measureText(text: string): TextMetrics;
  fillText(text: string, x: number, y: number): void;
  getImageData(x: number, y: number, width: number, height: number): ImageData;
}

export interface MorphTextOptions {
  /** CSS font shorthand with a pixel size, for example `"700 180px Geist, sans-serif"`. The size sets the tracing resolution. */
  font: string;
  /** Line height as a multiple of the font size. Default 1.15. */
  lineHeight?: number;
  /** Horizontal alignment of lines in a multi-line string. Default `center`. */
  align?: "start" | "center" | "end";
  /** CSS letter spacing, for example `"0.04em"`, where the canvas supports it. */
  letterSpacing?: string;
  /** Maximum distance in pixels between the traced edge and its simplified ring. Default 0.25. */
  tolerance?: number;
  /** Rings with less area than this, in square pixels, are dropped as antialiasing noise. Default 4. */
  minArea?: number;
  /** Canvas factory for workers or servers. Default: `OffscreenCanvas`, then `document.createElement("canvas")`. */
  createCanvas?: (width: number, height: number) => MorphTextCanvas;
}

export interface MorphTextOutline {
  /** Closed rings in pixels, origin at the top-left of the text box. Pass them to `AdvancedShapeMorph`. */
  rings: [number, number][][];
  width: number;
  height: number;
}

const MAX_CANVAS_PIXELS = 16_777_216;

function defaultCanvas(width: number, height: number): MorphTextCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height) as unknown as MorphTextCanvas;
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas as unknown as MorphTextCanvas;
  }
  throw new Error("traceTextOutline needs a canvas. Pass options.createCanvas outside a browser or worker.");
}

function fontPixelSize(font: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font);
  if (!match) throw new RangeError(`traceTextOutline font "${font}" must state its size in px, for example "700 160px Geist".`);
  return Number(match[1]);
}

/** Perpendicular distance from (px, py) to the segment a–b. */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq)) : 0;
  return Math.hypot(ax + dx * t - px, ay + dy * t - py);
}

function simplifyOpen(points: number[], first: number, last: number, tolerance: number, keep: Uint8Array): void {
  let index = -1;
  let worst = tolerance;
  for (let i = first + 1; i < last; i += 1) {
    const d = segmentDistance(points[2 * i], points[2 * i + 1], points[2 * first], points[2 * first + 1], points[2 * last], points[2 * last + 1]);
    if (d > worst) {
      worst = d;
      index = i;
    }
  }
  if (index < 0) return;
  keep[index] = 1;
  simplifyOpen(points, first, index, tolerance, keep);
  simplifyOpen(points, index, last, tolerance, keep);
}

/** Ramer–Douglas–Peucker for a closed ring, anchored at the vertex farthest from vertex 0. */
function simplifyClosed(points: number[], tolerance: number): [number, number][] {
  const n = points.length >> 1;
  if (n <= 4 || tolerance <= 0) return Array.from({ length: n }, (_, i) => [points[2 * i], points[2 * i + 1]]);
  let far = 0;
  let farDistance = -1;
  for (let i = 1; i < n; i += 1) {
    const d = Math.hypot(points[2 * i] - points[0], points[2 * i + 1] - points[1]);
    if (d > farDistance) {
      farDistance = d;
      far = i;
    }
  }
  const loop = [...points, points[0], points[1]];
  const keep = new Uint8Array(n + 1);
  keep[0] = 1;
  keep[far] = 1;
  keep[n] = 1;
  simplifyOpen(loop, 0, far, tolerance, keep);
  simplifyOpen(loop, far, n, tolerance, keep);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i += 1) if (keep[i]) out.push([points[2 * i], points[2 * i + 1]]);
  return out;
}

function ringArea(ring: readonly [number, number][]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return sum / 2;
}

/**
 * Trace iso-contours of a coverage field (marching squares). `alpha` holds one value per pixel in row order;
 * samples sit at pixel centres. Crossings are interpolated linearly between samples, so antialiased edges
 * give sub-pixel positions. Saddle cells are resolved by the cell's mean value. Rings are closed and their
 * orientation is not normalized; `AdvancedShapeMorph` nests and orients them.
 */
export function traceAlphaContours(
  alpha: ArrayLike<number>, width: number, height: number,
  options: { threshold?: number; tolerance?: number; minArea?: number; stride?: number; offset?: number } = {},
): [number, number][][] {
  const threshold = options.threshold ?? 127.5;
  const stride = options.stride ?? 1;
  const offset = options.offset ?? 0;
  const sample = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : alpha[(y * width + x) * stride + offset];
  const columns = width + 2;
  const edgeId = (x: number, y: number, vertical: boolean): number => (((y + 1) * columns + (x + 1)) << 1) | (vertical ? 1 : 0);
  const points = new Map<number, [number, number]>();
  const crossing = (x: number, y: number, vertical: boolean): number => {
    const id = edgeId(x, y, vertical);
    if (!points.has(id)) {
      const a = sample(x, y);
      const b = vertical ? sample(x, y + 1) : sample(x + 1, y);
      const f = a === b ? 0.5 : (threshold - a) / (b - a);
      points.set(id, vertical ? [x + 0.5, y + 0.5 + f] : [x + 0.5 + f, y + 0.5]);
    }
    return id;
  };
  const segments: number[] = [];
  for (let y = -1; y < height; y += 1) {
    for (let x = -1; x < width; x += 1) {
      const tl = sample(x, y);
      const tr = sample(x + 1, y);
      const br = sample(x + 1, y + 1);
      const bl = sample(x, y + 1);
      const code = (tl >= threshold ? 8 : 0) | (tr >= threshold ? 4 : 0) | (br >= threshold ? 2 : 0) | (bl >= threshold ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = () => crossing(x, y, false);
      const bottom = () => crossing(x, y + 1, false);
      const left = () => crossing(x, y, true);
      const right = () => crossing(x + 1, y, true);
      const centreInside = (tl + tr + br + bl) / 4 >= threshold;
      switch (code) {
        case 1: case 14: segments.push(left(), bottom()); break;
        case 2: case 13: segments.push(bottom(), right()); break;
        case 3: case 12: segments.push(left(), right()); break;
        case 4: case 11: segments.push(top(), right()); break;
        case 6: case 9: segments.push(top(), bottom()); break;
        case 7: case 8: segments.push(left(), top()); break;
        case 5:
          if (centreInside) segments.push(left(), top(), bottom(), right());
          else segments.push(top(), right(), left(), bottom());
          break;
        case 10:
          if (centreInside) segments.push(top(), right(), left(), bottom());
          else segments.push(left(), top(), bottom(), right());
          break;
      }
    }
  }
  // Every crossing point is shared by the two cells on either side of its edge; link segments through it.
  const owners = new Map<number, number[]>();
  for (let s = 0; s < segments.length; s += 1) {
    const list = owners.get(segments[s]);
    if (list) list.push(s);
    else owners.set(segments[s], [s]);
  }
  const used = new Uint8Array(segments.length >> 1);
  const rings: [number, number][][] = [];
  const tolerance = options.tolerance ?? 0.25;
  const minArea = options.minArea ?? 4;
  for (let start = 0; start < used.length; start += 1) {
    if (used[start]) continue;
    // Walk from segment to segment through shared crossing points; each step records the exit point.
    const loop: number[] = [];
    used[start] = 1;
    let exit = 2 * start + 1;
    for (;;) {
      const id = segments[exit];
      const point = points.get(id)!;
      loop.push(point[0], point[1]);
      const next = owners.get(id)?.find((end) => !used[end >> 1]);
      if (next === undefined) break;
      used[next >> 1] = 1;
      exit = next ^ 1;
    }
    if (loop.length < 6) continue;
    const ring = simplifyClosed(loop, tolerance);
    if (ring.length >= 3 && Math.abs(ringArea(ring)) >= minArea) rings.push(ring);
  }
  return rings;
}

/**
 * Draw `text` with `options.font` and trace its glyph outlines. Lines split on `\n`. Coordinates are in
 * pixels from the top-left of the text box.
 */
export function traceTextOutline(text: string, options: MorphTextOptions): MorphTextOutline {
  const size = fontPixelSize(options.font);
  const lines = text.split("\n");
  const createCanvas = options.createCanvas ?? defaultCanvas;
  const probe = createCanvas(1, 1).getContext("2d");
  if (!probe) throw new Error("traceTextOutline could not get a 2D canvas context.");
  probe.font = options.font;
  if (options.letterSpacing !== undefined && "letterSpacing" in probe) probe.letterSpacing = options.letterSpacing;
  const pad = Math.ceil(size * 0.25) + 2;
  const lineHeight = size * (options.lineHeight ?? 1.15);
  const metrics = lines.map((line) => probe.measureText(line));
  const ascent = Math.max(size * 0.8, ...metrics.map((m) => m.actualBoundingBoxAscent || 0));
  const descent = Math.max(size * 0.25, ...metrics.map((m) => m.actualBoundingBoxDescent || 0));
  const widths = metrics.map((m) => Math.max(m.width, (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || 0)));
  const textWidth = Math.max(1, ...widths);
  const width = Math.ceil(textWidth + 2 * pad);
  const height = Math.ceil(ascent + descent + (lines.length - 1) * lineHeight + 2 * pad);
  if (width * height > MAX_CANVAS_PIXELS) {
    throw new RangeError(`traceTextOutline needs a ${width} × ${height} canvas, which is too large. Use a smaller font size or shorter lines.`);
  }
  const canvas = createCanvas(width, height);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("traceTextOutline could not get a 2D canvas context.");
  ctx.font = options.font;
  if (options.letterSpacing !== undefined && "letterSpacing" in ctx) ctx.letterSpacing = options.letterSpacing;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#000";
  const align = options.align ?? "center";
  lines.forEach((line, index) => {
    const m = metrics[index];
    const free = textWidth - widths[index];
    const x = pad + (m.actualBoundingBoxLeft || 0) + (align === "start" ? 0 : align === "end" ? free : free / 2);
    ctx.fillText(line, x, pad + ascent + index * lineHeight);
  });
  const image = ctx.getImageData(0, 0, width, height);
  const rings = traceAlphaContours(image.data, width, height, {
    stride: 4, offset: 3, tolerance: options.tolerance, minArea: options.minArea,
  });
  return { rings, width, height };
}
