/**
 * Page-curl core: pure, renderer-free maths for a bound leaf turning around a
 * fixed spine. Everything here is a function of its inputs (no clock, no DOM,
 * no Three.js), so a WebGL mesh, a 2.5D CSS strip renderer and tests all agree
 * on the same paper.
 *
 * Model. Book space: x across the spread (spine at x = 0, the start side of a
 * turn at +x), y up from the desk, z down the page (head at −H/2). A leaf is an
 * inextensible strip: each row is integrated from the spine by arc length, so
 * paper never stretches. Its tangent angle blends from the resting gutter
 * curve on the start side to the mirrored curve on the far side. The blend is
 * uniform near the spine and bends towards the fore edge, from `bendStart`
 * outwards; moving `bendStart` changes the bend radius through the turn. A
 * positive deflection makes the fore edge lead (the corner peel), a negative
 * one makes it trail (air drag); `corner` tilts the bend line so the lower outer
 * corner lifts first.
 */

export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (a: number, b: number, n: number) => { const t = clamp01((n - a) / (b - a)); return t * t * (3 - 2 * t); };
const smoother = (n: number) => { const t = clamp01(n); return t * t * t * (t * (t * 6 - 15) + 10); };
/** Smooth hump: 0 at a, 1 at m, 0 at b. */
const hump = (n: number, a: number, m: number, b: number) => n <= a || n >= b ? 0 : n < m ? smoother((n - a) / (m - a)) : smoother((b - n) / (b - m));
/** Soft clamp to 0..1 so a curl never shows a crease where it meets the stops. */
const softMax0 = (n: number, k: number) => (n + Math.sqrt(n * n + k * k)) / 2 - k / 2;
const softUnit = (n: number, k = .03) => Math.max(0, Math.min(1, 1 - softMax0(1 - softMax0(n, k), k)));

/** Physical book in page-width units (page width = 1). */
export interface BookShape {
  /** Page height / page width. */
  aspect: number;
  /** Page-block thickness per side. */
  block: number;
  /** Cover-board thickness. */
  board: number;
  /** Leaf thickness. */
  leaf: number;
  /** Board overhang beyond the pages. */
  squares: number;
  /** Fraction of the page width over which the gutter curve rises. */
  gutterReach: number;
  /** How much of the block thickness the gutter dips at the spine, 0..1. */
  gutterDip: number;
}
/** Converts millimetre book dimensions to page-width units. */
export function bookShape(mm: { pageWidth?: number; pageHeight?: number; blockThickness?: number; boardThickness?: number; leaf?: number } = {}): BookShape {
  const w = mm.pageWidth ?? 190, u = (n: number) => n / w;
  return { aspect: (mm.pageHeight ?? 262) / w, block: u(mm.blockThickness ?? 14), board: u(mm.boardThickness ?? 2.8),
    leaf: u(mm.leaf ?? .22), squares: u(3.2), gutterReach: .3, gutterDip: .72 };
}
/** Height of the top of the page block above the board, where it is flat. */
export const blockTop = (shape: BookShape) => shape.board + shape.block;
/** Resting tangent angle of the top leaf at arc fraction σ, on the start side (radians, rising from the spine). */
export function restAngle(shape: BookShape, sigma: number): number {
  const g = shape.gutterReach, a0 = 3 * shape.block * shape.gutterDip / g;
  return sigma >= g ? 0 : a0 * (1 - sigma / g) ** 2;
}
/** Hinge where every leaf meets the spine: x = 0, y below the flat top by the gutter dip. */
export const hingeHeight = (shape: BookShape) => blockTop(shape) - shape.block * shape.gutterDip;

/** Shape of a turning leaf at one instant. */
export interface LeafBend {
  /** 0 resting on the start side, 1 resting on the far side. */
  turn: number;
  /** Fore-edge lead (+) or lag (−), in turn fractions. */
  deflection: number;
  /** Arc fraction where bending begins, 0..1. */
  bendStart: number;
  /** Lower-outer-corner lead, 0..1. */
  corner: number;
}
export const flatLeaf: LeafBend = { turn: 0, deflection: 0, bendStart: .5, corner: 0 };

/**
 * Bend of a leaf `p` (0..1) through its turn. Peel (the corner lifts and the
 * fore edge leads with a tight radius), flip (the spine side rotates over while
 * the fore edge trails in a wide C), then landing with one damped hop.
 * `stiffness` 0..1 shortens the peel and lag and widens the bend.
 */
