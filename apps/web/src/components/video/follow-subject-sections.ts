/**
 * Follow subject through sections: the pure, frame-addressable part.
 *
 * Causal beat:
 *   input      one recognizable subject (media or a host rig) enters the first world
 *   transform  the camera tracks it through each world; every boundary is a motivated
 *              transition (match cut, whip pan, occluder wipe or camera carry) that keeps
 *              its screen position, direction of travel, scale and light continuous
 *   output     it decelerates onto the destination with contact and holds there.
 *
 * Everything here is a pure function of (spec, frame, aspect): no clock, no state carried
 * between frames, so any frame can be seeked or exported. Heading and bank are low-passed
 * over a symmetric window of frames, which keeps them calm without frame history.
 */
import type { ImageAsset, SceneTemplateSpec } from "./scene-templates";

/** A point in normalized stage space (0..1 inside the frame; a little outside for entrances). */
export type FollowSubjectPoint = { x: number; y: number; scale?: number };
/** How the world changes at a section boundary. The subject is never cut away from. */
export type FollowSubjectTransition = "match-cut" | "whip-pan" | "occluder-wipe" | "camera-carry";
/** Procedural near-lens forms that pass faster than the plate, giving true parallax. */
export type FollowSubjectForeground = "foliage" | "trunks" | "grass" | "rock" | "none";
export interface FollowSubjectSection {
  id: string;
  /** Environment plate. Intrinsic width/height let it pan without exposing an edge. */
  environment: ImageAsset;
  /** Optional transparent layers above the plate; depth 1 travels with the camera pan, 2 twice as fast. */
  layers?: { asset: ImageAsset; depth: number }[];
  /** Plate point kept in view under the cover crop (object-position), default centre. */
  focus?: { x: number; y: number };
  /** Short label above the statement, e.g. a stage number or place. */
  kicker?: string;
  /** The section's statement, set large. */
  title: string;
  /** One secondary line under the statement. */
  caption?: string;
  /** Absolute first frame of this section. Omit to follow the previous section. */
  start?: number;
  /** Section length in frames. Omit to share the remaining frames evenly. */
  duration?: number;
  /** How this section's world arrives. Ignored on the first section. Default "camera-carry". */
  transition?: FollowSubjectTransition;
  /** Transition length, centred on the boundary. Defaults: match-cut 0, whip 14, wipe 20, carry 34. */
  transitionFrames?: number;
  /** Subject path through this section in normalized stage space. Omitted paths are generated so
   * consecutive sections join; the first enters from off-screen, the last lands on its final point. */
  path?: FollowSubjectPoint[];
  /** Optional path for portrait (height > width) output. */
  portraitPath?: FollowSubjectPoint[];
  foreground?: FollowSubjectForeground;
  /** Light on the subject in this world; blends across each transition. */
  light?: { color?: string; exposure?: number };
  /** Drifting depth particles. */
  atmosphere?: "motes" | "mist" | "none";
  /** Normalized stage y of the ground under the subject; enables its shadow. */
  ground?: number;
  /** Camera override for this world, e.g. a calmer pan and a firmer push on the destination. */
  camera?: { pan?: number; push?: number };
}
export interface FollowSubjectContent {
  subject: {
    /** Fallback and provenance for the subject; a host rig can replace its drawing. Needs intrinsic size. */
    media: ImageAsset;
    /** Subject box height as a fraction of the stage's shorter side. Default 0.12. */
    size?: number;
    /** Point of the media that rides the path (and pivots), normalized. Default centre. */
    anchor?: { x: number; y: number };
    /** "path" pitches along the direction of travel (craft, birds); "upright" never rotates (walkers). */
    orient?: "path" | "upright";
    /** Pitch cap in degrees, default 24. */
    maxTilt?: number;
    /** Normalized media y that touches the ground on arrival (a keel, wheels, feet). Default 1. */
    contact?: number;
  };
  /** Two to eight sections, in travel order. */
  sections: FollowSubjectSection[];
  /** Screen direction of travel, kept across every cut. Default "ltr". */
  direction?: "ltr" | "rtl";
  /** Arrival: the subject settles at its last path point by this fraction of the last section (default 0.72). */
  arrival?: { settle?: number; contact?: boolean };
  camera?: {
    /** Plate travel per section as a fraction of stage width, 0..0.5. Default 0.14. */
    pan?: number;
    /** Slow push-in per section, 0..0.4. Default 0.06. */
    push?: number;
    /** Foreground speed relative to the plate, 1..4. Default 2.6. */
    parallax?: number;
    /** How far the camera tilts with the subject's height, 0..1. Default 0.25. */
    follow?: number;
  };
  /** Copy block placement. "auto": lower third in landscape, upper band in portrait. */
  captionPlacement?: "auto" | "lower" | "upper";
  /** Segmented journey rail above the copy. Default true. */
  progress?: boolean;
  typography?: { display?: string; body?: string; titleScale?: number; titleWeight?: number };
  palette?: { ink?: string; scrim?: string; rail?: string };
  look?: { grain?: number; vignette?: number; letterbox?: boolean };
}

