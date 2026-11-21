/**
 * SHO1 ink: deposits the planned brush contacts into a paper raster.
 *
 * - The contact patch is a teardrop (sharp tip, round belly) oriented by the hair's tip
 *   direction, sized by press. Its edge follows a fixed paper-fibre field, so edges are
 *   fibrous, not blurred.
 * - Ink transfer is time-weighted: a pause deposits more pigment and water, so entry
 *   presses, 転折 shoulders and 止め ends pool, bleed and stay glossy longest.
 * - Kasure (かすれ): bristle lanes across the motion carry their own ink. When the brush
 *   empties or moves fast, dry lanes stop depositing and leave white channels along
 *   the stroke. Edges dry first.
 * - Nijimi (にじみ): water spreads from each stroke after contact, gated by the fibre
 *   field and the paper's absorbency, and keeps a faint front line.
 * - Colour strength decays with the ink left in the brush; dilute ink (淡墨) shifts to
 *   the ink's dilute hue.
 *
 * Deterministic: every pixel is a function of the plan and the time. Completed strokes
 * are cached; seeking in any order returns the same image.
 */
import { inkHash as shodoHash } from "../ink-brush";
import { shodoNoise, shodoRgb } from "./shodo-style";
import { SHODO_TIP_SHARE, shodoContactTipPower } from "./shodo-hand";
import type { ShodoPlan, ShodoPlannedStroke } from "./shodo-hand";

export interface ShodoInkRegion {
  /** Paper rectangle in design px that the raster covers. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Raster pixels per design pixel, 0.25..3. */
  scale: number;
}

export interface ShodoInkFrame {
  width: number;
  height: number;
  /** Straight (non-premultiplied) RGBA of the ink alone, to composite over the paper. */
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smoothstep = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const SAT = .011;

interface StrokeField {
  x0: number; y0: number; w: number; h: number;
  P: Float32Array;   // pigment (coverage-seconds / SAT)
  Q: Float32Array;   // pigment × tone, for colour-strength decay
  W: Float32Array;   // water
  T0: Float32Array;  // first contact time (s)
  T1: Float32Array;  // last contact time (s)
  wetUntil: number;  // time after which the bleed no longer changes
  t0: number; t1: number;
  halo: Float32Array | null; // cached final bleed pigment
}

/** A stroke tile being built: the samples before `next` are stamped. */
interface FieldBuild { field: StrokeField; next: number }

/** Paper fibre field: long kozo fibres plus fine tooth, raster sized, deterministic. */
export function shodoFibreField(width: number, height: number, seed: number, density: number): { fibre: Float32Array; tooth: Float32Array } {
  const fibre = new Float32Array(width * height), tooth = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    tooth[i] = .55 * shodoHash(seed + 3, x, y) + .45 * shodoNoise(seed + 5, x / 2.3, y / 2.3);
    fibre[i] = .25 * shodoNoise(seed + 7, x / 9, y / 13);
  }
  const count = Math.round(width * height / 260 * (.3 + density));
  for (let n = 0; n < count; n++) {
    let x = shodoHash(seed, n, 11) * width, y = shodoHash(seed, n, 13) * height;
    let a = shodoHash(seed, n, 17) * Math.PI * 2;
    const len = 10 + 55 * Math.pow(shodoHash(seed, n, 19), 2);
    const bend = (shodoHash(seed, n, 23) - .5) * .09, strength = .35 + .65 * shodoHash(seed, n, 29);
    for (let s = 0; s < len; s++) {
      const ix = x | 0, iy = y | 0;
      if (ix >= 0 && iy >= 0 && ix < width && iy < height) {
        const i = iy * width + ix;
        fibre[i] = Math.min(1, fibre[i] + strength * (1 - .4 * Math.abs(s / len - .5)));
      }
      x += Math.cos(a) * .9; y += Math.sin(a) * .9; a += bend;
    }
  }
  return { fibre, tooth };
}

/** Separable box blur, in place, mass-preserving at the interior. */
function boxBlur(src: Float32Array, w: number, h: number, r: number, tmp: Float32Array): void {
  if (r < 1) return;
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * inv;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      src[y * w + x] = acc * inv;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
}