export function leafBendAt(p: number, stiffness = .45): LeafBend {
  const s = clamp01(stiffness), t = clamp01(p);
  const turn = .08 * smooth(0, .2, t) + .92 * smoother((t - .14) / .66);
  const peel = .34 * (1 - .55 * s), lag = .3 * (1 - .65 * s);
  // Landing hop: the fore edge touches down after the spine side and lifts once.
  const hop = .07 * (1 - .5 * s) * hump(t, .8, .87, 1);
  const deflection = peel * hump(t, 0, .13, .4) - lag * hump(t, .3, .6, .86) - hop;
  const bendStart = .58 - .48 * smooth(.08, .5, t) + .3 * s * (1 - smooth(.08, .5, t)) * .5;
  const corner = .7 * (1 - smooth(.12, .45, t)) * (1 - .4 * s);
  return { turn, deflection, bendStart: Math.max(.04, Math.min(.85, bendStart)), corner };
}

/**
 * Integrates one row of a leaf. Writes `segments + 1` cross-section points
 * (x, y) and tangent angles. `row` is 0 at the head and 1 at the tail.
 */
export function leafRow(shape: BookShape, bend: LeafBend, row: number, segments: number,
  out: { x: Float32Array | number[]; y: Float32Array | number[]; angle: Float32Array | number[] }): void {
  const ds = 1 / segments, lift = shape.leaf * 1.5;
  const cornerBias = 2 * row - 1;
  const d = bend.deflection * (1 + bend.corner * cornerBias);
  const c = Math.max(.02, Math.min(.95, bend.bendStart - bend.corner * .22 * cornerBias));
  let x = 0, y = hingeHeight(shape) + lift;
  out.x[0] = x; out.y[0] = y;
  for (let i = 0; i < segments; i++) {
    const sigma = (i + .5) * ds;
    const b = sigma <= c ? 0 : ((sigma - c) / (1 - c)) ** 2;
    const theta = softUnit(bend.turn + d * b);
    const rest = restAngle(shape, sigma);
    const phi = rest + (Math.PI - 2 * rest) * theta;
    out.angle[i] = phi;
    x += ds * Math.cos(phi); y += ds * Math.sin(phi);
    out.x[i + 1] = x; out.y[i + 1] = y;
  }
  out.angle[segments] = out.angle[segments - 1];
}
/** Top-of-block cross-section on the start side (the resting leaf), same sampling as `leafRow`. */
export function restRow(shape: BookShape, segments: number, out: { x: Float32Array | number[]; y: Float32Array | number[]; angle: Float32Array | number[] }): void {
  leafRow({ ...shape, leaf: 0 }, flatLeaf, .5, segments, out);
}

/** Sheet geometry for a leaf: top (front face) and underside (back face) plus the paper edge. */
export interface LeafSurface {
  /** Columns along the page width and rows down the page. */
  columns: number; rows: number;
  /** Top sheet: xyz, normals and uv per vertex, (columns + 1) × (rows + 1). */
  position: Float32Array; normal: Float32Array; uv: Float32Array;
  /** Underside: offset by the leaf thickness, normals reversed, uv mirrored for the facing page. */
  backPosition: Float32Array; backNormal: Float32Array; backUv: Float32Array;
}
export function createLeafSurface(columns = 64, rows = 24): LeafSurface {
  const n = (columns + 1) * (rows + 1);
  return { columns, rows, position: new Float32Array(n * 3), normal: new Float32Array(n * 3), uv: new Float32Array(n * 2),
    backPosition: new Float32Array(n * 3), backNormal: new Float32Array(n * 3), backUv: new Float32Array(n * 2) };
}
/**
 * Fills a leaf surface for `bend`. `side` is +1 when the leaf starts on the +x
 * side (left-to-right books) and −1 when it starts on −x. Normals come from the
 * deformed surface itself (central differences along the page height and the
 * analytic tangent across it), not from the flat sheet.
 */