export interface FollowSubjectTimelineSection { index: number; id: string; start: number; end: number;
  transition: FollowSubjectTransition; transitionFrames: number }
export interface FollowSubjectState {
  frame: number; sectionIndex: number; sectionId: string;
  /** 0..1 through the active section, and through the whole journey. */
  sectionProgress: number; journeyProgress: number;
  /** Subject anchor in stage pixels, and its scale multiplier. */
  x: number; y: number; scale: number;
  /** Pitch along travel in degrees (screen space, positive = nose down in ltr) and bank -1..1. */
  heading: number; bank: number;
  /** Stage-heights per second, smoothed. */
  speed: number;
  /** 0 in flight, 1 once settled at the destination. */
  arrived: number;
  /** Active boundary transition, when inside its window. */
  transition?: { kind: FollowSubjectTransition; progress: number; from: number; to: number; into: number };
  light: { color: string; exposure: number };
}

const DEFAULT_FRAMES: Record<FollowSubjectTransition, number> = { "match-cut": 0, "whip-pan": 14, "occluder-wipe": 20, "camera-carry": 34 };
const TRANSITIONS = Object.keys(DEFAULT_FRAMES) as FollowSubjectTransition[];
const MIN_SECTION = 24;
const fail = (message: string): never => { throw new Error("Scene recipe: " + message); };
const text = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const inRange = (v: unknown, lo: number, hi: number) => finite(v) && v >= lo && v <= hi;
const hex = (v: unknown) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const smooth = (t: number) => { const u = Math.max(0, Math.min(1, t)); return u * u * u * (u * (u * 6 - 15) + 10); };

/** Resolves start/end frames and the transition into each section. */
export function followSubjectTimeline(content: FollowSubjectContent, durationFrames: number): FollowSubjectTimelineSection[] {
  const s = content.sections, n = s.length;
  // Knots: knots[i] is section i's start, knots[n] the end of the last section.
  const knots: (number | undefined)[] = [...s.map(x => x.start), durationFrames];
  knots[0] ??= 0;
  const forward = () => { for (let i = 1; i < n; i++) if (knots[i] === undefined && knots[i - 1] !== undefined && s[i - 1].duration !== undefined) knots[i] = knots[i - 1]! + s[i - 1].duration!; };
  forward();
  if (knots[n - 1] === undefined && s[n - 1].duration !== undefined) knots[n - 1] = durationFrames - s[n - 1].duration!;
  for (let i = n - 2; i > 0; i--) if (knots[i] === undefined && knots[i + 1] !== undefined && s[i].duration !== undefined) knots[i] = knots[i + 1]! - s[i].duration!;
  // Sections with neither start nor duration share the frames between their known neighbours.
  for (let i = 1; i < n; i++) if (knots[i] === undefined) {
    let j = i; while (knots[j] === undefined) j++;
    for (let k = i; k < j; k++) knots[k] = Math.round(knots[i - 1]! + (knots[j]! - knots[i - 1]!) * (k - i + 1) / (j - i + 1));
  }
  const starts = knots as number[];
  return s.map((section, i) => {
    const end = i + 1 < n ? starts[i + 1] : Math.min(durationFrames, section.duration !== undefined ? starts[i] + section.duration : durationFrames);
    const transition = i === 0 ? "match-cut" : section.transition ?? "camera-carry";
    return { index: i, id: section.id, start: starts[i], end, transition,
      transitionFrames: i === 0 ? 0 : section.transitionFrames ?? DEFAULT_FRAMES[transition] };
  });
}

