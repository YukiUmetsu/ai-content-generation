/** ShortSafeFrame core: per-output reserved regions and deterministic layout checks.
 * Every output (9:16, 16:9, 4:5 …) is its own profile with its own reserved UI.
 * Geometry is DATA supplied by the author or a preset's approximate insets — no
 * platform layout is hard-coded here. Rects are normalized [0,1] output space.
 */
import type { Diagnostic, Rect } from "../motion/types";

export type SafeFrameEdge = "top" | "bottom" | "left" | "right";
export type SafeFrameItemKind = "text" | "subject" | "graphic";
export interface ReservedRegion {
  id: string;
  rect: Rect;
  /** Edge this region hugs; it shrinks the content area from that side. Omit for interior obstacles. */
  edge?: SafeFrameEdge;
  /** Item kinds that must not enter. Default: text and subjects. */
  blocks?: readonly SafeFrameItemKind[];
  /** Preview-only stand-in drawn by ShortSafeFrame guides. Generic shapes, never platform branding. */
  appearance?: "band" | "actions" | "description" | "progress" | "header";
  label?: string;
}
export interface SafeFrameProfile {
  id: string;
  label?: string;
  /** Output raster in px. */
  width: number;
  height: number;
  reserved: readonly ReservedRegion[];
  /** Breathing room inside the content area, as a fraction of output width (applied as equal px on all sides). Default 0. */
  padding?: number;
}
export interface SafeFrameItem {
  id: string;
  kind: SafeFrameItemKind;
  rect: Rect;
  /** Critical subjects must sit fully inside the content area. */
  critical?: boolean;
}
export interface SafeFrameDiagnostic extends Diagnostic { profileId: string; targetId?: string; regionId?: string }
export interface SafeFrameInspection {
  ok: boolean;
  profileId: string;
  contentRect: Rect;
  diagnostics: SafeFrameDiagnostic[];
  /** Worst severity per item, for overlays. */
  status: Record<string, "ok" | "warning" | "error">;
}

