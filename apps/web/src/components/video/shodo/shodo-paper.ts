/**
 * SHO1 paper: washi formation, kozo fibres and a printed practice grid, as RGBA.
 *
 * The grid is printed INTO the paper (vermilion ink absorbed unevenly by the fibres),
 * so brush ink covers it. The default `kentei` sheet is a barely visible xy mesh with
 * slightly stronger cell lines and centre marks, after gridded practice hanshi.
 */
import { inkHash } from "../ink-brush";
import { shodoFibreField } from "./shodo-ink";
import { shodoNoise, shodoRgb } from "./shodo-style";
import type { ShodoPaper } from "./shodo-style";

export interface ShodoGridLines {
  /** Line colour, #RRGGBB. */
  color: string;
  /** Peak opacity of the printed line, 0..1. */
  opacity: number;
  /** Line width in design px. */
  width: number;
}

export interface ShodoSheet {
  /** Fine xy mesh (方眼); `pitch` is in design px. */
  mesh?: ShodoGridLines & { pitch: number };
  /** Character cells: equal columns × rows inside the inset rectangle. */
  cells?: ShodoGridLines & {
    columns: number;
    rows: number;
    /** Inset of the cell block from the paper edge, design px: [left, top, right, bottom]. */
    inset: readonly [number, number, number, number];
    /** Dotted half lines through each cell. */
    halfLines: boolean;
    /** Small circle at each cell centre. */
    centreMarks: boolean;
  };
}

/** Faint vermilion kentei-style practice sheet for a paper of the given size. */
export function kenteiSheet(width: number, height: number, columns = 1, rows = 1): ShodoSheet {
  const m = Math.min(width, height);
  return {
    // A coarse mesh like gridded practice hanshi: about 30 mm on a 242 mm sheet.
    mesh: { pitch: m / 8, color: "#D9583A", opacity: .1, width: .8 },
    cells: {
      columns, rows, inset: [m * .07, m * .07, m * .07, m * .07], halfLines: true, centreMarks: true,
      color: "#D24A2E", opacity: .22, width: 1,
    },
  };
}

export interface ShodoPaperImage { width: number; height: number; rgba: Uint8ClampedArray<ArrayBuffer> }

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Paper texture at `scale` raster px per design px. */
export function renderShodoPaper(
  width: number, height: number, scale: number, paper: ShodoPaper, sheet: ShodoSheet | null, seed: number,
): ShodoPaperImage {
  const W = Math.max(1, Math.round(width * scale)), H = Math.max(1, Math.round(height * scale));
  const { fibre, tooth } = shodoFibreField(W, H, seed + 401, paper.fibre);
  const [r0, g0, b0] = shodoRgb(paper.color);
  const rgba = new Uint8ClampedArray(W * H * 4);
  // Print coverage of the grid, accumulated as ink alpha per pixel.
  const print = new Float32Array(W * H);
  const line = (vertical: boolean, at: number, from: number, to: number, alpha: number, lw: number, dotted: boolean) => {
    const pos = at * scale, half = Math.max(.5, lw * scale / 2);
    const a0 = Math.floor(pos - half - 1), a1 = Math.ceil(pos + half + 1);
    const s0 = Math.max(0, Math.floor(from * scale)), s1 = Math.min(vertical ? H - 1 : W - 1, Math.ceil(to * scale));
    for (let a = a0; a <= a1; a++) {
      if (a < 0 || a >= (vertical ? W : H)) continue;
      const cov = clamp(half + .5 - Math.abs(a + .5 - pos), 0, 1);
      if (cov <= 0) continue;
      for (let s = s0; s <= s1; s++) {
        if (dotted && (s % Math.max(3, Math.round(6 * scale))) >= Math.max(1, Math.round(2.5 * scale))) continue;
        const i = vertical ? s * W + a : a * W + s;
        // Uneven take-up of the printing ink along the line and on fibres.
        const take = .72 + .28 * shodoNoise(seed + 77, s / 7, a * .3) + .18 * (fibre[i] - .3);
        print[i] = Math.max(print[i], alpha * cov * clamp(take, .4, 1.1));
      }
    }
  };
  let gridColor = "#D9583A";
  if (sheet?.mesh && sheet.mesh.pitch >= 3) {
    const m = sheet.mesh;
    gridColor = m.color;
    for (let x = m.pitch; x < width; x += m.pitch) line(true, x, 0, height, m.opacity, m.width, false);
    for (let y = m.pitch; y < height; y += m.pitch) line(false, y, 0, width, m.opacity, m.width, false);
  }
  const cells = sheet?.cells;
  if (cells && cells.columns >= 1 && cells.rows >= 1) {
    gridColor = cells.color;
    const [l, t, r, b] = cells.inset;
    const cw = (width - l - r) / cells.columns, ch = (height - t - b) / cells.rows;
    for (let c = 0; c <= cells.columns; c++) line(true, l + c * cw, t, height - b, cells.opacity, cells.width, false);
    for (let k = 0; k <= cells.rows; k++) line(false, t + k * ch, l, width - r, cells.opacity, cells.width, false);
    if (cells.halfLines) {
      for (let c = 0; c < cells.columns; c++) line(true, l + (c + .5) * cw, t, height - b, cells.opacity * .55, cells.width * .8, true);
      for (let k = 0; k < cells.rows; k++) line(false, t + (k + .5) * ch, l, width - r, cells.opacity * .55, cells.width * .8, true);
    }
    if (cells.centreMarks) {
      const rad = Math.min(cw, ch) * .018 * scale, lw = cells.width * scale * .8;
      for (let c = 0; c < cells.columns; c++) for (let k = 0; k < cells.rows; k++) {
        const cx = (l + (c + .5) * cw) * scale, cy = (t + (k + .5) * ch) * scale;
        for (let y = Math.floor(cy - rad - 2); y <= cy + rad + 2; y++) for (let x = Math.floor(cx - rad - 2); x <= cx + rad + 2; x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const d = Math.abs(Math.hypot(x + .5 - cx, y + .5 - cy) - rad);
          const cov = clamp(lw / 2 + .5 - d, 0, 1);
          if (cov > 0) print[y * W + x] = Math.max(print[y * W + x], cells.opacity * 1.2 * cov);
        }
      }
    }
  }
  const [pr, pg, pb] = shodoRgb(gridColor);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    // Washi formation: cloudy density, fibres catching light, a fine grain.
    const cloud = shodoNoise(seed + 13, x / (34 * scale), y / (34 * scale)) - .5;
    const cloud2 = shodoNoise(seed + 17, x / (9 * scale), y / (11 * scale)) - .5;
    const f = fibre[i], grain = tooth[i] - .5;
    let v = 1 + cloud * .028 + cloud2 * .016 + grain * .03 * (.4 + paper.tooth) + (f - .2) * .045 * paper.fibre;
    if (inkHash(seed + 31, x, y) > .99985) v -= .25; // rare bark speck
    let r = r0 * v, g = g0 * v, b = b0 * (v + (f - .2) * .01);
    const p = print[i];
    if (p > 0) { r += (pr - r) * p; g += (pg - g) * p; b += (pb - b) * p; }
    const o = i * 4;
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
  }
  return { width: W, height: H, rgba };
}