export function deformLeaf(surface: LeafSurface, shape: BookShape, bend: LeafBend, side: 1 | -1 = 1): LeafSurface {
  const { columns: nc, rows: nr } = surface, h = shape.aspect;
  const xs = new Float32Array(nc + 1), ys = new Float32Array(nc + 1), as = new Float32Array(nc + 1);
  const P = surface.position, N = surface.normal;
  for (let j = 0; j <= nr; j++) {
    const v = j / nr;
    leafRow(shape, bend, v, nc, { x: xs, y: ys, angle: as });
    for (let i = 0; i <= nc; i++) {
      const k = j * (nc + 1) + i;
      P[k * 3] = side * xs[i]; P[k * 3 + 1] = ys[i]; P[k * 3 + 2] = (v - .5) * h;
      const u = i / nc;
      surface.uv[k * 2] = side > 0 ? u : 1 - u; surface.uv[k * 2 + 1] = 1 - v;
      surface.backUv[k * 2] = side > 0 ? 1 - u : u; surface.backUv[k * 2 + 1] = 1 - v;
    }
  }
  for (let j = 0; j <= nr; j++) for (let i = 0; i <= nc; i++) {
    const k = j * (nc + 1) + i;
    const a = Math.min(i, nc - 1);
    // Tangent across the page from the integrated angle; along it by central difference.
    const prev = Math.max(0, i - 1), next = Math.min(nc, i + 1);
    let tx = P[(j * (nc + 1) + next) * 3] - P[(j * (nc + 1) + prev) * 3];
    let ty = P[(j * (nc + 1) + next) * 3 + 1] - P[(j * (nc + 1) + prev) * 3 + 1];
    let tz = P[(j * (nc + 1) + next) * 3 + 2] - P[(j * (nc + 1) + prev) * 3 + 2];
    if (tx * tx + ty * ty + tz * tz < 1e-12) { tx = side * Math.cos(as[a]); ty = Math.sin(as[a]); tz = 0; }
    const up = Math.max(0, j - 1), dn = Math.min(nr, j + 1);
    const vx = P[(dn * (nc + 1) + i) * 3] - P[(up * (nc + 1) + i) * 3];
    const vy = P[(dn * (nc + 1) + i) * 3 + 1] - P[(up * (nc + 1) + i) * 3 + 1];
    const vz = P[(dn * (nc + 1) + i) * 3 + 2] - P[(up * (nc + 1) + i) * 3 + 2];
    // n = side · (v × t): +y for a resting leaf on either side.
    let nx = vy * tz - vz * ty, ny = vz * tx - vx * tz, nz = vx * ty - vy * tx;
    const l = Math.hypot(nx, ny, nz) || 1; nx *= side / l; ny *= side / l; nz *= side / l;
    N[k * 3] = nx; N[k * 3 + 1] = ny; N[k * 3 + 2] = nz;
    surface.backPosition[k * 3] = P[k * 3] - nx * shape.leaf;
    surface.backPosition[k * 3 + 1] = P[k * 3 + 1] - ny * shape.leaf;
    surface.backPosition[k * 3 + 2] = P[k * 3 + 2] - nz * shape.leaf;
    surface.backNormal[k * 3] = -nx; surface.backNormal[k * 3 + 1] = -ny; surface.backNormal[k * 3 + 2] = -nz;
  }
  return surface;
}
/** Triangle indices for a grid sheet; `flip` reverses the winding (undersides, mirrored books). */
export function sheetIndex(columns: number, rows: number, flip: boolean): Uint32Array {
  const out = new Uint32Array(columns * rows * 6); let o = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const a = j * (columns + 1) + i, b = a + 1, c = a + columns + 1, d = c + 1;
    if (!flip) out.set([a, c, b, b, c, d], o); else out.set([a, b, c, b, d, c], o);
    o += 6;
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Timing                                                                   */

export interface TurnCue { at: number; frames: number }
/** Default pacing: an establishing share, then turns evenly placed so each spread gets equal reading time. */
export function turnSchedule(spreads: number, durationFrames: number, cues?: { at: number; frames?: number }[], establish?: number): TurnCue[] {
  if (cues) return cues.map(c => ({ at: c.at, frames: c.frames ?? 44 }));
  const e = establish ?? Math.round(durationFrames * .15), len = 44, out: TurnCue[] = [];
  for (let k = 0; k < spreads - 1; k++) out.push({ at: Math.round(e + (durationFrames - e) * (k + 1) / spreads - len / 2), frames: len });
  return out;
}
/** Where the book is at a frame: the spread on show, and the leaf in flight (if any). */
export interface BookMoment {
  /** Spread fully shown when no leaf is moving; the spread being left during a turn. */
  spread: number;
  /** Index of the turn in flight, or −1. */
  turning: number;
  /** Turn progress 0..1 (0 when idle). */
  progress: number;
  /** Frames since the last turn landed (Infinity before the first). */
  sinceLanding: number;
}
export function bookMoment(frame: number, schedule: readonly TurnCue[], reduced = false): BookMoment {
  let spread = 0, sinceLanding = Infinity;
  for (let k = 0; k < schedule.length; k++) {
    const { at, frames } = schedule[k];
    if (frame < at) break;
    if (reduced) {
      // Reduced motion cuts at the middle of the turn instead of animating it.
      if (frame >= at + frames / 2) { spread = k + 1; sinceLanding = frame - (at + frames / 2); }
      continue;
    }
    if (frame < at + frames) return { spread: k, turning: k, progress: (frame - at) / frames, sinceLanding };
    spread = k + 1; sinceLanding = frame - (at + frames);
  }
  return { spread, turning: -1, progress: 0, sinceLanding };
}

/* ------------------------------------------------------------------------ */
/* Camera                                                                   */

/** Orbit camera around a target on the book. Angles in degrees, distance in page widths. */
export interface BookCamera { target: [number, number, number]; yaw: number; pitch: number; distance: number; fov: number }
export function cameraEye(c: BookCamera): [number, number, number] {
  const y = c.yaw * Math.PI / 180, p = c.pitch * Math.PI / 180;
  return [c.target[0] + Math.sin(y) * Math.cos(p) * c.distance, c.target[1] + Math.sin(p) * c.distance,
    c.target[2] + Math.cos(y) * Math.cos(p) * c.distance];
}
/** Distance at which a box `width` × `depth` lying on the desk fills the frame, seen at `pitch`. */
export function fitDistance(width: number, depth: number, aspect: number, fov: number, pitch: number): number {
  const half = Math.tan(fov * Math.PI / 360);
  const foreshortened = depth * Math.sin(pitch * Math.PI / 180) + .12 * Math.cos(pitch * Math.PI / 180);
  return Math.max(width / 2 / (half * aspect), foreshortened / 2 / half);
}
export const lerpCamera = (a: BookCamera, b: BookCamera, t: number): BookCamera => ({
  target: [a.target[0] + (b.target[0] - a.target[0]) * t, a.target[1] + (b.target[1] - a.target[1]) * t, a.target[2] + (b.target[2] - a.target[2]) * t],
  yaw: a.yaw + (b.yaw - a.yaw) * t, pitch: a.pitch + (b.pitch - a.pitch) * t,
  // Distance blends geometrically so a push-in keeps a constant perceived speed.
  distance: a.distance * Math.pow(b.distance / a.distance, t), fov: a.fov + (b.fov - a.fov) * t,
});
/** A camera key: hold `shot` from `at`; moves between keys take `move` frames and end on the key. */
export interface CameraKey { at: number; shot: BookCamera; move: number }
/**
 * Camera at a frame: holds each key, eases into the next over its `move`
 * frames (smootherstep, zero velocity at both ends), and drifts slowly while
 * holding so a still page is never a freeze-frame. Pure: no history.
 */
export function cameraAt(frame: number, keys: readonly CameraKey[], drift = .035): BookCamera {
  let cam = keys[0].shot;
  for (let k = 1; k < keys.length; k++) {
    const { at, move, shot } = keys[k];
    const start = at - move;
    if (frame <= start) break;
    cam = lerpCamera(cam, shot, smoother((frame - start) / Math.max(1, move)));
  }
  // Slow dolly-in across the whole piece, a few percent, never reversing.
  const total = keys[keys.length - 1].at + 1;
  return { ...cam, distance: cam.distance * (1 - drift * clamp01(frame / Math.max(1, total))) };
}

/** Everything a book renderer needs for one frame: which faces lie on each block, the leaf in flight and the camera. */
export interface BookFrameState {
  /** Face index shown on the left and right blocks. */
  left: number; right: number;
  /** Leaf in flight, if any, with the faces printed on its two sides. */
  leaf?: { front: number; back: number; bend: LeafBend };
  camera: BookCamera; aspect: number;
}
/**
 * Faces on the book at a moment. Faces are numbered spread by spread, left
 * then right (spread k: 2k and 2k + 1). `side` +1 turns leaves from right to
 * left (left-to-right reading); −1 turns them from left to right.
 */
export function bookFaces(m: BookMoment, side: 1 | -1, stiffness: number): Pick<BookFrameState, "left" | "right" | "leaf"> {
  const k = m.turning;
  if (k < 0) return { left: 2 * m.spread, right: 2 * m.spread + 1 };
  const bend = leafBendAt(m.progress, stiffness);
  return side > 0
    ? { left: 2 * k, right: 2 * (k + 1) + 1, leaf: { front: 2 * k + 1, back: 2 * (k + 1), bend } }
    : { left: 2 * (k + 1), right: 2 * k + 1, leaf: { front: 2 * k, back: 2 * (k + 1) + 1, bend } };
}
