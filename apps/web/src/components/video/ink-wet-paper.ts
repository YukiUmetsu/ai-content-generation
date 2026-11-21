/**
 * INK1 wet paper: deterministic raster medium, not a filter on vector contours.
 * Sample the same timed brush-nib path as ink-brush.ts, then deposit mobile
 * pigment and water into a fixed paper-fibre field. Wet pigment spreads with
 * age, absorbs, and dries; once dry the final sheet is exactly stable.
 *
 * This is a bounded, analytic mass-preserving approximation, not a molecular
 * simulation or a full-frame Gaussian blur. Each footprint is deposited
 * independently on paper; no state depends on prior seek/playback calls.
 */
import { inspectInkBrush, inkHash, sampleInkBrushStroke, INK_DENSITIES } from "./ink-brush";
import type { InkBrushSpec } from "./ink-brush";

export interface InkWetOptions {
  /** Raster samples per design pixel. Defaults to at most .5 and under 1M cells. */
  scale?: number;
  /** Additional fibre-directed capillary spread, 0..1. */
  bleed?: number;
  /** Read full dry result immediately, with no timeline side effects. */
  reducedMotion?: boolean;
}
export interface InkWetFrame {
  width: number;
  height: number;
  /** Transparent RGBA deposit, separate from the author's paper colour and text. */
  rgba: Uint8Array;
  depositedMass: number;
  /** Raster-integrated pigment mass after conservation normalization. */
  pigmentMass: number;
  absorbedMass: number;
  waterMass: number;
}
const MAX_AGE = 56;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const color = (hex: string) => [
  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
] as const;