function checkPath(path: FollowSubjectPoint[] | undefined, label: string) {
  if (path === undefined) return;
  if (!Array.isArray(path) || path.length < 2) fail(label + " needs two or more points.");
  for (const p of path) if (!p || !inRange(p.x, -.4, 1.4) || !inRange(p.y, -.4, 1.4) || (p.scale !== undefined && !inRange(p.scale, .25, 4)))
    fail(label + " points need x/y within -0.4..1.4 and scale 0.25..4.");
}
function checkAsset(a: ImageAsset | undefined, label: string) {
  if (!a || !text(a.id) || !text(a.src) || !text(a.alt)) fail(label + " needs id, src, and alt.");
}
/** Validation for the recipe payload; called from validateSceneTemplate. */
export function checkFollowSubjectContent(c: FollowSubjectContent, durationFrames: number): void {
  if (!c || !c.subject) fail("follow subject needs a subject.");
  checkAsset(c.subject.media, "subject media");
  if (!(c.subject.media.width! > 0 && c.subject.media.height! > 0)) fail("subject media needs intrinsic width and height.");
  const sub = c.subject;
  if (sub.size !== undefined && !inRange(sub.size, .03, .6)) fail("subject size must be 0.03..0.6 of the shorter side.");
  if (sub.anchor && !(inRange(sub.anchor.x, 0, 1) && inRange(sub.anchor.y, 0, 1))) fail("subject anchor must be normalized.");
  if (sub.orient !== undefined && !["path", "upright"].includes(sub.orient)) fail("unknown subject orient.");
  if (sub.maxTilt !== undefined && !inRange(sub.maxTilt, 0, 60)) fail("maxTilt must be 0..60 degrees.");
  if (sub.contact !== undefined && !inRange(sub.contact, 0, 1)) fail("subject contact must be a normalized media y.");
  if (!Array.isArray(c.sections) || c.sections.length < 2 || c.sections.length > 8) fail("follow subject needs two to eight sections.");
  const ids = new Set<string>();
  c.sections.forEach((s, i) => {
    if (!s || !text(s.id) || ids.has(s.id)) fail("sections need unique stable IDs.");
    ids.add(s.id);
    checkAsset(s.environment, "section environment " + s.id);
    if (!text(s.title)) fail("every section needs a title.");
    if ((s.kicker !== undefined && !text(s.kicker)) || (s.caption !== undefined && !text(s.caption))) fail("kicker and caption must not be empty when given.");
    if (s.start !== undefined && !(Number.isSafeInteger(s.start) && s.start >= 0)) fail("section start must be a frame.");
    if (i === 0 && s.start !== undefined && s.start !== 0) fail("the first section starts at frame 0.");
    if (s.duration !== undefined && !(Number.isSafeInteger(s.duration) && s.duration >= MIN_SECTION)) fail(`section duration must be ${MIN_SECTION} frames or more.`);
    if (s.transition !== undefined && !TRANSITIONS.includes(s.transition)) fail("unknown section transition.");
    if (s.transitionFrames !== undefined && !(Number.isSafeInteger(s.transitionFrames) && s.transitionFrames >= 0 && s.transitionFrames <= 60)) fail("transitionFrames must be 0..60.");
    checkPath(s.path, "section path"); checkPath(s.portraitPath, "section portraitPath");
    if (s.foreground !== undefined && !["foliage", "trunks", "grass", "rock", "none"].includes(s.foreground)) fail("unknown section foreground.");
    if (s.atmosphere !== undefined && !["motes", "mist", "none"].includes(s.atmosphere)) fail("unknown section atmosphere.");
    if (s.light && ((s.light.color !== undefined && !hex(s.light.color)) || (s.light.exposure !== undefined && !inRange(s.light.exposure, .4, 1.6)))) fail("section light needs a #rrggbb colour and exposure 0.4..1.6.");
    if (s.focus && !(inRange(s.focus.x, 0, 1) && inRange(s.focus.y, 0, 1))) fail("section focus must be normalized.");
    if (s.ground !== undefined && !inRange(s.ground, 0, 1.2)) fail("section ground must be a normalized stage y.");
    if (s.camera && ((s.camera.pan !== undefined && !inRange(s.camera.pan, 0, .5)) || (s.camera.push !== undefined && !inRange(s.camera.push, 0, .4)))) fail("section camera needs pan 0..0.5 and push 0..0.4.");
    (s.layers ?? []).forEach(l => { checkAsset(l?.asset, "section layer"); if (!inRange(l.depth, -3, 3)) fail("layer depth must be -3..3."); });
  });
  const timeline = followSubjectTimeline(c, durationFrames);
  timeline.forEach((t, i) => {
    if (!(t.end - t.start >= MIN_SECTION)) fail(`sections must be ${MIN_SECTION} frames or longer and in frame order.`);
    if (t.end > durationFrames) fail("sections must end within the composition.");
    const prev = timeline[i - 1];
    if (prev && t.transitionFrames / 2 > Math.min(prev.end - prev.start, t.end - t.start) / 2) fail("a transition must fit inside both of its sections.");
  });
  const cam = c.camera;
  if (cam && ((cam.pan !== undefined && !inRange(cam.pan, 0, .5)) || (cam.push !== undefined && !inRange(cam.push, 0, .4)) ||
    (cam.parallax !== undefined && !inRange(cam.parallax, 1, 4)) || (cam.follow !== undefined && !inRange(cam.follow, 0, 1)))) fail("camera needs pan 0..0.5, push 0..0.4, parallax 1..4 and follow 0..1.");
  if (c.direction !== undefined && !["ltr", "rtl"].includes(c.direction)) fail("direction must be ltr or rtl.");
  if (c.captionPlacement !== undefined && !["auto", "lower", "upper"].includes(c.captionPlacement)) fail("unknown captionPlacement.");
  if (c.arrival?.settle !== undefined && !inRange(c.arrival.settle, .3, 1)) fail("arrival settle must be 0.3..1.");
  const ty = c.typography;
  if (ty && ((ty.titleScale !== undefined && !inRange(ty.titleScale, .7, 1.4)) || (ty.titleWeight !== undefined && !inRange(ty.titleWeight, 300, 900)))) fail("typography needs titleScale 0.7..1.4 and titleWeight 300..900.");
  const pal = c.palette;
  if (pal && [pal.ink, pal.scrim, pal.rail].some(v => v !== undefined && !hex(v))) fail("palette colours must be #rrggbb.");
  if (c.look && [c.look.grain, c.look.vignette].some(v => v !== undefined && !inRange(v, 0, 1))) fail("look grain and vignette must be 0..1.");
}

