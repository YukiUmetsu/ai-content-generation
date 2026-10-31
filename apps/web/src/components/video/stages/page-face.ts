/**
 * Printed page faces painted with Canvas 2D: paper, plate, heading, body copy,
 * caption and folio, laid out once and drawn in two passes (colour, and a
 * roughness map in which ink and plates read glossier than bare paper). The same
 * canvases texture the WebGL leaf and the 2.5D fallback, so both show identical
 * pages. Body copy shrinks to fit its block instead of being truncated, and the
 * report says when even the minimum size could not fit.
 */
import type { BookPageFace, ImageAsset } from "../scene-templates";

export interface PagePaintOptions {
  /** Canvas size in pixels. */
  width: number; height: number;
  /** Which page of the spread: the gutter is on the right of a left page. */
  side: "left" | "right";
  paper: string; ink: string; accent?: string;
  headingFont: string; bodyFont: string;
  /** Bare-paper roughness 0..1. */
  roughness: number;
  /** Ageing 0..1: edge toning and faint foxing. */
  age: number;
  /** Stable seed so speckle and foxing never change between frames. */
  seed: string;
  /** Tileable paper detail (multiplied in). */
  paperDetail?: CanvasImageSource;
  /** Decoded image for an asset, if any. */
  image: (asset: ImageAsset) => CanvasImageSource | undefined;
  /** Language tag for line breaking hints. */
  lang?: string;
}
export interface PageFaceReport {
  /** Body size actually used, as a fraction of the page height. */
  bodySize: number;
  /** True when the copy needed more room than the minimum size allows. */
  overflow: boolean;
  layout: "plate" | "text" | "mixed" | "title";
}

const CJK = "⺀-鿿가-힯豈-﫿＀-￯　-〿";
const CLOSING = "、。，．！？」』）〕】》〉・ー…";
const tokenRe = new RegExp(`[${CJK}][${CLOSING}]*|[ \\t]+|[^ \\t${CJK}]+`, "g");
const isCJK = (s: string) => new RegExp(`^[${CJK}]`).test(s);
/** Deterministic PRNG for paper speckle and foxing. */
function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
interface Line { text: string; width: number; justify: boolean; indent: number }
/** Greedy line breaking: words for spaced scripts, characters (with closing punctuation kept) for CJK. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: (line: number) => number, startLine = 0): Line[] {
  const lines: Line[] = [];
  text.split(/\n+/).forEach((raw, pi) => {
    // Paragraphs after the first open with an indent: an ideographic space in CJK, an em space otherwise.
    const para = pi === 0 ? raw.trim() : (isCJK(raw.trim()) ? "\u3000" : "\u2003") + raw.trim();
    const tokens = para.match(tokenRe) ?? [];
    let cur = "", n = 0;
    const push = (last: boolean) => { const t = cur.replace(/^ +| +$/g, ""); if (t) lines.push({ text: t, width: ctx.measureText(t).width, justify: !last && !isCJK(t), indent: 0 }); cur = ""; n++; };
    for (const tok of tokens) {
      if (/^[ \t]+$/.test(tok)) { if (cur) cur += " "; continue; }
      const next = cur + tok;
      if (cur && ctx.measureText(next.replace(/^ +| +$/g, "")).width > maxWidth(startLine + lines.length)) { push(false); cur = tok; }
      else cur = next;
      // A single unbreakable run longer than the line is split by character so it never escapes the block.
      while (ctx.measureText(cur).width > maxWidth(startLine + lines.length) && cur.length > 1) {
        let cut = cur.length - 1;
        while (cut > 1 && ctx.measureText(cur.slice(0, cut)).width > maxWidth(startLine + lines.length)) cut--;
        const head = cur.slice(0, cut); cur = cur.slice(cut);
        lines.push({ text: head, width: ctx.measureText(head).width, justify: false, indent: 0 });
      }
    }
    push(true); void n;
  });
  return lines;
}
function drawJustified(ctx: CanvasRenderingContext2D, line: Line, x: number, y: number, width: number) {
  const words = line.text.split(" ");
  const gap = (width - words.reduce((s, w) => s + ctx.measureText(w).width, 0)) / Math.max(1, words.length - 1);
  // Justify only when the word spaces stay even; a loose line is set ragged rather than with rivers.
  if (!line.justify || words.length < 2 || gap > ctx.measureText(" ").width * 2.1) { ctx.fillText(line.text, x, y); return; }
  let cx = x;
  for (const w of words) { ctx.fillText(w, cx, y); cx += ctx.measureText(w).width + gap; }
}
const font = (weight: number | string, size: number, family: string, italic = false) => `${italic ? "italic " : ""}${weight} ${size.toFixed(2)}px ${family}`;
/** Contain-fit, never stretched: an author's plate keeps its proportions. */
function contain(sw: number, sh: number, bw: number, bh: number) {
  const k = Math.min(bw / sw, bh / sh); return { w: sw * k, h: sh * k };
}
const sizeOf = (src: CanvasImageSource): [number, number] => {
  const s = src as { naturalWidth?: number; naturalHeight?: number; width?: number | SVGAnimatedLength; height?: number | SVGAnimatedLength };
  const w = s.naturalWidth || (typeof s.width === "number" ? s.width : 0), h = s.naturalHeight || (typeof s.height === "number" ? s.height : 0);
  return [w || 1, h || 1];
};

