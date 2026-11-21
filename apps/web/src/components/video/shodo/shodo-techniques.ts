/**
 * SHO1 筆法 — the basic techniques of a stroke, as data.
 *
 * Every stroke the hand writes is built from these: a start (始筆: 打ち込み, 蔵鋒, 露鋒),
 * travel (送筆) with turns (転折), and an end (終筆: 止め/垂露, 懸針, 撥ね, 払い), plus the
 * dot (点). This module names them, lists the brush moves of each step (the plan reports
 * the step it is executing), gives a canonical demonstration stroke, and measures a
 * rendered stroke to check that its technique left the shape it should.
 *
 * The checks are deterministic geometry on the ink raster, not image recognition.
 */
import type { ShodoEnd, ShodoStart, ShodoStrokeSpec } from "./shodo-glyphs";
import type { ShodoContact, ShodoPhase, ShodoTechnique } from "./shodo-hand";
import type { ShodoInkSurface } from "./shodo-ink";
import type { ShodoTechniqueParams } from "./shodo-style";

export type ShodoBasicId =
  | "uchikomi" | "zoho" | "roho" | "tensetsu" | "tome" | "kenshin" | "hane" | "hidari-harai" | "migi-harai" | "ten";

export interface ShodoBasic {
  id: ShodoBasicId;
  /** Japanese term and its reading. */
  term: string;
  reading: string;
  phase: ShodoPhase;
  /** One line on what the brush does. */
  summary: string;
  /** The style parameters that tune this technique. */
  params: readonly (keyof ShodoTechniqueParams)[];
  /** A canonical stroke that shows the technique, in a 1000-unit em box. */
  demo: ShodoStrokeSpec;
}

const H: ShodoStrokeSpec["points"] = [[150, 470], [500, 455], [850, 440]];

/** The ten basics, in teaching order: three starts, the turn, five ends, the dot. */
export const SHODO_BASICS: readonly ShodoBasic[] = [
  { id: "uchikomi", term: "打ち込み", reading: "uchikomi", phase: "kihitsu", summary: "45° press, hold, ease back",
    params: ["uchikomiDepth", "uchikomiReach", "uchikomiHold", "easeBack"],
    demo: { kind: "horizontal", start: "uchikomi", end: "tome", points: H } },
  { id: "zoho", term: "蔵鋒", reading: "zōhō", phase: "kihitsu", summary: "enter backwards, hide the tip",
    params: ["zohoReverse"], demo: { kind: "horizontal", start: "zoho", end: "tome", points: H } },
  { id: "roho", term: "露鋒", reading: "rohō", phase: "kihitsu", summary: "land moving, tip visible",
    params: ["rohoBuild"], demo: { kind: "horizontal", start: "roho", end: "tome", points: H } },
  { id: "tensetsu", term: "転折", reading: "tensetsu", phase: "tensetsu", summary: "stop, re-press, turn down",
    params: ["tensetsuShoulder", "tensetsuPress", "tensetsuHold"],
    demo: { kind: "turn", turns: [1], points: [[170, 230], [760, 200], [748, 830]] } },
  { id: "tome", term: "止め", reading: "tome", phase: "shuhitsu", summary: "垂露: small press, lift up",
    params: ["tomePress", "tomeReach", "tomeHold", "suiro"],
    demo: { kind: "vertical", end: "tome", points: [[500, 110], [502, 470], [500, 830]] } },
  { id: "kenshin", term: "懸針", reading: "kenshin", phase: "shuhitsu", summary: "lift while moving: a needle",
    params: ["kenshinLift"], demo: { kind: "vertical", end: "nuki", points: [[500, 110], [502, 470], [500, 860]] } },
  { id: "hane", term: "撥ね", reading: "hane", phase: "shuhitsu", summary: "pause, short 45° line, flick",
    params: ["haneHold", "haneLength", "haneSpeed"],
    demo: { kind: "vertical", end: "hane", hook: [-.86, -.5], points: [[560, 110], [562, 450], [560, 780]] } },
  { id: "hidari-harai", term: "左払い", reading: "hidari-harai", phase: "shuhitsu", summary: "even press, lift along the arc",
    params: ["haraiLift"], demo: { kind: "left-sweep", points: [[720, 130], [640, 400], [450, 650], [150, 840]] } },
  { id: "migi-harai", term: "右払い", reading: "migi-harai", phase: "shuhitsu", summary: "swell to the foot, pull out flat",
    params: ["footPress", "footHold", "pullOut", "footShare"],
    demo: { kind: "right-sweep", points: [[160, 140], [380, 420], [600, 660], [700, 740], [900, 790]] } },
  { id: "ten", term: "点", reading: "ten", phase: "kihitsu", summary: "touch, press along 45°, gather",
    params: ["tenPress", "tenHold"], demo: { kind: "dot", points: [[410, 360], [580, 560]], weight: 1.25 } },
];

