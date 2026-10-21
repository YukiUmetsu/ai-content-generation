/** Semantic transformation compiler. MG1 remains the sole frame/easing engine. */
import { evaluateTimeline, outputKey } from "./timeline";
import { isEasingSpec } from "./easing";
import { resolveWorldTransforms } from "./matrix";
import { morphShapes, validateMorph } from "./morph";
import { evaluateMask } from "./masks";
import type { MaskSpecLocal } from "./masks";
import { createSharedElement, evaluateSharedElement } from "./shared-element";
import { copyVisualData, paintVisualElement, prepareVisualScene, requireVisual, sceneLayers } from "./visual-transformation-scene";
import type { AffineMatrix, AnimationTrack, ColorValue, Diagnostic, EasingSpec, MotionValue } from "./types";
import type { CompiledVisualTransformation, PreparedVisualElement, TransformationLane, TransformationOptions, VisualLayer, VisualMapping, VisualScene, VisualTransformationProgram, VisualTransformationSample, VisualTransformationSpec } from "./visual-transformation-types";

export * from "./visual-transformation-types";

const determinant = (m: AffineMatrix) => m.a * m.d - m.b * m.c;
const safePair = (a: AffineMatrix, b: AffineMatrix) => Number.isFinite(determinant(a)) && Number.isFinite(determinant(b)) && Math.abs(determinant(a)) > 1e-10 && Math.abs(determinant(b)) > 1e-10 && Math.sign(determinant(a)) === Math.sign(determinant(b));
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const clamp = (v: number) => Math.max(0, Math.min(1, v));
function warning(message: string, code = "transformation-fallback"): Diagnostic { return { code, severity: "warning", message }; }
function validateOptions(options: TransformationOptions) {
  requireVisual(options.strategy === undefined || ["auto", "geometric-morph", "shared-element", "mask-reveal", "particle-handoff", "crossfade"].includes(options.strategy), "Unknown strategy; choose a supported transformation strategy.");
  requireVisual(options.fallback === undefined || ["crossfade", "mask-reveal"].includes(options.fallback), "Fallback must be crossfade or mask-reveal.");
  requireVisual(options.easing === undefined || isEasingSpec(options.easing), "Invalid easing; use an MG1 named easing, finite cubic bezier or steps specification.");
}

function selectStrategy(from: PreparedVisualElement | undefined, to: PreparedVisualElement | undefined, options: TransformationOptions): { selected: TransformationLane["strategy"]; reason: string; fixedPose: boolean } {
  const fallback = options.fallback ?? "crossfade";
  if (!from || !to) return { selected: "crossfade", reason: "Unmatched element uses an explicit opacity enter/exit.", fixedPose: true };
  if (!safePair(from.world, to.world)) return { selected: "crossfade", reason: "Singular or orientation-changing transforms require endpoint-pose crossfade.", fixedPose: true };
  const same = equal(from.content, to.content);
  const shapes = from.content.kind === "shape" && to.content.kind === "shape";
  const compatible = shapes && validateMorph(from.content.kind === "shape" ? from.content.shape : { contours: [] }, to.content.kind === "shape" ? to.content.shape : { contours: [] }).length === 0;
  const requested = options.strategy ?? "auto";
  if (requested === "auto") return { selected: compatible ? "geometric-morph" : same ? "shared-element" : fallback, reason: compatible ? "Compatible contour topology with authored point correspondence." : same ? "The visual representation is unchanged." : "Representation or topology changed; use the declared fallback.", fixedPose: false };
  if (requested === "geometric-morph" && !compatible) return { selected: fallback, reason: "Geometric morph requires matching contour topology, winding and finite nondegenerate paths.", fixedPose: false };
  if (requested === "shared-element" && !same) return { selected: fallback, reason: "Shared-element requires identical representations; changed text or opaque path strings cannot be interpolated.", fixedPose: false };
  if (requested === "particle-handoff" && !shapes) return { selected: fallback, reason: "Particle transport requires authored contour shapes on both sides.", fixedPose: false };
  return { selected: requested, reason: `Explicit ${requested} strategy.`, fixedPose: false };
}

