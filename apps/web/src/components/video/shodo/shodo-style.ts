/**
 * SHO1 — shodō (Japanese brush calligraphy) style contract.
 *
 * One validated, data-only description of the hand, the brush, the ink and the paper.
 * Every value is an input to the physical model in `shodo-hand.ts` and `shodo-ink.ts`;
 * nothing here is a post-process filter. Presets are starting points, not themes.
 */
import { inkHash } from "../ink-brush";

export type ShodoScript = "kaisho" | "gyosho" | "sosho";
export type ShodoHair = "goat" | "weasel" | "mixed" | "horse";

export interface ShodoHand {
  /** Script grammar: kaisho stops and presses at every entry, turn and end; gyōsho rounds and links; sōsho flows. */
  script: ShodoScript;
  /**
   * Writing-speed multiplier. 0.25..4. The kaisho default, 0.32, is a teacher's pace with the
   * brush on the paper (measured on 438 of her lesson videos: 21 s per character); 1 is about
   * three times as fast, a brisk demonstration.
   */
  speed: number;
  /** Pressure ("strength") multiplier on every authored press. 0.3..1.8. */
  pressure: number;
  /** Contact-width multiplier applied after pressure. 0.4..2. */
  width: number;
  /** How much each stroke thins from its first to its last contact, 0..0.8 ("width decay"). */
  widthDecay: number;
  /** Direction the gathered tip (穂先) points while writing, in degrees; -135 is upper-left. */
  tipAngle: number;
  /** Bias of the entry press (起筆) in degrees; 45 is the classical kaisho angled entry. 0..80. */
  entryAngle: number;
  /** 0 keeps the tip on its upper-left side; 1 lets it trail freely behind the motion (cursive). */
  tipFollow: number;
  /** Natural hand tremor and press variation, 0..1. Zero is mechanically exact. */
  tremor: number;
  /** Air-time hairline links (糸引き) between strokes, 0..1; used by gyōsho and sōsho. */
  ligature: number;
  /** Pause length multiplier for tame (溜め), turns and stops. 0..3. */
  pause: number;
  /**
   * Lean of the handle from vertical while the brush is in the air or barely touching,
   * degrees. Pressing stands the brush up; travel and sweeps tilt it (see shodo-hand).
   */
  lean: number;
  /**
   * Direction the handle top leans toward at rest, degrees clockwise from +x. 68 points at a
   * right-handed writer sitting below the page: top-view teaching videos show a long handle
   * toward the writer, while side views across the page show it nearly upright.
   */
  leanAzimuth: number;
  /** 直筆 (0, upright, tip through the centre of the line) … 側筆 (1, tilted toward the travel). 0..1. */
  sideBrush: number;
}

export interface ShodoBrush {
  hair: ShodoHair;
  /** Tuft (穂) diameter at the ferrule, in em/1000 of the written character. 20..220. */
  diameter: number;
  /** Tuft length relative to its diameter. 2.2..6. */
  length: number;
  /** Spring of the hair (コシ), 0..1. Stiff hair holds a point and splits under speed; soft hair spreads. */
  stiffness: number;
  /** Bristle lanes used for dry-brush (かすれ) streaks. 16..96. */
  bristles: number;
  /** Hair colour where no ink reaches (goat is cream, weasel is brown). #RRGGBB. */
  hairColor: string;
  /** Handle (軸) colour. #RRGGBB. */
  handleColor: string;
  /** Handle length relative to the tuft length. 2..8. */
  handleLength: number;
}

