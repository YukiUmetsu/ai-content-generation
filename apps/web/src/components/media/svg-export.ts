/**
 * Renderer-neutral still exporter: `MediaDocument` → SVG string → PNG blob.
 *
 * The exporter reads the document and never the DOM, so authoring overlays
 * (guides, safe region, bleed, grid, crop marks) can never leak into an export.
 * Layout is delegated to `./text-layout` with the same measurer the preview uses,
 * so line breaking and alignment cannot drift between the two.
 *
 * Two invariants drive the whole module:
 * - **Determinism.** The same document and options produce byte-identical SVG:
 *   no clocks, no randomness, no counters, every generated id derived from the
 *   owning layer id, `<defs>` sorted by id and all numbers rounded.
 * - **No implicit network access.** A referenced asset is emitted as an href
 *   (a reference), never fetched. When nothing inlines it, the export says so,
 *   because rasterising a referenced asset taints the canvas.
 */

import type {
  Diagnostic,
  ExportProfile,
  FontAsset,
  Insets,
  Layer,
  MediaDocument,
  MediaLayer,
  MediaMask,
  MediaSpec,
  Rect,
  ShapeLayer,
  ShapeSpec,
  Size,
  TextLayer,
  TextSpec,
} from "./document";
import {
  round,
  spanFontId,
  validateDocument,
  visibleLayersInPaintOrder,
} from "./document";
import type { MeasureText, TextLineRun } from "./text-layout";
import { createCanvasMeasurer, fontFamilyChain, layoutText } from "./text-layout";

const DEFAULT_PRECISION = 3;

/** Baseline as a fraction of the effective font size, matching typical font metrics. */
const ASCENT_RATIO = 0.8;

/** Coarse per-character advance (fraction of font size) used when no glyph metrics exist. */
const FALLBACK_ADVANCE_RATIO = 0.55;

/** Media crop fractions at or above this total describe a zero-width source and are ignored. */
const CROP_EDGE_LIMIT = 0.98;

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

/**
 * Conservative XML attribute name: an ASCII name-start character followed by
 * name characters, deliberately narrower than XML's full Unicode range. It is
 * enough for the names `SvgExportOptions.attributes` needs, and it cannot smuggle
 * a tag break or a second attribute through a caller-supplied name.
 */
const XML_ATTRIBUTE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

/**
 * Root attributes the exporter alone must control for the document to stay
 * well-formed, correctly sized and correctly namespaced. A caller-supplied value
 * can never override these, so a stray `attributes` entry cannot break the
 * document's own geometry or namespaces.
 */
const RESERVED_ROOT_ATTRIBUTES: ReadonlySet<string> = new Set([
  "xmlns",
  "width",
  "height",
  "viewBox",
]);

/** A named identity string used inside the generated `<svg>` root. */
interface ProfileDefinition {
  label: string;
  mimeType: string;
  extension: string;
}

/**
 * The still profiles this exporter can write. Video/other profiles exist in the
 * rendering contract (docs/11 §7) but are not produced here; passing one is
 * reported as `export-profile-unsupported` instead of being silently ignored.
 */
export const EXPORT_PROFILES: Record<ExportProfile, ProfileDefinition> = {
  "still-svg": { label: "SVG (still)", mimeType: "image/svg+xml", extension: "svg" },
  "still-png": { label: "PNG (still)", mimeType: "image/png", extension: "png" },
};

export interface SvgExportOptions {
  /** Output profile. @default "still-svg" */
  profile?: ExportProfile;
  /**
   * Multiplies the output `width`/`height` only. The viewBox and every coordinate
   * stay in design px, so scaling resamples but never re-lays-out. @default 1
   */
  scale?: number;
  /** Paint the artboard background rect. @default true */
  includeBackground?: boolean;
  /** Decimal places for every emitted number. @default 3 */
  precision?: number;
  /**
   * Extra attributes merged onto the `<svg>` root. A name that is not a
   * conservative XML attribute name is dropped rather than emitted, and the
   * exporter-owned `xmlns`, `width`, `height` and `viewBox` can never be
   * overridden, so a caller value cannot break the document's geometry or
   * namespaces.
   */
  attributes?: Record<string, string>;
  /** Maps an asset to an href usable inside SVG/PNG. Return null to skip and emit a diagnostic. */
  resolveAssetHref?: (assetId: string, uri: string, mediaType: string) => string | null;
  /** CSS injected into a `<style>` element inside the SVG (e.g. `@font-face` with data: URIs). */
  fontCss?: string;
  /** `"text"` (default) emits real, selectable `<text>`; `"outline"` refuses and reports a capability diagnostic. */
  textMode?: "text" | "outline";
}

export interface SvgExportResult {
  svg: string;
  diagnostics: Diagnostic[];
  /** Output size in px: artboard size × `scale` (never the layout size). */
  size: Size;
}

export interface PngExportOptions extends SvgExportOptions {
  /** Raster resolution multiplier applied on top of `scale`. @default 1 */
  pixelRatio?: number;
  /** Canvas fill behind the artwork; `"transparent"` makes the SVG background-less. @default the artboard background */
  background?: string | "transparent";
  /** Cancels the export between asynchronous steps. */
  signal?: AbortSignal;
}

export interface PngExportResult {
  blob: Blob;
  /** Pixel size of the rasterised canvas (svg size × `pixelRatio`). */
  size: Size;
  diagnostics: Diagnostic[];
  /** The exact SVG that was rasterised, so callers can diff it against a vector export. */
  svg: string;
}