/** What the brush does in each step a plan reports (`ShodoContact.step`). */
export const SHODO_TECHNIQUE_STEPS: Readonly<Record<ShodoTechnique, readonly string[]>> = {
  uchikomi: ["筆をつける — the tip lands upper-left and presses 45° toward the lower right", "溜め — hold the press", "ease back up into the stroke"],
  zoho: ["逆入 — push the tip back against the stroke", "fold the tip inside and hold", "flatten out into the stroke"],
  roho: ["land while moving; the press builds from the bare tip"],
  okuri: ["送筆 — even travel with the tip on the upper-left side"],
  orehi: ["lift slightly at the corner", "re-press 45° — the shoulder (肩)", "hold, then turn down"],
  magari: ["curve without stopping"],
  tome: ["lift slightly without leaving the paper", "turn 45° and press again (トン)", "hold", "gather the tip back and lift"],
  hane: ["溜め — pause and gather", "short 45° line", "flick off toward the hook"],
  harai: ["lift gradually while moving", "leave the paper moving", "pause and press at the foot", "turn the hair flat and pull out"],
  nuki: ["lift while moving", "leave as a needle point"],
  ten: ["touch the tip and press along 45°", "hold", "gather back and lift"],
  itohiki: ["hairline link between strokes (連綿)"],
};

/** Label of the step a contact sample is in. */
export function shodoStepLabel(contact: Pick<ShodoContact, "technique" | "step">): string {
  const steps = SHODO_TECHNIQUE_STEPS[contact.technique];
  return steps?.[Math.min(steps.length - 1, contact.step)] ?? contact.technique;
}

// ── Measured signatures ──────────────────────────────────────────────────────────────

export interface ShodoWidthProfile {
  /** Arc fraction (0..1) and measured ink width (design px) at each contact sample. */
  at: number[];
  width: number[];
  /** Median width of the middle of the stroke (35–65 % of its length). */
  middle: number;
}