export interface ShodoInk {
  /** Body colour of the fully dense ink. #RRGGBB. */
  color: string;
  /** Hue the ink takes when it is thin or diluted (青墨 leans blue, 茶墨 brown). #RRGGBB. */
  diluteColor: string;
  /** Ink concentration ("colour strength"): 1 is 濃墨 dense ink, 0.25 is pale 淡墨. 0.08..1. */
  strength: number;
  /** Water carried with the pigment; drives bleed (にじみ) and the wet sheen. 0..1. */
  water: number;
  /** Ink the brush holds after a dip, 0.1..1. */
  load: number;
  /** Load spent per em of written stroke ("colour strength decay"). 0..1.5. */
  decay: number;
  /** How much the deposit greys as the brush empties, 0..1. */
  fade: number;
  /** Re-dip (墨継ぎ) when the load falls below this value. 0 disables re-dipping. */
  redipBelow: number;
  /** Gloss of the dried ink. Oil-soot (油煙) inks shine more than pine-soot (松煙). 0..1. */
  gloss: number;
}

export interface ShodoPaper {
  /** Paper colour. #RRGGBB. */
  color: string;
  /** How far wet ink travels into the sheet (にじみ), 0..1. Hanshi ≈ 0.35, gasenshi ≈ 0.8, sized ≈ 0.08. */
  absorbency: number;
  /** Visible long fibres (楮) and their pull on the bleed, 0..1. */
  fibre: number;
  /** Surface tooth that catches a drying brush, 0..1. */
  tooth: number;
  /** Seconds for a fresh mark to lose its wet sheen. 0.5..12. */
  dryingSeconds: number;
}

/**
 * 筆法: tunables of the basic techniques. Distances are in stroke widths, presses are
 * extra press relative to the travel press, holds are seconds at speed 1.
 */
export interface ShodoTechniqueParams {
  /** 打ち込み: extra press of the 45° entry, its travel, its hold (溜め), and the share of the first run used to ease back. */
  uchikomiDepth: number;
  uchikomiReach: number;
  uchikomiHold: number;
  easeBack: number;
  /** 蔵鋒: how far the tip pushes back against the stroke before folding in. */
  zohoReverse: number;
  /** 露鋒: share of the first run over which the press builds from the bare tip. */
  rohoBuild: number;
  /** 転折: length and extra press of the 45° re-press that makes the shoulder, and its hold. */
  tensetsuShoulder: number;
  tensetsuPress: number;
  tensetsuHold: number;
  /** 止め: extra press of the final トン, its travel and hold; `suiro` scales it on verticals (垂露). */
  tomePress: number;
  tomeReach: number;
  tomeHold: number;
  suiro: number;
  /** 撥ね: the pause before the flick, the flick length and its duration. */
  haneHold: number;
  haneLength: number;
  haneSpeed: number;
  /** 払い / 懸針: share of the last run where the lift begins. */
  haraiLift: number;
  kenshinLift: number;
  /** 右払い: extra press and hold at the foot, and how far the chisel pulls out. */
  footPress: number;
  footHold: number;
  pullOut: number;
  /**
   * 右払い: the shortest pull-out, as a share of the stroke's length. The pull-out is the last
   * point pair; when that is shorter (a traced or fitted form spaces its points along the stroke),
   * the foot moves back along the stroke to this share.
   */
  footShare: number;
  /** 点: extra press and hold of the dot. */
  tenPress: number;
  tenHold: number;
  /** 結び: how much the brush lifts through the loop of a かな curve, so its counter stays open. */
  musubiLift: number;
}

export interface ShodoStyle {
  version: 1;
  hand: ShodoHand;
  technique: ShodoTechniqueParams;
  brush: ShodoBrush;
  ink: ShodoInk;
  paper: ShodoPaper;
  /** Fixed seed for hair lanes, paper fibres and tremor. Never derived from time. */
  seed: number;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };

// Gyōsho and sōsho keep their pace relative to kaisho (1.5 and 2.1 times as fast).
export const SHODO_HANDS = {
  kaisho: {
    script: "kaisho", speed: .32, pressure: 1, width: 1, widthDecay: .08, tipAngle: -135, entryAngle: 45,
    tipFollow: .22, tremor: .35, ligature: 0, pause: 1, lean: 38, leanAzimuth: 68, sideBrush: .15,
  },
  gyosho: {
    script: "gyosho", speed: .48, pressure: .95, width: .95, widthDecay: .18, tipAngle: -128, entryAngle: 32,
    tipFollow: .5, tremor: .4, ligature: .55, pause: .55, lean: 40, leanAzimuth: 64, sideBrush: .45,
  },
  sosho: {
    script: "sosho", speed: .67, pressure: .9, width: .9, widthDecay: .3, tipAngle: -120, entryAngle: 20,
    tipFollow: .78, tremor: .5, ligature: .9, pause: .3, lean: 42, leanAzimuth: 60, sideBrush: .65,
  },
} as const satisfies Record<ShodoScript, ShodoHand>;

export const SHODO_BRUSHES = {
  /** Large practice brush (大筆) of white goat hair: absorbent, soft, broad belly. */
  "goat-large": {
    hair: "goat", diameter: 104, length: 3.4, stiffness: .38, bristles: 64,
    hairColor: "#EEE7D8", handleColor: "#CDAA6A", handleLength: 3.1,
  },
  /** Firm weasel (イタチ) brush: crisp edges, sharp hane and early dry splits. */
  "weasel-firm": {
    hair: "weasel", diameter: 78, length: 3.4, stiffness: .78, bristles: 52,
    hairColor: "#8E6338", handleColor: "#2E2622", handleLength: 3.2,
  },
  /** Mixed hair (兼毫): a stiff core inside an absorbent goat mantle. */
  "mixed-practice": {
    hair: "mixed", diameter: 86, length: 3.5, stiffness: .56, bristles: 58,
    hairColor: "#D9CDB7", handleColor: "#B98B4E", handleLength: 3.1,
  },
  /** Small brush (小筆) for kana and signatures. */
  "kofude-small": {
    hair: "weasel", diameter: 34, length: 3.9, stiffness: .7, bristles: 28,
    hairColor: "#7A5432", handleColor: "#3A2A22", handleLength: 4.5,
  },
} as const satisfies Record<string, ShodoBrush>;

export const SHODO_INKS = {
  /** Dense pine/oil soot ink (濃墨). */
  sumi: {
    color: "#121110", diluteColor: "#5B5853", strength: 1, water: .5, load: 1, decay: .14, fade: .35,
    redipBelow: .34, gloss: .35,
  },
  /** Blue-black ink (青墨): cool where thin. */
  seiboku: {
    color: "#101318", diluteColor: "#4C5868", strength: .95, water: .55, load: 1, decay: .14, fade: .4,
    redipBelow: .34, gloss: .25,
  },
  /** Brown-black ink (茶墨): warm where thin. */
  chaboku: {
    color: "#1A1411", diluteColor: "#6B5444", strength: .95, water: .55, load: 1, decay: .14, fade: .4,
    redipBelow: .34, gloss: .3,
  },
  /** Diluted ink (淡墨): grey body with a darker wet core and wide bleed. */
  tanboku: {
    color: "#2A2826", diluteColor: "#8A867E", strength: .32, water: .85, load: 1, decay: .12, fade: .3,
    redipBelow: .34, gloss: .1,
  },
  /** Vermilion teacher's correction ink (朱墨). */
  shuboku: {
    color: "#E2461C", diluteColor: "#F08A62", strength: .92, water: .45, load: 1, decay: .15, fade: .3,
    redipBelow: .34, gloss: .45,
  },
} as const satisfies Record<string, ShodoInk>;

export const SHODO_PAPERS = {
  /** Machine or hand hanshi (半紙): moderate bleed, faint fibres. */
  hanshi: { color: "#F4F1EA", absorbency: .34, fibre: .45, tooth: .5, dryingSeconds: 3.2 },
  /** Gasenshi (画仙紙): very absorbent, long fibres, wide feathered bleed. */
  gasenshi: { color: "#F2EEE4", absorbency: .82, fibre: .75, tooth: .4, dryingSeconds: 5 },
  /** Sized kozo paper (礬水引き): almost no bleed, crisp kasure. */
  sized: { color: "#EFE7D6", absorbency: .07, fibre: .6, tooth: .72, dryingSeconds: 2.2 },
  /** Practice newsprint-like paper: rough, quick to dry. */
  practice: { color: "#ECE8DD", absorbency: .22, fibre: .2, tooth: .62, dryingSeconds: 2.6 },
} as const satisfies Record<string, ShodoPaper>;

