import { IDENTITY, multiplyMatrix, resolveWorldTransforms } from "./matrix";
import { evaluateMask } from "./masks";
import type { AffineMatrix, ColorValue, Rect } from "./types";
import type { PathContour } from "./morph";
import type { PreparedVisualElement, VisualLayer, VisualScene } from "./visual-transformation-types";

export const DEFAULT_FILL: ColorValue = { space: "srgb", r: 51, g: 102, b: 204, alpha: 1 };
export const TRANSPARENT: ColorValue = { space: "srgb", r: 0, g: 0, b: 0, alpha: 0 };
export const copyVisualData = <T,>(data: T): T => structuredClone(data);
export function requireVisual(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`VisualTransformation: ${message}`);
}
export function validRect(rect: Rect): boolean {
  return !!rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
}
function validateColor(color: ColorValue | undefined, label: string) {
  if (!color) return;
  requireVisual(color.space === "srgb" && [color.r, color.g, color.b].every(v => Number.isFinite(v) && v >= 0 && v <= 255) && Number.isFinite(color.alpha) && color.alpha >= 0 && color.alpha <= 1, `${label} must use sRGB, RGB channels in [0, 255] and alpha in [0, 1]. Convert linear-light colors to sRGB before using the SVG adapter.`);
}
function validateContour(contour: PathContour) {
  requireVisual(Array.isArray(contour.points) && contour.points.length > 0 && contour.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)), "Shape contours must contain finite points; repair the authored path.");
  (contour.holes ?? []).forEach(validateContour);
}
function layoutTransform(bounds: Rect, layout: Rect | undefined, transform: AffineMatrix | undefined) {
  if (!layout) return transform ?? IDENTITY;
  const x = layout.width / bounds.width;
  const y = layout.height / bounds.height;
  return multiplyMatrix({ a: x, b: 0, c: 0, d: y, e: layout.x - bounds.x * x, f: layout.y - bounds.y * y }, transform ?? IDENTITY);
}

