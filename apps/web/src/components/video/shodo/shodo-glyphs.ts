/**
 * SHO1 glyphs: a character is an ordered list of strokes. A stroke is a centreline in a
 * 1000×1000 em box (y down) plus the technique the hand uses to start, turn and end it.
 *
 * The geometry says WHERE the mark lies; `start`, `turns` and `end` say HOW the brush
 * makes it. The hand model in `shodo-hand.ts` turns both into brush motion.
 *
 * Bundled glyphs are original centrelines authored for this library (see the SHO1
 * reference study). KanjiVG data is never bundled: `parseKanjiVgSvg` reads a file the
 * host supplies, and that output carries KanjiVG's CC BY-SA 3.0 terms.
 */
import { SHODO_TECHNIQUE_RANGES } from "./shodo-style";
import type { ShodoTechniqueParams } from "./shodo-style";
import { shodoStructure } from "./shodo-structure";
import type { ShodoStructureRules } from "./shodo-structure";

/** 点画 families. They choose the default start and end technique. */
export type ShodoStrokeKind =
  | "dot"          // 点 ten
  | "horizontal"   // 横画 yokoga
  | "vertical"     // 縦画 tatega
  | "left-sweep"   // 左払い hidaribarai
  | "right-sweep"  // 右払い migibarai
  | "rise"         // 提 / 右上はらい: a short up-right stroke
  | "turn"         // 転折 tensetsu: one or more corners
  | "curve";       // 曲がり magari / 反り sori

/** 始筆 / 起筆 — how the brush is put to the paper (筆をつける). */
export type ShodoStart =
  | "uchikomi"   // 打ち込み: 45° press toward the lower right, hold, ease back (方筆)
  | "zoho"       // 蔵鋒 (逆入): enter against the direction, turn, hide the tip (円筆)
  | "roho";      // 露鋒: land while moving, tip left visible

/** 終筆 / 収筆 — how the stroke stops or leaves the paper. */
export type ShodoEnd =
  | "tome"       // 止め (and 垂露 on a vertical): lift a little, re-press, gather the tip, lift
  | "hane"       // 撥ね: pause, short 45° line, flick toward `hook`
  | "harai"      // 払い: lift while moving (right sweeps make a pressed foot first)
  | "nuki";      // 懸針 / 抜き: lift while moving to a needle point, no foot

export type ShodoPoint = readonly [number, number];

export interface ShodoStrokeSpec {
  kind: ShodoStrokeKind;
  /** Ordered centreline of the visible mark, em units (0..1000, y down). 2..24 points. */
  points: readonly ShodoPoint[];
  /** Indices of 転折 corners in `points` (stop, re-press, change direction). */
  turns?: readonly number[];
  start?: ShodoStart;
  end?: ShodoEnd;
  /** Direction of a 撥ね flick, as a vector; default is up-left. */
  hook?: ShodoPoint;
  /** Thickness multiplier for this stroke, 0.4..1.8. */
  weight?: number;
  /**
   * Press along the stroke: one multiplier per point of `points`, 0.4..1.8, applied where the
   * brush passes nearest that part of the centreline. A teacher's form uses it for that
   * teacher's swelling and thinning inside one stroke (the thick turn of a かな loop).
   */
  press?: readonly number[];
  /**
   * Speed of this stroke relative to the hand, 0.25..4 (default 1). A teacher's form uses it
   * to give each stroke that teacher's share of the writing time.
   */
  pace?: number;
  /**
   * This stroke's own technique settings over the style's, within the same ranges. A teacher's
   * form uses it for that teacher's heads, stops and lifts stroke by stroke.
   */
  technique?: Partial<ShodoTechniqueParams>;
  /**
   * The stroke starts or ends on another stroke (接筆), as the inner lines of 口 and 目 do.
   * The hand then writes a small head or a quiet stop that disappears into the other line
   * instead of a full 打ち込み or 止め knob. Set by `shodoJoinStrokes`.
   */
  joinStart?: boolean;
  joinEnd?: boolean;
}

/**
 * Where a component sits in its character (KanjiVG's labels): 偏 left, 旁 right, 冠 top,
 * 脚 bottom, 構 enclosure (kamae) and its content (kamaec), 垂 hanging roof (tare) and
 * its content (tarec), 繞 wrap from the bottom-left (nyo, as 辶) and its content (nyoc).
 */
export type ShodoPartPosition = "left" | "right" | "top" | "bottom" | "kamae" | "kamaec" | "tare" | "tarec" | "nyo" | "nyoc";

/** One component of a character, with the strokes it owns (writing order) and its own parts. */
export interface ShodoPart {
  element?: string;
  position?: ShodoPartPosition;
  strokes: readonly number[];
  children: readonly ShodoPart[];
}

export interface ShodoGlyph {
  char: string;
  strokes: readonly ShodoStrokeSpec[];
  /**
   * Data provenance; `kanjivg` output must be credited to KanjiVG (CC BY-SA 3.0). `teacher`
   * is a form fitted to one teacher's model (KanjiVG stroke order, the teacher's shapes).
   */
  source: "original" | "kanjivg" | "teacher";
  /** Component tree (from KanjiVG groups), used by the structure rules (結構法). */
  parts?: ShodoPart;
}

export const SHODO_DEFAULT_START: Record<ShodoStrokeKind, ShodoStart> = {
  dot: "uchikomi", horizontal: "uchikomi", vertical: "uchikomi", "left-sweep": "uchikomi",
  "right-sweep": "roho", rise: "uchikomi", turn: "uchikomi", curve: "uchikomi",
};
export const SHODO_DEFAULT_END: Record<ShodoStrokeKind, ShodoEnd> = {
  dot: "tome", horizontal: "tome", vertical: "tome", "left-sweep": "harai",
  "right-sweep": "harai", rise: "harai", turn: "tome", curve: "tome",
};

export const resolveStart = (s: ShodoStrokeSpec): ShodoStart => s.start ?? SHODO_DEFAULT_START[s.kind];
export const resolveEnd = (s: ShodoStrokeSpec): ShodoEnd => s.end ?? SHODO_DEFAULT_END[s.kind];