/** Deterministic interpolated paper fibre field, not a per-frame random texture. */
function fibre(seed: number, x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy;
  const ux = tx * tx * (3 - 2 * tx), uy = ty * ty * (3 - 2 * ty);
  const a = inkHash(seed, ix, iy), b = inkHash(seed, ix + 1, iy),
    c = inkHash(seed, ix, iy + 1), d = inkHash(seed, ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}
export function sampleWetInk(
  spec: InkBrushSpec, frame: number, options: InkWetOptions = {},
): InkWetFrame {
  const errors = inspectInkBrush(spec);
  if (errors.length) throw new RangeError(errors.map(x => x.path + ": " + x.message).join("; "));
  if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError("Ink wet-paper frame must be a nonnegative integer.");
  const scale = options.scale ?? Math.min(.5, Math.sqrt(1000000 / (spec.width * spec.height)));
  const bleed = options.bleed ?? .65;
  if (!Number.isFinite(scale) || scale < .125 || scale > 1) throw new RangeError("Ink raster scale must be .125..1.");
  if (!Number.isFinite(bleed) || bleed < 0 || bleed > 1) throw new RangeError("Ink bleed must be 0..1.");
  const width = Math.max(1, Math.round(spec.width * scale)),
    height = Math.max(1, Math.round(spec.height * scale));
  if (width * height > 2200000) throw new RangeError("Ink raster exceeds its 2.2M-cell memory limit.");
  const len = width * height;
  const density = new Float32Array(len), red = new Float32Array(len),
    green = new Float32Array(len), blue = new Float32Array(len);
  const rgba = new Uint8Array(len * 4);
  let depositedMass = 0, absorbedMass = 0, waterMass = 0;
  // Reused buffers hold a *single* dab footprint. Normalize each contact independently:
  // adding another stroke can never rescale a dry area elsewhere on the page.
  const pixelIndices: number[] = [], pixelWeights: number[] = [];
  const effectiveFrame = options.reducedMotion
    ? Math.max(...spec.strokes.map(s => s.startFrame + s.durationFrames + MAX_AGE))
    : frame;

  // All sources are stamped in absolute time with no mutable previous-frame state.
  for (let strokeIndex = 0; strokeIndex < spec.strokes.length; strokeIndex++) {
    const stroke = spec.strokes[strokeIndex];
    if (effectiveFrame <= stroke.startFrame) continue;
    const samples = sampleInkBrushStroke(stroke, spec.width, spec.height);
    const totalTime = samples[samples.length - 1].time;
    if (totalTime <= 0) continue;
    const [r, g, b] = color(INK_DENSITIES[stroke.tone]);
    const water = (1 - stroke.dryness) * (.32 + .68 * stroke.load);
    const paperSeed = spec.seed + strokeIndex * 97;

    for (let i = 1; i < samples.length; i++) {
      const before = samples[i - 1], after = samples[i];
      const length = Math.hypot(after.x - before.x, after.y - before.y);
      const count = Math.max(1, Math.ceil(length * scale / 1.8));
      const dx = after.x - before.x, dy = after.y - before.y;
      const speed = Math.hypot(dx, dy) || 1, ux = dx / speed, uy = dy / speed;
      for (let n = 0; n < count; n++) {
        const t = (n + .5) / count;
        const sampledTime = lerp(before.time, after.time, t);
        const contactFrame = stroke.startFrame + stroke.durationFrames * (sampledTime / totalTime);
        if (contactFrame > effectiveFrame) break;
        const age = clamp(effectiveFrame - contactFrame, 0, MAX_AGE);
        const pressure = lerp(before.pressure, after.pressure, t);
        if (pressure <= .005) continue;
        const travel = lerp(before.arc, after.arc, t) / samples[samples.length - 1].arc;
        const depletion = 1 - travel * (.14 + .34 * stroke.dryness);
        const amount = Math.max(.02, stroke.width * stroke.load * pressure * depletion *
          (length / count) * .9);
        const absorbed = 1 - Math.exp(-age / (7 + 12 * water));

        // Brush contact is a concentrated patch; the wet halo advances beyond
        // it later. Expanding a Gaussian kernel for both creates airbrush haze.
        const growth = bleed * water * .34 * (1 - Math.exp(-age / 10));
        const contact = stroke.width * (.075 + .925 * pressure) * scale / 2;
        const transverse = Math.max(.8, contact * .92);
        const longitudinal = Math.max(.9, contact * 1.10);
        const centerX = lerp(before.x, after.x, t) * scale,
          centerY = lerp(before.y, after.y, t) * scale;
        const bound = Math.ceil((1.65 + growth) * Math.max(transverse, longitudinal) + 3);
        const left = Math.max(0, Math.floor(centerX - bound)), right = Math.min(width - 1, Math.ceil(centerX + bound));
        const top = Math.max(0, Math.floor(centerY - bound)), bottom = Math.min(height - 1, Math.ceil(centerY + bound));
        const norm = 2 / (Math.PI * transverse * longitudinal);
        pixelIndices.length = 0;
        pixelWeights.length = 0;
        let footprintMass = 0;
        for (let py = top; py <= bottom; py++) {
          const oy = (py + .5 - centerY);
          for (let px = left; px <= right; px++) {
            const ox = px + .5 - centerX;
            const along = (ox * ux + oy * uy) / longitudinal;
            const across = (-ox * uy + oy * ux) / transverse;
            const q = along * along + across * across;
            if (q > 2.2) continue;
            const k = py * width + px;
            // Fibres are in *paper coordinates* and never regenerate with frame.
            const macro = fibre(paperSeed, px / 7.5, py / 11.5);
            const micro = inkHash(paperSeed + 17, px, py);
            // A fairly solid hair-bundle print, with an irregular fibre edge.
            // Only the narrower *outer* moisture halo is diffuse.
            const boundary = 1.08 + (macro - .5) * .21 + (micro - .5) * .07;
            const solidT = clamp((boundary - q) / .17, 0, 1);
            const solidContact = solidT * solidT * (3 - 2 * solidT);
            const haloLimit = 1.13 + growth * 1.4 + (macro - .5) * .26;
            const haloT = clamp((haloLimit - q) / .43, 0, 1);
            const halo = (1 - solidContact) * haloT * haloT *
              (.36 * growth / .34);
            if (solidContact + halo <= 0) continue;
            // Dry-brush channels run along the travel direction. Slow, loaded
            // strokes stay cohesive; fast depleted strokes break up visibly.
            // Fibres break away in irregular *brush-aligned* channels. A
            // periodic sine created obvious synthetic moire in the dry marks.
            // Map repeated dabs back to one stable stroke-arc coordinate so
            // contact gaps remain in place under arbitrary frame seeking.
            const strokeArc = lerp(before.arc, after.arc, t) +
              along * longitudinal / scale;
            const hairNoise = fibre(paperSeed + 71, strokeArc / 21,
              across * 7.2 + 3.4);
            const fineFibre = fibre(paperSeed + 73, strokeArc / 5.1,
              across * 15 + 6);
            const broken = clamp(
              (.48 + .12 * Math.abs(across) -
                (.75 * hairNoise + .25 * fineFibre)) / .21,
              0, 1,
            );
            const split = 1 - Math.min(.99, stroke.dryness * 1.30 * broken);
            const granulation = (.90 + micro * .16) * (.92 + macro * .16);
            const loadedEdge = 1 + water * absorbed * .14 *
              Math.exp(-Math.pow((Math.sqrt(q) - 1.02) / .1, 2));
            const pigment = norm * (solidContact + halo) *
              split * granulation * loadedEdge;
            if (pigment <= 0) continue;
            pixelIndices.push(k);
            pixelWeights.push(pigment);
            footprintMass += pigment;
          }
        }
        if (footprintMass <= 0) continue;
        const gain = amount / footprintMass;
        for (let q = 0; q < pixelIndices.length; q++) {
          const k = pixelIndices[q], pigment = pixelWeights[q] * gain;
          density[k] += pigment;
          red[k] += pigment * r;
          green[k] += pigment * g;
          blue[k] += pigment * b;
        }
        depositedMass += amount;
        absorbedMass += amount * absorbed;
        waterMass += amount * water * (1 - age / MAX_AGE);
      }
    }
  }

  // Each footprint has already been normalized locally. No global scaling:
  // previously dried pigment remains pixel-identical when a later stroke is added.
  let rawMass = 0;
  for (let k = 0; k < len; k++) rawMass += density[k];
  for (let k = 0; k < len; k++) {
    if (density[k] <= 0) continue;
    const pigment = density[k];
    const o = k * 4, inv = 1 / density[k];
    rgba[o] = clamp(Math.round(red[k] * inv), 0, 255);
    rgba[o + 1] = clamp(Math.round(green[k] * inv), 0, 255);
    rgba[o + 2] = clamp(Math.round(blue[k] * inv), 0, 255);
    rgba[o + 3] = clamp(Math.round(255 * (1 - Math.exp(-pigment * 2.15))), 0, 255);
  }
  return {
    width, height, rgba, depositedMass,
    pigmentMass: rawMass,
    absorbedMass, waterMass,
  };
}
function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}
function cat(parts: readonly Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, p) => sum + p.length, 0);
  const bytes = new Uint8Array(size); let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.length; }
  return bytes;
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(name: string, data: Uint8Array): Uint8Array {
  const label = new Uint8Array([...name].map(c => c.charCodeAt(0)));
  const chunk = cat([label, data]);
  return cat([u32(data.length), chunk, u32(crc32(chunk))]);
}
function adler32(bytes: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521; b = (b + a) % 65521;
  }
  return (b * 65536 + a) >>> 0;
}
/** RFC1950 zlib wrapping uncompressed DEFLATE blocks; no Node or npm dependency. */
function zlibStored(bytes: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  for (let offset = 0; offset < bytes.length; offset += 65535) {
    const size = Math.min(65535, bytes.length - offset), final = offset + size === bytes.length;
    chunks.push(new Uint8Array([final ? 1 : 0, size & 255, size >>> 8,
      (~size) & 255, ((~size) >>> 8) & 255]));
    chunks.push(bytes.subarray(offset, offset + size));
  }
  chunks.push(u32(adler32(bytes)));
  return cat(chunks);
}
/** PNG with lossless alpha, suitable for a real image-backed FilmStage ink layer. */
export function encodeWetInkPng(frame: InkWetFrame): Uint8Array {
  if (!Number.isSafeInteger(frame.width) || !Number.isSafeInteger(frame.height) ||
      frame.width < 1 || frame.height < 1 || frame.rgba.length !== frame.width * frame.height * 4)
    throw new RangeError("Invalid INK1 RGBA image dimensions.");
  const stride = frame.width * 4, pixels = new Uint8Array((stride + 1) * frame.height);
  for (let row = 0; row < frame.height; row++) pixels.set(
    frame.rgba.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  const header = cat([u32(frame.width), u32(frame.height),
    new Uint8Array([8, 6, 0, 0, 0])]);
  return cat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header), pngChunk("IDAT", zlibStored(pixels)),
    pngChunk("IEND", new Uint8Array()),
  ]);
}
export function wetInkPngDataUri(frame: InkWetFrame): string {
  const png = encodeWetInkPng(frame);
  let binary = "";
  for (let i = 0; i < png.length; i += 24576)
    binary += String.fromCharCode(...png.subarray(i, i + 24576));
  return "data:image/png;base64," + btoa(binary);
}