/** Measure the inked width across the motion at every contact sample of one stroke. */
export function measureShodoStroke(surface: ShodoInkSurface, index: number): ShodoWidthProfile {
  const stroke = surface.plan.strokes[index];
  const cover = surface.strokeCoverage(index);
  const { scale } = surface.region;
  const total = stroke.samples[stroke.samples.length - 1].arc || 1;
  const inked = (x: number, y: number) => {
    const ix = Math.round((x - surface.region.x) * scale) - cover.x0, iy = Math.round((y - surface.region.y) * scale) - cover.y0;
    return ix >= 0 && iy >= 0 && ix < cover.w && iy < cover.h && cover.P[iy * cover.w + ix] > .9;
  };
  const at: number[] = [], width: number[] = [];
  const D = surface.plan.brush.diameter, reach = D * 2.5;
  const S = stroke.samples;
  let lo = 0, hi = 0;
  for (let i = 0; i < S.length; i++) {
    const s = S[i];
    // Measure across the stroke's own course (smoothed over about one brush width),
    // not across a momentary 45° press or a backward gather.
    // Near the ends the window reaches inward, so a 45° press at the head or the
    // stop is measured across the stroke's course, not across the press.
    const last = S[S.length - 1].arc;
    while (lo < i && S[lo].arc < Math.min(s.arc - D * .6, last - D * 1.6)) lo++;
    while (hi < S.length - 1 && S[hi].arc < Math.max(s.arc + D * .6, D * 1.6)) hi++;
    const dx = S[hi].x - S[lo].x, dy = S[hi].y - S[lo].y, dl = Math.hypot(dx, dy);
    if (dl < D * .3 || !inked(s.x, s.y)) continue;
    const nx = -dy / dl, ny = dx / dl;
    let a = 0, b = 0;
    while (a < reach && inked(s.x + nx * (a + .5), s.y + ny * (a + .5))) a += .5;
    while (b < reach && inked(s.x - nx * (b + .5), s.y - ny * (b + .5))) b += .5;
    at.push(s.arc / total);
    width.push(a + b);
  }
  return { at, width, middle: median(width.filter((_, i) => at[i] >= .35 && at[i] <= .65)) };
}

function median(values: number[]): number {
  const v = [...values].sort((x, y) => x - y);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
}

export interface ShodoSignatureCheck {
  technique: ShodoStart | ShodoEnd | "tensetsu" | "ten" | "foot";
  pass: boolean;
  /** Measured ratio against the stroke's middle width, and the bound it must meet. */
  measured: number;
  bound: string;
  message: string;
}

const maxIn = (p: ShodoWidthProfile, a: number, b: number) =>
  Math.max(0, ...p.width.filter((_, i) => p.at[i] >= a && p.at[i] <= b));
const minIn = (p: ShodoWidthProfile, a: number, b: number) => {
  const w = p.width.filter((_, i) => p.at[i] >= a && p.at[i] <= b);
  return w.length ? Math.min(...w) : 0;
};

/**
 * Check that a rendered stroke shows its techniques: a pressed head for 打ち込み, a bare
 * tip for 露鋒, a shoulder at 転折, a heavier stop for 止め, a needle for 懸針, a tapered
 * 払い, a foot and a pull-out for 右払い, a protruding hook for 撥ね.
 */