/** Validates ownership before compiling all coordinated channels into one MG1 timeline. */
export function compileVisualTransformation(input: VisualTransformationSpec): CompiledVisualTransformation {
  requireVisual(input && input.schemaVersion === 1, "Unsupported schemaVersion; provide a VT1 authoring fragment.");
  validateOptions(input);
  requireVisual(input.id && Number.isInteger(input.durationFrames) && input.durationFrames > 0, "An id and positive integer durationFrames are required.");
  requireVisual(input.fps && Number.isInteger(input.fps.num) && Number.isInteger(input.fps.den) && input.fps.num > 0 && input.fps.den > 0, "FPS must be a positive integer rational.");
  const range = input.range;
  requireVisual(range && Number.isInteger(range.startFrame) && Number.isInteger(range.endFrame) && range.startFrame >= 0 && range.endFrame > range.startFrame && range.endFrame < input.durationFrames, "The handoff range must be nonempty, use integer frames and leave a destination frame within durationFrames.");
  const spec = copyVisualData(input);
  const fromElements = prepareVisualScene(spec.from);
  const toElements = prepareVisualScene(spec.to);
  const fromById = new Map(fromElements.map(e => [e.id, e]));
  const toById = new Map(toElements.map(e => [e.id, e]));
  const diagnostics: Diagnostic[] = [];
  const decisions: CompiledVisualTransformation["decisions"] = [];
  const lanes: TransformationLane[] = [];
  const laneEasings = new Map<string, EasingSpec>();
  const usedFrom = new Set<string>();
  const usedTo = new Set<string>();
  let mappings: VisualMapping[] = spec.mappings ?? [];
  if (spec.mappings === undefined) {
    for (const elements of [fromElements, toElements]) {
      requireVisual(new Set(elements.map(e => e.semanticId)).size === elements.length, "Automatic semantic matching is ambiguous; supply explicit mappings for duplicate semanticIds.");
    }
    mappings = fromElements.flatMap(from => {
      const to = toElements.find(e => e.semanticId === from.semanticId);
      return to ? [{ kind: "one-to-one" as const, id: `match-${from.id}`, semanticId: from.semanticId, from: from.id, to: to.id }] : [];
    });
  }
  const mappingIds = new Set<string>();
  for (const mapping of mappings) {
    validateOptions(mapping);
    requireVisual(mapping.id && mapping.semanticId && !mappingIds.has(mapping.id), `Mapping '${mapping.id}' needs a unique id and semanticId.`);
    mappingIds.add(mapping.id);
    const pairs = mapping.kind === "group" ? mapping.pairs : mapping.kind === "one-to-one" ? [{ from: mapping.from, to: mapping.to, semanticId: mapping.semanticId }] : mapping.kind === "many-to-one" ? mapping.from.map(from => ({ from, to: mapping.to, semanticId: mapping.semanticId })) : mapping.kind === "one-to-many" ? mapping.to.map(to => ({ from: mapping.from, to, semanticId: mapping.semanticId })) : [];
    requireVisual(pairs.length > 0, `Mapping '${mapping.id}' must contain at least one pair.`);
    const fromIds = [...new Set(pairs.map(p => p.from))];
    const toIds = [...new Set(pairs.map(p => p.to))];
    requireVisual(mapping.kind !== "many-to-one" || fromIds.length === pairs.length, `Merge '${mapping.id}' repeats a source; each source may paint only once.`);
    requireVisual(mapping.kind !== "one-to-many" || toIds.length === pairs.length, `Split '${mapping.id}' repeats a destination; each destination may paint only once.`);
    requireVisual(mapping.kind !== "group" || fromIds.length === pairs.length && toIds.length === pairs.length, `Group '${mapping.id}' must contain unique one-to-one pairs; use split/merge mappings for other cardinalities.`);
    for (const id of fromIds) { requireVisual(fromById.has(id) && !usedFrom.has(id), `Source '${id}' is missing or already owned; give every source exactly one mapping.`); usedFrom.add(id); }
    for (const id of toIds) { requireVisual(toById.has(id) && !usedTo.has(id), `Destination '${id}' is missing or already owned; give every destination exactly one mapping.`); usedTo.add(id); }
    const options = { ...spec, ...mapping };
    pairs.forEach((pair, index) => {
      const from = fromById.get(pair.from)!;
      const to = toById.get(pair.to)!;
      const multiple = mapping.kind === "many-to-one" || mapping.kind === "one-to-many";
      const requested = options.strategy ?? "auto";
      const useCardinalityFallback = multiple && ["auto", "shared-element", "geometric-morph"].includes(requested);
      const decision = selectStrategy(from, to, useCardinalityFallback ? { ...options, strategy: options.fallback ?? "crossfade" } : options);
      const reason = useCardinalityFallback ? "Split/merge correspondence uses the declared representation fallback; each endpoint paints once." : decision.reason;
      decisions.push({ mappingId: `${mapping.id}:${index}`, requested, selected: decision.selected, reason });
      if (decision.selected !== requested && requested !== "auto" || decision.reason.includes("require") || requested === "auto" && !["geometric-morph", "shared-element"].includes(decision.selected)) diagnostics.push(warning(`${mapping.id}: ${reason}`));
      const particles = { count: 48, seed: 1, radius: 2, arc: 35, ...options.particles };
      requireVisual(Number.isInteger(particles.count) && particles.count >= 1 && particles.count <= 256 && Number.isInteger(particles.seed) && Number.isFinite(particles.radius) && particles.radius > 0 && Number.isFinite(particles.arc), `Mapping '${mapping.id}' needs 1–256 particles, integer seed and positive radius.`);
      lanes.push({ id: `mapping:${mapping.id}:${index}`, semanticId: pair.semanticId, from, to, strategy: decision.selected, fixedPose: decision.fixedPose, sourceWeight: mapping.kind === "one-to-many" && index > 0 ? 0 : 1, targetWeight: mapping.kind === "many-to-one" && index > 0 ? 0 : 1, particles });
      laneEasings.set(`mapping:${mapping.id}:${index}`, options.easing ?? "ease-in-out");
    });
  }
  for (const element of fromElements) if (!usedFrom.has(element.id)) lanes.push({ id: `exit:${element.id}`, semanticId: element.semanticId, from: element, strategy: "crossfade", fixedPose: true, sourceWeight: 1, targetWeight: 0, particles: { count: 1, seed: 1, radius: 1, arc: 0 } });
  for (const element of toElements) if (!usedTo.has(element.id)) lanes.push({ id: `enter:${element.id}`, semanticId: element.semanticId, to: element, strategy: "crossfade", fixedPose: true, sourceWeight: 0, targetWeight: 1, particles: { count: 1, seed: 1, radius: 1, arc: 0 } });

  const tracks: AnimationTrack[] = [];
  const addTrack = (lane: TransformationLane, property: string, valueType: AnimationTrack["valueType"], from: MotionValue, to: MotionValue) => {
    const easing = laneEasings.get(lane.id) ?? spec.easing ?? "ease-in-out";
    tracks.push({ id: `${lane.id}/${property}`, targetId: lane.id, property, valueType, keyframes: [{ frame: range.startFrame, value: from }, { frame: range.endFrame, value: to, easing }] });
  };
  // A frozen interruption matte or an unpaired parent matte has no moving
  // correspondence. Keep both endpoint poses visible instead of clipping the
  // transported geometry out of both windows midway through the handoff.
  for (const lane of lanes) if (lane.from && lane.to) {
    const ownsBoth = (fromId: string, toId: string) => lanes.some(l => l.from?.id === fromId && l.to?.id === toId && !l.fixedPose);
    const sourceUnpaired = lane.from.clipChain.some((c, i) => c.space === "local" && (!lane.to!.clipChain[i] || !ownsBoth(c.ownerId, lane.to!.clipChain[i].ownerId)));
    const targetUnpaired = lane.to.clipChain.some((c, i) => c.space === "local" && (!lane.from!.clipChain[i] || !ownsBoth(lane.from!.clipChain[i].ownerId, c.ownerId)));
    if (sourceUnpaired || targetUnpaired || (lane.from.resolvedClips?.length ?? 0) > 0 || (lane.to.resolvedClips?.length ?? 0) > 0) {
      lane.fixedPose = true;
      lane.strategy = "crossfade";
      const decision = decisions.find(d => `mapping:${d.mappingId}` === lane.id);
      const reason = "Unpaired or frozen clip owners use visible endpoint-pose crossfade.";
      if (decision) { decision.selected = "crossfade"; decision.reason = reason; }
      diagnostics.push(warning(`${lane.id}: ${reason}`));
    }
  }
  // Preserve local hierarchy only when the corresponding parent also survives.
  for (const lane of lanes) {
    const from = lane.from;
    const to = lane.to;
    if (from?.parentId && to?.parentId && from.coordinateSpace !== "world" && to.coordinateSpace !== "world" && !lane.fixedPose) {
      const parent = lanes.find(l => l.from?.id === from.parentId && l.to?.id === to.parentId && l.sourceWeight === 1 && l.targetWeight === 1 && !l.fixedPose);
      if (parent) lane.parentLaneId = parent.id;
    }
  }
  // Determine all unsafe local pairs before generating any child tracks. This
  // stays independent of authoring order, including tiny locals in large parents.
  for (const lane of lanes) if (lane.parentLaneId && lane.from && lane.to && !safePair(lane.from.local, lane.to.local)) {
    lane.fixedPose = true;
    lane.parentLaneId = undefined;
    lane.strategy = "crossfade";
    const decision = decisions.find(d => `mapping:${d.mappingId}` === lane.id);
    if (decision) { decision.selected = "crossfade"; decision.reason = "Unsafe local affine pair requires endpoint-pose crossfade."; }
    diagnostics.push(warning(`${lane.id}: unsafe local transforms use endpoint-pose crossfade.`));
  }
  for (const lane of lanes) {
    if (lane.parentLaneId && lanes.find(l => l.id === lane.parentLaneId)?.fixedPose) lane.parentLaneId = undefined;
    const from = lane.from, to = lane.to;
    const a = from ? lane.parentLaneId ? from.local : from.world : to!.world;
    const b = to ? lane.parentLaneId ? to.local : to.world : from!.world;
    addTrack(lane, "progress", "number", 0, 1);
    addTrack(lane, "transform", "transform", lane.fixedPose ? from?.world ?? to!.world : a, lane.fixedPose ? from?.world ?? to!.world : b);
    addTrack(lane, "opacity", "opacity", from ? lane.parentLaneId ? from.localOpacity : from.opacity : 0, to ? lane.parentLaneId ? to.localOpacity : to.opacity : 0);
    addTrack(lane, "fill", "color", from?.fill ?? to!.fill, to?.fill ?? from!.fill);
    addTrack(lane, "stroke", "color", from?.stroke ?? to!.stroke, to?.stroke ?? from!.stroke);
    addTrack(lane, "strokeWidth", "number", from?.strokeWidth ?? to!.strokeWidth, to?.strokeWidth ?? from!.strokeWidth);
    if (from && to) lane.shared = createSharedElement({ semanticId: lane.semanticId, from: { transform: from.world, opacity: from.opacity, range: { startFrame: 0, endFrame: range.endFrame } }, to: { transform: to.world, opacity: to.opacity, range: { startFrame: range.startFrame, endFrame: spec.durationFrames } }, handoff: range });
  }
  return { spec, lanes, decisions, diagnostics, timeline: { schemaVersion: 1, id: spec.id, fps: spec.fps, durationFrames: spec.durationFrames, nodes: tracks.map(track => ({ kind: "track", id: track.id, track })) } };
}

