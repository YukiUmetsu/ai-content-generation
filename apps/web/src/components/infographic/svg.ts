/**
 * Static export — the layout is already the geometry, so this is serialization.
 *
 * `layoutToSvg` walks an {@link InfographicLayout} and emits SVG with no
 * measurement, no layout and no font loading at export time: text lines were
 * wrapped and positioned during layout, and arrowheads were baked into real
 * paths by the connector factory. That is what makes the exported still agree
 * with the preview pixel-for-pixel (docs/11: "one document, many backends").
 *
 * Determinism is enforced: attribute order is fixed, numbers are rounded once,
 * ids come from the layout, and nothing reads the clock or the environment. The
 * same layout always produces byte-identical output.
 */

import { baselineOffset } from "./measure";
import { cornerRadius, resolvePaint, textAnchorX } from "./paint";
import type { PaintDef, ResolvedPaint } from "./paint";
import { round, strokeDashArray } from "./primitives";
import type {
  InfographicDiagnostic,
  InfographicLayout,
  InfographicPrimitive,
  RectInfo,
  TextPrimitive,
} from "./types";

export interface SvgLayoutOptions {
  /** Emit the layout's own background primitive. @default true */
  includeBackground?: boolean;
  /** Decimal precision for coordinates. @default 3 */
  precision?: number;
  /** Extra attributes for the root `<svg>` element. */
  attributes?: Record<string, string>;
  /** Emit `<title>`/`<desc>` for assistive technology. @default true */
  accessible?: boolean;
  /** CSS class applied to the root `<svg>`. */
  className?: string;
  /** Page to embed in the accessible description. @default the layout's own page */
  page?: number;
}

export interface SvgLayoutResult {
  svg: string;
  width: number;
  height: number;
  diagnostics: InfographicDiagnostic[];
}

/** Minimal XML escaping — text is user content, so this is not optional. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function number(value: number, precision: number): string {
  const rounded = round(value, precision);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(precision).replace(/0+$/, "").replace(/\.$/, "");
}

function commonAttributes(primitive: InfographicPrimitive, precision: number): string[] {
  const attributes: string[] = [
    `id="${escapeXml(primitive.id)}"`,
    `data-km-primitive="${primitive.kind}"`,
  ];
  if (primitive.role) attributes.push(`data-km-role="${escapeXml(primitive.role)}"`);
  if (primitive.semanticId) attributes.push(`data-km-semantic-id="${escapeXml(primitive.semanticId)}"`);
  if (primitive.opacity !== undefined && primitive.opacity !== 1) {
    attributes.push(`opacity="${number(primitive.opacity, precision)}"`);
  }
  return attributes;
}

function paintAttributes(
  primitive: { fill?: string; stroke?: string; strokeWidth?: number; dash?: string },
  precision: number
): string[] {
  const attributes: string[] = [];
  attributes.push(`fill="${primitive.fill ? escapeXml(primitive.fill) : "none"}"`);
  if (primitive.stroke) {
    attributes.push(`stroke="${escapeXml(primitive.stroke)}"`);
    attributes.push(`stroke-width="${number(primitive.strokeWidth ?? 1, precision)}"`);
    if (primitive.strokeWidth !== undefined) {
      attributes.push('stroke-linecap="round"');
      attributes.push('stroke-linejoin="round"');
    }
    const dash = strokeDashArray(primitive.dash, primitive.strokeWidth ?? 1);
    if (dash) attributes.push(`stroke-dasharray="${dash}"`);
  }
  return attributes;
}

/** Serialize gradient and shadow definitions exactly as `react.tsx` draws them. */
export function paintDefsToSvg(defs: readonly PaintDef[], precision: number): string {
  if (defs.length === 0) return "";
  const body = defs.map((def) => {
    if (def.kind === "gradient") {
      return `<linearGradient id="${escapeXml(def.id)}" gradientUnits="userSpaceOnUse" x1="${number(def.x1, precision)}" y1="${number(def.y1, precision)}" x2="${number(def.x2, precision)}" y2="${number(def.y2, precision)}"><stop offset="0" stop-color="${escapeXml(def.from)}" /><stop offset="1" stop-color="${escapeXml(def.to)}" stop-opacity="${number(def.toOpacity, precision)}" /></linearGradient>`;
    }
    const layers = def.layers
      .map((layer) => `<feDropShadow dx="0" dy="${number(layer.dy, precision)}" stdDeviation="${number(layer.blur / 2, precision)}" flood-color="${escapeXml(def.color)}" flood-opacity="${number(layer.opacity, precision)}" />`)
      .join("");
    return `<filter id="${escapeXml(def.id)}" filterUnits="userSpaceOnUse" x="${number(def.x, precision)}" y="${number(def.y, precision)}" width="${number(def.width, precision)}" height="${number(def.height, precision)}" color-interpolation-filters="sRGB">${layers}</filter>`;
  });
  return `<defs>${body.join("")}</defs>`;
}