/**
 * Original kaisho centrelines. Proportions follow the studied teaching models by eye;
 * nothing was traced. Coordinates leave a margin so wide strokes stay inside the em box.
 */
export const SHODO_GLYPHS: Readonly<Record<string, ShodoGlyph>> = {
  "一": {
    char: "一", source: "original", strokes: [
      { kind: "horizontal", points: [[150, 512], [500, 492], [850, 478]], weight: 1.12 },
    ],
  },
  "二": {
    char: "二", source: "original", strokes: [
      { kind: "horizontal", points: [[285, 335], [520, 322], [715, 314]], weight: .95 },
      { kind: "horizontal", points: [[150, 682], [500, 664], [855, 652]], weight: 1.1 },
    ],
  },
  "三": {
    char: "三", source: "original", strokes: [
      { kind: "horizontal", points: [[250, 225], [500, 212], [730, 204]], weight: .92 },
      { kind: "horizontal", points: [[300, 470], [500, 461], [690, 455]], weight: .85 },
      { kind: "horizontal", points: [[150, 760], [500, 742], [858, 730]], weight: 1.12 },
    ],
  },
  "永": {
    char: "永", source: "original", strokes: [
      // 1 側 — the dot
      { kind: "dot", points: [[474, 58], [528, 150]], weight: 1.12 },
      // 2 勒 + 努 + 趯 — short horizontal, 転折, the pillar, 撥ね
      { kind: "turn", points: [[318, 300], [540, 268], [532, 520], [528, 850]], turns: [1], end: "hane",
        hook: [-.86, -.5], weight: 1.05 },
      // 3 策 + 掠 — horizontal, 転折, long left sweep
      { kind: "turn", points: [[205, 498], [420, 462], [352, 600], [250, 720], [118, 812]], turns: [1],
        end: "harai", weight: .98 },
      // 4 啄 — short left sweep from the upper right
      { kind: "left-sweep", points: [[790, 372], [700, 452], [592, 520]], weight: .95 },
      // 5 磔 — right sweep with its foot
      { kind: "right-sweep", points: [[585, 540], [680, 650], [780, 762], [935, 830]], weight: 1.08 },
    ],
  },
  "道": {
    char: "道", source: "original", strokes: [
      // 首
      { kind: "dot", points: [[440, 75], [492, 148]], weight: .95 },
      { kind: "left-sweep", points: [[690, 55], [648, 110], [592, 165]], weight: 1 },
      { kind: "horizontal", points: [[338, 228], [580, 212], [800, 198]], weight: 1 },
      { kind: "left-sweep", points: [[565, 238], [530, 280], [492, 312]], weight: .85 },
      { kind: "vertical", points: [[448, 322], [450, 520], [452, 720]], weight: 1 },
      { kind: "turn", points: [[452, 318], [728, 300], [720, 520], [714, 720]], turns: [1], weight: 1 },
      { kind: "horizontal", points: [[472, 435], [588, 431], [700, 427]], weight: .8 },
      { kind: "horizontal", points: [[472, 550], [588, 546], [700, 542]], weight: .8 },
      { kind: "horizontal", points: [[464, 712], [590, 708], [706, 704]], weight: .85 },
      // 辶: a short heavy dot, the zigzag, then the long sweep with its flat chisel end
      { kind: "dot", points: [[195, 222], [258, 300]], weight: 1.05 },
      { kind: "turn", points: [[45, 470], [150, 452], [252, 430], [165, 548], [290, 665], [205, 790]], turns: [2, 3],
        end: "tome", weight: .95 },
      { kind: "right-sweep", points: [[85, 815], [200, 850], [440, 880], [660, 898], [830, 912], [990, 884]],
        start: "uchikomi", weight: 1.02 },
    ],
  },
  "山": {
    char: "山", source: "original", strokes: [
      { kind: "vertical", points: [[500, 120], [502, 450], [500, 770]], weight: 1.05 },
      { kind: "turn", points: [[195, 365], [198, 780], [810, 772]], turns: [1], weight: 1 },
      { kind: "vertical", points: [[808, 330], [808, 560], [806, 800]], weight: 1 },
    ],
  },
  "心": {
    char: "心", source: "original", strokes: [
      { kind: "dot", points: [[150, 520], [212, 640]], weight: 1.05 },
      { kind: "curve", points: [[320, 300], [340, 620], [430, 805], [640, 820], [740, 760]], end: "hane",
        hook: [.15, -1], weight: 1.05 },
      { kind: "dot", points: [[468, 185], [548, 300]], weight: 1.05 },
      { kind: "dot", points: [[732, 368], [842, 520]], weight: 1.12 },
    ],
  },
};

export interface ShodoGlyphIssue { path: string; message: string }