/** Analytic seed: no random generator, simulation, wall-clock, or previous frame. */
function seedFraction(seed: number, index: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x45d9f3b)) >>> 0;
  value = Math.imul(value ^ value >>> 16, 0x45d9f3b) >>> 0;
  return ((value ^ value >>> 16) >>> 0) / 4294967296;
}
function pointInside(point: { x: number; y: number }, points: Array<{ x: number; y: number }>) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function particlePoint(element: PreparedVisualElement, index: number, seed: number) {
  const bounds = element.content.bounds;
  // Bounded rejection over even-odd contour fill. Thin/open shapes fall back to
  // an authored vertex, never an unbounded sampler or an off-shape random point.
  const contours = element.content.kind === "shape" ? element.content.shape.contours : [];
  const insideContour = (p: { x: number; y: number }, contour: typeof contours[number]): boolean => pointInside(p, contour.points) && !(contour.holes ?? []).some(h => insideContour(p, h));
  for (let attempt = 0; attempt < 64; attempt++) {
    const p = { x: bounds.x + seedFraction(seed, index * 128 + attempt * 2) * bounds.width, y: bounds.y + seedFraction(seed, index * 128 + attempt * 2 + 1) * bounds.height };
    if (contours.some(c => insideContour(p, c))) return p;
  }
  return contours[0]?.points[index % contours[0].points.length] ?? { x: bounds.x, y: bounds.y };
}

