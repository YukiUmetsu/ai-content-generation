import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { CanvasHTMLAttributes } from "react";
import { DEFAULT_BRUSH_LOOK, drawShodoBrush, drawShodoBrushShadow } from "./shodo-brush";
import type { ShodoBrushLook, ShodoCamera } from "./shodo-brush";
import { shodoBrushPose, shodoStrokeNumbers } from "./shodo-hand";
import type { ShodoPlan, ShodoStrokeNumber } from "./shodo-hand";
import { ShodoInkSurface } from "./shodo-ink";
import { renderShodoPaper } from "./shodo-paper";
import type { ShodoSheet } from "./shodo-paper";
import { inkHash } from "../ink-brush";
import { loadShodoTextures } from "./shodo-textures";
import type { ShodoTextures } from "./shodo-textures";

export interface ShodoRect { x: number; y: number; width: number; height: number }

export interface ShodoCanvasProps extends Omit<CanvasHTMLAttributes<HTMLCanvasElement>, "children" | "width" | "height"> {
  plan: ShodoPlan;
  /** Absolute frame; the canvas draws the writing at frame / fps seconds. */
  frame: number;
  fps?: number;
  /** Design size of the picture, px. */
  width: number;
  height: number;
  /** The sheet of paper, design px. */
  paper: ShodoRect;
  /** Printed practice grid; null for plain paper. */
  sheet?: ShodoSheet | null;
  /** What lies under the paper. */
  underlay?: "felt" | "none";
  /** Paperweight (文鎮) across the top edge of the sheet. */
  paperweight?: "wood" | "steel" | "none";
  /** Motion blur on fast brush moves, as a 180° film shutter would record them. */
  motionBlur?: boolean;
  showBrush?: boolean;
  brushLook?: Partial<ShodoBrushLook>;
  /** Camera height in design px; lower gives stronger perspective on the brush. */
  cameraHeight?: number;
  /** Ink raster pixels per design pixel, with the device pixel ratio; at most 2 in all. Default 2: sharp ink edges on every screen. */
  inkScale?: number;
  /** Device pixel ratio for the backing store; defaults to the window's, capped at 2. */
  pixelRatio?: number;
  /**
   * Stroke-order guide in red teaching ink (朱): none, a number and an arrow for the stroke
   * being written ("current") or for all written strokes ("all"), or a small number next to
   * the start of each stroke when the brush lands for it ("numbers"; see `shodoStrokeNumbers`).
   */
  orderGuide?: "none" | "current" | "all" | "numbers";
  /** Limit the guide to these stroke numbers (1-based writing order). */
  guideStrokes?: readonly number[];
  /**
   * Colour of the guide. Default "#D8432A" for the arrows and "#B3301A" for "numbers": the
   * darker vermilion gives small text a contrast of 5.6:1 on hanshi.
   */
  guideColor?: string;
  /** Text size of the "numbers" guide, design px. Default: 0.42 of the brush diameter. */
  guideSize?: number;
  /** Show the finished writing with no motion and no brush. */
  reducedMotion?: boolean;
  /** Accessible description of the writing. */
  label?: string;
  /**
   * What this canvas draws: everything (default); the page only, with no brush ("page": the
   * underlay, paper, ink and guides); or only the brush and its shadow on a transparent canvas
   * ("brush", hidden from assistive technology). Stack a "page" canvas and a "brush" canvas with
   * the same plan and frame to put a host's own layer, such as a card, between them.
   */
  layer?: "all" | "page" | "brush";
  /** Where the stroke-order guide may place numbers, design px. Default: the paper. */
  guideBounds?: ShodoRect;
  /**
   * What the host asked to see, for example its own video frame when `frame` is a frame within a
   * pass that repeats. The canvas reports it in `data-km-shodo-frame` and, once drawn, in
   * `data-km-shodo-drawn`, which an export waits for. Default: `frame`.
   */
  stamp?: string | number;
}

