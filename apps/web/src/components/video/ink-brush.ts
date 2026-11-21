/**
 * INK1 — authored brush geometry, not a post-process ink matte or a fluid simulation.
 * Pure absolute-frame evaluation: control point pressure, segment pace, brush load,
 * five ink values, and paper-anchored flying-white bristle splits. No renderer clock.
 */
export interface InkBrushNode {
  x: number;
  y: number;
  /** Contact force, 0..1; varies the physical width of the mark. */
  pressure: number;
  /** Local travel speed multiplier, .25..4; greater is faster across this segment. */
  pace: number;
}
export interface InkBrushStroke {
  id: string;
  points: readonly InkBrushNode[];
  /** Maximum full-pressure brush width, 1..120 design pixels. */
  width: number;
  /** Available pigment 0..1; controls ink opacity, not blur. */
  load: number;
  /** Degree of bristle splitting, 0..1; the holes show actual paper. */
  dryness: number;
  /** Five deliberately separated ink densities, darkest (0) to palest (4). */
  tone: 0 | 1 | 2 | 3 | 4;
  startFrame: number;
  durationFrames: number;
}
export interface InkBrushSpec {
  version: 1;
  width: number;
  height: number;
  paper: string;
  seed: number;
  strokes: readonly InkBrushStroke[];
}
export interface InkIssue { code: string; path: string; message: string }
export interface InkGeometry {
  id: string;
  progress: number;
  outline: string;
  /** A narrower ink-rich contact band: actual second pigment deposit, not an edge outline. */
  core: string;
  /** Tiny irregular paper apertures within the same mark, fixed in paper coordinates. */
  pores: readonly { x: number; y: number; rx: number; ry: number }[];
  /** Isolated brush hairs dragging past the main contact patch. */
  hairs: readonly { d: string; width: number; opacity: number }[];
  /** Flying-white paper channels revealed inside an individual stroke. */
  gaps: readonly { d: string; width: number }[];
  /** Position of the brush's original travel, used for fixed pigment gradation. */
  flow: readonly [number, number, number, number];
  color: string;
  opacity: number;
  /** Tight authored-geometry bounds, before the full-sheet SVG clip. */
  bounds: readonly [number, number, number, number];
}
export const INK_DENSITIES = ["#20282A", "#475254", "#6E7B7C", "#9EA8A7", "#CBD0C7"] as const;
const HEX = /^#[0-9a-f]{6}$/i;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const between = (n: unknown, min: number, max: number) => finite(n) && n >= min && n <= max;
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const fmt = (v: number) => v.toFixed(3);
/** Hash only paper-space indices and pinned seed; never a frame or wall clock. */
export function inkHash(seed: number, x: number, y: number): number {
  let n = (Math.imul((x | 0) + 101, 374761393) + Math.imul((y | 0) + 211, 668265263) + Math.imul((seed | 0) + 37, 1013904223)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
export function inspectInkBrush(value: InkBrushSpec): InkIssue[] {
  const issues: InkIssue[] = [];
  const fail = (code: string, path: string, message: string) => issues.push({ code, path, message });
  if (!value || typeof value !== "object") return [{ code: "spec", path: "/", message: "An INK1 object is required." }];
  if (value.version !== 1) fail("version", "/version", "INK1 requires version 1.");
  if (!Number.isSafeInteger(value.width) || value.width < 240 || value.width > 4096) fail("width", "/width", "Width must be 240..4096.");
  if (!Number.isSafeInteger(value.height) || value.height < 240 || value.height > 4096) fail("height", "/height", "Height must be 240..4096.");
  if (typeof value.paper !== "string" || !HEX.test(value.paper)) fail("paper", "/paper", "Paper must be #RRGGBB.");
  if (!Number.isSafeInteger(value.seed) || value.seed < 0 || value.seed > 2147483647) fail("seed", "/seed", "Seed must be a nonnegative 31-bit integer.");
  if (!Array.isArray(value.strokes) || value.strokes.length < 1 || value.strokes.length > 72) {
    fail("strokes", "/strokes", "Supply 1..72 authored strokes; there is no fabricated brush fallback.");
    return issues;
  }
  const ids = new Set<string>();
  for (let i = 0; i < value.strokes.length; i++) {
    const s = value.strokes[i], at = "/strokes/" + i;
    if (!s || typeof s.id !== "string" || !/^[a-z][a-z0-9-]{0,47}$/.test(s.id) || ids.has(s.id))
      fail("stroke-id", at + "/id", "Use a unique lowercase stroke ID.");
    else ids.add(s.id);
    if (!s || !between(s.width, 1, 120)) fail("stroke-width", at + "/width", "Width must be 1..120.");
    if (!s || !between(s.load, 0, 1)) fail("stroke-load", at + "/load", "Load must be 0..1.");
    if (!s || !between(s.dryness, 0, 1)) fail("stroke-dryness", at + "/dryness", "Dryness must be 0..1.");
    if (!s || !Number.isInteger(s.tone) || s.tone < 0 || s.tone > 4)
      fail("stroke-tone", at + "/tone", "Tone must be one of 0, 1, 2, 3, 4.");
    if (!s || !Number.isSafeInteger(s.startFrame) || s.startFrame < 0)
      fail("stroke-start", at + "/startFrame", "Start must be a nonnegative integer.");
    if (!s || !Number.isSafeInteger(s.durationFrames) || s.durationFrames < 1 || s.durationFrames > 3600)
      fail("stroke-duration", at + "/durationFrames", "Duration must be 1..3600 frames.");
    if (!s || !Array.isArray(s.points) || s.points.length < 2 || s.points.length > 20) {
      fail("stroke-points", at + "/points", "Each stroke needs 2..20 ordered control points.");
      continue;
    }
    let travel = 0;
    for (let j = 0; j < s.points.length; j++) {
      const p = s.points[j], path = at + "/points/" + j;
      if (!p || !between(p.x, 0, value.width) || !between(p.y, 0, value.height))
        fail("point-position", path, "Control point must lie within the canvas.");
      if (!p || !between(p.pressure, 0, 1))
        fail("point-pressure", path + "/pressure", "Pressure must be within 0..1.");
      if (!p || !between(p.pace, .25, 4))
        fail("point-pace", path + "/pace", "Pace must be within .25..4.");
      if (j > 0 && p && s.points[j - 1] && finite(p.x) && finite(p.y) &&
          finite(s.points[j - 1].x) && finite(s.points[j - 1].y))
        travel += Math.hypot(p.x - s.points[j - 1].x, p.y - s.points[j - 1].y);
    }
    if (travel < .5) fail("stroke-length", at + "/points", "Control points need a visible travel distance.");
  }
  return issues;
}

export interface InkBrushSample { x: number; y: number; pressure: number; pace: number; arc: number; time: number }
type Sample = InkBrushSample;
function cubic(a: number, b: number, c: number, d: number, t: number): number {
  return b + .5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
}
function fullSamples(s: InkBrushStroke, width: number, height: number): Sample[] {
  const nodes = s.points, samples: Sample[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[Math.max(0, i - 1)], b = nodes[i], c = nodes[i + 1], d = nodes[Math.min(i + 2, nodes.length - 1)];
    // Bounded curve subdivision, independent of time, viewport and device pixel ratio.
    const steps = Math.max(8, Math.min(30, Math.ceil(Math.hypot(c.x - b.x, c.y - b.y) / 7)));
    for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
      const t = k / steps;
      const sample: Sample = {
        x: clamp(cubic(a.x, b.x, c.x, d.x, t), 0, width),
        y: clamp(cubic(a.y, b.y, c.y, d.y, t), 0, height),
        pressure: clamp(cubic(a.pressure, b.pressure, c.pressure, d.pressure, t), 0, 1),
        pace: clamp(lerp(b.pace, c.pace, t), .25, 4), arc: 0, time: 0,
      };
      if (samples.length) {
        const prior = samples[samples.length - 1];
        const dist = Math.hypot(sample.x - prior.x, sample.y - prior.y);
        sample.arc = prior.arc + dist;
        sample.time = prior.time + dist / Math.max(.25, (sample.pace + prior.pace) / 2);
      }
      samples.push(sample);
    }
  }
  return samples;
}
/** Reuse the exact timed Catmull-Rom nib trajectory in the separate pigment/paper adapter. */
export function sampleInkBrushStroke(stroke: InkBrushStroke, width: number, height: number): readonly InkBrushSample[] {
  return fullSamples(stroke, width, height);
}
function partialSamples(samples: Sample[], progress: number): Sample[] {
  if (progress <= 0) return [];
  if (progress >= 1) return samples;
  const target = samples[samples.length - 1].time * progress;
  const out: Sample[] = [samples[0]];
  for (let i = 1; i < samples.length; i++) {
    const p = samples[i], previous = samples[i - 1];
    if (p.time > target) {
      if (target > previous.time) {
        const t = (target - previous.time) / (p.time - previous.time);
        out.push({
          x: lerp(previous.x, p.x, t), y: lerp(previous.y, p.y, t),
          pressure: lerp(previous.pressure, p.pressure, t), pace: lerp(previous.pace, p.pace, t),
          arc: lerp(previous.arc, p.arc, t), time: target,
        });
      }
      break;
    }
    out.push(p);
  }
  return out;
}
/** Interpolated noise prevents the saw-tooth outlines caused by hashing each curve sample. */
function inkSmoothNoise(seed: number, distance: number, scale: number, channel: number): number {
  const x = distance / scale, cell = Math.floor(x), fraction = x - cell;
  const t = fraction * fraction * (3 - 2 * fraction);
  return lerp(inkHash(seed, cell, channel), inkHash(seed, cell + 1, channel), t);
}
interface OffsetSample extends Sample { nx: number; ny: number; radius: number }
function offsets(samples: Sample[], totalArc: number, s: InkBrushStroke, seed: number): OffsetSample[] {
  return samples.map((p, i) => {
    const before = samples[Math.max(0, i - 1)], after = samples[Math.min(samples.length - 1, i + 1)];
    const dx = after.x - before.x, dy = after.y - before.y, length = Math.hypot(dx, dy) || 1;
    const tipIn = Math.pow(clamp(p.arc / Math.max(.1, s.width * .8), .018, 1), .55);
    const tipOut = Math.pow(clamp((totalArc - p.arc) / Math.max(.1, s.width * .85), .018, 1), .68);
    // A piece of paper has fixed tooth: don't sample any jitter from frame or active sample count.
    const fibre = inkSmoothNoise(seed, p.arc, 11, 17);
    const edge = .97 + (fibre - .5) * (.10 + .21 * s.dryness);
    const paceDepletion = 1 - .085 * clamp((p.pace - 1) / 3, 0, 1);
    const radius = s.width * (.06 + .94 * p.pressure) * (.72 + .28 * s.load)
      * Math.min(tipIn, tipOut) * edge * paceDepletion / 2;
    return { ...p, nx: -dy / length, ny: dx / length, radius };
  });
}
type BrushGeometry = Omit<InkGeometry, "id" | "progress" | "color" | "opacity">;
function geometry(
  s: InkBrushStroke, seed: number, samples: Sample[], totalArc: number, fullSamples: Sample[],
): BrushGeometry {
  const from = fullSamples[0], to = fullSamples[fullSamples.length - 1];
  const flow = [from.x, from.y, to.x, to.y] as const;
  if (samples.length < 2) return {
    outline: "", core: "", gaps: [], hairs: [], pores: [], flow, bounds: [0, 0, 0, 0],
  };
  const pts = offsets(samples, totalArc, s, seed);
  const point = (p: OffsetSample, amount: number, lateral: number): readonly [number, number] =>
    [p.x + p.nx * amount * p.radius + p.ny * lateral,
     p.y + p.ny * amount * p.radius - p.nx * lateral];
  const asPath = (vertices: readonly (readonly [number, number])[]): string =>
    "M" + vertices.map((p, i) => (i ? "L" : "") + fmt(p[0]) + " " + fmt(p[1])).join(" ") + " Z";

  // Off-centre wet/dry tip contact: no symmetric, uniform fill that reads as a vector ribbon.
  const left = pts.map(p => point(p, 1.02 + (inkSmoothNoise(seed, p.arc, 8, 41) - .5) * .22, 0));
  const right = pts.map(p => point(p, -1.0 + (inkSmoothNoise(seed, p.arc, 9, 43) - .5) * .21, 0)).reverse();
  const hull = [...left, ...right], outline = asPath(hull);
  // Ink-rich bristle edge naturally tracks the geometry in one movement, with lighter wash beside it.
  const coreLeft = pts.map(p => point(p, .44 + .08 * (inkSmoothNoise(seed, p.arc, 13, 47) - .5), 0));
  const coreRight = pts.map(p => point(p, -.32 + .07 * (inkSmoothNoise(seed, p.arc, 15, 53) - .5), 0)).reverse();
  const core = asPath([...coreLeft, ...coreRight]);

  // Fine, discontinuous flying-white cuts; density depends on dryness and speed. A wet
  // loaded stroke keeps most of its contact, while fast nearly dry work breaks apart.
  const gaps: { d: string; width: number }[] = [];
  const lanes = Math.min(24, Math.max(0, Math.round(s.dryness * 24)));
  for (let lane = 0; lane < lanes; lane++) {
    const across = (lane - (lanes - 1) / 2 + (inkHash(seed, lane, 73) - .5) * .34) / Math.max(1, lanes) * 1.8;
    const paths: string[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      // Hair contact varies in space; don't produce straight, equally spaced stripes.
      const phase = Math.floor(a.arc / (6.5 + lane % 7));
      const gapChance = s.dryness * (.25 + .30 * a.pace) * (.66 + .34 * (1 - s.load));
      if (inkHash(seed + lane * 131, phase, 71) > gapChance) continue;
      if (a.radius < .65 || b.radius < .65) continue;
      const nudgeA = (inkHash(seed + lane, phase, 89) - .5) * .14;
      const nudgeB = (inkHash(seed + lane, phase + 1, 89) - .5) * .14;
      const p0 = point(a, across + nudgeA, 0), p1 = point(b, across + nudgeB, 0);
      paths.push("M" + fmt(p0[0]) + " " + fmt(p0[1]) + "L" + fmt(p1[0]) + " " + fmt(p1[1]));
    }
    if (paths.length) gaps.push({
      d: paths.join(" "),
      width: Math.max(.22, s.width * (.003 + .014 * s.dryness) * (.65 + .35 * s.load)),
    });
  }

  // Very small, spatially pinned paper apertures remove pigment, not paint cream over it.
  // Independent of current frame: an existing dry mark doesn't change when another grows.
  const pores: { x: number; y: number; rx: number; ry: number }[] = [];
  const holes = Math.min(380, Math.ceil(totalArc * .95));
  const complete = offsets(fullSamples, totalArc, s, seed);
  for (let j = 0; j < holes; j++) {
    const index = Math.min(complete.length - 1, Math.floor(inkHash(seed, j, 103) * complete.length));
    const p = complete[index];
    const lateral = (inkHash(seed, j, 107) * 1.76 - .88);
    const hash = inkHash(seed, j, 109);
    const likelihood = (.10 + .31 * s.dryness + .15 * (1 - s.load)) * (.75 + .25 * p.pace / 4);
    if (hash > likelihood || p.radius < .65) continue;
    const xy = point(p, lateral, 0);
    pores.push({
      x: xy[0], y: xy[1],
      rx: Math.max(.22, s.width * (.004 + .011 * inkHash(seed, j, 113))),
      ry: Math.max(.16, s.width * (.003 + .007 * inkHash(seed, j, 117))),
    });
  }

  // A few feathering hairs can extend past the silhouette on the brush's dry side.
  // They remain physical local marks (not a full-frame grain overlay).
  const hairs: { d: string; width: number; opacity: number }[] = [];
  for (let i = 1; i < pts.length - 2; i += 2) {
    const p = pts[i], q = pts[Math.min(pts.length - 1, i + 2)];
    if (p.radius < 1.1 || inkHash(seed, Math.floor(p.arc / 7), 127) > .20 + .48 * s.dryness) continue;
    const side = inkHash(seed, i, 129) > .5 ? 1 : -1;
    const out = side * (1.01 + inkHash(seed, i, 131) * .32);
    const a = point(p, out, 0), b = point(q, out + side * .12, 0);
    hairs.push({
      d: "M" + fmt(a[0]) + " " + fmt(a[1]) + "L" + fmt(b[0]) + " " + fmt(b[1]),
      width: Math.max(.4, p.radius * (.025 + inkHash(seed, i, 137) * .06)),
      opacity: .16 + s.load * .30,
    });
  }
  // Distinct hairs inside the wet footprint are deposited as fine ink threads, not
  // a generic texture projected across the picture. Each lane follows the changing
  // tangent and pressure, with slightly different ink retention and intermittent contact.
  const bristles = Math.max(7, Math.min(68, Math.round(s.width * (.56 + .34 * s.dryness))));
  for (let lane = 0; lane < bristles; lane++) {
    const across = ((lane + .5 + (inkHash(seed, lane, 193) - .5) * .45) / bristles * 2 - 1) * .93;
    const segments: string[] = [];
    let active = false;
    for (let j = 0; j < pts.length; j++) {
      const p = pts[j];
      if (p.radius < .35 || inkHash(seed + lane * 19, Math.floor(p.arc / 9), 197) <
        s.dryness * (.12 + .22 * p.pace / 4)) {
        active = false;
        continue;
      }
      const jitter = (inkSmoothNoise(seed + lane * 43, p.arc, 13, 199) - .5) * .17;
      const xy = point(p, across + jitter, 0);
      segments.push((active ? "L" : "M") + fmt(xy[0]) + " " + fmt(xy[1]));
      active = true;
    }
    if (!segments.length) continue;
    hairs.push({
      d: segments.join(" "),
      width: .25 + Math.min(1.25, s.width / 64) * (.3 + inkHash(seed, lane, 211)),
      opacity: .055 + .23 * s.load * (.5 + .5 * inkHash(seed, lane, 213)),
    });
  }
  // At the lift, separated bristles continue beyond the wet core and fade independently.
  // They grow only during the final brush travel, never ahead of the contact tip.
  const drawnArc = pts[pts.length - 1].arc;
  const lift = clamp((drawnArc / Math.max(.1, totalArc) - .97) / .03, 0, 1);
  if (lift > 0 && complete.length > 8) {
    const tip = complete[complete.length - 1];
    const prior = complete[Math.max(0, complete.length - 8)];
    const dx = tip.x - prior.x, dy = tip.y - prior.y, length = Math.hypot(dx, dy) || 1;
    const dirX = dx / length, dirY = dy / length;
    for (let lane = 0; lane < 17; lane++) {
      const offset = (lane - 8) / 8 * (.6 + .3 * s.dryness);
      const begin = complete[Math.max(0, complete.length - 9 - (lane % 4))];
      const a = point(begin, offset, 0);
      const distance = (6 + 32 * inkHash(seed, lane, 149)) * lift
        * (.42 + .58 * s.dryness);
      const sx = tip.x + dirX * distance + tip.nx * offset * s.width * .09;
      const sy = tip.y + dirY * distance + tip.ny * offset * s.width * .09;
      hairs.push({
        d: "M" + fmt(a[0]) + " " + fmt(a[1]) +
          "Q" + fmt(tip.x + tip.nx * offset * s.width * .08) + " " +
          fmt(tip.y + tip.ny * offset * s.width * .08) + " " +
          fmt(sx) + " " + fmt(sy),
        width: .24 + 1.0 * inkHash(seed, lane, 151) * (.3 + .7 * s.load),
        opacity: (.12 + .48 * inkHash(seed, lane, 153)) * lift,
      });
    }
  }
  const xs = hull.map(p => p[0]), ys = hull.map(p => p[1]);
  return {
    outline, core, gaps, pores, hairs, flow,
    bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  };
}

/** A frame can be evaluated in any order; geometry, fibres and dry gaps are paper anchored. */
export function evaluateInkBrush(spec: InkBrushSpec, frame: number, reducedMotion = false): InkGeometry[] {
  const issues = inspectInkBrush(spec);
  if (issues.length) throw new RangeError(issues.map(i => i.path + ": " + i.message).join("; "));
  if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError("Ink frame must be a nonnegative integer.");
  return spec.strokes.map((s, i) => {
    const progress = reducedMotion ? 1 : clamp((frame - s.startFrame) / s.durationFrames, 0, 1);
    if (progress === 0) return { id: s.id, progress, outline: "", core: "", gaps: [], pores: [], hairs: [],
      flow: [s.points[0].x, s.points[0].y, s.points[s.points.length - 1].x, s.points[s.points.length - 1].y],
      color: INK_DENSITIES[s.tone], opacity: .3 + .7 * s.load,
      bounds: [0, 0, 0, 0] };
    const full = fullSamples(s, spec.width, spec.height);
    const drawn = partialSamples(full, progress);
    return { id: s.id, progress, color: INK_DENSITIES[s.tone],
      opacity: .3 + .7 * s.load, ...geometry(s, spec.seed + 101 * i, drawn, full[full.length - 1].arc, full) };
  });
}