/** Generated paths: a tracking-shot hold that drifts, joined end to start; the first enters, the last lands. */
function defaultPath(i: number, n: number, portrait: boolean): FollowSubjectPoint[] {
  const hold = portrait ? { x: .46, y: .52 } : { x: .42, y: .34 };
  const drift = portrait ? { x: .53, y: .5 - .03 * (i % 2) } : { x: .49, y: .32 + .04 * (i % 2) };
  // The entrance starts with the nose already in frame, so motion reads from the first frame.
  if (i === 0) return [{ x: -.02, y: hold.y + .1 }, { x: hold.x - .14, y: hold.y - .02 }, hold];
  if (i === n - 1) return portrait ? [hold, { x: .56, y: .6 }, { x: .6, y: .78 }] : [hold, { x: .58, y: .52 }, { x: .7, y: .74 }];
  return [hold, drift, hold];
}
const mirror = (p: FollowSubjectPoint, rtl: boolean) => rtl ? { ...p, x: 1 - p.x } : p;
export function followSubjectPath(c: FollowSubjectContent, index: number, portrait: boolean): FollowSubjectPoint[] {
  const s = c.sections[index];
  const authored = portrait ? s.portraitPath ?? s.path : s.path;
  return (authored ?? defaultPath(index, c.sections.length, portrait)).map(p => mirror(p, c.direction === "rtl"));
}