function feltTile(seed: number): HTMLCanvasElement | null {
  const tile = document.createElement("canvas");
  tile.width = tile.height = 128;
  const t = tile.getContext("2d");
  if (!t) return null;
  const img = t.createImageData(128, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const n = inkHash(seed, x, y), m = inkHash(seed + 1, x >> 2, y >> 2);
    const v = 18 + n * 10 + m * 6, o = (y * 128 + x) * 4;
    img.data[o] = v * .8; img.data[o + 1] = v * .85; img.data[o + 2] = v * 1.25 + 6; img.data[o + 3] = 255;
  }
  t.putImageData(img, 0, 0);
  return tile;
}

/**
 * Canvas renderer for a SHO1 writing plan: underlay, paper with its printed grid, the ink
 * raster, an optional stroke-order guide, the brush shadow and the brush. Frame-addressed:
 * it draws exactly the state at `frame`, so seeking and export are deterministic.
 */
export const ShodoCanvas = forwardRef<HTMLCanvasElement, ShodoCanvasProps>(function ShodoCanvas({
  plan, frame, fps = 30, width, height, paper, sheet = null, underlay = "felt", paperweight = "wood", motionBlur = true,
  showBrush = true, brushLook, cameraHeight, inkScale = 2, pixelRatio, orderGuide = "none", guideStrokes, guideColor, guideSize,
  reducedMotion = false, label, layer = "all", guideBounds, stamp, style, ...props
}, ref) {
  const mark = String(stamp ?? frame);
  // The brush layer has no paper or ink, so it builds neither.
  const page = layer !== "brush";
  const guideInk = guideColor ?? (orderGuide === "numbers" ? "#B3301A" : "#D8432A");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useImperativeHandle(ref, () => canvasRef.current as HTMLCanvasElement);
  const dpr = pixelRatio ?? (typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1));
  const inkRes = Math.min(2, inkScale * dpr);
  const surface = useMemo(() => page ? new ShodoInkSurface(plan, { ...paper, scale: inkRes }) : null, [plan, paper, inkRes, page]);
  const paperCanvas = useMemo(() => {
    if (!page || typeof document === "undefined") return null;
    const img = renderShodoPaper(paper.width, paper.height, inkRes, plan.style.paper, sheet, plan.style.seed);
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    c.getContext("2d")?.putImageData(new ImageData(img.rgba, img.width, img.height), 0, 0);
    return c;
  }, [paper.width, paper.height, inkRes, plan.style.paper, plan.style.seed, sheet, page]);
  const inkCanvas = useMemo(() => !page || typeof document === "undefined" ? null : document.createElement("canvas"), [page]);
  const felt = useMemo(() => typeof document === "undefined" ? null : feltTile(plan.style.seed), [plan.style.seed]);
  const look = useMemo(() => ({ ...DEFAULT_BRUSH_LOOK, ...brushLook }), [brushLook]);
  // Scanned material textures decode asynchronously; the canvas reports ready only after.
  const [textures, setTextures] = useState<ShodoTextures | null>(null);
  useEffect(() => {
    let live = true;
    loadShodoTextures().then(t => { if (live) setTextures(t); }).catch(() => { if (live) setTextures(null); });
    return () => { live = false; };
  }, []);
  const blurLayers = useMemo(() => typeof document === "undefined" ? null : [document.createElement("canvas"), document.createElement("canvas")], []);
  // The layers that do not change while the brush writes (the underlay, the sheet with its shadow,
  // the paperweight) are drawn once at the backing resolution; a frame draws only ink and brush.
  const backW = Math.round(width * dpr), backH = Math.round(height * dpr);
  const background = useMemo(() => {
    if (typeof document === "undefined" || !paperCanvas) return null;
    const c = document.createElement("canvas");
    c.width = backW; c.height = backH;
    const b = c.getContext("2d");
    if (!b) return null;
    b.setTransform(dpr, 0, 0, dpr, 0, 0);
    b.imageSmoothingEnabled = true;
    b.imageSmoothingQuality = "high";
    // Underlay (下敷き) and the sheet's soft contact shadow.
    if (underlay === "felt") {
      b.fillStyle = (felt && b.createPattern(felt, "repeat")) ?? "#1B1E2B";
      b.fillRect(0, 0, width, height);
    }
    b.save();
    b.shadowColor = "rgba(0,0,0,.35)";
    b.shadowBlur = 10;
    b.shadowOffsetY = 2;
    b.fillStyle = plan.style.paper.color;
    b.fillRect(paper.x, paper.y, paper.width, paper.height);
    b.restore();
    b.drawImage(paperCanvas, paper.x, paper.y, paper.width, paper.height);
    return c;
  }, [backW, backH, dpr, width, height, underlay, felt, paper, paperCanvas, plan.style.paper.color]);
  const weight = useMemo(() => {
    if (!page || typeof document === "undefined" || paperweight === "none") return null;
    const c = document.createElement("canvas");
    c.width = backW; c.height = backH;
    const w = c.getContext("2d");
    if (!w) return null;
    w.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPaperweight(w, paper, paperweight, textures);
    return c;
  }, [backW, backH, dpr, paper, paperweight, textures, page]);
  // Stamp the strokes' ink tiles ahead of the brush while the browser is idle, so no frame waits
  // for a whole stroke to be stamped when the brush lands.
  useEffect(() => {
    if (reducedMotion || typeof window === "undefined" || !surface) return;
    let live = true, id = 0;
    const idle = typeof window.requestIdleCallback === "function";
    const next = () => { id = idle ? window.requestIdleCallback(step, { timeout: 120 }) : window.setTimeout(() => step(), 16); };
    const step = (deadline?: IdleDeadline) => {
      if (!live) return;
      const budget = !deadline || deadline.didTimeout ? 4 : Math.max(1, Math.min(12, deadline.timeRemaining()));
      if (!surface.prepare(performance.now() + budget)) next();
    };
    next();
    return () => { live = false; if (idle) window.cancelIdleCallback(id); else window.clearTimeout(id); };
  }, [surface, reducedMotion]);
  // Placed once per plan against the finished writing, so a number never moves or lands on later ink.
  const numbers = useMemo(() => page && orderGuide === "numbers" ? shodoStrokeNumbers(plan, { size: guideSize, bounds: guideBounds ?? paper, only: guideStrokes }) : null,
    [orderGuide, plan, guideSize, paper, guideBounds, guideStrokes, page]);

  useEffect(() => {
    const canvas = canvasRef.current, ctx = canvas?.getContext("2d");
    if (!canvas) return;
    // Without a 2D context nothing can be drawn: say so, so an export fails at once with the reason.
    if (!ctx) { canvas.dataset.kmShodoStatus = "error"; return; }
    if (page && (!paperCanvas || !inkCanvas || !surface)) return;
    const seconds = reducedMotion ? plan.duration : Math.max(0, frame) / fps;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (background) ctx.drawImage(background, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (page && surface && inkCanvas) {
      // Ink.
      const ink = surface.render(seconds, reducedMotion);
      if (inkCanvas.width !== ink.width || inkCanvas.height !== ink.height) { inkCanvas.width = ink.width; inkCanvas.height = ink.height; }
      inkCanvas.getContext("2d")?.putImageData(new ImageData(ink.rgba, ink.width, ink.height), 0, 0);
      ctx.drawImage(inkCanvas, paper.x, paper.y, paper.width, paper.height);
      if (weight) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(weight, 0, 0); ctx.restore(); }
      if (numbers) drawStrokeNumbers(ctx, numbers, seconds, guideInk, plan.style.paper.color);
      else if (orderGuide !== "none" && orderGuide !== "numbers" && !reducedMotion) {
        const inkAt = (x: number, y: number) => {
          const ix = Math.round((x - paper.x) * surface.region.scale), iy = Math.round((y - paper.y) * surface.region.scale);
          return ix < 0 || iy < 0 || ix >= ink.width || iy >= ink.height ? 0 : ink.rgba[(iy * ink.width + ix) * 4 + 3] / 255;
        };
        drawOrderGuide(ctx, plan, seconds, orderGuide, guideInk, width, inkAt, guideStrokes);
      }
    }
    const pose = shodoBrushPose(plan, seconds);
    if (layer !== "page" && showBrush && !reducedMotion) {
      const cam: ShodoCamera = { x: width / 2, y: height / 2, height: cameraHeight ?? Math.max(width, height) * 2.2 };
      const drawAt = (c: CanvasRenderingContext2D, p: typeof pose) => {
        drawShodoBrushShadow(c, cam, p, plan.style.brush, plan.brush.diameter, look);
        drawShodoBrush(c, cam, p, plan.style.brush, plan.style.ink, plan.brush.diameter, look, plan.style.seed);
      };
      // A 180° shutter at the film rate: fast moves are averaged over several sub-poses. The
      // travel is measured over the shutter: the tip in 3D, and the top of the handle, which
      // swings with the lean. Sub-poses are spaced closely enough to read as one smear.
      const shutter = .5 / fps;
      const p0 = shodoBrushPose(plan, seconds - shutter / 2), p1 = shodoBrushPose(plan, seconds + shutter / 2);
      const handle = plan.brush.tuftLength * (1 + plan.style.brush.handleLength);
      const swing = Math.hypot(p1.leanX - p0.leanX, p1.leanY - p0.leanY) * Math.PI / 180 * handle;
      const travel = Math.max(Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z), swing);
      if (motionBlur && blurLayers && travel > plan.brush.diameter * .12) {
        const [acc, one] = blurLayers;
        for (const c of [acc, one]) if (c.width !== canvas.width || c.height !== canvas.height) { c.width = canvas.width; c.height = canvas.height; }
        const a = acc.getContext("2d"), o = one.getContext("2d");
        if (a && o) {
          a.setTransform(1, 0, 0, 1, 0, 0); a.clearRect(0, 0, acc.width, acc.height);
          a.globalCompositeOperation = "lighter";
          // Enough sub-poses that the blur reads as a smear, not as separate ghosts.
          const n = Math.max(3, Math.min(16, Math.ceil(travel / (plan.brush.diameter * .12))));
          for (let k = 0; k < n; k++) {
            o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, one.width, one.height);
            o.setTransform(dpr, 0, 0, dpr, 0, 0);
            drawAt(o, shodoBrushPose(plan, seconds + (k / (n - 1) - .5) * shutter));
            a.globalAlpha = 1 / n;
            a.drawImage(one, 0, 0);
          }
          a.globalAlpha = 1; a.globalCompositeOperation = "source-over";
          ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(acc, 0, 0); ctx.restore();
        } else drawAt(ctx, pose);
      } else drawAt(ctx, pose);
    }
    // An export waits for this mark: the canvas has drawn what it was asked for.
    canvas.dataset.kmShodoDrawn = mark;
  }, [frame, fps, plan, surface, paperCanvas, inkCanvas, background, weight, width, height, paper, dpr, showBrush, look, textures, blurLayers, motionBlur,
    cameraHeight, orderGuide, guideStrokes, guideInk, numbers, reducedMotion, page, layer, mark]);

  // The brush alone is decoration: the page canvas carries the description.
  const a11y = page ? { role: "img", "aria-label": label ?? "Brush calligraphy being written" } : { "aria-hidden": true };
  return <canvas {...props} ref={canvasRef} {...a11y}
    data-km-shodo="" data-km-shodo-layer={layer} data-km-shodo-frame={mark} data-km-shodo-ready={textures || !page ? "true" : "false"}
    width={Math.round(width * dpr)} height={Math.round(height * dpr)}
    style={{ width: "100%", height: "auto", aspectRatio: `${width} / ${height}`, display: "block", ...style }} />;
});