/** Evaluates arbitrary integer frames without mutating the compiled fragment. */
export function evaluateVisualTransformation(compiled: CompiledVisualTransformation, frame: number, evaluation?: import("./types").EvaluationResult): VisualTransformationSample {
  requireVisual(Number.isInteger(frame), "Frame must be a finite integer; quantize playback time before evaluation.");
  const { spec, lanes } = compiled;
  const sampledFrame = Math.max(0, Math.min(spec.durationFrames - 1, frame));
  if (sampledFrame <= spec.range.startFrame || sampledFrame >= spec.range.endFrame) return { frame: sampledFrame, progress: sampledFrame <= spec.range.startFrame ? 0 : 1, layers: sceneLayers(sampledFrame <= spec.range.startFrame ? spec.from : spec.to), diagnostics: compiled.diagnostics };
  const result = evaluation ?? evaluateTimeline(compiled.timeline, sampledFrame);
  requireVisual(result.frame === sampledFrame, "Shared evaluation must match the transformation frame; pass the director's resolved frame.");
  const value = <T extends MotionValue,>(lane: TransformationLane, property: string) => result.samples[outputKey(lane.id, property)].value as T;
  const worldResult = resolveWorldTransforms(lanes.map(lane => ({ id: lane.id, parentId: lane.parentLaneId, local: value<AffineMatrix>(lane, "transform") })));
  const world = worldResult.transforms;
  const laneById = new Map(lanes.map(l => [l.id, l]));
  const opacity = (lane: TransformationLane): number => value<number>(lane, "opacity") * (lane.parentLaneId ? opacity(laneById.get(lane.parentLaneId)!) : 1);
  const layers: VisualLayer[] = [];
  const sourceOrder = new Map(spec.from.elements.map((e, i) => [e.id, i]));
  const targetOrder = new Map(spec.to.elements.map((e, i) => [e.id, i]));
  const sourceOwners = spec.from.elements.filter(e => e.content.kind !== "group").map(e => lanes.find(l => l.from?.id === e.id && l.sourceWeight === 1)?.id);
  const targetOwners = spec.to.elements.filter(e => e.content.kind !== "group").map(e => lanes.find(l => l.to?.id === e.id && l.targetWeight === 1)?.id);
  const paintOrderChanged = !equal(sourceOwners, targetOwners);
  const drawOrder = new Map<VisualLayer, [number, number]>();
  for (const lane of lanes) {
    const t = clamp(value<number>(lane, "progress"));
    const lineage = [...new Set([lane.semanticId, ...(lane.from?.lineage ?? (lane.from ? [lane.from.semanticId] : [])), ...(lane.to?.lineage ?? (lane.to ? [lane.to.semanticId] : []))])];
    const owner = lane.shared ? evaluateSharedElement(lane.shared, sampledFrame).owner : "handoff";
    // Kernel semantic handoff determines authoritative endpoints; MG1 tracks
    // determine authored easing, transform and paint during the handoff.
    const transform = owner === "from" ? lane.from!.world : owner === "to" ? lane.to!.world : world[lane.id];
    const ownerWorld = (side: "from" | "to", id: string) => {
      const matching = lanes.find(l => l[side]?.id === id);
      return matching && !matching.fixedPose ? world[matching.id] : matching?.[side]?.world ?? transform;
    };
    const paint = (side: "from" | "to", weight: number, interpolatePaint = false) => {
      const element = lane[side];
      if (!element || weight <= 0) return undefined;
      const layer = paintVisualElement(element, lane.fixedPose ? element.world : transform, id => ownerWorld(side, id));
      if (!layer) return undefined;
      layer.id = `${lane.id}:${side}`;
      layer.semanticId = lane.semanticId;
      layer.lineage = lineage;
      drawOrder.set(layer, [side === "from" ? 0 : 1, (side === "from" ? sourceOrder : targetOrder).get(element.id) ?? 0]);
      const parentOpacity = lane.parentLaneId ? opacity(laneById.get(lane.parentLaneId)!) : 1;
      layer.opacity = weight * (interpolatePaint ? opacity(lane) : lane.parentLaneId ? element.localOpacity * parentOpacity : element.opacity);
      if (interpolatePaint) { layer.fill = value<ColorValue>(lane, "fill"); layer.stroke = value<ColorValue>(lane, "stroke"); layer.strokeWidth = value<number>(lane, "strokeWidth"); }
      return layer;
    };
    const sameClips = lane.from && lane.to && equal(lane.from.clipChain.map(c => ({ ...c, ownerId: undefined })), lane.to.clipChain.map(c => ({ ...c, ownerId: undefined }))) && equal(lane.from.resolvedClips, lane.to.resolvedClips) && lane.from.clipChain.every((clip, index) => {
      const destination = lane.to!.clipChain[index];
      return clip.space === "world" || lanes.some(l => l.from?.id === clip.ownerId && l.to?.id === destination.ownerId && !l.fixedPose);
    });
    if ((lane.strategy === "shared-element" || lane.strategy === "geometric-morph") && lane.from && lane.to) {
      const singleRepresentation = sameClips && !paintOrderChanged;
      const a = paint("from", singleRepresentation ? 1 : 1 - t, true);
      const b = singleRepresentation ? undefined : paint("to", t, true);
      if (lane.strategy === "geometric-morph" && lane.from.content.kind === "shape" && lane.to.content.kind === "shape") {
        const geometry = morphShapes(lane.from.content.shape, lane.to.content.shape, t);
        const content = { ...lane.from.content, shape: { contours: geometry.contours } };
        if (a) a.content = content;
        if (b) b.content = content;
      }
      if (a) layers.push(a);
      if (b) layers.push(b);
    } else if (lane.strategy === "particle-handoff" && lane.from && lane.to) {
      const a = paint("from", lane.sourceWeight * Math.max(0, 1 - t * 4));
      const b = paint("to", lane.targetWeight * Math.max(0, (t - 0.75) * 4));
      if (a) layers.push(a);
      const particleOpacity = Math.min(1, t * 4, (1 - t) * 4) * opacity(lane);
      for (let i = 0; i < lane.particles.count; i++) {
        const start = particlePoint(lane.from, i, lane.particles.seed);
        const end = particlePoint(lane.to, i, lane.particles.seed);
        const m = transform;
        const x = start.x + (end.x - start.x) * t;
        const y = start.y + (end.y - start.y) * t - Math.sin(Math.PI * t) * lane.particles.arc * (seedFraction(lane.particles.seed, i) * 2 - 1);
        const radius = lane.particles.radius;
        const points = Array.from({ length: 12 }, (_, j) => ({ x: x + Math.cos(j * Math.PI / 6) * radius, y: y + Math.sin(j * Math.PI / 6) * radius }));
        const prototype = paint("from", 1, true);
        if (prototype) {
          const particle: VisualLayer = { ...prototype, id: `${lane.id}:particle:${i}`, content: { kind: "shape", bounds: { x: x - radius, y: y - radius, width: radius * 2, height: radius * 2 }, shape: { contours: [{ points, closed: true }] } }, transform: m, opacity: particleOpacity, strokeWidth: 0 };
          drawOrder.set(particle, drawOrder.get(prototype)!);
          layers.push(particle);
        }
      }
      if (b) layers.push(b);
    } else {
      // Split and merge weights enforce single ownership of repeated endpoints.
      const a = paint("from", lane.sourceWeight * (lane.strategy === "mask-reveal" ? 1 : 1 - t));
      const b = paint("to", lane.targetWeight * (lane.strategy === "mask-reveal" ? 1 : t));
      for (const [side, layer] of [["from", a], ["to", b]] as const) if (layer) {
        if (lane.strategy === "mask-reveal") {
          const mask: MaskSpecLocal = { kind: "clip", rect: layer.content.bounds, axis: side === "from" ? "right-to-left" : "left-to-right", transform: layer.transform };
          layer.clips.push(evaluateMask(mask, side === "from" ? 1 - t : t));
        }
        layers.push(layer);
      }
    }
  }
  layers.sort((a, b) => {
    const x = drawOrder.get(a) ?? [0, 0], y = drawOrder.get(b) ?? [0, 0];
    return paintOrderChanged ? x[0] - y[0] || x[1] - y[1] : x[1] - y[1] || x[0] - y[0];
  });
  return { frame: sampledFrame, progress: clamp((sampledFrame - spec.range.startFrame) / (spec.range.endFrame - spec.range.startFrame)), layers: layers.filter(l => l.opacity > 0), diagnostics: [...compiled.diagnostics, ...result.diagnostics, ...worldResult.diagnostics] };
}