export class ShodoInkSurface {
  readonly width: number;
  readonly height: number;
  private readonly fields: (StrokeField | null)[];
  private readonly building: (FieldBuild | null)[];
  private readonly fibre: Float32Array;
  private readonly tooth: Float32Array;
  /** Optical density, Σ k·P (k from each stroke's ink strength). */
  private readonly frameP: Float32Array;
  /** Density-weighted tone, dense colour and dilute colour, for mixing inks. */
  private readonly frameQ: Float32Array;
  private readonly frameC: Float32Array;
  private readonly frameWet: Float32Array;
  private readonly rgba: Uint8ClampedArray<ArrayBuffer>;
  private readonly bleedRadius: number;

  readonly plan: ShodoPlan;
  readonly region: ShodoInkRegion;

  // Plain fields, not parameter properties, so the file also compiles with `erasableSyntaxOnly`.
  constructor(plan: ShodoPlan, region: ShodoInkRegion) {
    this.plan = plan;
    this.region = region;
    if (!(region.scale >= .25 && region.scale <= 3)) throw new RangeError("Ink raster scale must be 0.25..3.");
    this.width = Math.max(1, Math.round(region.width * region.scale));
    this.height = Math.max(1, Math.round(region.height * region.scale));
    if (this.width * this.height > 6_000_000) throw new RangeError("Ink raster exceeds 6M cells; lower the scale.");
    const style = plan.style;
    const field = shodoFibreField(this.width, this.height, style.seed + 401, style.paper.fibre);
    this.fibre = field.fibre;
    this.tooth = field.tooth;
    const n = this.width * this.height;
    this.frameP = new Float32Array(n);
    this.frameQ = new Float32Array(n);
    this.frameC = new Float32Array(n * 6);
    this.frameWet = new Float32Array(n);
    this.rgba = new Uint8ClampedArray(n * 4);
    this.fields = plan.strokes.map(() => null);
    this.building = plan.strokes.map(() => null);
    this.bleedRadius = Math.max(0, plan.brush.diameter * region.scale * (.035 + .3 * style.paper.absorbency));
  }

  /** Stamp one planned stroke into its own raster tile. */
  private build(index: number): StrokeField {
    return this.fields[index] ?? this.advance(index, Infinity) as StrokeField;
  }

  /**
   * Build stroke tiles ahead of time, in stroke order, until `deadline` (a performance.now()
   * time in ms): a player calls this while idle, so no frame waits for a whole stroke to be
   * stamped. A tile resumes where the last call stopped and ends the same as one built in one
   * go. Returns true when every tile is built.
   */
  prepare(deadline: number): boolean {
    for (let i = 0; i < this.plan.strokes.length; i++) {
      if (!this.fields[i] && !this.advance(i, deadline)) return false;
    }
    return true;
  }

  /** The empty tile of one stroke, sized to its bounds plus room for the bleed. */
  private begin(index: number): FieldBuild {
    const stroke: ShodoPlannedStroke = this.plan.strokes[index];
    const s = this.region.scale, ox = this.region.x, oy = this.region.y;
    const pad = Math.ceil(this.bleedRadius * 2.4 + 4);
    const x0 = clamp(Math.floor((stroke.bounds[0] - ox) * s) - pad, 0, this.width - 1);
    const y0 = clamp(Math.floor((stroke.bounds[1] - oy) * s) - pad, 0, this.height - 1);
    const x1 = clamp(Math.ceil((stroke.bounds[2] - ox) * s) + pad, 0, this.width - 1);
    const y1 = clamp(Math.ceil((stroke.bounds[3] - oy) * s) + pad, 0, this.height - 1);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const bleedTau = .3 + .7 * this.plan.style.paper.absorbency;
    return { next: 1, field: {
      x0, y0, w, h, P: new Float32Array(w * h), Q: new Float32Array(w * h), W: new Float32Array(w * h),
      T0: new Float32Array(w * h).fill(Infinity), T1: new Float32Array(w * h).fill(-Infinity),
      t0: stroke.t0, t1: stroke.t1, wetUntil: stroke.t1 + bleedTau * 5, halo: null,
    } };
  }