export function inspectShodoGlyph(glyph: ShodoGlyph): ShodoGlyphIssue[] {
  const issues: ShodoGlyphIssue[] = [];
  if (!glyph || typeof glyph.char !== "string" || [...glyph.char].length !== 1)
    issues.push({ path: "/char", message: "A glyph needs exactly one character." });
  if (!glyph || !glyph.strokes || glyph.strokes.length < 1 || glyph.strokes.length > 40)
    return [...issues, { path: "/strokes", message: "A glyph needs 1..40 strokes." }];
  glyph.strokes.forEach((s, i) => {
    const at = "/strokes/" + i;
    const points: readonly ShodoPoint[] = s.points;
    if (!points || points.length < 2 || points.length > 24) {
      issues.push({ path: at + "/points", message: "A stroke needs 2..24 points." });
      return;
    }
    if (points.some((p: ShodoPoint) => p.length !== 2 || p.some((v: number) => !Number.isFinite(v) || v < -100 || v > 1100)))
      issues.push({ path: at + "/points", message: "Points are [x, y] within -100..1100 em units." });
    if (s.turns?.some((t: number) => !Number.isInteger(t) || t < 1 || t > points.length - 2))
      issues.push({ path: at + "/turns", message: "Turn indices must be interior points." });
    if (s.weight !== undefined && (!Number.isFinite(s.weight) || s.weight < .4 || s.weight > 1.8))
      issues.push({ path: at + "/weight", message: "Weight must be 0.4..1.8." });
    if (s.hook && (s.hook.length !== 2 || Math.hypot(s.hook[0], s.hook[1]) < 1e-3))
      issues.push({ path: at + "/hook", message: "Hook must be a nonzero [dx, dy]." });
    if (s.pace !== undefined && (!Number.isFinite(s.pace) || s.pace < .25 || s.pace > 4))
      issues.push({ path: at + "/pace", message: "Pace must be 0.25..4." });
    if (s.press !== undefined && (!Array.isArray(s.press) || s.press.length !== points?.length
        || s.press.some((v: number) => !Number.isFinite(v) || v < .4 || v > 1.8)))
      issues.push({ path: at + "/press", message: "Press needs one value per point, each 0.4..1.8." });
    for (const [key, v] of Object.entries(s.technique ?? {})) {
      const range = SHODO_TECHNIQUE_RANGES[key as keyof ShodoTechniqueParams];
      if (!range || typeof v !== "number" || !Number.isFinite(v) || v < range[0] || v > range[1])
        issues.push({ path: at + "/technique/" + key, message: range ? `${key} must be ${range[0]}..${range[1]}.` : `Unknown technique ${key}.` });
    }
  });
  return issues;
}

// ── KanjiVG adapter ────────────────────────────────────────────────────────────────

/** KanjiVG stroke classes (kvg:type, first alternative) → kind and end technique. */
const KVG_TYPES: Record<string, { kind: ShodoStrokeKind; end?: ShodoEnd }> = {
  "㇐": { kind: "horizontal" }, "㇑": { kind: "vertical" }, "㇒": { kind: "left-sweep" },
  "㇏": { kind: "right-sweep" }, "㇔": { kind: "dot" }, "㇀": { kind: "rise" },
  "㇕": { kind: "turn" }, "㇄": { kind: "turn" }, "㇗": { kind: "turn" },
  "㇆": { kind: "turn", end: "hane" }, "㇚": { kind: "vertical", end: "hane" },
  "㇙": { kind: "vertical", end: "hane" }, "㇟": { kind: "turn", end: "hane" },
  "㇃": { kind: "curve", end: "hane" }, "㇂": { kind: "curve", end: "hane" },
  "㇁": { kind: "curve", end: "hane" }, "㇖": { kind: "horizontal", end: "hane" },
  "㇈": { kind: "turn", end: "hane" }, "㇉": { kind: "turn", end: "hane" },
  "㇇": { kind: "turn", end: "harai" }, "㇋": { kind: "turn", end: "harai" },
  "㇓": { kind: "left-sweep" }, "㇌": { kind: "turn", end: "harai" },
  "㇅": { kind: "turn", end: "tome" }, "㇛": { kind: "turn", end: "tome" },
  "㇜": { kind: "turn", end: "tome" }, "㇞": { kind: "turn", end: "tome" },
  "㇊": { kind: "turn", end: "hane" }, "㇍": { kind: "turn", end: "tome" },
  "㇎": { kind: "turn", end: "harai" }, "㇝": { kind: "curve", end: "harai" },
  "㇠": { kind: "turn", end: "hane" }, "㇡": { kind: "turn", end: "hane" },
  "㇢": { kind: "curve", end: "hane" }, "㇣": { kind: "curve", end: "tome" },
};

type Vec = [number, number];

/** Parse SVG path data (M/L/C/S/Q/H/V/Z, absolute and relative) into a sampled polyline. */
export function samplePathData(d: string, samplesPerCurve = 10): Vec[] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const out: Vec[] = [];
  let i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0, lcx = 0, lcy = 0, prev = "";
  const num = () => Number(tokens[i++]);
  const cubic = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
    for (let k = 1; k <= samplesPerCurve; k++) {
      const t = k / samplesPerCurve, u = 1 - t;
      out.push([u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]);
    }
    lcx = x2; lcy = y2; x = x3; y = y3;
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase(), c = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (c === "M") {
      x = ox + num(); y = oy + num(); sx = x; sy = y; out.push([x, y]);
      cmd = rel ? "l" : "L";
    } else if (c === "L") { x = ox + num(); y = oy + num(); out.push([x, y]); }
    else if (c === "H") { x = ox + num(); out.push([x, y]); }
    else if (c === "V") { y = oy + num(); out.push([x, y]); }
    else if (c === "C") {
      const a = [num(), num(), num(), num(), num(), num()];
      cubic(ox + a[0], oy + a[1], ox + a[2], oy + a[3], ox + a[4], oy + a[5]);
    } else if (c === "S") {
      const r1x = /[CS]/i.test(prev) ? 2 * x - lcx : x, r1y = /[CS]/i.test(prev) ? 2 * y - lcy : y;
      const a = [num(), num(), num(), num()];
      cubic(r1x, r1y, ox + a[0], oy + a[1], ox + a[2], oy + a[3]);
    } else if (c === "Q") {
      const qx = ox + num(), qy = oy + num(), ex = ox + num(), ey = oy + num();
      cubic(x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), ex + 2 / 3 * (qx - ex), ey + 2 / 3 * (qy - ey), ex, ey);
    } else if (c === "Z") { x = sx; y = sy; out.push([x, y]); }
    else throw new RangeError("Unsupported SVG path command: " + cmd);
    prev = c;
    if (Number.isNaN(x) || Number.isNaN(y)) throw new RangeError("Malformed SVG path data.");
  }
  return out;
}

