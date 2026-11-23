/**
 * SHO1 reviewed kaisho forms: three kanji whose KanjiVG centrelines are reviewed against kaisho
 * references (regular-script stroke guides, 2016–2018, ryohkei.com: 学, 毎, 先).
 *
 * The stroke order, the centrelines and the hooks are KanjiVG's (CC BY-SA 3.0; the credit is shown
 * with the writing). The review changes what the brush does on each stroke: the thickness of
 * wedge-like strokes (weight), the length of a long 撥ね flick (hook), the press at one corner
 * (press), and, at the joins listed in `moved`, the end point of one stroke and the start of the next
 * (with the joinStart / joinEnd flag). Every other point is KanjiVG's. It does not change the global
 * form rules (shodoKaishoForm), so other characters are unaffected.
 *
 * A reviewed form is used only when the KanjiVG file it was reviewed against is the file loaded:
 * its SVG hash and length must match (see glyphFromKanjiVg). Any other KanjiVG text uses the rules.
 */
import type { ShodoGlyph } from "./shodo-glyphs";

/** The KanjiVG file a reviewed form was checked against. */
export interface ShodoReviewedSource {
  /** KanjiVG file stem, for example "05b66" (学). */
  file: string;
  /** FNV-1a (32-bit, hex) of the SVG text, as glyphFromKanjiVg computes it. */
  svgHash: string;
  /** Length of the SVG text in characters. */
  svgLength: number;
}

export interface ShodoReviewedGlyph extends ShodoGlyph {
  reviewed: ShodoReviewedSource;
  /** The points the review moved, as 0-based stroke and point indices: the only points that differ from KanjiVG. */
  moved?: readonly { stroke: number; point: number }[];
}

export const SHODO_REVIEWED_KANJI: Readonly<Record<string, ShodoReviewedGlyph>> = {
  "先": {
    char: "先", source: "kanjivg", reviewed: { file: "05148", svgHash: "70782c57", svgLength: 3044 },
    strokes: [
      {kind: "left-sweep",points: [[368,195],[325,332],[251,453]],weight: 0.8},
      {kind: "horizontal",points: [[335,300],[628,268]],weight: 0.82,joinStart: true},
      {kind: "vertical",points: [[502,151],[502,463]],weight: 0.9,joinEnd: true},
      {kind: "horizontal",points: [[209,493],[802,451]],weight: 0.95},
      {kind: "left-sweep",points: [[416,488],[336,789],[276,869],[201,937]],weight: 0.88,joinStart: true},
      {kind: "turn",points: [[548,522],[559,559],[559,812],[577,865],[650,882],[773,870],[798,841]],turns: [3],end: "hane",hook: [5.642752293578042,-60.84908256880715],weight: 0.85},
    ],
    parts: {strokes: [0,1,2,3,4,5],children: [{position: "top",strokes: [0,1,2,3],children: []},{element: "儿",position: "bottom",strokes: [4,5],children: [{element: "丿",strokes: [4],children: []}]}]},
    // The 3rd stroke joins into the 4th (no lift at its end), so its end sits on the 4th's centreline; the 5th starts on the 4th.
    moved: [{ stroke: 2, point: 1 }, { stroke: 4, point: 0 }],
  },
  "学": {
    char: "学", source: "kanjivg", reviewed: { file: "05b66", svgHash: "3cfe2188", svgLength: 3238 },
    strokes: [
      {kind: "dot",points: [[304,161],[353,232]],weight: 0.75},
      {kind: "dot",points: [[456,111],[489,195]],weight: 0.75},
      {kind: "left-sweep",points: [[659,116],[594,245]],weight: 0.7},
      {kind: "dot",points: [[240,315],[217,434]],weight: 0.78},
      {kind: "turn",points: [[257,339],[744,279],[765,288],[765,305]],turns: [2],end: "hane",hook: [-46.85779816513764,55.080275229357824],weight: 0.9},
      {kind: "turn",points: [[366,466],[576,428],[606,472]],turns: [1],end: "hane",hook: [-100,40],weight: 0.8,haneScale: 1.7},
      {kind: "curve",points: [[506.76,515.19],[540.76,662.19],[529.76,802.19],[513.76,850.19],[497.76,864.19],[470.76,855.19]],end: "hane",hook: [-32.14678899082571,-37.17431192660558],weight: 1.05,joinStart: true},
      {kind: "horizontal",points: [[253,656],[595,607],[777,609]],weight: 0.95},
    ],
    parts: {strokes: [0,1,2,3,4,5,6,7],children: [{position: "top",strokes: [0,1,2,3,4],children: [{element: "⺍",strokes: [0,1,2],children: []},{element: "冖",strokes: [3,4],children: []}]},{element: "子",position: "bottom",strokes: [5,6,7],children: []}]},
    // The 6th stroke's hane and the 7th stroke's start move a little right and down (review of the 学 writing).
    moved: [{ stroke: 5, point: 2 }, ...[0, 1, 2, 3, 4, 5].map(point => ({ stroke: 6, point }))],
    // The 6th stroke's hane ends at the centre of the ink (about 506, 494), lower than before (hook [-100,40], haneScale 1.7).
    // The 7th stroke is v1's shape (KanjiVG's own points, weight 1.05), moved as a whole by (+0.18, +9.70), so its start
    // (506.76, 515.19) is exactly the tip of the 6th stroke's hane (the planner's last contact of that stroke). If the 6th
    // stroke changes, both the hane and this start must be recomputed from the planner.
  },
  "毎": {
    char: "毎", source: "kanjivg", reviewed: { file: "06bce", svgHash: "6271f1fc", svgLength: 3162 },
    strokes: [
      {kind: "left-sweep",points: [[415,133],[356,254],[262,374]],weight: 0.8},
      {kind: "horizontal",points: [[374,220],[676,171]],weight: 0.82,joinStart: true},
      {kind: "turn",points: [[410,415],[361,568],[298,703],[301,721],[582,762],[666,792],[735,836]],turns: [3],end: "tome",weight: 0.95,press: [1,1,0.7,0.4,0.6,1,1]},
      {kind: "turn",points: [[406,389],[652,355],[674,361],[690,384],[669,597],[630,794],[589,892],[567,887]],turns: [6],end: "hane",hook: [-27.717889908256893,-35.66513761467877],weight: 0.95,joinStart: true},
      {kind: "vertical",points: [[537,371],[526,490],[464,718]],weight: 0.85,joinStart: true,joinEnd: true},
      {kind: "horizontal",points: [[171,574],[830,538]],weight: 0.9},
    ],
    parts: {strokes: [0,1,2,3,4,5],children: [{element: "𠂉",position: "top",strokes: [0,1],children: [{element: "丿",strokes: [0],children: []}]},{element: "毋",position: "bottom",strokes: [2,3,4,5],children: []}]},
  },
};