  /** Stamp a stroke's samples into its tile until `deadline`; the tile when done, else null. */
  private advance(index: number, deadline: number): StrokeField | null {
    const job = this.building[index] ?? (this.building[index] = this.begin(index));
    const stroke: ShodoPlannedStroke = this.plan.strokes[index];
    const { style } = this.plan;
    const s = this.region.scale, ox = this.region.x, oy = this.region.y;
    const { x0, y0, w, h, P, Q, W, T0, T1 } = job.field;
    const samples = stroke.samples;
    const bristles = style.brush.bristles;
    const seed = style.seed + index * 7919;
    const strokeInk = stroke.ink;
    const waterBase = .75 + .25 * strokeInk.water;
    const rough = .07 + .1 * style.paper.fibre;
    const fade = strokeInk.fade;
    const D = this.plan.brush.diameter;
    const refSpeed = D * 14;
    const fibre = this.fibre, tooth = this.tooth, W0 = this.width;

    for (let i = job.next; i < samples.length; i++) {
      // Every eighth sample, stop at the deadline (at least one sample is stamped per call).
      if (i > job.next && (i - job.next) % 8 === 0 && performance.now() > deadline) { job.next = i; return null; }
      const A = samples[i - 1], B = samples[i];
      const dist = Math.hypot(B.x - A.x, B.y - A.y) * s;
      const n = Math.max(1, Math.ceil(dist / .7));
      const dtSub = (B.t - A.t) / n;
      for (let k = 0; k < n; k++) {
        const u = (k + .5) / n;
        const p = A.p + (B.p - A.p) * u;
        if (p <= .003) continue;
        const cx = ((A.x + (B.x - A.x) * u) - ox) * s, cy = ((A.y + (B.y - A.y) * u) - oy) * s;
        let tx = A.tx + (B.tx - A.tx) * u, ty = A.ty + (B.ty - A.ty) * u;
        const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
        const mx = A.vx || tx * -1, my = A.vy || ty * -1;
        const ml = Math.hypot(mx, my) || 1;
        const nx = -my / ml, ny = mx / ml;
        const width = (A.width + (B.width - A.width) * u) * s;
        const length = (A.length + (B.length - A.length) * u) * s;
        const ink = A.ink + (B.ink - A.ink) * u;
        const speed = A.speed + (B.speed - A.speed) * u;
        const t = A.t + (B.t - A.t) * u;
        const arc = A.arc + (B.arc - A.arc) * u;
        const half = width / 2;
        const tipA = SHODO_TIP_SHARE * length, bellyA = (SHODO_TIP_SHARE - 1) * length;
        const tipPow = shodoContactTipPower(p);
        const R = tipA + half + 2;
        // Ink transfer: wet brushes lay full pigment; speed and an empty brush starve lanes.
        // A loaded brush keeps its point wet even in a fast flick; an emptying one splits.
        const speedDry = clamp(speed / refSpeed - .55, 0, 1.6) * (1 - .72 * Math.sqrt(clamp(ink, 0, 1)));
        // A half-full brush still writes solid; kasure begins near a quarter load or at speed.
        const inkWet = Math.pow(clamp(ink / .55, 0, 1), .8);
        const wetness = clamp(inkWet * (1 - .42 * speedDry) * waterBase * (1.1 - .25 * style.brush.stiffness), 0, 1);
        const rate = dtSub / SAT * (.72 + .28 * clamp(wetness * 1.6, 0, 1));
        const tone = 1 - fade * Math.pow(1 - clamp(ink, 0, 1), 1.5) * .75;
        const baseDensity = 2.2 + 1.4 * wetness;
        const waterRate = dtSub / SAT * wetness * (.4 + p);
        const crossTip = Math.abs(length * (tx * nx + ty * ny));
        const halfAcross = .5 * crossTip + half + .5;
        const arcBucket = arc / Math.max(4, D * .9);
        const lanePhase = shodoHash(seed, 3, 5) * 10;
        const ix0 = Math.max(0, Math.floor(cx - R) - x0), ix1 = Math.min(w - 1, Math.ceil(cx + R) - x0);
        const iy0 = Math.max(0, Math.floor(cy - R) - y0), iy1 = Math.min(h - 1, Math.ceil(cy + R) - y0);
        for (let yy = iy0; yy <= iy1; yy++) {
          const qy = yy + y0 + .5 - cy;
          for (let xx = ix0; xx <= ix1; xx++) {
            const qx = xx + x0 + .5 - cx;
            const along = qx * tx + qy * ty;
            if (along > tipA + 1 || along < bellyA - half - 1) continue;
            const across = qx * -ty + qy * tx;
            const gi = (yy + y0) * W0 + xx + x0;
            const f = fibre[gi];
            let inside: number;
            if (along >= bellyA) {
              const uu = (tipA - along) / Math.max(1e-3, length);
              const hw = half * Math.pow(clamp(uu, 0, 1), tipPow) * (1 + rough * (f - .35));
              inside = hw - Math.abs(across);
            } else {
              const da = along - bellyA;
              inside = half * (1 + rough * (f - .35)) - Math.sqrt(da * da + across * across);
            }
            if (inside <= -.5) continue;
            const cov = inside >= .5 ? 1 : inside + .5;
            // Bristle lanes across the motion.
            const lane = (qx * nx + qy * ny) / halfAcross;
            const L = (lane + 1) * bristles * .5 + lanePhase;
            const hairInk = shodoNoise(seed, L, arcBucket);
            const edge = Math.abs(lane);
            const laneWet = wetness * (.48 + hairInk) - .45 * edge * edge * edge * (1 - wetness)
              + (tooth[gi] - .5) * style.paper.tooth * .32 * (1 - wetness);
            const M = laneWet >= .29 ? 1 : laneWet <= .23 ? 0 : smoothstep(.23, .29, laneWet);
            if (M <= 0) continue;
            const li = yy * w + xx;
            // Wet hair transfers ink on contact (fast flicks stay black); dwelling adds a pool.
            const prev = P[li];
            const next = Math.max(prev, cov * M * baseDensity * (.92 + .16 * hairInk)) + rate * cov * M * .5;
            P[li] = next;
            Q[li] += (next - prev) * tone;
            W[li] += waterRate * cov * M;
            if (t < T0[li]) T0[li] = t;
            if (t > T1[li]) T1[li] = t;
          }
        }
      }
    }
    this.fields[index] = job.field;
    this.building[index] = null;
    return job.field;
  }