const EPSILON = 1e-6;
const DEFAULT_BLOCKS: readonly SafeFrameItemKind[] = ["text", "subject"];
const validRect = (r: Rect) => [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0 &&
  r.x >= -EPSILON && r.y >= -EPSILON && r.x + r.width <= 1 + EPSILON && r.y + r.height <= 1 + EPSILON;
const overlaps = (a: Rect, b: Rect) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > EPSILON &&
  Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > EPSILON;
const contains = (outer: Rect, inner: Rect) => inner.x >= outer.x - EPSILON && inner.y >= outer.y - EPSILON &&
  inner.x + inner.width <= outer.x + outer.width + EPSILON && inner.y + inner.height <= outer.y + outer.height + EPSILON;

export function safeFrameOrientation(profile: Pick<SafeFrameProfile, "width" | "height">): "portrait" | "landscape" | "square" {
  return profile.width === profile.height ? "square" : profile.width > profile.height ? "landscape" : "portrait";
}

/** Four edge bands from fractional insets, e.g. a `VideoPlatformPreset`'s approximate `safeInset`.
 * Replace with measured overlay geometry when a placement's real UI is known.
 */
export function safeFrameProfileFromInset(options: {
  id: string; label?: string; width: number; height: number;
  inset: { left: number; right: number; top: number; bottom: number };
}): SafeFrameProfile {
  const { left, right, top, bottom } = options.inset;
  const bands: ReservedRegion[] = [
    { id: "top", edge: "top", rect: { x: 0, y: 0, width: 1, height: top }, appearance: "header" },
    { id: "bottom", edge: "bottom", rect: { x: 0, y: 1 - bottom, width: 1, height: bottom }, appearance: "description" },
    { id: "left", edge: "left", rect: { x: 0, y: 0, width: left, height: 1 } },
    { id: "right", edge: "right", rect: { x: 1 - right, y: 0, width: right, height: 1 }, appearance: "actions" },
  ];
  return { id: options.id, label: options.label, width: options.width, height: options.height,
    reserved: bands.filter(band => band.rect.width > 0 && band.rect.height > 0) };
}

/** Validate a profile. Errors here make every other check meaningless. */
export function validateSafeFrameProfile(profile: SafeFrameProfile): SafeFrameDiagnostic[] {
  const out: SafeFrameDiagnostic[] = [];
  const fail = (code: string, message: string, regionId?: string) =>
    out.push({ code, severity: "error", message, profileId: profile.id, regionId });
  if (!profile.id.trim() || !Number.isSafeInteger(profile.width) || !Number.isSafeInteger(profile.height) || profile.width <= 0 || profile.height <= 0)
    fail("safe-frame-profile-invalid", `Profile "${profile.id}" needs an ID and a positive integer raster.`);
  if (profile.padding !== undefined && (!Number.isFinite(profile.padding) || profile.padding < 0 || profile.padding >= 0.3))
    fail("safe-frame-profile-invalid", `Profile "${profile.id}" padding must be between 0 and 0.3 of the output width.`);
  const ids = new Set<string>();
  for (const region of profile.reserved) {
    if (!region.id.trim() || ids.has(region.id) || !validRect(region.rect))
      fail("safe-frame-region-invalid", `Reserved region "${region.id}" needs a unique ID and normalized bounds inside the output.`, region.id);
    ids.add(region.id);
    const r = region.rect, touches = { top: r.y <= EPSILON, bottom: r.y + r.height >= 1 - EPSILON,
      left: r.x <= EPSILON, right: r.x + r.width >= 1 - EPSILON };
    if (region.edge && !touches[region.edge])
      fail("safe-frame-region-detached", `Region "${region.id}" is declared on the ${region.edge} edge but does not touch it.`, region.id);
  }
  return out;
}

/** The content area left after edge-anchored regions; interior regions only block collisions. */
export function safeFrameContentRect(profile: SafeFrameProfile): Rect {
  let left = 0, top = 0, right = 1, bottom = 1;
  for (const { edge, rect } of profile.reserved) {
    if (edge === "top") top = Math.max(top, rect.y + rect.height);
    else if (edge === "bottom") bottom = Math.min(bottom, rect.y);
    else if (edge === "left") left = Math.max(left, rect.x + rect.width);
    else if (edge === "right") right = Math.min(right, rect.x);
  }
  const padX = profile.padding ?? 0, padY = padX * profile.width / profile.height;
  left += padX; right -= padX; top += padY; bottom -= padY;
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** CC1 bridge: pass as `CameraComposition` so framing solves inside the content area. */
export function safeFrameCameraComposition(profile: SafeFrameProfile): { safeRegion: Rect; exclusions: Rect[] } {
  return { safeRegion: safeFrameContentRect(profile),
    exclusions: profile.reserved.filter(r => !r.edge && (r.blocks ?? DEFAULT_BLOCKS).includes("subject")).map(r => r.rect) };
}
/** Text bridge for `placeProtectedText` / `ExplainerStage`. */
export function safeFrameTextConstraints(profile: SafeFrameProfile): { safeRegion: Rect; avoidRegions: Rect[] } {
  return { safeRegion: safeFrameContentRect(profile),
    avoidRegions: profile.reserved.filter(r => !r.edge && (r.blocks ?? DEFAULT_BLOCKS).includes("text")).map(r => r.rect) };
}
/** Output-px zones for `inspectExplainerPrinciples` output profiles. */
export function safeFrameExclusionZones(profile: SafeFrameProfile): { id: string; rect: Rect }[] {
  return profile.reserved.filter(r => (r.blocks ?? DEFAULT_BLOCKS).includes("text")).map(r => ({ id: r.id,
    rect: { x: r.rect.x * profile.width, y: r.rect.y * profile.height, width: r.rect.width * profile.width, height: r.rect.height * profile.height } }));
}

/** Check one output's measured layout against its reserved regions. */
export function inspectSafeFrame(profile: SafeFrameProfile, items: readonly SafeFrameItem[]): SafeFrameInspection {
  const diagnostics = validateSafeFrameProfile(profile);
  const content = safeFrameContentRect(profile), status: SafeFrameInspection["status"] = {};
  const report = (item: SafeFrameItem, severity: "error" | "warning", code: string, message: string, regionId?: string) => {
    diagnostics.push({ code, severity, message, profileId: profile.id, targetId: item.id, regionId });
    if (status[item.id] !== "error") status[item.id] = severity;
  };
  if (content.width <= 0 || content.height <= 0)
    diagnostics.push({ code: "safe-frame-no-content", severity: "error", profileId: profile.id,
      message: `Reserved edges leave no content area in "${profile.id}".` });
  const seen = new Set<string>();
  for (const item of items) {
    status[item.id] ??= "ok";
    if (!item.id.trim() || seen.has(item.id) || !validRect(item.rect)) {
      report(item, "error", "safe-frame-item-invalid", `Item "${item.id}" needs a unique ID and normalized bounds inside the output.`);
      continue;
    }
    seen.add(item.id);
    const strict = item.kind === "text" || item.critical;
    if (strict && !contains(content, item.rect))
      report(item, "error", `${item.kind}-outside-safe-area`, `${item.kind === "text" ? "Text" : "Critical subject"} "${item.id}" leaves the content area of "${profile.id}".`);
    for (const region of profile.reserved) {
      if (!overlaps(item.rect, region.rect) || !(region.blocks ?? DEFAULT_BLOCKS).includes(item.kind)) continue;
      const name = region.label ?? region.id;
      if (strict) report(item, "error", `${item.kind}-in-reserved-region`, `"${item.id}" overlaps reserved "${name}" in "${profile.id}".`, region.id);
      else report(item, "warning", `${item.kind}-in-reserved-region`, `"${item.id}" overlaps reserved "${name}" in "${profile.id}"; it may be hidden by app UI.`, region.id);
    }
  }
  for (const text of items.filter(i => i.kind === "text" && seen.has(i.id)))
    for (const subject of items.filter(i => i.kind === "subject" && i.critical && seen.has(i.id)))
      if (overlaps(text.rect, subject.rect))
        report(text, "error", "text-covers-subject", `Text "${text.id}" covers critical subject "${subject.id}" in "${profile.id}".`);
  return { ok: !diagnostics.some(d => d.severity === "error"), profileId: profile.id, contentRect: content, diagnostics, status };
}

/** How `to` would look if it were mechanically derived from `from`. */
function derive(rect: Rect, fromAspect: number, toAspect: number, mode: "center-crop" | "letterbox"): Rect {
  const narrower = toAspect < fromAspect;
  const f = narrower ? toAspect / fromAspect : fromAspect / toAspect;
  if (mode === "center-crop")
    return narrower ? { x: (rect.x - (1 - f) / 2) / f, y: rect.y, width: rect.width / f, height: rect.height }
      : { x: rect.x, y: (rect.y - (1 - f) / 2) / f, width: rect.width, height: rect.height / f };
  return narrower ? { x: rect.x, y: (1 - f) / 2 + rect.y * f, width: rect.width, height: rect.height * f }
    : { x: (1 - f) / 2 + rect.x * f, y: rect.y, width: rect.width * f, height: rect.height };
}
const same = (a: Rect, b: Rect, tolerance: number) =>
  Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance &&
  Math.abs(a.width - b.width) <= tolerance && Math.abs(a.height - b.height) <= tolerance;

/** Check every output, that critical IDs exist in all of them, and that no output is a blind crop/letterbox of another. */
export function inspectSafeFrameSet(outputs: readonly { profile: SafeFrameProfile; items: readonly SafeFrameItem[] }[],
  options: { requiredIds?: readonly string[]; tolerance?: number } = {}) {
  const inspections = outputs.map(output => inspectSafeFrame(output.profile, output.items));
  const diagnostics = inspections.flatMap(inspection => inspection.diagnostics);
  const required = new Set(options.requiredIds ?? outputs.flatMap(o => o.items.filter(i => i.critical).map(i => i.id)));
  for (const { profile, items } of outputs) {
    const present = new Set(items.map(item => item.id));
    for (const id of required) if (!present.has(id))
      diagnostics.push({ code: "item-missing-in-output", severity: "error", profileId: profile.id, targetId: id,
        message: `"${id}" is missing from "${profile.id}"; every output must carry the same semantic subjects.` });
  }
  const tolerance = options.tolerance ?? 0.002;
  for (const [i, a] of outputs.entries()) for (const b of outputs.slice(i + 1)) {
    const fromAspect = a.profile.width / a.profile.height, toAspect = b.profile.width / b.profile.height;
    if (Math.abs(fromAspect - toAspect) < 1e-3) continue;
    const pairs = a.items.flatMap(item => { const other = b.items.find(o => o.id === item.id); return other ? [[item.rect, other.rect] as const] : []; });
    if (pairs.length < 2) continue;
    for (const mode of ["center-crop", "letterbox"] as const)
      if (pairs.every(([from, to]) => same(derive(from, fromAspect, toAspect, mode), to, tolerance)))
        diagnostics.push({ code: "blind-crop", severity: "error", profileId: b.profile.id,
          message: `"${b.profile.id}" is a ${mode} of "${a.profile.id}". Compose each output independently.` });
  }
  return { ok: !diagnostics.some(d => d.severity === "error"), inspections, diagnostics };
}