/** Catmull-Rom through the points, re-parameterized by arc length so speed is even. */
function sampler(points: FollowSubjectPoint[], aspect: number) {
  const pts = points.map(p => ({ x: p.x, y: p.y, s: p.scale ?? 1 }));
  const at = (k: number) => pts[Math.max(0, Math.min(pts.length - 1, k))];
  const raw = (u: number) => {
    const f = Math.max(0, Math.min(1, u)) * (pts.length - 1), k = Math.min(pts.length - 2, Math.floor(f)), t = f - k;
    const [a, b, c, d] = [at(k - 1), at(k), at(k + 1), at(k + 2)];
    const cr = (p0: number, p1: number, p2: number, p3: number) => .5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    return { x: cr(a.x, b.x, c.x, d.x), y: cr(a.y, b.y, c.y, d.y), s: b.s + (c.s - b.s) * t };
  };
  const N = 48, lengths = [0];
  for (let i = 1; i <= N; i++) { const p = raw((i - 1) / N), q = raw(i / N); lengths.push(lengths[i - 1] + Math.hypot((q.x - p.x) * aspect, q.y - p.y)); }
  const total = lengths[N] || 1;
  return (u: number) => {
    const target = Math.max(0, Math.min(1, u)) * total;
    let i = 1; while (i < N && lengths[i] < target) i++;
    const seg = lengths[i] - lengths[i - 1] || 1;
    return raw((i - 1 + (target - lengths[i - 1]) / seg) / N);
  };
}

/** Where the subject is (normalized) at a frame, before smoothing of heading. */
function positionAt(c: FollowSubjectContent, timeline: FollowSubjectTimelineSection[], samplers: ReturnType<typeof sampler>[], frame: number, reduced: boolean) {
  const n = timeline.length;
  const local = (i: number, f: number) => {
    const t = timeline[i], l = (f - t.start) / Math.max(1, t.end - t.start);
    if (reduced) return i === n - 1 ? 1 : .5;
    if (i === 0) { const v = Math.max(0, Math.min(1, l)); return (v + .55 * (1 - Math.pow(1 - v, 3))) / 1.55; } // enters fast, settles to cruise
    if (i === n - 1) { const v = Math.max(0, Math.min(1, l / (c.arrival?.settle ?? .72))); return 1.5 * (v - v * v * v / 3); } // decelerates to rest
    return l;
  };
  let i = 0; while (i < n - 1 && frame >= timeline[i + 1].start) i++;
  let p = samplers[i](local(i, frame));
  // Paths that do not meet are blended across the transition window (never a jump).
  const next = timeline[i + 1], here = timeline[i];
  const blend = (a: typeof p, b: typeof p, w: number) => ({ x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w, s: a.s + (b.s - a.s) * w });
  if (!reduced && next && next.transitionFrames > 0 && frame > next.start - next.transitionFrames / 2) {
    const w = smooth((frame - (next.start - next.transitionFrames / 2)) / next.transitionFrames);
    p = blend(p, samplers[i + 1](0), w * .5);
  }
  if (!reduced && i > 0 && here.transitionFrames > 0 && frame < here.start + here.transitionFrames / 2) {
    const w = smooth((frame - (here.start - here.transitionFrames / 2)) / here.transitionFrames);
    p = blend(samplers[i - 1](1), p, .5 + w * .5);
  }
  return { ...p, index: i };
}

