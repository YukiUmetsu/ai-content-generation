/**
 * SHO1 間架結構法: how a teacher lays out a character, as named classical rules.
 *
 * The classical treatises (歐陽詢 結字三十六法, 黄自元 間架結構九十二法, and Japanese 書写
 * 字形の整え方) name the habits that make a character well built. Each rule here has its
 * classical name, a test for the characters it applies to (KanjiVG's component tree), and the
 * change it makes. The amounts were measured, not guessed: 411 finished kaisho models by one
 * teacher were compared with the same characters from KanjiVG (SHO1 research note, §2.8–2.9),
 * and a rule is enabled only when it improved the match on both halves of the characters.
 * Only these aggregate numbers are kept; no teacher shape is stored.
 *
 * `shodoKaishoForm` applies these first, then rises the horizontals, weights the strokes and
 * re-closes the joins.
 */
import type { ShodoGlyph, ShodoPart, ShodoPartPosition, ShodoPoint, ShodoStrokeSpec } from "./shodo-glyphs";

export type ShodoLayout = "leftRight" | "topBottom" | "enclosure" | "tare" | "nyo" | "single" | "kana";

/** The rules of the rule book, in the order they are applied. */
export type ShodoKankaRuleId = "tenpu" | "soukanmuri" | "jougeNoMa" | "sachouUchou" | "gaikei";

export interface ShodoStructureRules {
  /** 外形: width of the whole character relative to KanjiVG, by top-level layout (1 = unchanged). */
  aspect: Readonly<Record<ShodoLayout, number>>;
  /** 天覆: width of a covering crown (宀 冖 雨 人 亠 穴 癶) relative to other tops, about its centre. */
  crownWidth: number;
  /** 草冠: width of 艹 relative to KanjiVG. */
  grassWidth: number;
  /** 上下の間: width of the top part, width of the bottom part, and height of the bottom part
   * kept on its base line (less than 1 opens the gap under the top part). */
  topWidth: number;
  bottomWidth: number;
  bottomHeight: number;
  /** 左短右長: how far the foot of the left part rises, as a fraction of the character height. */
  leftFootRise: number;
}

/** Medians from the teacher study. */
export const SHODO_STRUCTURE_RULES: ShodoStructureRules = {
  aspect: { leftRight: 1, topBottom: .905, enclosure: .955, tare: .95, nyo: .93, single: .885, kana: .93 },
  crownWidth: 1.032,
  grassWidth: .95,
  topWidth: .94,
  bottomWidth: .94,
  bottomHeight: .92,
  leftFootRise: .03,
};

/** Crowns that cover what is under them (天覆), as KanjiVG names them. */
export const SHODO_COVERING_CROWNS = new Set(["宀", "冖", "雨", "人", "亠", "穴", "癶", "𠆢"]);

export interface ShodoKankaRule {
  id: ShodoKankaRuleId;
  /** Classical name and reading. */
  term: string;
  reading: string;
  /** What the teacher does, in one line. */
  summary: string;
}

/** The rule book, for captions and teaching views. */
export const SHODO_KANKA_RULES: readonly ShodoKankaRule[] = [
  { id: "tenpu", term: "天覆", reading: "tenpuku", summary: "A covering crown (宀, 雨, 亠, 人…) stays wide enough to cover the body under it." },
  { id: "soukanmuri", term: "草冠", reading: "sōkanmuri", summary: "艹 stays compact over the body." },
  { id: "jougeNoMa", term: "上下の間", reading: "jōge no ma", summary: "Top and bottom parts are a little narrower, with air between them." },
  { id: "sachouUchou", term: "左短右長", reading: "sachō uchō", summary: "The left part (偏) ends higher than the right part." },
  { id: "gaikei", term: "外形", reading: "gaikei", summary: "冠/脚 and single-part characters are taller than a typeface; 偏/旁 keep their width." },
];

type Box = [number, number, number, number];

function boxOf(strokes: readonly ShodoStrokeSpec[], indices: readonly number[]): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of indices) for (const [x, y] of strokes[i]?.points ?? []) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return x1 >= x0 ? [x0, y0, x1, y1] : null;
}

/** Map every point of the chosen strokes. Hooks are directions and stay as they are. */
function move(strokes: ShodoStrokeSpec[], indices: readonly number[], f: (p: ShodoPoint) => ShodoPoint): void {
  for (const i of indices) {
    const s = strokes[i];
    if (s) strokes[i] = { ...s, points: s.points.map(p => { const [x, y] = f(p); return [Math.round(x), Math.round(y)] as const; }) };
  }
}