/** Ramer–Douglas–Peucker simplification that always keeps the end points. */
function simplify(points: Vec[], tolerance: number): Vec[] {
  if (points.length < 3) return points;
  const [a, b] = [points[0], points[points.length - 1]];
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  // A closed loop has no chord to measure from: its farthest point from the start splits it.
  const closed = len < tolerance;
  let worst = 0, index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const dist = closed ? Math.hypot(points[i][0] - a[0], points[i][1] - a[1]) : Math.abs((points[i][0] - a[0]) * dy - (points[i][1] - a[1]) * dx) / len;
    if (dist > worst) { worst = dist; index = i; }
  }
  if (worst <= tolerance) return [a, b];
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}

/** Hiragana and katakana (including small and voiced forms). */
export function isKanaChar(char: string): boolean {
  const c = char.codePointAt(0) ?? 0;
  return c >= 0x3041 && c <= 0x30FF;
}

/**
 * Drop a drawn entry or exit flourish: KanjiVG starts and ends many strokes with a tiny
 * curl that stands for the brush entry or stop. The hand makes its own 起筆 and 終筆,
 * so a curl that turns more than ~35° from the stroke's course is removed.
 */
function trimFlourish(raw: Vec[]): Vec[] {
  const arc = [0];
  for (let i = 1; i < raw.length; i++) arc.push(arc[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const total = arc[arc.length - 1];
  if (total < 120 || raw.length < 6) return raw;
  const at = (s: number) => raw[Math.max(0, arc.findIndex(a => a >= s))] ?? raw[raw.length - 1];
  const dir = (a: Vec, b: Vec) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  const turn = (x: number, y: number) => Math.abs(Math.atan2(Math.sin(x - y), Math.cos(x - y)));
  // KanjiVG's pen-style entry and exit curls span up to ~5 of its 109 units (≈ 50 em).
  const lead = Math.min(55, total * .12);
  let from = 0, to = raw.length - 1;
  let start: Vec | null = null;
  if (turn(dir(raw[0], at(lead)), dir(at(lead), at(lead * 2.5))) > .26) {
    // Cut the entry curl at that length, between samples: a long cubic is sampled sparsely, and
    // its next sample can lie far past the curl (用's first stroke lost 150 em and left its corner
    // open; 夫's ノ started below its top line). The exit cut keeps the next sample, as before.
    from = Math.max(1, arc.findIndex(a => a >= lead));
    const t = (lead - arc[from - 1]) / ((arc[from] - arc[from - 1]) || 1);
    start = [raw[from - 1][0] + (raw[from][0] - raw[from - 1][0]) * t, raw[from - 1][1] + (raw[from][1] - raw[from - 1][1]) * t];
  }
  if (turn(dir(at(total - lead), raw[raw.length - 1]), dir(at(total - lead * 2.5), at(total - lead))) > .26)
    to = Math.max(from + 1, arc.findIndex(a => a >= total - lead));
  const kept = raw.slice(from, to + 1);
  return start && Math.hypot(start[0] - kept[0][0], start[1] - kept[0][1]) > 1e-6 ? [start, ...kept] : kept;
}

/** Small かな: the 拗音 and 促音 marks. */
const SMALL_KANA = new Set([..."ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ"]);
/** The ring of ゜ is written light and quick, so its hole stays open. */
const LOOP_WEIGHT = .75;
/** かな strokes carry the teacher's weight: her かな are bolder than the kanji skeleton's default (research note §2.24). */
const KANA_WEIGHT = 1.1;

/** Convert one sampled centreline (em units) and its stroke class into a SHO1 stroke. */
export function strokeFromCentreline(raw: Vec[], kvgType = "", kana = false): ShodoStrokeSpec {
  const typed = KVG_TYPES[[...kvgType.split("/")[0]][0] ?? ""];
  const hooked = typed?.end === "hane";
  // A closed loop (the circle of ゜ in ぱ, パ) ends near its start but is long: a curve, not a dot,
  // and its ends are not trimmed as pen curls, so the ring stays closed.
  const chord = Math.hypot(raw[raw.length - 1][0] - raw[0][0], raw[raw.length - 1][1] - raw[0][1]);
  const path = raw.reduce((s, p, i) => i ? s + Math.hypot(p[0] - raw[i - 1][0], p[1] - raw[i - 1][1]) : 0, 0);
  const loop = !typed && chord < 140 && path > 150 && path > 2.5 * chord;
  if (!hooked && !loop) raw = trimFlourish(raw);
  let points = simplify(raw, 9);
  if (points.length > 24) points = points.filter((_, i) => i % Math.ceil(points.length / 24) === 0 || i === points.length - 1);
  // Corners sharper than ~55° become 転折; gentle bends stay curves.
  const turns: number[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const ax = points[i][0] - points[i - 1][0], ay = points[i][1] - points[i - 1][1];
    const bx = points[i + 1][0] - points[i][0], by = points[i + 1][1] - points[i][1];
    const cos = (ax * bx + ay * by) / ((Math.hypot(ax, ay) * Math.hypot(bx, by)) || 1);
    if (cos < .57) turns.push(i);
  }
  let kind: ShodoStrokeKind = typed?.kind ?? "curve";
  let end: ShodoEnd | undefined = typed?.end;
  let hook: ShodoPoint | undefined;
  if (end === "hane" && points.length >= 3) {
    // KanjiVG draws the hook as the last short segment: the brush flicks along it.
    const a = points[points.length - 2], b = points[points.length - 1];
    hook = [b[0] - a[0], b[1] - a[1]];
    points = points.slice(0, -1);
    while (turns.length && turns[turns.length - 1] >= points.length - 1) turns.pop();
  }
  if (!typed) {
    const a = points[0], b = points[points.length - 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (turns.length && !loop) kind = "turn";
    else if (loop) kind = "curve";
    else if (length < 140) kind = "dot";
    else if (Math.abs(dy) < Math.abs(dx) * .35) kind = "horizontal";
    else if (Math.abs(dx) < Math.abs(dy) * .25) kind = "vertical";
    else kind = dx < 0 ? "left-sweep" : "right-sweep";
    end = undefined;
  }
  if (turns.length && kind !== "turn" && kind !== "curve") kind = "turn";
  const rounded = points.map(p => [Math.round(p[0]), Math.round(p[1])] as const);
  // ㇏a is 平捺, the flat sweep of 辶 and 廴: in kaisho it starts with a pressed head.
  const flatSweep = kvgType.split("/")[0].startsWith("㇏a");
  if (kana) {
    // かな are written with flowing curves: an exposed-tip entry, no kaisho corner
    // presses, and an end that lifts while moving unless the stroke is a dot or a hook.
    const dot = kind === "dot";
    return { kind: dot ? "dot" : turns.length || points.length > 3 ? "curve" : kind, points: rounded,
      start: dot ? "uchikomi" : "roho", ...(dot ? {} : { end: hook ? "hane" : "nuki" }), ...(hook ? { hook } : {}), weight: loop ? LOOP_WEIGHT : dot ? .96 : KANA_WEIGHT };
  }
  return { kind, points: rounded, ...(flatSweep ? { start: "uchikomi" as const } : {}),
    ...(turns.length ? { turns } : {}), ...(end ? { end } : {}), ...(hook ? { hook } : {}) };
}

/**
 * Read a KanjiVG SVG document (text). Strokes are taken in document order, which is
 * KanjiVG's stroke order. The result is marked `source: "kanjivg"` so hosts can credit
 * KanjiVG (CC BY-SA 3.0, http://kanjivg.tagaini.net).
 */
export function parseKanjiVgSvg(svg: string, char?: string): ShodoGlyph {
  if (typeof svg !== "string" || !svg.includes("<path")) throw new RangeError("Expected a KanjiVG SVG document.");
  const viewBox = /viewBox="\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*"/.exec(svg);
  const [vx, vy, vw, vh] = viewBox ? viewBox.slice(1).map(Number) : [0, 0, 109, 109];
  const scale = 1000 / Math.max(vw, vh);
  const strokes: ShodoStrokeSpec[] = [];
  const named = char ?? /kvg:element="([^"]+)"/.exec(svg)?.[1] ?? "";
  const kana = isKanaChar(named);
  // Walk the groups in document order: strokes come in writing order, and each group
  // records the component (element) and where it sits (position).
  const root: RawPart = { strokes: [], children: [] };
  const stack: RawPart[] = [root];
  const tag = /<(\/?)(g|path)\b([^>]*)>/g;
  for (let m = tag.exec(svg); m; m = tag.exec(svg)) {
    const [, close, name, attrs] = m;
    if (name === "g") {
      if (close) { if (stack.length > 1) stack.pop(); continue; }
      const element = /kvg:element="([^"]+)"/.exec(attrs)?.[1];
      const position = /kvg:position="([^"]+)"/.exec(attrs)?.[1] as ShodoPartPosition | undefined;
      const partNo = /kvg:part="([^"]+)"/.exec(attrs)?.[1];
      const node: RawPart = { element, position, partNo, strokes: [], children: [] };
      stack[stack.length - 1].children.push(node);
      if (!attrs.trimEnd().endsWith("/")) stack.push(node);
      continue;
    }
    if (close) continue;
    const d = /\sd="([^"]+)"/.exec(attrs)?.[1];
    if (!d) continue;
    const type = /kvg:type="([^"]*)"/.exec(attrs)?.[1] ?? "";
    const raw = samplePathData(d).map(([x, y]) => [(x - vx) * scale, (y - vy) * scale] as Vec);
    const index = strokes.length;
    strokes.push(strokeFromCentreline(raw, type, kana));
    for (const node of stack) node.strokes.push(index);
  }
  if (!strokes.length) throw new RangeError("The KanjiVG document has no stroke paths.");
  const element = /kvg:element="([^"]+)"/.exec(svg)?.[1];
  return { char: char ?? element ?? "?", source: "kanjivg", strokes, parts: tidyParts(root) };
}