/** Working state threaded through the (pure) SVG serializer. */
interface RenderContext {
  document: MediaDocument;
  precision: number;
  measure: MeasureText;
  /** Per media-layer href resolution (`null` when nothing inlined the asset). */
  hrefs: ReadonlyMap<string, string | null>;
  /** True when the caller asked for `xlink:href` compatibility via `attributes`. */
  emitXlink: boolean;
  /** Set while rendering once an `xlink:href` is actually written. */
  usedXlink: boolean;
  /** Generated `<clipPath>` markup keyed by deterministic id. */
  clips: Map<string, string>;
  /** Generated `<filter>` elements keyed by deterministic layer ids. */
  filters: Map<string, string>;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Round then stringify, so serialization is stable across runs. */
function formatNumber(value: number, precision: number): string {
  return String(round(value, precision));
}

/** Escape a string for both XML text content and quoted attribute values. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Serialize attributes in the given order, dropping `undefined` values. */
function formatAttributes(
  attributes: ReadonlyArray<readonly [string, string | undefined]>
): string {
  const parts: string[] = [];
  for (const [name, value] of attributes) {
    if (value === undefined) continue;
    parts.push(`${name}="${escapeXml(value)}"`);
  }
  return parts.join(" ");
}

/** A `<rect>` markup string shared by shapes and clip paths. */
function rectMarkup(
  x: number,
  y: number,
  width: number,
  height: number,
  precision: number,
  radius = 0
): string {
  const attributes: Array<[string, string | undefined]> = [
    ["x", formatNumber(x, precision)],
    ["y", formatNumber(y, precision)],
    ["width", formatNumber(width, precision)],
    ["height", formatNumber(height, precision)],
  ];
  if (radius > 0) {
    attributes.push(["rx", formatNumber(radius, precision)]);
    attributes.push(["ry", formatNumber(radius, precision)]);
  }
  return `<rect ${formatAttributes(attributes)}/>`;
}

// ---------------------------------------------------------------------------
// Text measurement
// ---------------------------------------------------------------------------

/** Parse the `Npx` size out of a CSS font shorthand for the fallback estimator. */
function fontShorthandSize(font: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font);
  return match ? Number(match[1]) : 16;
}

/**
 * Deterministic advance used when no canvas glyph metrics are available
 * (jsdom, workers). Coarse by design: it only needs to keep wrapping stable and
 * non-empty so the same document lays out identically everywhere.
 */
function estimateAdvance(font: string, text: string): number {
  return FALLBACK_ADVANCE_RATIO * fontShorthandSize(font) * text.length;
}

/**
 * Measurer for export: real canvas advances in a browser, an approximation when
 * the canvas reports nothing. `layoutText` is fed this function so preview and
 * export break lines the same way.
 */
export function createExportMeasurer(fonts: Record<string, FontAsset>): MeasureText {
  const canvasMeasurer = createCanvasMeasurer(fonts);
  return (font, text) => {
    if (text.length === 0) return 0;
    const measured = canvasMeasurer(font, text);
    return measured > 0 ? measured : estimateAdvance(font, text);
  };
}

// ---------------------------------------------------------------------------
// Layer tree
// ---------------------------------------------------------------------------

/**
 * Visible layers grouped by parent id for depth-first painting. Paint order is
 * `visibleLayersInPaintOrder`, which already drops hidden layers and hidden
 * branches; preserving its order here keeps siblings in `(z, id)` order.
 */
function groupVisibleLayers(layers: readonly Layer[]): Map<string | null, Layer[]> {
  const visible = visibleLayersInPaintOrder(layers);
  const visibleIds = new Set(visible.map((layer) => layer.id));
  const byParent = new Map<string | null, Layer[]>();
  for (const layer of visible) {
    const parentId = layer.parentId ?? null;
    // A dangling parent id is treated as a root so the layer is never dropped.
    const key = parentId !== null && visibleIds.has(parentId) ? parentId : null;
    const bucket = byParent.get(key);
    if (bucket) bucket.push(layer);
    else byParent.set(key, [layer]);
  }
  return byParent;
}

/**
 * `translate(x y)` followed by `rotate(a cx cy)` about the layer's own unrotated
 * local bounds. The shape is drawn at its local origin inside the translated
 * group, so the rotation centre is expressed in that same local frame: an
 * explicit `anchorX`/`anchorY` is a 0..1 fraction of those bounds, and the
 * default is the top-left corner, matching `LayerTransform`'s documented default.
 *
 * The `anchorX ?? 0` / `anchorY ?? 0` default must stay in sync with the two
 * other places that resolve the same pivot:
 * - `document.ts` — `layerBounds`/`rotatedBounds` default `anchorX`/`anchorY` to `0`.
 * - `layer-stack.tsx` — the DOM `transform-origin` defaults to `0% 0%`.
 * Changing one without the others silently breaks preview/export parity.
 */