/** A sequential authoring helper over the same global MG1 frame domain. */
export function createVisualTransformationProgram(specs: VisualTransformationSpec[]): VisualTransformationProgram {
  requireVisual(specs.length > 0, "A program requires at least one transition.");
  const first = specs[0];
  for (let i = 0; i < specs.length; i++) {
    const current = specs[i];
    requireVisual(equal(current.fps, first.fps) && current.durationFrames === first.durationFrames, "All program fragments must share the same FPS and durationFrames.");
    if (i) {
      requireVisual(current.range.startFrame >= specs[i - 1].range.endFrame, "Program handoff ranges must be ordered and cannot overlap; coordinate independent elements within one fragment.");
      requireVisual(equal(current.from, specs[i - 1].to), `Scene continuity failed before '${current.id}'; reuse the exact preceding destination snapshot.`);
    }
  }
  return { schemaVersion: 1, fps: copyVisualData(first.fps), durationFrames: first.durationFrames, segments: specs.map((spec, i) => ({ startFrame: i ? spec.range.startFrame : 0, transformation: compileVisualTransformation(spec) })) };
}
export function evaluateVisualTransformationProgram(program: VisualTransformationProgram, frame: number): VisualTransformationSample {
  requireVisual(Number.isInteger(frame), "Frame must be a finite integer.");
  const sampledFrame = Math.max(0, Math.min(program.durationFrames - 1, frame));
  const segment = [...program.segments].reverse().find(s => s.startFrame <= sampledFrame);
  requireVisual(segment, "Program has no segment for this frame; compile authoring fragments before sampling.");
  return evaluateVisualTransformation(segment.transformation, sampledFrame);
}