type RawPart = { element?: string; position?: ShodoPartPosition; partNo?: string; strokes: number[]; children: RawPart[] };

/**
 * Turn raw KanjiVG groups into a component tree: drop empty and wrapper groups, and merge a
 * component that KanjiVG splits around another one (囗 part 1 and part 2 around 玉).
 */
function tidyParts(root: RawPart): ShodoPart {
  const visit = (n: RawPart): ShodoPart => {
    let kids = n.children.filter(k => k.strokes.length > 0);
    // A single wrapper child adds nothing: descend into it.
    while (kids.length === 1 && !kids[0].position && kids[0].strokes.length === n.strokes.length)
      kids = kids[0].children.filter(k => k.strokes.length > 0);
    const merged: RawPart[] = [];
    for (const k of kids) {
      const twin = k.partNo ? merged.find(m => m.partNo && m.element === k.element && m.position === k.position) : undefined;
      if (twin) { twin.strokes = [...twin.strokes, ...k.strokes].sort((a, b) => a - b); twin.children = [...twin.children, ...k.children]; }
      else merged.push({ ...k, strokes: [...k.strokes], children: [...k.children] });
    }
    return {
      ...(n.element ? { element: n.element } : {}), ...(n.position ? { position: n.position } : {}),
      strokes: n.strokes, children: merged.map(visit),
    };
  };
  return visit(root);
}

const polyDistance = (points: readonly ShodoPoint[], q: ShodoPoint): { d: number; at: ShodoPoint } => {
  let best = { d: Infinity, at: points[0] as ShodoPoint };
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2));
    const at: ShodoPoint = [a[0] + dx * t, a[1] + dy * t];
    const d = Math.hypot(at[0] - q[0], at[1] - q[1]);
    if (d < best.d) best = { d, at };
  }
  return best;
};

/**
 * Degrees below the horizontal past which a KanjiVG dot falls to the left steeply enough to be
 * written as a short ノ (泉's first stroke, the left dot of ⺣). Measured on a teacher's ink: 110.
 */
const LEFT_DOT = 110;

const isLeftDot = (st: ShodoStrokeSpec) => st.kind === "dot" && st.points.length >= 2
  && Math.atan2(st.points[st.points.length - 1][1] - st.points[0][1], st.points[st.points.length - 1][0] - st.points[0][0]) * 180 / Math.PI > LEFT_DOT;