/** Full subject state at one frame for one output size. Pure; used by the stage, rigs and preflight. */
export function followSubjectAt(spec: SceneTemplateSpec<"follow-subject-through-sections">, frame: number, reduced = spec.reducedMotion ?? false): FollowSubjectState {
  const c = spec.content, w = spec.width, h = spec.height, portrait = h > w;
  const timeline = followSubjectTimeline(c, spec.durationFrames), n = timeline.length;
  const f = Math.max(0, Math.min(spec.durationFrames - 1, Math.round(frame)));
  const samplers = c.sections.map((_, i) => sampler(followSubjectPath(c, i, portrait), w / h));
  const pos = (t: number) => positionAt(c, timeline, samplers, Math.max(0, Math.min(spec.durationFrames - 1, t)), reduced);
  const p = pos(f), i = p.index, sec = timeline[i];
  const fps = spec.fps.num / spec.fps.den;
  // Velocity over a symmetric window: a low-pass that needs no frame history.
  const K = 5, a = pos(f - K), b = pos(f + K);
  const vx = (b.x - a.x) * w / (2 * K), vy = (b.y - a.y) * h / (2 * K);
  const speed = Math.hypot(vx, vy) * fps / h;
  const tilt = c.subject.maxTilt ?? 24, dir = c.direction === "rtl" ? -1 : 1;
  const headingOf = (t: number) => {
    const q0 = pos(t - K), q1 = pos(t + K), dx = (q1.x - q0.x) * w * dir, dy = (q1.y - q0.y) * h;
    const moving = smooth(Math.hypot(dx, dy) / (h * .02)); // levels out gently as it comes to rest
    return Math.max(-tilt, Math.min(tilt, Math.atan2(dy, Math.max(Math.abs(dx), 1e-6)) * 180 / Math.PI)) * moving;
  };
  const upright = c.subject.orient === "upright" || reduced;
  // A wide symmetric kernel smooths the turn; a short replay then caps it at 2.5° a frame.
  // Both depend only on f (the replay always starts 36 frames back), so seeking stays exact.
  const target = (g: number) => [[-12, 1], [-6, 2], [0, 3], [6, 2], [12, 1]].reduce((sum, [o, k]) => sum + k * headingOf(g + o), 0) / 9;
  const heading = upright ? 0 : (() => { let hd = target(f - 36); for (let g = f - 35; g <= f; g++) hd += Math.max(-2.5, Math.min(2.5, target(g) - hd)); return hd; })();
  const bank = upright ? 0 : Math.max(-1, Math.min(1, (headingOf(f + 6) - headingOf(f - 6)) / 14));
  const lastStart = timeline[n - 1].start, settleAt = lastStart + (timeline[n - 1].end - lastStart) * (c.arrival?.settle ?? .72);
  const arrived = reduced ? (i === n - 1 ? 1 : 0) : smooth((f - (settleAt - 10)) / 10);
  // Light continuity: the incoming world's light arrives across the transition, not on the cut.
  const lightOf = (k: number) => ({ color: c.sections[k].light?.color ?? "#ffffff", exposure: c.sections[k].light?.exposure ?? 1 });
  let light = lightOf(i), transition: FollowSubjectState["transition"];
  const window = (t: FollowSubjectTimelineSection) => ({ from: t.start - Math.ceil(t.transitionFrames / 2), to: t.start + Math.ceil(t.transitionFrames / 2) });
  for (const t of timeline.slice(1)) {
    const { from, to } = window(t);
    if (!reduced && t.transitionFrames > 0 && f >= from && f < to) {
      const progress = (f - from) / Math.max(1, to - from);
      transition = { kind: t.transition, progress, from, to, into: t.index };
      const A = lightOf(t.index - 1), B = lightOf(t.index), m = smooth(progress);
      light = { color: mixHex(A.color, B.color, m), exposure: A.exposure + (B.exposure - A.exposure) * m };
    } else if (t.transition === "match-cut" && f === t.start) transition = { kind: "match-cut", progress: 1, from: t.start, to: t.start, into: t.index };
  }
  return { frame: f, sectionIndex: i, sectionId: sec.id,
    sectionProgress: Math.max(0, Math.min(1, (f - sec.start) / Math.max(1, sec.end - sec.start - 1))),
    journeyProgress: f / Math.max(1, spec.durationFrames - 1),
    x: p.x * w, y: p.y * h, scale: p.s, heading, bank, speed, arrived, transition, light };
}
export function mixHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map(k => parseInt(a.slice(k, k + 2), 16)), pb = [1, 3, 5].map(k => parseInt(b.slice(k, k + 2), 16));
  return "#" + pa.map((v, k) => Math.round(v + (pb[k] - v) * t).toString(16).padStart(2, "0")).join("");
}