/** Resolve layout first, then hierarchy. Fail before constructing any tracks. */
export function prepareVisualScene(scene: VisualScene): PreparedVisualElement[] {
  requireVisual(scene && typeof scene.id === "string" && Array.isArray(scene.elements), "A scene needs an id and an elements array.");
  const ids = new Set<string>();
  for (const element of scene.elements) {
    requireVisual(element.id && element.semanticId && !ids.has(element.id), `Scene '${scene.id}' has an empty or duplicate element id '${element.id}'; give each instance a unique id and semanticId.`);
    ids.add(element.id);
    requireVisual(element.content && validRect(element.content.bounds), `Element '${element.id}' needs positive finite intrinsic bounds.`);
    requireVisual(!element.layout || validRect(element.layout), `Element '${element.id}' has invalid layout bounds.`);
    requireVisual(!element.transform || [element.transform.a, element.transform.b, element.transform.c, element.transform.d, element.transform.e, element.transform.f].every(Number.isFinite), `Element '${element.id}' has a non-finite transform.`);
    requireVisual(element.opacity === undefined || Number.isFinite(element.opacity) && element.opacity >= 0 && element.opacity <= 1, `Element '${element.id}' opacity must be in [0, 1].`);
    requireVisual(element.strokeWidth === undefined || Number.isFinite(element.strokeWidth) && element.strokeWidth >= 0, `Element '${element.id}' strokeWidth must be finite and nonnegative.`);
    validateColor(element.fill, `Element '${element.id}' fill`);
    validateColor(element.stroke, `Element '${element.id}' stroke`);
    if (element.content.kind === "shape") {
      requireVisual(element.content.shape.contours.length > 0, `Shape '${element.id}' needs at least one contour.`);
      element.content.shape.contours.forEach(validateContour);
    } else if (element.content.kind === "text") {
      requireVisual(typeof element.content.text === "string" && (element.content.fontSize === undefined || Number.isFinite(element.content.fontSize) && element.content.fontSize > 0) && (element.content.lineHeight === undefined || Number.isFinite(element.content.lineHeight) && element.content.lineHeight > 0), `Text '${element.id}' needs text and positive finite fontSize/lineHeight.`);
    } else if (element.content.kind === "svg-path") {
      requireVisual(typeof element.content.d === "string" && element.content.d.length > 0, `SVG path '${element.id}' needs a path string. Use contours to enable geometric morphing.`);
    } else requireVisual(element.content.kind === "group", `Element '${element.id}' has an unsupported content kind.`);
    for (const clip of element.clips ?? []) {
      requireVisual(["local", "world"].includes(clip.space) && ["clip", "alpha", "luma"].includes(clip.mask.kind) && validRect(clip.mask.rect), `Clip on '${element.id}' needs a valid coordinate space, kind and positive finite rect.`);
      requireVisual(!clip.mask.transform || Object.values(clip.mask.transform).every(Number.isFinite), `Clip on '${element.id}' has a non-finite transform.`);
      requireVisual(clip.mask.feather === undefined || Number.isFinite(clip.mask.feather) && clip.mask.feather >= 0, `Clip on '${element.id}' has invalid feather.`);
      requireVisual(clip.mask.axis === undefined || ["left-to-right", "right-to-left", "top-to-bottom", "bottom-to-top", "radial"].includes(clip.mask.axis), `Clip on '${element.id}' uses an unsupported sweep axis.`);
    }
    for (const clip of element.resolvedClips ?? []) requireVisual(clip && ["clip", "alpha", "luma"].includes(clip.kind) && Array.isArray(clip.polygon) && clip.polygon.length === 4 && clip.polygon.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)) && clip.bounds && [clip.bounds.x, clip.bounds.y, clip.bounds.width, clip.bounds.height, clip.opacity, clip.feather].every(Number.isFinite) && clip.bounds.width >= 0 && clip.bounds.height >= 0 && clip.opacity >= 0 && clip.opacity <= 1 && clip.feather >= 0, `Snapshot matte on '${element.id}' is malformed; capture it with retargetVisualTransformation.`);
  }
  const byId = new Map(scene.elements.map(e => [e.id, e]));
  for (const element of scene.elements) if (element.parentId) {
    requireVisual(byId.get(element.parentId)?.content.kind === "group", `Parent '${element.parentId}' of '${element.id}' must reference an existing group.`);
  }
  // Cycles must be checked even for world-space children that skip inheritance.
  const hierarchy = resolveWorldTransforms(scene.elements.map(e => ({ id: e.id, parentId: e.parentId, local: IDENTITY })));
  requireVisual(!hierarchy.diagnostics.some(d => d.severity === "error"), hierarchy.diagnostics.map(d => d.message).join(" "));
  const locals = new Map(scene.elements.map(e => [e.id, layoutTransform(e.content.bounds, e.layout, e.transform)]));
  for (const [id, matrix] of locals) requireVisual(Object.values(matrix).every(Number.isFinite), `Layout for '${id}' overflows its affine matrix; use bounded dimensions and scale.`);
  const resolved = resolveWorldTransforms(scene.elements.map(e => ({ id: e.id, parentId: e.coordinateSpace === "world" ? undefined : e.parentId, local: locals.get(e.id)! })));
  for (const [id, matrix] of Object.entries(resolved.transforms)) requireVisual(Object.values(matrix).every(Number.isFinite), `World transform for '${id}' overflows; reduce ancestor scales or translations.`);
  const chain = (id: string): PreparedVisualElement["clipChain"] => {
    const element = byId.get(id)!;
    return [...(element.parentId ? chain(element.parentId) : []), ...(element.clips ?? []).map(c => ({ ...c, ownerId: id }))];
  };
  const inheritedOpacity = (id: string): number => {
    const element = byId.get(id)!;
    return (element.opacity ?? 1) * (element.parentId ? inheritedOpacity(element.parentId) : 1);
  };
  return scene.elements.map(e => ({ ...e, local: locals.get(e.id)!, world: resolved.transforms[e.id], opacity: inheritedOpacity(e.id), localOpacity: e.opacity ?? 1, fill: e.fill ?? DEFAULT_FILL, stroke: e.stroke ?? TRANSPARENT, strokeWidth: e.strokeWidth ?? 0, clipChain: chain(e.id) }));
}

export function paintVisualElement(element: PreparedVisualElement, world: AffineMatrix = element.world, ownerWorld?: (id: string) => AffineMatrix): VisualLayer | undefined {
  if (element.content.kind === "group") return undefined;
  return {
    id: element.id, semanticId: element.semanticId, lineage: element.lineage ?? [element.semanticId], content: element.content,
    transform: world, opacity: element.opacity, fill: element.fill, stroke: element.stroke, strokeWidth: element.strokeWidth,
    clips: [...(element.resolvedClips ?? []), ...element.clipChain.map(clip => evaluateMask({ ...clip.mask, transform: clip.space === "world" ? clip.mask.transform : multiplyMatrix(clip.mask.transform ?? IDENTITY, ownerWorld?.(clip.ownerId) ?? world) }, 1))],
  };
}

export function sceneLayers(scene: VisualScene): VisualLayer[] {
  const prepared = prepareVisualScene(scene);
  const worlds = new Map(prepared.map(e => [e.id, e.world]));
  return prepared.flatMap(e => {
    const layer = paintVisualElement(e, e.world, id => worlds.get(id)!);
    return layer && layer.opacity > 0 ? [layer] : [];
  });
}