/** Exact painted-state retarget. C0 appearance continuity; no C1 velocity claim. */
export function retargetVisualTransformation(program: VisualTransformationProgram, request: { frame: number; to: VisualScene; durationFrames: number } & TransformationOptions): VisualTransformationProgram {
  requireVisual(Number.isInteger(request.frame) && request.frame >= 0 && request.frame < program.durationFrames && Number.isInteger(request.durationFrames) && request.durationFrames > 0, "Retarget frame must be inside the program and durationFrames must be a positive integer.");
  const snapshot = evaluateVisualTransformationProgram(program, request.frame);
  const from: VisualScene = { id: `snapshot-${request.frame}`, elements: snapshot.layers.map((layer, i) => ({ id: `snapshot-${i}`, semanticId: layer.semanticId, lineage: layer.lineage, content: layer.content, transform: layer.transform, opacity: layer.opacity, fill: layer.fill, stroke: layer.stroke, strokeWidth: layer.strokeWidth, resolvedClips: layer.clips })) };
  const mappings: VisualMapping[] = [];
  for (const semanticId of new Set(from.elements.map(e => e.semanticId))) {
    const sources = from.elements.filter(e => e.semanticId === semanticId);
    const targets = request.to.elements.filter(e => e.semanticId === semanticId);
    requireVisual(targets.length <= 1, `Retarget semanticId '${semanticId}' is ambiguous; use unique destination semanticIds.`);
    if (targets[0]) {
      mappings.push(sources.length === 1 ? { id: `retarget-${mappings.length}`, semanticId, kind: "one-to-one", from: sources[0].id, to: targets[0].id } : { id: `retarget-${mappings.length}`, semanticId, kind: "many-to-one", from: sources.map(e => e.id) as [string, ...string[]], to: targets[0].id });
    }
  }
  const endFrame = request.frame + request.durationFrames;
  const durationFrames = Math.max(program.durationFrames, endFrame + 1);
  const compiled = compileVisualTransformation({ schemaVersion: 1, id: `retarget-${request.frame}`, fps: program.fps, durationFrames, range: { startFrame: request.frame, endFrame }, from, to: request.to, mappings, strategy: request.strategy, fallback: request.fallback, easing: request.easing, particles: request.particles });
  return { ...program, durationFrames, segments: [...program.segments.filter(s => s.startFrame < request.frame), { startFrame: request.frame, transformation: compiled }] };
}

/** Persist the authoring fragment, then recompile after loading; no hidden state. */
export function serializeVisualTransformation(spec: VisualTransformationSpec): string {
  compileVisualTransformation(spec);
  return JSON.stringify(spec);
}
export function parseVisualTransformation(json: string): CompiledVisualTransformation {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error("VisualTransformation: invalid JSON; provide a serialized VT1 authoring fragment."); }
  return compileVisualTransformation(parsed as VisualTransformationSpec);
}