/** How far (em) an end may reach past an earlier line and still join it; further, the stroke crosses that line. */
const CROSS_REACH = 40;

/**
 * Find stroke ends that meet an earlier stroke (closer than `reach` em) and mark them as joins.
 * With `snap`, a horizontal, vertical or turn end is also moved along its own line onto the
 * other stroke's centreline, so the inner lines of boxes close cleanly.
 */
export function shodoJoinStrokes(glyph: ShodoGlyph, reach = 70, snap = true): ShodoGlyph {
  const strokes: ShodoStrokeSpec[] = glyph.strokes.map(st => ({ ...st, points: st.points.map(p => [p[0], p[1]] as ShodoPoint) }));
  // The top-level part of each stroke (偏 and 旁, 冠 and 脚 …). Within a part the full reach closes
  // the gaps left by trimming KanjiVG's pen curls; across parts only ends that already nearly meet
  // join, so a horizontal of 旁 is not pulled into 偏 (校, 持, 働).
  const partOf = new Map<number, number>();
  (glyph.parts?.children ?? []).forEach((part, p) => part.strokes.forEach(i => partOf.set(i, p)));
  const across = Math.min(reach, 15);
  strokes.forEach((st, i) => {
    if (st.kind === "dot") return;
    const points = st.points as ShodoPoint[];
    for (const [index, key] of [[0, "joinStart"], [points.length - 1, "joinEnd"]] as const) {
      const e = points[index];
      let best: { d: number; at: ShodoPoint } | null = null;
      // Only a line already on the paper can take the join (earlier in stroke order).
      const nb0 = points[index === 0 ? 1 : index - 1];
      const ox = e[0] - nb0[0], oy = e[1] - nb0[1], ol = Math.hypot(ox, oy) || 1;
      glyph.strokes.forEach((other, j) => {
        if (j >= i || other.kind === "dot") return;
        const limit = partOf.has(i) && partOf.has(j) && partOf.get(i) !== partOf.get(j) ? across : reach;
        const hit = polyDistance(other.points, e);
        // An end that already passes through the other line and reaches well beyond it crosses that
        // line (青's top vertical, the verticals of 艹): it stands free, so it is not pulled back.
        const beyond = -((hit.at[0] - e[0]) * ox + (hit.at[1] - e[1]) * oy) / ol;
        if (beyond > CROSS_REACH) return;
        if (hit.d < limit && (!best || hit.d < best.d)) best = hit;
      });
      if (!best) continue;
      const hit: { d: number; at: ShodoPoint } = best;
      st[key] = true;
      if (!snap || (st.kind !== "horizontal" && st.kind !== "vertical" && st.kind !== "turn")) continue;
      // Move the end along the stroke's own direction to meet the other line; an end stops
      // a little short of that line's centre so its stop hides inside it.
      const nb = points[index === 0 ? 1 : index - 1];
      const dx = e[0] - nb[0], dy = e[1] - nb[1], dl = Math.hypot(dx, dy) || 1;
      const along = ((hit.at[0] - e[0]) * dx + (hit.at[1] - e[1]) * dy) / dl - (index === 0 ? 0 : 26);
      if (Math.abs(along) < reach) points[index] = [Math.round(e[0] + dx / dl * along), Math.round(e[1] + dy / dl * along)];
    }
  });
  return { ...glyph, strokes };
}

export interface ShodoFormOptions {
  /**
   * 右上がり: horizontals rise to the right by this angle, in degrees, over the skeleton's own
   * slope. 0..8. KanjiVG kanji: 1 (measured on a teacher's forms); kana and bundled originals: 3.5.
   * Kana take half of it.
   */
  rise?: number;
  /** Length factor for 払い strokes, measured from their start (brush kaisho extends sweeps). 1..1.4. */
  sweep?: number;
  /** Length factor for the main horizontal (主画), about its centre. 1..1.3. */
  main?: number;
  /**
   * Length factor for a kanji horizontal whose end is free (not on an earlier stroke), toward its
   * joined start or about its centre. 0.8..1. KanjiVG kanji: 0.88 (measured); otherwise 1.
   */
  freeEnd?: number;
  /** Length factor for a kanji dot, from its start. 0.6..1. KanjiVG kanji: 0.8 (measured); otherwise 1. */
  dotLength?: number;
  /** Length factor for a kanji 提 (rising stroke ㇀), from its start. 1..1.4. KanjiVG kanji: 1.2 (measured); otherwise 1. */
  riseStrokeLength?: number;
  /**
   * Degrees by which a kanji 右払い's pull-out (its last segment, from the pressed foot) turns
   * flatter than KanjiVG's, never above the horizontal. 0..20. KanjiVG kanji: 12 (measured: her
   * pull-outs run 21° below the horizontal, KanjiVG's 34°); otherwise 0.
   */
  footTurn?: number;
  /**
   * Weight factor for a kanji 右払い. 1..1.5. KanjiVG kanji: 1.3 (measured: her 右払い are 1.44 times as
   * heavy as the rules' weight by length; the other stroke kinds 0.87 to 1.24); otherwise 1.
   */
  rightSweepWeight?: number;
  /**
   * Size factor for a small かな (ぁ っ ゃ ァ ッ ャ …) from KanjiVG, about the foot of its box. 0.6..1.
   * Default 0.76: KanjiVG draws them at 0.79 of a full かな, too large to read beside one (ゃ
   * next to し reads as や); 0.76 gives about 0.6, as handwriting is taught.
   */
  smallKana?: number;
  /**
   * Component layout (結構法) measured on a teacher's models, see `shodoStructure`. Pass
   * `false` to keep KanjiVG's layout, or override single rules.
   */
  structure?: false | Partial<ShodoStructureRules>;
}