/** Normalized copy-safe region for an output size; the subject must stay out of it. */
export function followSubjectCopyRegion(c: FollowSubjectContent, width: number, height: number) {
  const portrait = height > width;
  const placement = c.captionPlacement === undefined || c.captionPlacement === "auto" ? (portrait ? "upper" : "lower") : c.captionPlacement;
  return placement === "upper"
    ? { placement, x: .06, y: portrait ? .05 : .07, width: portrait ? .88 : .58, height: portrait ? .3 : .34 }
    : { placement, x: .055, y: portrait ? .64 : .58, width: portrait ? .89 : .56, height: portrait ? .3 : .36 };
}
export interface FollowSubjectFramingIssue { frame: number; code: "copy-overlap" | "off-stage" | "continuity"; message: string }
/** CPU-only preflight for one output size: the subject box must stay clear of the copy region and on
 * stage after its entrance, and a match cut must keep its screen position. Samples every other frame. */
export function followSubjectFraming(spec: SceneTemplateSpec<"follow-subject-through-sections">): FollowSubjectFramingIssue[] {
  const c = spec.content, w = spec.width, h = spec.height, issues: FollowSubjectFramingIssue[] = [];
  const region = followSubjectCopyRegion(c, w, h), timeline = followSubjectTimeline(c, spec.durationFrames);
  const boxH = Math.min(w, h) * (c.subject.size ?? .12), aspect = c.subject.media.width! / c.subject.media.height!;
  const anchor = c.subject.anchor ?? { x: .5, y: .5 };
  const entered = timeline[0].start + Math.round((timeline[0].end - timeline[0].start) * .5);
  for (let f = 0; f < spec.durationFrames; f += 2) {
    const s = followSubjectAt(spec, f, false), bh = boxH * s.scale, bw = bh * aspect;
    const box = { l: s.x - bw * anchor.x, t: s.y - bh * anchor.y, r: s.x + bw * (1 - anchor.x), b: s.y + bh * (1 - anchor.y) };
    const R = { l: region.x * w, t: region.y * h, r: (region.x + region.width) * w, b: (region.y + region.height) * h };
    if (box.l < R.r && box.r > R.l && box.t < R.b && box.b > R.t) issues.push({ frame: f, code: "copy-overlap", message: `subject enters the ${region.placement} copy region` });
    if (f >= entered && (box.l < 0 || box.r > w || box.t < 0 || box.b > h)) issues.push({ frame: f, code: "off-stage", message: "subject leaves the frame after its entrance" });
  }
  for (const t of timeline.slice(1)) if (t.transition === "match-cut") {
    const a = followSubjectAt(spec, t.start - 1, false), b = followSubjectAt(spec, t.start, false);
    if (Math.hypot(a.x - b.x, a.y - b.y) > Math.min(w, h) * .03) issues.push({ frame: t.start, code: "continuity", message: `match cut into "${t.id}" moves the subject` });
  }
  return issues;
}