function layerTransformString(layer: Layer, precision: number): string {
  const { x, y, width, height, rotation, anchorX, anchorY } = layer.transform;
  const parts = [`translate(${formatNumber(x, precision)} ${formatNumber(y, precision)})`];
  if (rotation) {
    const cx = width * (anchorX ?? 0);
    const cy = height * (anchorY ?? 0);
    parts.push(
      `rotate(${formatNumber(rotation, precision)} ${formatNumber(cx, precision)} ${formatNumber(
        cy,
        precision
      )})`
    );
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** Fill/stroke attributes: `fill="none"` appears only when a stroke exists without a fill. */
function shapePaintAttributes(
  shape: ShapeSpec,
  precision: number
): Array<[string, string | undefined]> {
  const attributes: Array<[string, string | undefined]> = [];
  if (shape.fill !== undefined) attributes.push(["fill", shape.fill]);
  else if (shape.stroke !== undefined) attributes.push(["fill", "none"]);
  if (shape.stroke !== undefined) {
    attributes.push(["stroke", shape.stroke]);
    if (shape.strokeWidth !== undefined) {
      attributes.push(["stroke-width", formatNumber(shape.strokeWidth, precision)]);
    }
  }
  return attributes;
}

/** Rect (with radius), ellipse and line, all drawn at the layer's local origin. */
function renderShapeLayer(layer: ShapeLayer, precision: number): string {
  const { width, height } = layer.transform;
  const shape = layer.shape;
  switch (shape.kind) {
    case "rect": {
      const attributes: Array<[string, string | undefined]> = [
        ["x", "0"],
        ["y", "0"],
        ["width", formatNumber(width, precision)],
        ["height", formatNumber(height, precision)],
      ];
      const radius = shape.radius ?? 0;
      if (radius > 0) {
        attributes.push(["rx", formatNumber(radius, precision)]);
        attributes.push(["ry", formatNumber(radius, precision)]);
      }
      attributes.push(...shapePaintAttributes(shape, precision));
      return `<rect ${formatAttributes(attributes)}/>`;
    }
    case "ellipse": {
      const attributes: Array<[string, string | undefined]> = [
        ["cx", formatNumber(width / 2, precision)],
        ["cy", formatNumber(height / 2, precision)],
        ["rx", formatNumber(width / 2, precision)],
        ["ry", formatNumber(height / 2, precision)],
        ...shapePaintAttributes(shape, precision),
      ];
      return `<ellipse ${formatAttributes(attributes)}/>`;
    }
    case "line": {
      // The layer bounds are the line's diagonal; a line has no area to fill.
      const attributes: Array<[string, string | undefined]> = [
        ["x1", "0"],
        ["y1", "0"],
        ["x2", formatNumber(width, precision)],
        ["y2", formatNumber(height, precision)],
      ];
      if (shape.stroke !== undefined) {
        attributes.push(["stroke", shape.stroke]);
        if (shape.strokeWidth !== undefined) {
          attributes.push(["stroke-width", formatNumber(shape.strokeWidth, precision)]);
        }
      }
      return `<line ${formatAttributes(attributes)}/>`;
    }
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** One `<tspan>` per run, carrying the span's own font/colour/weight override. */
function renderRun(spec: TextSpec, run: TextLineRun, context: RenderContext): string {
  const span = spec.spans[run.spanIndex];
  if (!span) return escapeXml(run.text);

  const attributes: Array<[string, string | undefined]> = [];
  const fontId = spanFontId(spec, span);
  if (fontId !== spec.fontId) {
    const font = context.document.fonts[fontId];
    if (font) attributes.push(["font-family", fontFamilyChain(font)]);
  }
  if (span.weight !== undefined) attributes.push(["font-weight", String(span.weight)]);
  if (span.italic) attributes.push(["font-style", "italic"]);
  if (span.color) attributes.push(["fill", span.color]);
  if (span.underline) attributes.push(["text-decoration", "underline"]);

  const attributeString = attributes.length > 0 ? ` ${formatAttributes(attributes)}` : "";
  return `<tspan${attributeString}>${escapeXml(run.text)}</tspan>`;
}

/**
 * Real, selectable `<text>` — one element per laid-out line at its baseline, with
 * runs preserved as `<tspan>`s. Text is never split into an image: editability
 * and assistive technology both depend on staying textual.
 */
function renderTextLayer(layer: TextLayer, context: RenderContext): string {
  const spec = layer.text;
  const box: Size = { width: layer.transform.width, height: layer.transform.height };
  const layout = layoutText(spec, box, context.document.fonts, context.measure);
  const lineHeight = spec.lineHeight * layout.size;
  const anchor = spec.align === "center" ? "middle" : spec.align === "end" ? "end" : "start";
  const x = spec.align === "center" ? box.width / 2 : spec.align === "end" ? box.width : 0;
  const baseFont = context.document.fonts[spec.fontId];
  const family = baseFont ? fontFamilyChain(baseFont) : "system-ui, sans-serif";
  const baseWeight = baseFont?.weight ?? 400;

  const elements: string[] = [];
  layout.lines.forEach((line, index) => {
    const baseline = index * lineHeight + layout.size * ASCENT_RATIO;
    const attributes: Array<[string, string | undefined]> = [
      ["x", formatNumber(x, context.precision)],
      ["y", formatNumber(baseline, context.precision)],
      ["font-family", family],
      ["font-size", formatNumber(layout.size, context.precision)],
      ["font-weight", String(baseWeight)],
      ["text-anchor", anchor],
    ];
    if (spec.letterSpacing !== 0) {
      attributes.push(["letter-spacing", formatNumber(spec.letterSpacing, context.precision)]);
    }
    if (spec.direction === "auto") {
      // CSS has no `direction: auto`; plaintext bidi is the equivalent behaviour.
      attributes.push(["unicode-bidi", "plaintext"]);
    } else {
      attributes.push(["direction", spec.direction]);
    }
    const runs = line.runs.map((run) => renderRun(spec, run, context)).join("");
    elements.push(`<text ${formatAttributes(attributes)}>${runs}</text>`);
  });
  return elements.join("");
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

function clampCropFraction(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(CROP_EDGE_LIMIT, Math.max(0, value));
}

/**
 * The enlarged inner box a source-space crop reveals, in the media layer's local
 * coordinates. Mirrors `MediaFrame`'s crop view transform: the frame shows the
 * cropped region by scaling the inner box up by `1 / (1 - a - b)` per axis. A
 * crop whose fractions meet or exceed `1` on an axis is ignored (it would
 * describe an empty region), and the source itself is never mutated.
 */
function resolveCropBox(crop: Insets | undefined, width: number, height: number): Rect | null {
  if (!crop) return null;
  const top = clampCropFraction(crop.top);
  const right = clampCropFraction(crop.right);
  const bottom = clampCropFraction(crop.bottom);
  const left = clampCropFraction(crop.left);
  if (left + right >= 1 || top + bottom >= 1) return null;
  if (left === 0 && right === 0 && top === 0 && bottom === 0) return null;
  const widthScale = 1 - left - right;
  const heightScale = 1 - top - bottom;
  return {
    x: -(left / widthScale) * width,
    y: -(top / heightScale) * height,
    width: width / widthScale,
    height: height / heightScale,
  };
}

/** Bucket a normalised focal coordinate into one of SVG's three alignment slots. */
function focalBucket(value: number): "Min" | "Mid" | "Max" {
  if (!Number.isFinite(value)) return "Mid";
  if (value < 1 / 3) return "Min";
  if (value > 2 / 3) return "Max";
  return "Mid";
}

/**
 * `preserveAspectRatio` from the fit policy, with alignment derived from the
 * focal point. SVG only offers three alignment slots per axis, so a continuous
 * focal point is quantised to the nearest third — good enough to keep the subject
 * roughly in frame, and documented rather than faked as exact.
 */
function mediaPreserveAspectRatio(media: MediaSpec): string {
  if (media.fit === "fill") return "none";
  const slice = media.fit === "cover" ? "slice" : "meet";
  if (media.fit === "none") return `xMidYMid ${slice}`;
  const x = focalBucket(media.focalPoint?.x ?? 0.5);
  const y = focalBucket(media.focalPoint?.y ?? 0.5);
  return `x${x}Y${y} ${slice}`;
}

/** Clip-path content for a media mask, in the layer's local coordinate system. */
function maskClipMarkup(
  mask: MediaMask | undefined,
  width: number,
  height: number,
  precision: number
): string | null {
  if (!mask) return null;
  switch (mask.kind) {
    case "rounded":
      return rectMarkup(0, 0, width, height, precision, mask.radius ?? 0);
    case "circle":
      // No forced 1:1 aspect: on a non-square frame this is an ellipse, the honest
      // result of "circle" on the mask the author asked for.
      return `<ellipse ${formatAttributes([
        ["cx", formatNumber(width / 2, precision)],
        ["cy", formatNumber(height / 2, precision)],
        ["rx", formatNumber(width / 2, precision)],
        ["ry", formatNumber(height / 2, precision)],
      ])}/>`;
    case "inset": {
      const inset = mask.inset;
      const left = inset?.left ?? 0;
      const top = inset?.top ?? 0;
      const right = inset?.right ?? 0;
      const bottom = inset?.bottom ?? 0;
      return rectMarkup(
        left,
        top,
        Math.max(0, width - left - right),
        Math.max(0, height - top - bottom),
        precision
      );
    }
    case "none":
    default:
      return null;
  }
}

/** Register a deterministic mask clip for a media layer and return its id. */
function registerMaskClip(context: RenderContext, layer: MediaLayer): string | null {
  const markup = maskClipMarkup(
    layer.media.mask,
    layer.transform.width,
    layer.transform.height,
    context.precision
  );
  if (!markup) return null;
  const id = `km-mask-${layer.id}`;
  context.clips.set(id, `<clipPath id="${id}">${markup}</clipPath>`);
  return id;
}

/** Register a clip to the layer's local bounds (`clip: true`) and return its id. */
function registerSelfClip(context: RenderContext, layer: Layer): string {
  const id = `km-clip-${layer.id}`;
  const markup = rectMarkup(
    0,
    0,
    layer.transform.width,
    layer.transform.height,
    context.precision
  );
  context.clips.set(id, `<clipPath id="${id}">${markup}</clipPath>`);
  return id;
}

/**
 * A single `<image>` (or a crop-scoped nested `<svg>` around one). The href is
 * always emitted; when the caller asked for `xlink:href` compatibility it is
 * duplicated. Nothing is fetched here — an unresolvable asset falls back to its
 * declared uri as a plain reference and is reported by the diagnostics.
 */
function renderMediaLayer(layer: MediaLayer, context: RenderContext): string {
  const asset = context.document.assets[layer.media.assetId];
  if (!asset) return "";

  const { width, height } = layer.transform;
  const href = context.hrefs.get(layer.id) ?? null;
  const source = href ?? asset.uri;
  const hrefAttribute = ` href="${escapeXml(source)}"`;
  const xlinkAttribute = context.emitXlink ? ` xlink:href="${escapeXml(source)}"` : "";
  if (context.emitXlink) context.usedXlink = true;

  const aspect = mediaPreserveAspectRatio(layer.media);
  const maskId = registerMaskClip(context, layer);
  const maskAttribute = maskId ? `url(#${maskId})` : undefined;
  const cropBox = resolveCropBox(layer.media.crop, width, height);

  if (cropBox) {
    // The nested `<svg>` crops by mapping the enlarged inner box onto the layer
    // viewport; the source stays intact and the image keeps its own fit.
    const viewBox = `${formatNumber(cropBox.x, context.precision)} ${formatNumber(
      cropBox.y,
      context.precision
    )} ${formatNumber(cropBox.width, context.precision)} ${formatNumber(
      cropBox.height,
      context.precision
    )}`;
    const svgAttributes = formatAttributes([
      ["x", "0"],
      ["y", "0"],
      ["width", formatNumber(width, context.precision)],
      ["height", formatNumber(height, context.precision)],
      ["viewBox", viewBox],
      ["preserveAspectRatio", "none"],
      ["clip-path", maskAttribute ? `url(#${maskId})` : undefined],
    ]);
    const imageAttributes = formatAttributes([
      ["x", formatNumber(cropBox.x, context.precision)],
      ["y", formatNumber(cropBox.y, context.precision)],
      ["width", formatNumber(cropBox.width, context.precision)],
      ["height", formatNumber(cropBox.height, context.precision)],
      ["preserveAspectRatio", aspect],
    ]);
    return `<svg ${svgAttributes}><image ${imageAttributes}${hrefAttribute}${xlinkAttribute}/></svg>`;
  }

  const imageAttributes = formatAttributes([
    ["x", "0"],
    ["y", "0"],
    ["width", formatNumber(width, context.precision)],
    ["height", formatNumber(height, context.precision)],
    ["preserveAspectRatio", aspect],
    ["clip-path", maskAttribute ? `url(#${maskId})` : undefined],
  ]);
  return `<image ${imageAttributes}${hrefAttribute}${xlinkAttribute}/>`;
}

// ---------------------------------------------------------------------------
// Layer dispatch
// ---------------------------------------------------------------------------

/** Emit one layer as a `<g>`, nesting group children so transforms compose. */
function renderLayer(
  layer: Layer,
  context: RenderContext,
  children: Map<string | null, Layer[]>
): string {
  const attributes: Array<[string, string | undefined]> = [
    ["transform", layerTransformString(layer, context.precision)],
  ];
  if (layer.opacity !== 1) {
    attributes.push(["opacity", formatNumber(layer.opacity, context.precision)]);
  }
  if (layer.blend !== "normal") {
    attributes.push(["style", `mix-blend-mode:${layer.blend}`]);
  }
  const shadow = layer.appearance?.dropShadow;
  if (shadow) {
    const id = `km-shadow-${layer.id}`;
    // The SVG filter region is relative to the subject's bounding box. A
    // fixed percentage clips shadows around small cutouts or large offsets.
    // Three Gaussian standard deviations capture nearly all visible blur.
    const spread = shadow.blur * 3;
    const left = Math.max(0, spread - shadow.dx);
    const right = Math.max(0, spread + shadow.dx);
    const top = Math.max(0, spread - shadow.dy);
    const bottom = Math.max(0, spread + shadow.dy);
    const width = Math.max(layer.transform.width, 1);
    const height = Math.max(layer.transform.height, 1);
    const filterBounds = `x="${formatNumber(-100 * left / width, context.precision)}%" ` +
      `y="${formatNumber(-100 * top / height, context.precision)}%" ` +
      `width="${formatNumber(100 * (1 + (left + right) / width), context.precision)}%" ` +
      `height="${formatNumber(100 * (1 + (top + bottom) / height), context.precision)}%"`;
    // Decompose the modern feDropShadow shorthand into core SVG 1.1 primitives.
    // Inkscape and other older renderers may silently drop the entire filtered
    // subject when they encounter the shorthand, even though the SVG is valid.
    context.filters.set(id, `<filter id="${escapeXml(id)}" ${filterBounds} color-interpolation-filters="sRGB">` +
      `<feGaussianBlur in="SourceAlpha" stdDeviation="${formatNumber(shadow.blur, context.precision)}" result="shadow-blur"/>` +
      `<feOffset in="shadow-blur" dx="${formatNumber(shadow.dx, context.precision)}" dy="${formatNumber(shadow.dy, context.precision)}" result="shadow-offset"/>` +
      `<feFlood flood-color="${escapeXml(shadow.color)}" flood-opacity="${formatNumber(shadow.opacity, context.precision)}" result="shadow-color"/>` +
      `<feComposite in="shadow-color" in2="shadow-offset" operator="in" result="shadow"/>` +
      `<feMerge><feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`);
    attributes.push(["filter", `url(#${id})`]);
  }
  if (layer.clip) {
    attributes.push(["clip-path", `url(#${registerSelfClip(context, layer)})`]);
  }
  const open = `<g ${formatAttributes(attributes)}>`;

  switch (layer.kind) {
    case "group": {
      const nested = (children.get(layer.id) ?? [])
        .map((child) => renderLayer(child, context, children))
        .join("");
      return `${open}${nested}</g>`;
    }
    case "shape":
      return `${open}${renderShapeLayer(layer, context.precision)}</g>`;
    case "text":
      return `${open}${renderTextLayer(layer, context)}</g>`;
    case "media":
      return `${open}${renderMediaLayer(layer, context)}</g>`;
    default:
      return `${open}</g>`;
  }
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

interface ExportDiagnosticContext {
  profileName: string;
  profileDefinition: ProfileDefinition | undefined;
  textMode: "text" | "outline";
  fontCss?: string;
  hrefs: ReadonlyMap<string, string | null>;
  availableFontFamilies?: readonly string[];
}

/** Font ids referenced by any text layer, sorted for deterministic output. */
function collectReferencedFontIds(document: MediaDocument): string[] {
  const ids = new Set<string>();
  for (const layer of document.layers) {
    if (layer.kind !== "text") continue;
    ids.add(layer.text.fontId);
    for (const span of layer.text.spans) ids.add(spanFontId(layer.text, span));
  }
  return [...ids].sort();
}

/** Resolve every media layer's href once so diagnostics and rendering agree. */
function resolveAssetHrefs(
  document: MediaDocument,
  resolve: SvgExportOptions["resolveAssetHref"]
): Map<string, string | null> {
  const hrefs = new Map<string, string | null>();
  for (const layer of document.layers) {
    if (layer.kind !== "media") continue;
    const asset = document.assets[layer.media.assetId];
    const uri = asset?.uri ?? "";
    let href: string | null = null;
    if (resolve) {
      try {
        href = resolve(layer.media.assetId, uri, asset?.mediaType ?? "");
      } catch {
        // A throwing resolver is treated as "did not inline" rather than fatal.
        href = null;
      }
    }
    hrefs.set(layer.id, href ?? null);
  }
  return hrefs;
}

/**
 * The warnings and errors a consumer should see before exporting. Blocking
 * `validateDocument` errors pass through; export-specific problems are added
 * with a `capability` so callers can negotiate rather than guess.
 */
function collectExportDiagnostics(
  document: MediaDocument,
  context: ExportDiagnosticContext
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const push = (diagnostic: Omit<Diagnostic, "sceneId"> & { sceneId?: string }): void => {
    diagnostics.push({ ...diagnostic, sceneId: diagnostic.sceneId ?? document.id });
  };

  for (const diagnostic of validateDocument(document)) {
    if (diagnostic.severity === "error") diagnostics.push(diagnostic);
  }

  if (!context.profileDefinition) {
    push({
      code: "export-profile-unsupported",
      severity: "error",
      message: `Export profile "${context.profileName}" is not produced yet; this build writes still SVG/PNG only.`,
      capability: "export-profile",
    });
  }

  if (context.textMode === "outline") {
    push({
      code: "export-text-outline-unsupported",
      severity: "error",
      message:
        "Outline text export is not supported; text stays editable <text> so the export never silently diverges from the source.",
      capability: "svg-text-outline",
      fallback: "text",
    });
  }

  const referencedFontIds = collectReferencedFontIds(document);
  const hasFontCss = typeof context.fontCss === "string" && context.fontCss.trim().length > 0;
  if (!hasFontCss) {
    for (const fontId of referencedFontIds) {
      push({
        code: "export-font-not-embedded",
        severity: "warning",
        message: `Font "${fontId}" is not embedded (no fontCss); a rasteriser without it will substitute glyphs.`,
        capability: "font-embedding",
        path: `fonts.${fontId}`,
      });
    }
  }

  if (context.availableFontFamilies) {
    const available = new Set(context.availableFontFamilies);
    for (const fontId of referencedFontIds) {
      const font = document.fonts[fontId];
      if (font && !available.has(font.family)) {
        push({
          code: "export-font-unavailable",
          severity: "warning",
          message: `Font family "${font.family}" is not among the available families; glyphs may be substituted.`,
          capability: "font",
          path: `fonts.${fontId}`,
        });
      }
    }
  }

  for (const layer of visibleLayersInPaintOrder(document.layers)) {
    if (layer.kind !== "media") continue;
    const asset = document.assets[layer.media.assetId];
    if (!asset) {
      push({
        code: "export-asset-missing",
        severity: "error",
        message: `Media layer references asset "${layer.media.assetId}" which is not declared in document.assets.`,
        layerId: layer.id,
        capability: "asset",
        path: `layers.${layer.id}.media.assetId`,
      });
      continue;
    }
    // An asset already containing a data: image URI is as inline as one
    // returned by resolveAssetHref; neither requires a remote image request.
    const usedHref = context.hrefs.get(layer.id) ?? asset.uri;
    if (!/^data:image\/[^,]+,/i.test(usedHref)) {
      push({
        code: "export-asset-not-inlined",
        severity: "warning",
        message: `Asset "${layer.media.assetId}" is referenced externally; rasterising SVG to PNG may taint the canvas.`,
        layerId: layer.id,
        capability: "asset-inline",
        fallback: "reference",
        path: `layers.${layer.id}.media.assetId`,
      });
    }
  }

  // SVG carries blend modes reliably; rasterisers vary, so a still-png export
  // warns rather than promising a result it cannot guarantee.
  if (context.profileName !== "still-svg") {
    for (const layer of visibleLayersInPaintOrder(document.layers)) {
      if (layer.blend !== "normal") {
        push({
          code: "export-blend-unsupported",
          severity: "warning",
          message: `Blend mode "${layer.blend}" cannot be guaranteed by the "${context.profileName}" profile; a rasteriser may ignore it.`,
          layerId: layer.id,
          capability: "mix-blend-mode",
          fallback: "normal",
          path: `layers.${layer.id}.blend`,
        });
      }
    }
  }

  return diagnostics;
}

function lookupProfile(name: string): ProfileDefinition | undefined {
  const profiles = EXPORT_PROFILES as Record<string, ProfileDefinition | undefined>;
  return profiles[name];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialize a document to a standalone SVG string plus its diagnostics.
 *
 * The export is built from the document, never the DOM, so no authoring overlay
 * can appear. Scaling multiplies only the root `width`/`height` — the viewBox and
 * every coordinate remain in design px, which is what proves the documented rule
 * that output scaling cannot alter layout decisions. The result is byte-identical
 * for the same document and options.
 */
export function documentToSvg(
  document: MediaDocument,
  options: SvgExportOptions = {}
): SvgExportResult {
  const precision = options.precision ?? DEFAULT_PRECISION;
  const scale = options.scale ?? 1;
  const profileName: string = options.profile ?? "still-svg";
  const profileDefinition = lookupProfile(profileName);
  const includeBackground = options.includeBackground ?? true;
  const textMode = options.textMode ?? "text";
  const attributes = options.attributes ?? {};
  // `attributes` requesting the xlink namespace is the signal to duplicate hrefs
  // for renderers that predate SVG2 `href`.
  const emitXlink = Object.prototype.hasOwnProperty.call(attributes, "xmlns:xlink");

  const { width, height } = document.artboard;
  // Output scaling multiplies only the <svg> width/height (the raster
  // resolution); the viewBox and every coordinate stay in design px, so `scale`
  // can never change wrapping, alignment or paint geometry — it only resamples.
  const svgSize: Size = {
    width: round(width * scale, precision),
    height: round(height * scale, precision),
  };

  const hrefs = resolveAssetHrefs(document, options.resolveAssetHref);
  const diagnostics = collectExportDiagnostics(document, {
    profileName,
    profileDefinition,
    textMode,
    fontCss: options.fontCss,
    hrefs,
  });

  const context: RenderContext = {
    document,
    precision,
    measure: createExportMeasurer(document.fonts),
    hrefs,
    emitXlink,
    usedXlink: false,
    clips: new Map(),
    filters: new Map(),
  };

  const childrenByParent = groupVisibleLayers(document.layers);
  const body = (childrenByParent.get(null) ?? [])
    .map((layer) => renderLayer(layer, context, childrenByParent))
    .join("");

  const styleMarkup = options.fontCss
    ? `<style type="text/css">${escapeXml(options.fontCss)}</style>`
    : "";
  const clipMarkup = [...context.clips.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, markup]) => markup)
    .join("");
  const filterMarkup = [...context.filters.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, markup]) => markup)
    .join("");
  const defs = styleMarkup || clipMarkup || filterMarkup ? `<defs>${styleMarkup}${clipMarkup}${filterMarkup}</defs>` : "";

  const background = includeBackground
    ? `<rect x="0" y="0" width="${formatNumber(width, precision)}" height="${formatNumber(
        height,
        precision
      )}" fill="${escapeXml(document.artboard.background)}"/>`
    : "";

  const title = document.metadata?.title;
  const notes = document.metadata?.notes?.join(" ");
  const titleMarkup = title ? `<title>${escapeXml(title)}</title>` : "";
  const descMarkup = notes ? `<desc>${escapeXml(notes)}</desc>` : "";

  const rootAttributes: Array<[string, string | undefined]> = [["xmlns", SVG_NAMESPACE]];
  if (context.usedXlink) rootAttributes.push(["xmlns:xlink", XLINK_NAMESPACE]);
  if (title) rootAttributes.push(["role", "img"]);
  rootAttributes.push(["width", formatNumber(svgSize.width, precision)]);
  rootAttributes.push(["height", formatNumber(svgSize.height, precision)]);
  rootAttributes.push([
    "viewBox",
    `0 0 ${formatNumber(width, precision)} ${formatNumber(height, precision)}`,
  ]);

  // Core geometry attributes win over caller-supplied ones so the viewBox can
  // never disagree with the layer coordinates. Caller names are validated too:
  // an invalid XML name is dropped, never emitted, and the reserved control set
  // is protected regardless of which root attributes were actually written.
  const reserved = new Set([...RESERVED_ROOT_ATTRIBUTES, ...rootAttributes.map(([name]) => name)]);
  const extraAttributes = Object.keys(attributes)
    .filter((name) => XML_ATTRIBUTE_NAME_PATTERN.test(name) && !reserved.has(name))
    .sort()
    .map((name) => ` ${name}="${escapeXml(attributes[name])}"`)
    .join("");

  const svg = `<svg ${formatAttributes(rootAttributes)}${extraAttributes}>${titleMarkup}${descMarkup}${defs}${background}${body}</svg>`;

  return { svg, diagnostics, size: svgSize };
}

/**
 * Pure, DOM-free diagnostics for a prospective export — safe in jsdom and Node.
 * Returns everything {@link documentToSvg} would report, plus a mismatch check
 * when the caller declares which font families are actually installed.
 */
export function preflightExport(
  document: MediaDocument,
  options: SvgExportOptions & { availableFontFamilies?: readonly string[] } = {}
): Diagnostic[] {
  const profileName: string = options.profile ?? "still-svg";
  const hrefs = resolveAssetHrefs(document, options.resolveAssetHref);
  return collectExportDiagnostics(document, {
    profileName,
    profileDefinition: lookupProfile(profileName),
    textMode: options.textMode ?? "text",
    fontCss: options.fontCss,
    hrefs,
    availableFontFamilies: options.availableFontFamilies,
  });
}

// ---------------------------------------------------------------------------
// PNG rasterisation
// ---------------------------------------------------------------------------

function createAbortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("Export aborted.", "AbortError");
  }
  const error = new Error("Export aborted.");
  error.name = "AbortError";
  return error;
}

function isSecurityError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  if (name === "SecurityError") return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && /tainted|SecurityError/i.test(message);
}