function drawPaperweight(ctx: CanvasRenderingContext2D, paper: ShodoRect, kind: "steel" | "wood", textures: ShodoTextures | null): void {
  const h = Math.max(10, paper.width * .05), y = paper.y + h * .3, x = paper.x + paper.width * .08, w = paper.width * .84, r = h * .18;
  ctx.save();
  // Contact shadow: tight and dark at the base, soft further out.
  ctx.shadowColor = "rgba(20,14,8,.45)"; ctx.shadowBlur = h * .5; ctx.shadowOffsetY = h * .22; ctx.shadowOffsetX = h * .1;
  ctx.fillStyle = kind === "wood" ? "#5A3A20" : "#7E868C";
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip();
  if (kind === "wood" && textures) {
    // Scanned wood grain running along the bar.
    const pattern = ctx.createPattern(textures.wood as CanvasImageSource, "repeat");
    if (pattern) {
      pattern.setTransform(new DOMMatrix().translate(x, y).scale(w / 640, h / 100 * 1.6));
      ctx.fillStyle = pattern; ctx.fillRect(x, y, w, h);
    }
  } else if (kind === "steel") {
    // Brushed steel: fine streaks along the bar over a cool gradient.
    const base = ctx.createLinearGradient(0, y, 0, y + h);
    base.addColorStop(0, "#C9CFD3"); base.addColorStop(.5, "#959CA2"); base.addColorStop(1, "#6C7378");
    ctx.fillStyle = base; ctx.fillRect(x, y, w, h);
    for (let i = 0; i < 90; i++) {
      const yy = y + inkHash(7, i, 3) * h, xx = x + inkHash(7, i, 5) * w * .7;
      ctx.strokeStyle = `rgba(${inkHash(7, i, 9) > .5 ? "255,255,255" : "30,34,38"},${(.04 + .08 * inkHash(7, i, 11)).toFixed(3)})`;
      ctx.lineWidth = .6; ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx + w * (.1 + .4 * inkHash(7, i, 13)), yy); ctx.stroke();
    }
  } else { ctx.fillStyle = "#6B4526"; ctx.fillRect(x, y, w, h); }
  // Bevelled block: a lit top edge, a darker lower face, and a soft top reflection.
  const bevel = ctx.createLinearGradient(0, y, 0, y + h);
  bevel.addColorStop(0, "rgba(255,240,215,.42)"); bevel.addColorStop(.12, "rgba(255,240,215,.08)");
  bevel.addColorStop(.55, "rgba(0,0,0,0)"); bevel.addColorStop(.86, "rgba(20,10,4,.25)"); bevel.addColorStop(1, "rgba(20,10,4,.5)");
  ctx.fillStyle = bevel; ctx.fillRect(x, y, w, h);
  const ends = ctx.createLinearGradient(x, 0, x + w, 0);
  ends.addColorStop(0, "rgba(20,10,4,.3)"); ends.addColorStop(.04, "rgba(20,10,4,0)"); ends.addColorStop(.96, "rgba(20,10,4,0)"); ends.addColorStop(1, "rgba(20,10,4,.35)");
  ctx.fillStyle = ends; ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/**
 * Small stroke-order numbers. Each number fades in when the brush lands for its stroke and
 * then stays. A thin paper-coloured halo keeps it legible where it crosses the printed grid.
 */