/**
 * Give a typeface-like skeleton (for example KanjiVG) the habits of brush kaisho:
 * - the teacher-measured layout (結構法, `shodoStructure`), for KanjiVG glyphs only;
 * - 右上がり as a gentle shear, so verticals stay vertical and joints stay closed;
 * - a free horizontal end that stops short of the skeleton's, compact dots and a longer 提 (kanji);
 * - weight from length, so main strokes carry the character and short ones stay light;
 * - 懸針 for a final vertical that hangs below the rest of the character;
 * - a pressed foot on every 右払い.
 * Kana keep their curves and get only half the rise.
 */
export function shodoKaishoForm(source: ShodoGlyph, options: ShodoFormOptions = {}): ShodoGlyph {
  // A teacher's form already has that teacher's layout and brush habits.
  if (source.source === "teacher") return source;
  const kana = isKanaChar(source.char);
  // Bundled originals were drawn with their own proportions; only KanjiVG skeletons get the layout rules.
  const glyph = options.structure === false || source.source !== "kanjivg" ? source : shodoStructure(source, options.structure ?? {});
  const length = (st: ShodoStrokeSpec) => st.points.reduce((a, p, i) => i ? a + Math.hypot(p[0] - st.points[i - 1][0], p[1] - st.points[i - 1][1]) : 0, 0);
  // Measured on a teacher's 389 kanji forms against our KanjiVG forms (research note §2.22):
  // her horizontals rise 1° over KanjiVG's slope, and a free horizontal end stops short.
  const measured = !kana && source.source === "kanjivg";
  const rise = Math.tan((options.rise ?? (measured ? 1 : 3.5)) * (kana ? .5 : 1) * Math.PI / 180);
  const freeEnd = kana ? 1 : options.freeEnd ?? (measured ? .88 : 1);
  // Her dots are shorter and her 提 strokes longer than KanjiVG's (§2.23).
  const dotLength = kana ? 1 : options.dotLength ?? (measured ? .8 : 1);
  const riseStrokeLength = kana ? 1 : options.riseStrokeLength ?? (measured ? 1.2 : 1);
  const footTurn = kana ? 0 : options.footTurn ?? (measured ? 12 : 0);
  const rightSweepWeight = kana ? 1 : options.rightSweepWeight ?? (measured ? 1.3 : 1);
  const small = source.source === "kanjivg" && SMALL_KANA.has(source.char) ? options.smallKana ?? .76 : 1;
  const sweep = kana ? 1 : options.sweep ?? 1.16;
  // 主画: one horizontal carries the character; it is written longer than the rest.
  const mainFactor = kana ? 1 : options.main ?? 1.1;
  const horizontals = glyph.strokes.map((st, i) => ({ i, st })).filter(({ st }) => st.kind === "horizontal");
  const mainIndex = horizontals.length >= 1 ? horizontals.reduce((a, b) => length(b.st) > length(a.st) ? b : a).i : -1;
  const all = glyph.strokes.flatMap(st => st.points);
  const cx = (Math.min(...all.map(p => p[0])) + Math.max(...all.map(p => p[0]))) / 2;
  const bottom = Math.max(...all.map(p => p[1]));
  const longest = Math.max(...glyph.strokes.map(length));
  const sheared = glyph.strokes.map(st => st.points.map(([x, y]) => [x, Math.round(y - (x - cx) * rise)] as ShodoPoint));
  const strokes = glyph.strokes.map((st, i): ShodoStrokeSpec => {
    let points: ShodoPoint[] = sheared[i];
    const out: ShodoStrokeSpec = { ...st, points };
    if (st.weight === undefined) out.weight = Math.round(Math.min(1.1, Math.max(.84, .86 + .26 * length(st) / longest)) * 100) / 100;
    // Her 右払い press down to a heavy foot; a thin one reads as a long dot (秋's 火).
    if (st.weight === undefined && st.kind === "right-sweep" && rightSweepWeight !== 1) out.weight = Math.round((out.weight ?? 1) * rightSweepWeight * 100) / 100;
    const last = i === glyph.strokes.length - 1, end = st.points[st.points.length - 1];
    if (!kana && last && st.kind === "vertical" && !st.end && end[1] >= bottom - 2 && length(st) > 450) out.end = "nuki";
    // Teachers' kaisho carries its sweeps further than a typeface skeleton: extend 払い
    // strokes from their start so the free end reaches out (大, 人, 永, 水, 有).
    const sweeping = st.kind === "left-sweep" || st.kind === "right-sweep" || (st.end ?? "") === "harai";
    if (i === mainIndex && mainFactor !== 1) {
      const cxs = (points[0][0] + points[points.length - 1][0]) / 2, cys = (points[0][1] + points[points.length - 1][1]) / 2;
      points = points.map(([x, y]) => [Math.round(cxs + (x - cxs) * mainFactor), Math.round(cys + (y - cys) * mainFactor)] as const);
      out.points = points;
    }
    if (sweeping && sweep !== 1 && !st.turns?.length) {
      const [x0, y0] = points[0];
      points = points.map(([x, y], k) => k === 0 ? [x, y] as const : [Math.round(x0 + (x - x0) * sweep), Math.round(y0 + (y - y0) * sweep)] as const);
      out.points = points;
    }
    return out;
  });
  // A longer 主画 or 払い stops before it reaches a stroke that the skeleton keeps apart
  // (体: 本's horizontal into 亻; 病: 疒's sweep into 丙).
  limitReach(strokes, sheared, glyph.parts);
  strokes.forEach((st, i) => {
    if (st.kind === "right-sweep" && st.points.length < 3) {
      const [a, b] = [st.points[0], st.points[st.points.length - 1]];
      strokes[i] = { ...st, points: [a, [Math.round(a[0] + (b[0] - a[0]) * .72), Math.round(a[1] + (b[1] - a[1]) * .74)], b] };
    }
    // 右払い: the pull-out leaves the foot flatter than KanjiVG draws it (秋's 火 read as a long dot).
    // Only a real pull-out turns: the last segment of 辶's sweep is its whole tail.
    const sweep = strokes[i];
    if (footTurn && sweep.kind === "right-sweep" && resolveEnd(sweep) === "harai" && sweep.points.length >= 3) {
      const P = sweep.points, foot = P[P.length - 2], tip = P[P.length - 1];
      const len = Math.hypot(tip[0] - foot[0], tip[1] - foot[1]);
      if (len > .5 * length(sweep)) return;
      const angle = Math.max(0, Math.atan2(tip[1] - foot[1], tip[0] - foot[0]) - footTurn * Math.PI / 180);
      strokes[i] = { ...sweep, points: [...P.slice(0, -1), [Math.round(foot[0] + Math.cos(angle) * len), Math.round(foot[1] + Math.sin(angle) * len)]] };
    }
  });
  let formed = shodoJoinStrokes({ ...glyph, strokes });
  // A horizontal that does not end on an earlier stroke shortens toward its joined start (or
  // about its centre); joins are then closed again.
  if (freeEnd !== 1) formed = shodoJoinStrokes({ ...formed, strokes: formed.strokes.map(st => {
    if (st.kind !== "horizontal" || st.joinEnd) return st;
    const p = st.points, q = p[p.length - 1];
    const [ax, ay] = st.joinStart ? p[0] : [(p[0][0] + q[0]) / 2, (p[0][1] + q[1]) / 2];
    return { ...st, points: p.map(([x, y]) => [Math.round(ax + (x - ax) * freeEnd), Math.round(ay + (y - ay) * freeEnd)] as const) };
  }) });
  // Dots are written compact, and 提 (the rising stroke ㇀) reaches further, both from their start.
  if (dotLength !== 1 || riseStrokeLength !== 1) {
    const before = formed.strokes.map(st => st.points);
    const scaled = formed.strokes.map(st => {
      const k = st.kind === "dot" && st.points.length >= 2 ? dotLength : st.kind === "rise" ? riseStrokeLength : 1;
      if (k === 1) return st;
      const [ax, ay] = st.points[0];
      return { ...st, points: st.points.map(([x, y]) => [Math.round(ax + (x - ax) * k), Math.round(ay + (y - ay) * k)] as const) };
    });
    limitReach(scaled, before, glyph.parts);     // a longer 提 stops before the next part (野: 里 and 予)
    formed = shodoJoinStrokes({ ...formed, strokes: scaled });
  }
  // A small かな is written smaller still, on the foot of its box.
  if (small !== 1) {
    const pts = formed.strokes.flatMap(st => st.points);
    const fx = (Math.min(...pts.map(p => p[0])) + Math.max(...pts.map(p => p[0]))) / 2, fy = Math.max(...pts.map(p => p[1]));
    formed = { ...formed, strokes: formed.strokes.map(st => ({ ...st, points: st.points.map(([x, y]) => [Math.round(fx + (x - fx) * small), Math.round(fy + (y - fy) * small)] as const) })) };
  }
  // A dot that falls steeply to the left (泉's first stroke, the left dot of ⺣) is written as a short
  // ノ: the dot's pressed footprint points down-right, across such a path, and reads as a blob. Not
  // for a teacher's forms: their dots were fitted to that teacher's ink as dots.
  if (measured) formed = { ...formed, strokes: formed.strokes.map(st => isLeftDot(st) ? { ...st, kind: "left-sweep" as const } : st) };
  return formed;
}