/**
 * Paints one page face. `pass` "color" draws paper, ink and plates;
 * "roughness" draws the matching roughness map (grey levels, read from G).
 */
export function paintPageFace(ctx: CanvasRenderingContext2D, face: BookPageFace, o: PagePaintOptions, pass: "color" | "roughness" = "color"): PageFaceReport {
  const W = o.width, H = o.height, color = pass === "color";
  const grey = (r: number) => { const v = Math.round(Math.max(0, Math.min(1, r)) * 255); return `rgb(${v},${v},${v})`; };
  const random = rng(o.seed);
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = color ? o.paper : grey(o.roughness);
  ctx.fillRect(0, 0, W, H);
  if (color) {
    if (o.paperDetail) {
      ctx.globalCompositeOperation = "multiply"; ctx.globalAlpha = .5;
      const tile = Math.round(W / 2);
      for (let y = 0; y < H; y += tile) for (let x = 0; x < W; x += tile) ctx.drawImage(o.paperDetail, x, y, tile, tile);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    }
    // Fibre speckle: tiny, sparse, low contrast.
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(${random() < .5 ? "90,70,40" : "255,255,250"},${(.03 + random() * .05).toFixed(3)})`;
      ctx.fillRect(random() * W, random() * H, 1 + random() * 2.2, 1 + random() * 1.2);
    }
    if (o.age > 0) {
      // Edge toning: paper yellows from the exposed edges inwards.
      const tone = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .35, W / 2, H / 2, Math.hypot(W, H) * .58);
      tone.addColorStop(0, "rgba(150,110,40,0)"); tone.addColorStop(1, `rgba(150,105,35,${(.22 * o.age).toFixed(3)})`);
      ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = tone; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < Math.round(26 * o.age); i++) {
        const x = random() * W, y = random() * H, r = 2 + random() * W * .007;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(150,95,45,${(.18 * o.age).toFixed(3)})`); g.addColorStop(1, "rgba(150,95,45,0)");
        ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      ctx.globalCompositeOperation = "source-over";
    }
  }
  // Text block. The gutter margin is wider, as in a real book.
  const gutterLeft = o.side === "right";
  const mIn = W * .13, mOut = W * .1, top = H * .085, bottom = H * .1;
  const bx = gutterLeft ? mIn : mOut, bw = W - mIn - mOut, by = top, bh = H - top - bottom;
  const hasText = !!(face.heading?.trim() || face.text?.trim());
  const layout: PageFaceReport["layout"] = face.layout === "plate" || (face.layout !== "text" && face.image && !face.text?.trim())
    ? "plate" : face.image && face.layout !== "text" ? "mixed" : face.text?.trim() ? "text" : "title";
  const inkFill = color ? o.ink : grey(o.roughness * .62);
  let report: PageFaceReport = { bodySize: 0, overflow: false, layout };
  ctx.textBaseline = "alphabetic";
  const folioH = face.folio ? H * .03 : 0;
  const drawPlate = (x: number, y: number, w: number, h: number) => {
    const src = face.image && o.image(face.image);
    const [sw, sh] = src ? sizeOf(src) : [3, 4];
    const box = contain(sw, sh, w, h), px = x + (w - box.w) / 2, py = y + (h - box.h) / 2;
    // Plate mark: the impression of an intaglio plate, a slightly darker field and a pressed rim.
    const pad = Math.min(W, H) * .018;
    if (color) {
      ctx.fillStyle = "rgba(120,96,60,.07)"; ctx.fillRect(px - pad, py - pad, box.w + pad * 2, box.h + pad * 2);
      ctx.strokeStyle = "rgba(95,72,40,.32)"; ctx.lineWidth = Math.max(2, W * .0022);
      ctx.strokeRect(px - pad, py - pad, box.w + pad * 2, box.h + pad * 2);
      ctx.strokeStyle = "rgba(255,252,240,.55)"; ctx.lineWidth = Math.max(1.5, W * .0014);
      ctx.strokeRect(px - pad + 2.5, py - pad + 2.5, box.w + pad * 2, box.h + pad * 2);
      if (src) {
        // Printed, not pasted: the plate takes on the paper beneath it.
        ctx.save(); ctx.beginPath(); ctx.rect(px, py, box.w, box.h); ctx.clip();
        ctx.globalCompositeOperation = "multiply"; ctx.drawImage(src, px, py, box.w, box.h); ctx.restore();
      }
    } else { ctx.fillStyle = grey(o.roughness * .8); ctx.fillRect(px, py, box.w, box.h); }
    return { x: px, y: py, w: box.w, h: box.h };
  };
  if (layout === "plate") {
    const capSize = H * .026;
    ctx.font = font(400, capSize, o.bodyFont, true);
    const capLines = face.caption ? wrap(ctx, face.caption, () => bw * .86) : [];
    const capH = capLines.length ? capLines.length * capSize * 1.4 + H * .03 : 0;
    const headSize = H * .03;
    const headH = face.heading ? headSize * 1.8 : 0;
    if (face.heading) {
      ctx.font = font(600, headSize, o.headingFont); ctx.fillStyle = inkFill; ctx.textAlign = "center";
      ctx.fillText(face.heading.toUpperCase(), bx + bw / 2, by + headSize, bw);
    }
    const plate = drawPlate(bx, by + headH, bw, bh - capH - headH - folioH);
    if (capLines.length) {
      ctx.font = font(400, capSize, o.bodyFont, true); ctx.fillStyle = inkFill; ctx.textAlign = "center";
      capLines.forEach((l, i) => ctx.fillText(l.text, bx + bw / 2, plate.y + plate.h + H * .045 + i * capSize * 1.4));
    }
    report = { bodySize: capLines.length ? .026 : 0, overflow: false, layout };
  } else {
    let y = by;
    if (layout === "mixed") { const p = drawPlate(bx, y, bw, bh * .46); y = p.y + p.h + H * .05; }
    const title = layout === "title";
    if (face.heading) {
      // Display heading: as large as the longest word allows, at most three lines.
      let hs = H * (title ? .075 : .056);
      ctx.font = font(600, hs, o.headingFont);
      let lines = wrap(ctx, face.heading, () => bw);
      while ((lines.length > 3 || lines.some(l => l.width > bw)) && hs > H * .03) { hs *= .92; ctx.font = font(600, hs, o.headingFont); lines = wrap(ctx, face.heading, () => bw); }
      if (title) y = by + bh * .34 - lines.length * hs * 1.12 / 2;
      ctx.fillStyle = inkFill; ctx.textAlign = title ? "center" : "left";
      lines.forEach((l, i) => ctx.fillText(l.text, title ? bx + bw / 2 : bx, y + hs + i * hs * 1.12));
      y += hs * (lines.length * 1.12) + hs * .55;
      // A short solid rule under the heading, in the accent colour.
      ctx.fillStyle = color ? (o.accent ?? o.ink) : grey(o.roughness * .7);
      ctx.fillRect(title ? bx + bw / 2 - bw * .08 : bx, y, bw * .16, Math.max(3, H * .0032));
      y += H * .045;
    }
    if (face.text?.trim()) {
      const avail = by + bh - folioH - y;
      const lead = 1.5;
      const cjkText = new RegExp(`[${CJK}]`).test(face.text);
      let size = H * .034, lines: Line[] = [], fits = false, dropW = 0;
      const dropLines = 3;
      for (let attempt = 0; attempt < 24; attempt++) {
        ctx.font = font(400, size, o.bodyFont);
        // Drop cap on spaced scripts only.
        const first = !cjkText && /^[A-Za-z]/.test(face.text.trim()) ? face.text.trim()[0] : "";
        if (first) { ctx.font = font(500, size * lead * (dropLines - .35), o.headingFont); dropW = ctx.measureText(first).width + size * .45; ctx.font = font(400, size, o.bodyFont); }
        else dropW = 0;
        const body = first ? face.text.trim().slice(1) : face.text.trim();
        lines = wrap(ctx, body, i => i < dropLines && dropW ? bw - dropW : bw);
        if (lines.length * size * lead <= avail) { fits = true; break; }
        if (size <= H * .019) break;
        size = Math.max(H * .019, size * .94);
      }
      const first = dropW ? face.text.trim()[0] : "";
      if (first) {
        ctx.font = font(500, size * lead * (dropLines - .35), o.headingFont); ctx.fillStyle = color ? (o.accent ?? o.ink) : inkFill; ctx.textAlign = "left";
        ctx.fillText(first, bx, y + size * lead * (dropLines - 1) + size * .95);
      }
      ctx.font = font(400, size, o.bodyFont); ctx.fillStyle = inkFill; ctx.textAlign = "left";
      const maxLines = Math.floor(avail / (size * lead));
      lines.slice(0, fits ? lines.length : maxLines).forEach((l, i) => {
        const indent = i < dropLines && dropW ? dropW : 0;
        drawJustified(ctx, l, bx + indent, y + size + i * size * lead, bw - indent);
      });
      report = { bodySize: size / H, overflow: !fits, layout };
    }
    if (face.caption && layout !== "title") {
      const capSize = H * .024; ctx.font = font(400, capSize, o.bodyFont, true); ctx.fillStyle = inkFill; ctx.textAlign = "left";
      ctx.fillText(face.caption, bx, by + bh - folioH - capSize * .4, bw);
    }
    void hasText;
  }
  if (face.folio) {
    ctx.font = font(400, H * .022, o.bodyFont); ctx.fillStyle = inkFill; ctx.textAlign = "center";
    ctx.fillText(face.folio, bx + bw / 2, H - bottom * .55);
  }
  if (color) {
    // Gutter: the page curves away from the light into the binding.
    const gx = gutterLeft ? 0 : W, g = ctx.createLinearGradient(gx, 0, gutterLeft ? W * .16 : W * .84, 0);
    g.addColorStop(0, "rgba(70,48,24,.34)"); g.addColorStop(.35, "rgba(70,48,24,.1)"); g.addColorStop(1, "rgba(70,48,24,0)");
    ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.restore();
  return report;
}

/** Fore-edge and head/tail texture: hundreds of leaves seen edge-on, slightly uneven. `u` runs along the edge, `v` up the block. */
export function paintPageEdge(ctx: CanvasRenderingContext2D, width: number, height: number, paper: string, seed: string, edge?: string) {
  const random = rng(seed + "edge");
  ctx.fillStyle = edge ?? paper; ctx.fillRect(0, 0, width, height);
  for (let y = 0; y < height; y += 1) {
    const d = random();
    if (d < .55) continue;
    ctx.fillStyle = d > .9 ? "rgba(255,252,242,.35)" : `rgba(70,52,30,${(.08 + random() * .16).toFixed(3)})`;
    ctx.fillRect(0, y, width, 1);
  }
  // Leaves near the board sit in shadow; the top leaves catch the light.
  const g = ctx.createLinearGradient(0, height, 0, 0);
  g.addColorStop(0, "rgba(40,28,14,.45)"); g.addColorStop(.25, "rgba(40,28,14,.12)"); g.addColorStop(1, "rgba(255,250,235,.06)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
}