function textAttributes(primitive: TextPrimitive, precision: number): string[] {
  const anchor = primitive.align === "center" ? "middle" : primitive.align === "end" ? "end" : "start";
  const attributes: string[] = [
    `font-family="${escapeXml(primitive.family)}"`,
    `font-size="${number(primitive.fontSize, precision)}"`,
    `fill="${escapeXml(primitive.color)}"`,
    `text-anchor="${anchor}"`,
  ];
  if (primitive.weight !== undefined) attributes.push(`font-weight="${primitive.weight}"`);
  if (primitive.italic) attributes.push('font-style="italic"');
  if (primitive.letterSpacing) attributes.push(`letter-spacing="${number(primitive.letterSpacing, precision)}"`);
  if (primitive.tabular) attributes.push('style="font-variant-numeric:tabular-nums"');
  return attributes;
}

/**
 * Serialize one primitive. Exported so tests can assert single-primitive output
 * and so other adapters (canvas, PDF) can reuse the same attribute decisions.
 */
export function primitiveToSvg(
  primitive: InfographicPrimitive,
  precision: number,
  diagnostics: InfographicDiagnostic[],
  paint?: ResolvedPaint
): string {
  const markerEnd = "markerEnd" in primitive ? primitive.markerEnd : undefined;
  if (markerEnd && markerEnd !== "none") {
    diagnostics.push({
      code: "svg-marker-ignored",
      severity: "warning",
      message: `Primitive "${primitive.id}" carries markerEnd="${markerEnd}"; arrowheads are baked into paths by the connector factory and are not re-emitted.`,
      primitiveId: primitive.id,
    });
  }

  const attributes = commonAttributes(primitive, precision);
  const filter = paint?.filterFor(primitive);
  if (filter) attributes.push(`filter="${filter}"`);
  const fill = paint?.fillFor(primitive);
  const painted = <T extends { fill?: string }>(shape: T): T => (fill === undefined ? shape : { ...shape, fill });

  switch (primitive.kind) {
    case "rect": {
      attributes.push(`x="${number(primitive.x, precision)}"`, `y="${number(primitive.y, precision)}"`);
      attributes.push(`width="${number(primitive.width, precision)}"`, `height="${number(primitive.height, precision)}"`);
      const radius = cornerRadius(primitive);
      if (radius) attributes.push(`rx="${number(radius, precision)}"`, `ry="${number(radius, precision)}"`);
      attributes.push(...paintAttributes(painted(primitive), precision));
      return `<rect ${attributes.join(" ")} />`;
    }
    case "ellipse": {
      attributes.push(
        `cx="${number(primitive.x + primitive.width / 2, precision)}"`,
        `cy="${number(primitive.y + primitive.height / 2, precision)}"`,
        `rx="${number(primitive.width / 2, precision)}"`,
        `ry="${number(primitive.height / 2, precision)}"`
      );
      attributes.push(...paintAttributes(painted(primitive), precision));
      return `<ellipse ${attributes.join(" ")} />`;
    }
    case "line": {
      attributes.push(
        `x1="${number(primitive.x1, precision)}"`,
        `y1="${number(primitive.y1, precision)}"`,
        `x2="${number(primitive.x2, precision)}"`,
        `y2="${number(primitive.y2, precision)}"`
      );
      attributes.push(...paintAttributes({ ...primitive, fill: undefined }, precision));
      return `<line ${attributes.join(" ")} />`;
    }
    case "polyline": {
      const points = primitive.points
        .map(([x, y]) => `${number(x, precision)},${number(y, precision)}`)
        .join(" ");
      attributes.push(`points="${points}"`);
      if (primitive.closed) attributes.push('data-km-closed="true"');
      attributes.push(...paintAttributes(primitive, precision));
      return `<polyline ${attributes.join(" ")} />`;
    }
    case "path": {
      attributes.push(`d="${primitive.d}"`);
      attributes.push(...paintAttributes(painted(primitive), precision));
      return `<path ${attributes.join(" ")} />`;
    }
    case "text": {
      // `text-anchor` positions glyphs relative to x, so the anchor x must move
      // with the alignment — identical to the DOM preview in `react.tsx`.
      const x = textAnchorX(primitive);
      attributes.push(`x="${number(x, precision)}"`);
      attributes.push(`y="${number(primitive.y, precision)}"`);
      if (primitive.width) attributes.push(`data-km-width="${number(primitive.width, precision)}"`);
      attributes.push(...textAttributes(primitive, precision));
      const lines = primitive.lines.map((line, index) => {
        const y = round(primitive.y + baselineOffset(index, primitive.fontSize, primitive.lineHeight), precision);
        return `<tspan x="${number(x, precision)}" y="${number(y, precision)}">${escapeXml(line)}</tspan>`;
      });
      return `<text ${attributes.join(" ")}>${lines.join("")}</text>`;
    }
    default: {
      diagnostics.push({
        code: "svg-unsupported-primitive",
        severity: "error",
        message: `Cannot serialize primitive of kind "${(primitive as { kind: string }).kind}".`,
        primitiveId: (primitive as { id: string }).id,
      });
      return "";
    }
  }
}