export const DEFAULT_SHODO_TECHNIQUE: ShodoTechniqueParams = {
  uchikomiDepth: .3, uchikomiReach: .22, uchikomiHold: .07, easeBack: .34,
  zohoReverse: .38, rohoBuild: .38,
  tensetsuShoulder: .2, tensetsuPress: .32, tensetsuHold: .06,
  tomePress: .3, tomeReach: .12, tomeHold: .08, suiro: .75,
  haneHold: .1, haneLength: 1.25, haneSpeed: .1,
  haraiLift: .42, kenshinLift: .62,
  footPress: .46, footHold: .1, pullOut: .22, footShare: .2,
  tenPress: .12, tenHold: .12,
  musubiLift: .25,
};

export const DEFAULT_SHODO_STYLE: ShodoStyle = {
  version: 1,
  hand: { ...SHODO_HANDS.kaisho },
  technique: { ...DEFAULT_SHODO_TECHNIQUE },
  brush: { ...SHODO_BRUSHES["goat-large"] },
  ink: { ...SHODO_INKS.sumi },
  paper: { ...SHODO_PAPERS.hanshi },
  seed: 1151,
};

/** Merge a partial style over the default (or a given base) without mutating either. */
export function resolveShodoStyle(partial: DeepPartial<ShodoStyle> = {}, base: ShodoStyle = DEFAULT_SHODO_STYLE): ShodoStyle {
  return {
    version: 1,
    hand: { ...base.hand, ...partial.hand },
    technique: { ...base.technique, ...partial.technique },
    brush: { ...base.brush, ...partial.brush },
    ink: { ...base.ink, ...partial.ink },
    paper: { ...base.paper, ...partial.paper },
    seed: partial.seed ?? base.seed,
  };
}

export interface ShodoIssue { code: string; path: string; message: string }

const HEX = /^#[0-9a-f]{6}$/i;
type Range = readonly [number, number];
const HAND_RANGES: Record<Exclude<keyof ShodoHand, "script">, Range> = {
  speed: [.25, 4], pressure: [.3, 1.8], width: [.4, 2], widthDecay: [0, .8], tipAngle: [-180, 180],
  entryAngle: [0, 80], tipFollow: [0, 1], tremor: [0, 1], ligature: [0, 1], pause: [0, 3],
  lean: [0, 60], leanAzimuth: [-180, 180], sideBrush: [0, 1],
};
const BRUSH_RANGES: Record<"diameter" | "length" | "stiffness" | "bristles" | "handleLength", Range> = {
  diameter: [20, 220], length: [2.2, 6], stiffness: [0, 1], bristles: [16, 96], handleLength: [2, 8],
};
const INK_RANGES: Record<Exclude<keyof ShodoInk, "color" | "diluteColor">, Range> = {
  strength: [.08, 1], water: [0, 1], load: [.1, 1], decay: [0, 1.5], fade: [0, 1], redipBelow: [0, .9], gloss: [0, 1],
};
export const SHODO_TECHNIQUE_RANGES: Record<keyof ShodoTechniqueParams, Range> = {
  uchikomiDepth: [0, 1], uchikomiReach: [0, 1.2], uchikomiHold: [0, .4], easeBack: [.05, .7],
  zohoReverse: [0, 1], rohoBuild: [.05, .8],
  tensetsuShoulder: [0, .6], tensetsuPress: [0, 1], tensetsuHold: [0, .4],
  tomePress: [0, 1], tomeReach: [0, .6], tomeHold: [0, .4], suiro: [0, 1.5],
  haneHold: [0, .4], haneLength: [.3, 2.5], haneSpeed: [.04, .4],
  haraiLift: [.1, .9], kenshinLift: [.1, .95],
  footPress: [0, 1], footHold: [0, .4], pullOut: [0, .8], footShare: [0, .5],
  tenPress: [0, 1], tenHold: [0, .4],
  musubiLift: [0, .9],
};
const PAPER_RANGES: Record<Exclude<keyof ShodoPaper, "color">, Range> = {
  absorbency: [0, 1], fibre: [0, 1], tooth: [0, 1], dryingSeconds: [.5, 12],
};