export function checkShodoStroke(surface: ShodoInkSurface, index: number): ShodoSignatureCheck[] {
  const stroke = surface.plan.strokes[index];
  if (stroke.kind === "link") return [];
  const p = measureShodoStroke(surface, index);
  const m = p.middle || 1;
  const out: ShodoSignatureCheck[] = [];
  const add = (technique: ShodoSignatureCheck["technique"], measured: number, ok: boolean, bound: string, message: string) =>
    out.push({ technique, pass: ok, measured: Math.round(measured * 100) / 100, bound, message });
  if (stroke.kind === "dot") {
    const s = stroke.samples, a = s[0], b = s.reduce((far, x) => Math.hypot(x.x - a.x, x.y - a.y) > Math.hypot(far.x - a.x, far.y - a.y) ? x : far, a);
    const ratio = (Math.hypot(b.x - a.x, b.y - a.y) + Math.max(...p.width) * .5) / Math.max(1, Math.max(...p.width));
    add("ten", ratio, ratio >= .9 && ratio <= 2.8, "0.9..2.8", "点 is an almond, longer than wide but not a dash");
    return out;
  }
  // A start is judged against its own first run: a short horizontal before a long sweep
  // must not be compared with the sweep.
  const total = stroke.samples[stroke.samples.length - 1].arc || 1;
  const firstTurn = stroke.samples.find(s => s.technique === "orehi");
  const run1 = firstTurn ? firstTurn.arc / total : 1;
  const ms = median(p.width.filter((_, i) => p.at[i] >= run1 * .3 && p.at[i] <= run1 * .65)) || m;
  const head = Math.min(.15, run1 * .3);
  if (stroke.start === "uchikomi") { const r = maxIn(p, 0, head) / ms; add("uchikomi", r, r >= 1.06, "≥ 1.06", "打ち込み leaves a pressed head wider than the travel"); }
  if (stroke.start === "zoho") { const r = maxIn(p, 0, head) / ms; add("zoho", r, r >= .95, "≥ 0.95", "蔵鋒 leaves a full, rounded head"); }
  if (stroke.start === "roho") { const r = minIn(p, 0, .04) / ms; add("roho", r, r <= .7, "≤ 0.70", "露鋒 starts from the bare tip"); }
  if (stroke.samples.some(s => s.technique === "orehi")) {
    const corner = stroke.samples.filter(s => s.technique === "orehi").map(s => s.arc / total);
    const c = corner[Math.floor(corner.length / 2)];
    const r = maxIn(p, c - .06, c + .08) / m;
    add("tensetsu", r, r >= 1.05, "≥ 1.05", "転折 leaves a shoulder at the corner");
  }
  // An end is judged against its own last run.
  const lastTurn = [...stroke.samples].reverse().find(s => s.technique === "orehi");
  const runN = lastTurn ? lastTurn.arc / total : 0;
  const me = median(p.width.filter((_, i) => p.at[i] >= runN + (1 - runN) * .3 && p.at[i] <= runN + (1 - runN) * .7)) || m;
  if (stroke.end === "tome") { const r = maxIn(p, .85, 1) / me; add("tome", r, r >= 1.02, "≥ 1.02", "止め ends heavier than the travel"); }
  if (stroke.end === "nuki") { const r = minIn(p, .96, 1) / me; add("nuki", r, r <= .35, "≤ 0.35", "懸針 ends in a needle point"); }
  if (stroke.end === "harai" && stroke.kind !== "right-sweep") { const r = minIn(p, .94, 1) / me; add("harai", r, r <= .45, "≤ 0.45", "払い tapers as the brush lifts"); }
  if (stroke.end === "harai" && stroke.kind === "right-sweep") {
    const foot = maxIn(p, .6, .95) / m;
    add("foot", foot, foot >= 1.1, "≥ 1.10", "右払い swells to a pressed foot");
    const tip = minIn(p, .97, 1) / m;
    add("harai", tip, tip <= .55, "≤ 0.55", "右払い pulls out to a flat point");
  }
  if (stroke.end === "hane") {
    // The hook must leave ink well outside the stroke it ends: sample the flick path.
    const flick = stroke.samples.filter(s => s.technique === "hane" && s.step === 2);
    const cover = surface.strokeCoverage(index), sc = surface.region.scale;
    const inkedAt = (x: number, y: number) => {
      const ix = Math.round((x - surface.region.x) * sc) - cover.x0, iy = Math.round((y - surface.region.y) * sc) - cover.y0;
      return ix >= 0 && iy >= 0 && ix < cover.w && iy < cover.h && cover.P[iy * cover.w + ix] > .9;
    };
    const along = flick.filter((_, i) => i >= flick.length * .2 && i <= flick.length * .75);
    const share = along.length ? along.filter(s => inkedAt(s.x, s.y)).length / along.length : 0;
    add("hane", share, share >= .8, "≥ 0.80", "撥ね leaves an inked hook along the flick");
  }
  return out;
}

/** Check every stroke of a plan; an empty `failures` list means every technique reads. */
export function auditShodoTechniques(surface: ShodoInkSurface): { checks: { stroke: number; check: ShodoSignatureCheck }[]; failures: { stroke: number; check: ShodoSignatureCheck }[] } {
  const checks = surface.plan.strokes.flatMap((_, i) => checkShodoStroke(surface, i).map(check => ({ stroke: i, check })));
  return { checks, failures: checks.filter(c => !c.check.pass) };
}