function drawStrokeNumbers(ctx: CanvasRenderingContext2D, numbers: readonly ShodoStrokeNumber[], seconds: number, color: string, paper: string): void {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  for (const n of numbers) {
    const alpha = Math.min(1, Math.max(0, (seconds - n.t0) / .18));
    if (alpha <= 0) continue;
    ctx.globalAlpha = alpha;
    ctx.font = `600 ${n.size.toFixed(1)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    // Digits are about 0.72 of the font size tall: put their middle on the placed centre.
    const text = String(n.number), y = n.y + n.size * .36;
    // On ink the halo is wider, so the number reads as a label on a small patch of paper.
    ctx.lineWidth = n.size * (n.onInk ? .38 : .28);
    ctx.strokeStyle = paper;
    ctx.strokeText(text, n.x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, n.x, y);
  }
  ctx.restore();
}

/** Stroke number and direction arrow in red teaching ink, placed where it covers the least ink. */
function drawOrderGuide(
  ctx: CanvasRenderingContext2D, plan: ShodoPlan, seconds: number, mode: "current" | "all", color: string, canvasWidth: number,
  inkAt: (x: number, y: number) => number, only?: readonly number[],
): void {
  const real = plan.strokes.filter(s => s.kind !== "link");
  const allowed = real.filter((_, i) => !only || only.includes(i + 1));
  const shown = mode === "all" ? allowed.filter(s => s.t0 <= seconds) : allowed.filter(s => s.t0 <= seconds + .6 && s.t1 + .5 >= seconds).slice(-1);
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const D = plan.brush.diameter, size = Math.max(14, D * .6);
  ctx.font = `600 ${size.toFixed(0)}px system-ui, sans-serif`;
  for (const s of shown) {
    const text = String(real.indexOf(s) + 1), tw = ctx.measureText(text).width;
    // Follow the travelling part of the stroke (送筆), smoothed, not the entry press.
    const travel = s.samples.filter(x => x.phase === "sohitsu");
    const src = travel.length > 8 ? travel : s.samples;
    const smoothAt = (c: number): [number, number] => {
      let x = 0, y = 0, n = 0;
      for (let k = Math.max(0, c - 6); k <= Math.min(src.length - 1, c + 6); k++) { x += src[k].x; y += src[k].y; n++; }
      return [x / n, y / n];
    };
    // Candidates: the first or the last half of the stroke, on either side, at two distances.
    let best: { path: [number, number][]; score: number } | null = null;
    for (const half of [0, 1]) for (const side of [1, -1]) for (const off of [D * 1.3, D * 1.9]) {
      const from = half ? Math.floor(src.length * .45) : 0, to = half ? src.length - 1 : Math.floor(src.length * .55);
      const base = Array.from({ length: 25 }, (_, i) => smoothAt(Math.round(from + (to - from) * i / 24)));
      const path = base.map((p, i) => {
        const a = base[Math.max(0, i - 4)], b = base[Math.min(base.length - 1, i + 4)];
        const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return [p[0] + (b[1] - a[1]) / d * off * side, p[1] - (b[0] - a[0]) / d * off * side] as [number, number];
      });
      const [sx, sy] = path[0], [s2x, s2y] = path[2], dl = Math.hypot(s2x - sx, s2y - sy) || 1;
      const lx = sx - (s2x - sx) / dl * size * .9, ly = sy - (s2y - sy) / dl * size * .9;
      // Measured cost: ink under the arrow and the label, and a label pushed off the canvas.
      let score = 0;
      for (const [x, y] of path) score += inkAt(x, y);
      for (let k = 0; k < 9; k++) score += 2 * inkAt(lx + (k % 3 - 1) * tw * .5, ly + (Math.floor(k / 3) - 1) * size * .4);
      if (lx - tw / 2 < 4 || lx + tw / 2 > canvasWidth - 4) score += 50;
      score += off / D * .3 + half * .2;
      if (!best || score < best.score) best = { path, score };
    }
    if (!best) continue;
    const path = best.path;
    const [sx, sy] = path[0], [s2x, s2y] = path[2], dl = Math.hypot(s2x - sx, s2y - sy) || 1;
    ctx.fillStyle = color;
    ctx.fillText(text, sx - (s2x - sx) / dl * size * .9 - tw / 2, sy - (s2y - sy) / dl * size * .9 + size * .35);
    // A thin paper-coloured halo keeps the red line legible where it crosses ink.
    for (const [w, c] of [[Math.max(4, size * .3), "rgba(246,243,236,.85)"], [Math.max(1.5, size * .11), color]] as const) {
      ctx.lineWidth = w; ctx.strokeStyle = c;
      ctx.beginPath();
      path.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
      ctx.stroke();
    }
    const [ex, ey] = path[path.length - 1], [px, py] = path[path.length - 3];
    const ang = Math.atan2(ey - py, ex - px), head = size * .5;
    ctx.beginPath();
    ctx.moveTo(ex + Math.cos(ang) * head * .4, ey + Math.sin(ang) * head * .4);
    ctx.lineTo(ex - Math.cos(ang - .5) * head, ey - Math.sin(ang - .5) * head);
    ctx.lineTo(ex - Math.cos(ang + .5) * head, ey - Math.sin(ang + .5) * head);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

export interface ShodoBrushProfileProps extends Omit<CanvasHTMLAttributes<HTMLCanvasElement>, "children" | "width" | "height"> {
  plan: ShodoPlan;
  frame: number;
  fps?: number;
  /** Canvas size, px. */
  width: number;
  height: number;
  /** The sheet of paper in the plan's design px; the view spans its width. */
  paper: ShodoRect;
  /** How much of the page depth shows, 0 (edge-on) .. 0.5. */
  depth?: number;
  brushLook?: Partial<ShodoBrushLook>;
  pixelRatio?: number;
  label?: string;
}

/**
 * The same writing seen from the writer's side, like side-view teaching videos: the page at
 * a grazing angle with its ink, and the brush in profile, so its lean, its height and the
 * bend of the tuft can be read directly. Frame-addressed like `ShodoCanvas`.
 */
export const ShodoBrushProfile = forwardRef<HTMLCanvasElement, ShodoBrushProfileProps>(function ShodoBrushProfile({
  plan, frame, fps = 30, width, height, paper, depth = .22, brushLook, pixelRatio, label, style, ...props
}, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useImperativeHandle(ref, () => canvasRef.current as HTMLCanvasElement);
  const dpr = pixelRatio ?? (typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1));
  const surface = useMemo(() => new ShodoInkSurface(plan, { ...paper, scale: 1 }), [plan, paper]);
  const inkCanvas = useMemo(() => typeof document === "undefined" ? null : document.createElement("canvas"), []);
  const look = useMemo(() => ({ ...DEFAULT_BRUSH_LOOK, ...brushLook }), [brushLook]);
  const [textures, setTextures] = useState<ShodoTextures | null>(null);
  useEffect(() => {
    let live = true;
    loadShodoTextures().then(t => { if (live) setTextures(t); }).catch(() => { if (live) setTextures(null); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current, ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !inkCanvas) return;
    const seconds = Math.max(0, frame) / fps;
    // Design px → canvas: fit the page and the whole standing brush; the page sits low.
    const brushTall = plan.brush.tuftLength * (1 + plan.style.brush.handleLength) * 1.08;
    const s = Math.min(width / (paper.width * 1.35), height * .9 / (brushTall + paper.height * depth));
    const ox = paper.x + paper.width / 2 - width / (2 * s);
    const ground = height * .94 / s;
    const cam: ShodoCamera = { x: 0, y: paper.y + paper.height, height: 1, view: "side", ground, depth };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, "#E9E6DF"); bg.addColorStop(.75, "#D6D1C6"); bg.addColorStop(1, "#BDB6A8");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, -ox * s * dpr, 0);
    // Felt underlay and the page, seen at a grazing angle.
    const far = ground - paper.height * depth;
    ctx.fillStyle = "#1C1F2C";
    ctx.fillRect(ox, far - 14 / s, width / s, ground - far + 26 / s);
    ctx.fillStyle = plan.style.paper.color;
    ctx.fillRect(paper.x, far, paper.width, ground - far);
    const ink = surface.render(seconds);
    if (inkCanvas.width !== ink.width || inkCanvas.height !== ink.height) { inkCanvas.width = ink.width; inkCanvas.height = ink.height; }
    inkCanvas.getContext("2d")?.putImageData(new ImageData(ink.rgba, ink.width, ink.height), 0, 0);
    ctx.save();
    ctx.translate(0, ground + (paper.y - cam.y) * depth);
    ctx.scale(1, depth);
    ctx.drawImage(inkCanvas, paper.x, 0, paper.width, paper.height);
    ctx.restore();
    // Page edge highlight.
    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.fillRect(paper.x, ground - 1 / s, paper.width, 2 / s);
    const pose = shodoBrushPose(plan, seconds);
    drawShodoBrush(ctx, cam, pose, plan.style.brush, plan.style.ink, plan.brush.diameter, look, plan.style.seed);
  }, [frame, fps, plan, surface, inkCanvas, width, height, paper, depth, dpr, look, textures]);
  return <canvas {...props} ref={canvasRef} role="img" aria-label={label ?? "The brush seen from the side while writing"}
    data-km-shodo-profile="" data-km-shodo-frame={frame} data-km-shodo-ready={textures ? "true" : "false"}
    width={Math.round(width * dpr)} height={Math.round(height * dpr)}
    style={{ width: "100%", height: "auto", aspectRatio: `${width} / ${height}`, display: "block", ...style }} />;
});