  /** Bleed pigment of one stroke at time t, in its tile. */
  private bleed(field: StrokeField, t: number): Float32Array | null {
    const r = Math.round(this.bleedRadius);
    if (r < 1 || this.plan.style.paper.absorbency <= .01) return null;
    if (field.halo && t >= field.wetUntil) return field.halo;
    // A settled bleed is always computed at the same moment, so the cache never depends
    // on which frame asked first.
    if (t >= field.wetUntil) t = field.wetUntil;
    const { w, h, W, T0, T1, x0, y0 } = field;
    const tau = .3 + .7 * this.plan.style.paper.absorbency;
    const src = new Float32Array(w * h), tmp = new Float32Array(w * h);
    for (let i = 0; i < src.length; i++) {
      const a = T0[i];
      if (a === Infinity || t <= a) continue;
      const partial = T1[i] > a ? clamp((t - a) / (T1[i] - a), 0, 1) : 1;
      src[i] = W[i] * partial * (1 - Math.exp(-(t - a) / tau));
    }
    const grow = clamp((t - field.t0) / (tau * 2.5), .35, 1);
    const radius = Math.max(1, Math.round(r * grow));
    boxBlur(src, w, h, radius, tmp);
    boxBlur(src, w, h, Math.max(1, Math.round(radius * .6)), tmp);
    const fibre = this.fibre, W0 = this.width;
    const strength = this.plan.style.paper.absorbency;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const i = yy * w + xx, b = src[i];
      if (b <= 0) continue;
      const f = fibre[(yy + y0) * W0 + xx + x0];
      // Nijimi travels along fibres: dark tendrils where a fibre carries the water, and
      // only on very absorbent paper a soft general halo. Never a uniform blur.
      const reach = b / 9;
      const along = reach * (.15 + 1.6 * f);
      const tendril = smoothstep(.45, .85, along) * (.3 + .7 * f);
      const soft = strength * strength * smoothstep(.15, .8, reach) * .3;
      src[i] = tendril * .85 + soft;
    }
    if (t >= field.wetUntil) field.halo = src;
    return src;
  }

  /** Render the ink layer at an absolute time (seconds). */
  render(seconds: number, reducedMotion = false): ShodoInkFrame {
    const t = reducedMotion ? this.plan.duration + 30 : seconds;
    const { frameP, frameQ, frameC, frameWet, rgba } = this;
    frameP.fill(0); frameQ.fill(0); frameC.fill(0); frameWet.fill(0);
    const style = this.plan.style;
    const dry = style.paper.dryingSeconds;
    let bx0 = this.width, by0 = this.height, bx1 = -1, by1 = -1;
    let gloss = 0;
    for (let s = 0; s < this.plan.strokes.length; s++) {
      const stroke = this.plan.strokes[s];
      if (stroke.t0 > t) break;
      const field = this.build(s);
      const halo = this.bleed(field, t);
      const { w, h, x0, y0, P, Q, W, T0, T1 } = field;
      // Each ink has its own optical strength and colours; overlaps mix by density.
      const k = 1.15 * Math.pow(stroke.ink.strength, 1.6);
      const [cr, cg, cb] = shodoRgb(stroke.ink.color), [dr, dg, db] = shodoRgb(stroke.ink.diluteColor);
      gloss = Math.max(gloss, stroke.ink.gloss);
      bx0 = Math.min(bx0, x0); by0 = Math.min(by0, y0); bx1 = Math.max(bx1, x0 + w - 1); by1 = Math.max(by1, y0 + h - 1);
      for (let yy = 0; yy < h; yy++) {
        const row = (yy + y0) * this.width + x0;
        for (let xx = 0; xx < w; xx++) {
          const i = yy * w + xx, a = T0[i];
          const hp = halo ? halo[i] : 0;
          let pp = 0, tone = 1;
          if (a !== Infinity && t >= a) {
            pp = P[i] * (T1[i] > a ? clamp((t - a) / (T1[i] - a), 0, 1) : 1);
            tone = P[i] > 0 ? Q[i] / P[i] : 1;
            const age = t - T1[i];
            if (age < dry * 2.5) frameWet[row + xx] = Math.max(frameWet[row + xx], clamp(W[i] * .02, 0, 1) * Math.exp(-Math.max(0, age) / dry));
          }
          const d = k * (pp + hp);
          if (d <= 0) continue;
          const j = row + xx, c = j * 6;
          frameP[j] += d;
          frameQ[j] += k * (pp * tone + hp * .92 * tone);
          frameC[c] += d * cr; frameC[c + 1] += d * cg; frameC[c + 2] += d * cb;
          frameC[c + 3] += d * dr; frameC[c + 4] += d * dg; frameC[c + 5] += d * db;
        }
      }
    }
    rgba.fill(0);
    if (bx1 < 0) return { width: this.width, height: this.height, rgba };
    const W0 = this.width;
    for (let y = Math.max(1, by0); y <= Math.min(this.height - 2, by1); y++) {
      for (let x = Math.max(1, bx0); x <= Math.min(W0 - 2, bx1); x++) {
        const i = y * W0 + x, p = frameP[i];
        if (p <= 1e-4) continue;
        const tone = clamp(frameQ[i] / p, 0, 1), c = i * 6, inv = 1 / p;
        // Pigment absorbed in fibres: denser on fibre ridges in thin ink.
        const fib = .9 + .2 * this.fibre[i];
        const alpha = (1 - Math.exp(-p * fib)) * (.45 + .55 * tone);
        const body = Math.pow(clamp(alpha, 0, 1), .55);
        const dr = frameC[c + 3] * inv, dg = frameC[c + 4] * inv, db = frameC[c + 5] * inv;
        let r = dr + (frameC[c] * inv - dr) * body, g = dg + (frameC[c + 1] * inv - dg) * body, b = db + (frameC[c + 2] * inv - db) * body;
        // Wet ink: darker and glossy, with a meniscus highlight where the pool thickness changes.
        const wet = frameWet[i];
        if (wet > .01 || gloss > 0) {
          const hL = 1 - Math.exp(-frameP[i - 1] * .22), hR = 1 - Math.exp(-frameP[i + 1] * .22);
          const hU = 1 - Math.exp(-frameP[i - W0] * .22), hD = 1 - Math.exp(-frameP[i + W0] * .22);
          const gx = hR - hL, gy = hD - hU;
          const facing = clamp(-(gx * .6 + gy * .8) * 2.2, 0, 1);
          const spec = facing * facing * (wet * .55 + gloss * .12);
          r = r * (1 - .18 * wet) + 255 * spec; g = g * (1 - .18 * wet) + 255 * spec; b = b * (1 - .16 * wet) + 250 * spec;
        }
        const o = i * 4;
        rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b;
        rgba[o + 3] = clamp(alpha, 0, 1) * 255;
      }
    }
    return { width: this.width, height: this.height, rgba };
  }

  /** The finished pigment tile of one stroke (raster px), for measuring its shape. */
  strokeCoverage(index: number): { x0: number; y0: number; w: number; h: number; P: Float32Array } {
    const f = this.build(index);
    return { x0: f.x0, y0: f.y0, w: f.w, h: f.h, P: f.P };
  }

  /** Ink coverage (0..1) at a design-px point and time; for tests and cause-and-effect checks. */
  coverageAt(seconds: number, x: number, y: number): number {
    const frame = this.render(seconds);
    const ix = Math.round((x - this.region.x) * this.region.scale), iy = Math.round((y - this.region.y) * this.region.scale);
    if (ix < 0 || iy < 0 || ix >= frame.width || iy >= frame.height) return 0;
    return frame.rgba[(iy * frame.width + ix) * 4 + 3] / 255;
  }
}