/**
 * Deterministic SVG document for one layout page.
 *
 * Failure mode is explicit: a primitive that cannot be serialized produces an
 * error diagnostic rather than disappearing quietly.
 */
export function layoutToSvg(layout: InfographicLayout, options: SvgLayoutOptions = {}): SvgLayoutResult {
  const precision = options.precision ?? 3;
  const diagnostics: InfographicDiagnostic[] = [];
  const { width, height } = layout.canvas;

  const rootAttributes: string[] = [
    'xmlns="http://www.w3.org/2000/svg"',
    `width="${number(width, precision)}"`,
    `height="${number(height, precision)}"`,
    `viewBox="0 0 ${number(width, precision)} ${number(height, precision)}"`,
    'role="img"',
    `data-km-infographic="${escapeXml(layout.id)}"`,
    `data-km-template="${escapeXml(layout.template)}"`,
    `data-km-art-direction="${escapeXml(layout.artDirection)}"`,
    `data-km-profile="${escapeXml(layout.profile)}"`,
    `data-km-layout-version="${escapeXml(layout.provenance.layoutVersion)}"`,
  ];
  if (options.className) rootAttributes.push(`class="${escapeXml(options.className)}"`);
  for (const [key, value] of Object.entries(options.attributes ?? {})) {
    rootAttributes.push(`${key}="${escapeXml(value)}"`);
  }

  const accessible = options.accessible ?? true;
  const titleId = `${layout.id}-title`;
  const descId = `${layout.id}-desc`;
  if (accessible) {
    rootAttributes.push(`aria-labelledby="${escapeXml(`${titleId} ${descId}`)}"`);
  }

  const body: string[] = [];
  if (accessible) {
    body.push(`<title id="${escapeXml(titleId)}">${escapeXml(layout.metadata?.title ?? layout.id)}</title>`);
    const pageSuffix = layout.pages > 1 ? ` Page ${options.page ?? 1} of ${layout.pages}.` : "";
    body.push(`<desc id="${escapeXml(descId)}">${escapeXml(`${layout.summary}${pageSuffix}`)}</desc>`);
  }

  const includeBackground = options.includeBackground ?? true;
  const primitives = layout.primitives.filter(
    (primitive) => includeBackground || primitive.role !== "infographic-background"
  );
  // Ids must stay unique when several exports share one HTML document (e.g. the
  // same source in two art directions), so the scope names everything that
  // changes the paint.
  const paint = resolvePaint(primitives, `${layout.id}-${layout.artDirection}-${layout.profile}-p${options.page ?? 1}`);
  const defs = paintDefsToSvg(paint.defs, precision);
  if (defs) body.push(defs);
  for (const primitive of primitives) {
    const serialized = primitiveToSvg(primitive, precision, diagnostics, paint);
    if (serialized) body.push(serialized);
  }

  const svg = `<svg ${rootAttributes.join(" ")}>${body.join("")}</svg>`;
  return { svg, width, height, diagnostics };
}