function securityErrorWithDiagnostics(
  diagnostics: readonly Diagnostic[]
): Error {
  const blocked = diagnostics.filter((entry) => entry.code === "export-asset-not-inlined");
  const detail =
    blocked.length > 0
      ? blocked.map((entry) => `${entry.layerId ?? "unknown"}:${entry.code}`).join(", ")
      : "export-asset-not-inlined";
  return new Error(
    `PNG rasterisation was blocked by a tainted canvas (SecurityError). Assets were not inlined [${detail}]; inline them with resolveAssetHref (e.g. data: URIs) so the canvas stays same-origin.`
  );
}

function decodeImage(image: HTMLImageElement): Promise<void> {
  return image.decode().catch((error: unknown) => {
    throw new Error(
      `The exported SVG could not be decoded for rasterisation: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  });
}

function loadImage(image: HTMLImageElement, url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () =>
      reject(new Error("The exported SVG could not be decoded for rasterisation."));
    image.src = url;
  });
}

function toPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  // A throw from `toBlob` (e.g. SecurityError) rejects this promise automatically.
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

/**
 * Rasterise a document to a PNG by decoding the exported SVG through an
 * `HTMLImageElement` and drawing it to a canvas. The SVG is the source of truth:
 * this function adds no geometry, only a pixel grid and an optional background.
 *
 * Environments without a canvas or `toBlob` (jsdom and Node) reject with a clear
 * message instead of an opaque failure. A `SecurityError` from a canvas tainted
 * by a non-inlined asset is reported with the matching
 * `export-asset-not-inlined` diagnostic in the message.
 */
export async function documentToPng(
  document: MediaDocument,
  options: PngExportOptions = {}
): Promise<PngExportResult> {
  const signal = options.signal;
  const throwIfAborted = (): void => {
    if (signal?.aborted) throw createAbortError();
  };
  throwIfAborted();

  const pixelRatio = options.pixelRatio ?? 1;
  const backgroundOption = options.background ?? document.artboard.background;
  const transparent = backgroundOption === "transparent";

  const svgResult = documentToSvg(document, {
    profile: options.profile,
    scale: options.scale,
    includeBackground: transparent ? false : options.includeBackground ?? true,
    precision: options.precision,
    attributes: options.attributes,
    resolveAssetHref: options.resolveAssetHref,
    fontCss: options.fontCss,
    textMode: options.textMode,
  });
  const { svg, size: svgSize, diagnostics } = svgResult;

  if (typeof Blob === "undefined") {
    throw new Error("PNG export needs a Blob implementation; this environment does not provide one.");
  }
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("PNG export needs URL.createObjectURL; this environment does not provide it.");
  }
  if (typeof HTMLCanvasElement === "undefined" || typeof Image === "undefined") {
    throw new Error(
      "PNG export needs HTMLCanvasElement and Image; jsdom and Node do not rasterise SVG. Use documentToSvg and rasterise elsewhere."
    );
  }
  const hostDocument = globalThis.document;
  if (typeof hostDocument === "undefined") {
    throw new Error("PNG export needs a DOM document to create a canvas.");
  }
  const canvas = hostDocument.createElement("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("PNG export needs a real HTMLCanvasElement; the host returned an incompatible node.");
  }
  if (typeof canvas.toBlob !== "function") {
    throw new Error("PNG export needs HTMLCanvasElement.toBlob; this environment does not provide it.");
  }

  const outputSize: Size = {
    width: Math.max(1, Math.round(svgSize.width * pixelRatio)),
    height: Math.max(1, Math.round(svgSize.height * pixelRatio)),
  };
  canvas.width = outputSize.width;
  canvas.height = outputSize.height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("PNG export needs a 2D canvas context; the host returned null.");
  }
  if (!transparent) {
    context.fillStyle = backgroundOption;
    context.fillRect(0, 0, outputSize.width, outputSize.height);
  }

  const svgBlob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(svgBlob);
  try {
    throwIfAborted();
    const image = new Image();
    if (typeof image.decode === "function") {
      image.src = url;
      await decodeImage(image);
    } else {
      await loadImage(image, url);
    }
    throwIfAborted();
    context.drawImage(image, 0, 0, outputSize.width, outputSize.height);
    const blob = await toPngBlob(canvas);
    if (!blob) {
      throw new Error("canvas.toBlob produced no data for the PNG export.");
    }
    return { blob, size: outputSize, diagnostics, svg };
  } catch (error) {
    if (isSecurityError(error)) throw securityErrorWithDiagnostics(diagnostics);
    throw error;
  } finally {
    // Always release the object URL, including when rasterisation failed.
    URL.revokeObjectURL(url);
  }
}