const has = (kids: readonly ShodoPart[], ...positions: ShodoPartPosition[]) => positions.every(p => kids.some(k => k.position === p));
const part = (kids: readonly ShodoPart[], position: ShodoPartPosition) => kids.find(k => k.position === position);
const widen = (strokes: ShodoStrokeSpec[], indices: readonly number[], k: number) => {
  const b = boxOf(strokes, indices);
  if (b && k !== 1) { const c = (b[0] + b[2]) / 2; move(strokes, indices, ([x, y]) => [c + (x - c) * k, y]); }
};

/** The top-level layout of a glyph, from its component tree. */
export function shodoLayout(glyph: ShodoGlyph): ShodoLayout {
  const code = glyph.char.codePointAt(0) ?? 0;
  if (code >= 0x3041 && code <= 0x30FF) return "kana";
  const kids = glyph.parts?.children ?? [];
  if (has(kids, "top", "bottom")) return "topBottom";
  if (has(kids, "left", "right")) return "leftRight";
  if (kids.some(k => k.position === "kamae")) return "enclosure";
  if (has(kids, "tare", "tarec")) return "tare";
  if (has(kids, "nyo", "nyoc")) return "nyo";
  return "single";
}

/** The 間架結構 rules that apply to a glyph, in the order they are applied. */
export function shodoKankaRulesFor(glyph: ShodoGlyph, overrides: Partial<ShodoStructureRules> = {}): ShodoKankaRuleId[] {
  const r = { ...SHODO_STRUCTURE_RULES, ...overrides, aspect: { ...SHODO_STRUCTURE_RULES.aspect, ...overrides.aspect } };
  const layout = shodoLayout(glyph);
  const kids = glyph.parts?.children ?? [];
  const top = part(kids, "top");
  const out: ShodoKankaRuleId[] = [];
  if (layout === "topBottom" && top?.element && SHODO_COVERING_CROWNS.has(top.element) && r.crownWidth !== 1) out.push("tenpu");
  if (layout === "topBottom" && top?.element === "艹" && r.grassWidth !== 1) out.push("soukanmuri");
  if (layout === "topBottom" && (r.topWidth !== 1 || r.bottomWidth !== 1 || r.bottomHeight !== 1)) out.push("jougeNoMa");
  if (layout === "leftRight" && r.leftFootRise) out.push("sachouUchou");
  if (r.aspect[layout] !== 1) out.push("gaikei");
  return out;
}

/** Apply the teacher's 間架結構 habits to a glyph. Pure; returns a new glyph. */
export function shodoStructure(glyph: ShodoGlyph, overrides: Partial<ShodoStructureRules> = {}): ShodoGlyph {
  const r = { ...SHODO_STRUCTURE_RULES, ...overrides, aspect: { ...SHODO_STRUCTURE_RULES.aspect, ...overrides.aspect } };
  const layout = shodoLayout(glyph);
  const strokes = glyph.strokes.map(s => ({ ...s }));
  const all = strokes.map((_, i) => i);
  const whole = boxOf(strokes, all);
  if (!whole) return glyph;
  const kids = glyph.parts?.children ?? [];
  const rules = shodoKankaRulesFor(glyph, overrides);
  if (layout === "topBottom") {
    const top = part(kids, "top")!, bottom = part(kids, "bottom")!;
    if (rules.includes("tenpu")) widen(strokes, top.strokes, r.crownWidth);
    if (rules.includes("soukanmuri")) widen(strokes, top.strokes, r.grassWidth);
    if (rules.includes("jougeNoMa")) {
      widen(strokes, top.strokes, r.topWidth);
      const bb = boxOf(strokes, bottom.strokes);
      if (bb) {
        const c = (bb[0] + bb[2]) / 2;
        move(strokes, bottom.strokes, ([x, y]) => [c + (x - c) * r.bottomWidth, bb[3] - (bb[3] - y) * r.bottomHeight]);
      }
    }
  }
  if (rules.includes("sachouUchou")) {
    // The left part keeps its top and shortens toward it, so its foot ends higher.
    const left = part(kids, "left")!, lb = boxOf(strokes, left.strokes);
    if (lb) {
      const k = Math.max(.75, 1 - r.leftFootRise * (whole[3] - whole[1]) / Math.max(1, lb[3] - lb[1]));
      move(strokes, left.strokes, ([x, y]) => [x, lb[1] + (y - lb[1]) * k]);
    }
  }
  if (rules.includes("gaikei")) {
    const aspect = r.aspect[layout], cx = (whole[0] + whole[2]) / 2;
    move(strokes, all, ([x, y]) => [cx + (x - cx) * aspect, y]);
  }
  return { ...glyph, strokes };
}