function checkRanges<T extends object>(
  value: T | undefined, ranges: Record<string, Range>, at: string, issues: ShodoIssue[],
): void {
  if (!value || typeof value !== "object") {
    issues.push({ code: "group", path: at, message: "Required style group is missing." });
    return;
  }
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const n = (value as Record<string, unknown>)[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max)
      issues.push({ code: "range", path: at + "/" + key, message: `${key} must be a number within ${min}..${max}.` });
  }
}

/** Path-specific validation; an empty list means the style is safe to render. */
export function inspectShodoStyle(style: ShodoStyle): ShodoIssue[] {
  const issues: ShodoIssue[] = [];
  if (!style || typeof style !== "object") return [{ code: "style", path: "/", message: "A SHO1 style object is required." }];
  if (style.version !== 1) issues.push({ code: "version", path: "/version", message: "SHO1 style version must be 1." });
  if (!Number.isSafeInteger(style.seed) || style.seed < 0 || style.seed > 2147483647)
    issues.push({ code: "seed", path: "/seed", message: "Seed must be a nonnegative 31-bit integer." });
  checkRanges(style.hand, HAND_RANGES, "/hand", issues);
  if (style.hand && !["kaisho", "gyosho", "sosho"].includes(style.hand.script))
    issues.push({ code: "script", path: "/hand/script", message: "Script must be kaisho, gyosho or sosho." });
  checkRanges(style.technique, SHODO_TECHNIQUE_RANGES, "/technique", issues);
  checkRanges(style.brush, BRUSH_RANGES, "/brush", issues);
  if (style.brush) {
    if (!["goat", "weasel", "mixed", "horse"].includes(style.brush.hair))
      issues.push({ code: "hair", path: "/brush/hair", message: "Hair must be goat, weasel, mixed or horse." });
    for (const key of ["hairColor", "handleColor"] as const)
      if (typeof style.brush[key] !== "string" || !HEX.test(style.brush[key]))
        issues.push({ code: "color", path: "/brush/" + key, message: key + " must be #RRGGBB." });
  }
  checkRanges(style.ink, INK_RANGES, "/ink", issues);
  if (style.ink) for (const key of ["color", "diluteColor"] as const)
    if (typeof style.ink[key] !== "string" || !HEX.test(style.ink[key]))
      issues.push({ code: "color", path: "/ink/" + key, message: key + " must be #RRGGBB." });
  checkRanges(style.paper, PAPER_RANGES, "/paper", issues);
  if (style.paper && (typeof style.paper.color !== "string" || !HEX.test(style.paper.color)))
    issues.push({ code: "color", path: "/paper/color", message: "Paper colour must be #RRGGBB." });
  return issues;
}

export function assertShodoStyle(style: ShodoStyle): void {
  const issues = inspectShodoStyle(style);
  if (issues.length) throw new RangeError(issues.map(i => i.path + ": " + i.message).join("; "));
}

/** Parse #RRGGBB into linear-ish 0..255 channels. */
export function shodoRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** Smooth value noise on a lattice, in [0, 1). */
export function shodoNoise(seed: number, x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy;
  const ux = tx * tx * (3 - 2 * tx), uy = ty * ty * (3 - 2 * ty);
  const a = inkHash(seed, ix, iy), b = inkHash(seed, ix + 1, iy);
  const c = inkHash(seed, ix, iy + 1), d = inkHash(seed, ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