/** Clear paper (em, centreline to centreline) that a lengthened stroke keeps from strokes of another part. */
const REACH_CLEAR = 50;

/**
 * Where a stroke was lengthened (from `before` to its current points, same point count), shorten
 * the lengthening so the stroke keeps REACH_CLEAR from the strokes of the other top-level parts
 * (偏 and 旁, 冠 and 脚 …), or the distance it had before when that was already smaller. Inside one
 * part strokes are meant to sit close. Changes `strokes` in place.
 */
function limitReach(strokes: ShodoStrokeSpec[], before: readonly (readonly ShodoPoint[])[], parts: ShodoGlyph["parts"], clear = REACH_CLEAR): void {
  const partOf = new Map<number, number>();
  (parts?.children ?? []).forEach((part, p) => part.strokes.forEach(i => partOf.set(i, p)));
  const dense = (P: readonly ShodoPoint[]): ShodoPoint[] => P.flatMap((p, k) => {
    if (k === 0) return [p];
    const q = P[k - 1], n = Math.max(1, Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / 8));
    return Array.from({ length: n }, (_, m) => [q[0] + (p[0] - q[0]) * (m + 1) / n, q[1] + (p[1] - q[1]) * (m + 1) / n] as ShodoPoint);
  });
  strokes.forEach((st, i) => {
    const P0 = before[i], P1 = st.points;
    if (P0.length !== P1.length || P1.every((p, k) => p[0] === P0[k][0] && p[1] === P0[k][1])) return;
    if (!partOf.has(i)) return;
    const others = strokes.flatMap((o, j) => j === i || !partOf.has(j) || partOf.get(j) === partOf.get(i) ? [] : dense(o.points));
    if (!others.length) return;
    const gap = (P: readonly ShodoPoint[]) => Math.min(...dense(P).map(a => Math.min(...others.map(b => Math.hypot(a[0] - b[0], a[1] - b[1])))));
    const lerp = (t: number) => P0.map((p, k) => [Math.round(p[0] + (P1[k][0] - p[0]) * t), Math.round(p[1] + (P1[k][1] - p[1]) * t)] as const);
    const need = Math.min(clear, gap(P0));
    if (gap(P1) >= need) return;
    let lo = 0, hi = 1;
    for (let it = 0; it < 7; it++) { const t = (lo + hi) / 2; if (gap(lerp(t)) >= need) lo = t; else hi = t; }
    strokes[i] = { ...st, points: lerp(lo) };
  });
}

/** KanjiVG file name for a character, for example 道 → "09053.svg". */
export function kanjiVgFileName(char: string): string {
  const code = char.codePointAt(0);
  if (code === undefined) throw new RangeError("A character is required.");
  return code.toString(16).padStart(5, "0") + ".svg";
}