/**
 * `data:` URI for the layout, suitable for `<img src>` or CSS `url()`.
 * Percent-encoded rather than base64 so the result stays inspectable and
 * deterministic across runtimes.
 */
export function layoutToDataUri(layout: InfographicLayout, options: SvgLayoutOptions = {}): string {
  const { svg } = layoutToSvg(layout, options);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Standalone SVG file contents (no XML prolog beyond the declaration) so the
 * still can be written out and opened directly.
 */
export function layoutToSvgFile(layout: InfographicLayout, options: SvgLayoutOptions = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${layoutToSvg(layout, options).svg}`;
}

export interface PngLayoutOptions extends SvgLayoutOptions {
  /** Device pixel ratio for the raster. @default 2 */
  pixelRatio?: number;
  /** Background painted behind the layout when the background primitive is skipped. */
  background?: string;
}

/**
 * Rasterize a layout through the platform's SVG image decoder.
 *
 * This is an *optional adapter*: it needs a DOM (`Image`, `<canvas>`,
 * `toBlob`) and therefore throws `svg-png-unavailable` outside a browser
 * instead of returning a blank image. Callers that only need vectors should use
 * {@link layoutToSvg} and skip the raster path entirely.
 */
export async function layoutToPng(layout: InfographicLayout, options: PngLayoutOptions = {}): Promise<Blob> {
  if (typeof document === "undefined" || typeof Image === "undefined") {
    throw new Error(
      "svg-png-unavailable: PNG export needs a DOM canvas (Image/canvas.toBlob); this runtime has none. Use layoutToSvg() instead."
    );
  }
  const pixelRatio = options.pixelRatio ?? 2;
  const { svg, width, height, diagnostics } = layoutToSvg(layout, options);
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new Error(
      `svg-png-failed: the vector pass reported errors (${diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => diagnostic.code)
        .join(", ")}).`
    );
  }

  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("svg-png-decode-failed: the platform could not decode the exported SVG."));
    element.src = uri;
  });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("svg-png-unavailable: the canvas 2D context could not be created.");
  }
  if (options.background) {
    context.fillStyle = options.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("svg-png-failed: canvas.toBlob returned no data."));
    });
  });
}

/** Bounding box of every primitive, in design px. Useful for crop previews. */
export function layoutBounds(layout: InfographicLayout): RectInfo {
  const bounds: RectInfo = {
    x: Number.POSITIVE_INFINITY,
    y: Number.POSITIVE_INFINITY,
    width: 0,
    height: 0,
  };
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const primitive of layout.primitives) {
    const box = primitiveBounds(primitive);
    if (!box) continue;
    bounds.x = Math.min(bounds.x, box.x);
    bounds.y = Math.min(bounds.y, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }

  if (!Number.isFinite(bounds.x)) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: round(bounds.x),
    y: round(bounds.y),
    width: round(right - bounds.x),
    height: round(bottom - bounds.y),
  };
}

function primitiveBounds(primitive: InfographicPrimitive): RectInfo | null {
  switch (primitive.kind) {
    case "rect":
    case "ellipse":
      return { x: primitive.x, y: primitive.y, width: primitive.width, height: primitive.height };
    case "line": {
      const x = Math.min(primitive.x1, primitive.x2);
      const y = Math.min(primitive.y1, primitive.y2);
      return { x, y, width: Math.abs(primitive.x2 - primitive.x1), height: Math.abs(primitive.y2 - primitive.y1) };
    }
    case "polyline": {
      const xs = primitive.points.map(([x]) => x);
      const ys = primitive.points.map(([, y]) => y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    }
    case "text":
      return { x: primitive.x, y: primitive.y, width: primitive.width, height: primitive.height };
    default:
      return null;
  }
}
