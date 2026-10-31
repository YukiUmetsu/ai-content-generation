/**
 * Page-Turn Story. Causal beat:
 *   input      a bound book of illustrated spreads on a lit desk
 *   transform  the camera moves from the establishing view to reading distance;
 *              a leaf peels at its corner, bends around the fixed spine,
 *              trails through the air and settles with one small hop
 *   output     the next spread, held long enough to read.
 * The page bend, the turn timing and the camera are pure functions of the frame
 * (page-curl.ts). The WebGL book (page-turn-book.ts) is optional and supplied by
 * the host through PageTurnRendererContext, so the foundation carries no 3D
 * dependency; without it, without WebGL, or with renderer "flat", a 2.5D book
 * drawn from the same pages and the same curl takes its place.
 */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ComponentType, CSSProperties } from "react";
import type { BookPageFace, BookSpread, ImageAsset, SceneTemplateFrame, SceneTemplateSpec } from "../scene-templates";
import { pageTurnSpreads } from "../scene-templates";
import { bookFaces, bookMoment, bookShape, cameraAt, clamp01, fitDistance, leafRow, turnSchedule } from "./page-curl";
import type { BookCamera, BookFrameState, BookShape, CameraKey, TurnCue } from "./page-curl";
import { paintPageEdge, paintPageFace } from "./page-face";
import type { PageFaceReport } from "./page-face";
import { FilmFinish, KineticWords, fitLongestWord, srOnly } from "./stage-kit";

export type PageTurnStoryContent = SceneTemplateSpec<"page-turn-story">["content"];
type Content = PageTurnStoryContent;
export const PAGE_TEXTURE_WIDTH = 1024;
export const defaultSerif = `"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua","Hiragino Mincho ProN","Yu Mincho","Noto Serif CJK JP","Songti SC",Georgia,serif`;

/* ------------------------------------------------------------------------ */
/* Pages                                                                     */

export interface PaintedFace { color: HTMLCanvasElement; roughness: HTMLCanvasElement; report: PageFaceReport; face: BookPageFace }
export interface PaintedBook { faces: PaintedFace[]; edge: HTMLCanvasElement; paperNormal?: HTMLImageElement }
const imageCache = new Map<string, Promise<HTMLImageElement>>();
/** Decodes an image once; rejects instead of drawing a substitute. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  let job = imageCache.get(src);
  if (!job) {
    job = new Promise((resolve, reject) => {
      const img = new Image(); img.crossOrigin = "anonymous"; img.decoding = "async";
      img.onload = () => resolve(img); img.onerror = () => reject(new Error("Could not load " + src));
      img.src = src;
    });
    imageCache.set(src, job); job.catch(() => imageCache.delete(src));
  }
  return job;
}
const paintKey = (c: Content, shape: BookShape) => JSON.stringify([pageTurnSpreads(c), c.paper, c.typography, shape.aspect, c.environment?.light?.warmth]);
/** Faces in book order: spread k left is 2k, right is 2k + 1. */
export const facesOf = (spreads: BookSpread[]) => spreads.flatMap(s => [s.left, s.right]);
/** Paints every page face of a book once per authored input set; shared by the stage and the
 * cinematic `epic-book` template so both print identical pages. */
export function usePaintedBook(c: Content, shape: BookShape, accent: string): { book?: PaintedBook; error?: string } {
  const key = paintKey(c, shape) + accent;
  const [state, setState] = useState<{ key: string; book?: PaintedBook; error?: string }>({ key: "" });
  useEffect(() => {
    let live = true;
    const spreads = pageTurnSpreads(c), faces = facesOf(spreads);
    const assets = new Map<string, ImageAsset>();
    faces.forEach(f => f.image && assets.set(f.image.id, f.image));
    const detail = c.paper?.texture?.color, normal = c.paper?.texture?.normal;
    const fonts = (typeof document !== "undefined" && document.fonts?.ready) || Promise.resolve();
    Promise.all([Promise.all([...assets.values()].map(a => loadImage(a.src).then(img => [a.id, img] as const))),
      detail ? loadImage(detail.src) : undefined, normal ? loadImage(normal.src) : undefined, fonts])
      .then(([images, paperDetail, paperNormal]) => {
        if (!live) return;
        const byId = new Map(images);
        const W = PAGE_TEXTURE_WIDTH, H = Math.round(W * shape.aspect);
        const canvas = (w: number, h: number) => { const el = document.createElement("canvas"); el.width = w; el.height = h; return el; };
        const ctxOf = (el: HTMLCanvasElement) => { try { return el.getContext("2d"); } catch { return null; } };
        const paper = c.paper?.color ?? "#efe4cc", ink = c.paper?.ink ?? "#2a2219", pageAccent = c.paper?.accent ?? "#9a3b22";
        const painted = faces.map((face, i) => {
          const color = canvas(W, H), roughness = canvas(W, H), cc = ctxOf(color), rc = ctxOf(roughness);
          const opts = { width: W, height: H, side: (i % 2 ? "right" : "left") as "left" | "right", paper, ink, accent: pageAccent,
            headingFont: c.typography?.headingFont ?? defaultSerif, bodyFont: c.typography?.bodyFont ?? defaultSerif,
            roughness: c.paper?.roughness ?? .9, age: c.paper?.age ?? .35, seed: spreads[i >> 1].id + (i % 2),
            paperDetail: paperDetail, image: (a: ImageAsset) => byId.get(a.id) };
          const report = cc ? paintPageFace(cc, face, opts, "color") : { bodySize: 0, overflow: false, layout: "text" as const };
          if (rc) paintPageFace(rc, face, opts, "roughness");
          return { color, roughness, report, face };
        });
        const edge = canvas(64, 256), ec = ctxOf(edge);
        if (ec) paintPageEdge(ec, 64, 256, paper, spreads[0].id, c.paper?.edgeColor);
        setState({ key, book: { faces: painted, edge, paperNormal } });
      }, e => live && setState({ key, error: e instanceof Error ? e.message : String(e) }));
    return () => { live = false; };
    // The key captures every input the painting reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state : {};
}

/* ------------------------------------------------------------------------ */
/* Camera plan                                                                */

/** Authored framing per output aspect. Landscape keeps the title column on the left during the establishing shot. */
export function pageTurnCameraKeys(c: Content, shape: BookShape, aspect: number, schedule: readonly TurnCue[], establishEnd: number, durationFrames: number): CameraKey[] {
  const fov = 30, portrait = aspect < 1, side = c.direction === "right" ? -1 : 1, h = shape.aspect, top = shape.board + shape.block;
  const shot = (target: [number, number, number], yaw: number, pitch: number, width: number, depth: number, user?: { yaw?: number; pitch?: number; zoom?: number }): BookCamera => {
    const p = user?.pitch ?? pitch;
    return { target, yaw: user?.yaw ?? yaw, pitch: p, fov, distance: fitDistance(width, depth, aspect, fov, p) / (user?.zoom ?? 1) };
  };
  const cam = c.camera ?? {};
  const establish = portrait
    ? shot([0, top, h * .12], -16, 40, 2.7, h + .8, cam.establish)
    : shot([-.6, top, .08], -22, 33, 3.3, h + .9, cam.establish);
  const far = { ...establish, distance: establish.distance * 1.22, yaw: establish.yaw - 7 };
  // Reading distance. The book sits high in frame so the caption band below stays on the dark desk.
  // Landscape reads the whole spread, then eases in towards the text page; portrait reads the text page, then its plate.
  const text = (-side) as -1 | 1;
  const read = (looking: -1 | 1 | 0, close = false): BookCamera => portrait
    ? shot([looking * .5, top, .16], -3, 68, 1.16, h * 1.16, cam.read)
    : close ? shot([text * .3, top, .14], -4, 64, 1.75, h * 1.22, cam.read) : shot([0, top, .16], -5, 62, 2.3, h * 1.32, cam.read);
  // The turn is seen lower and wider, with headroom for the leaf standing upright over the spine.
  // A standing leaf is not foreshortened like the desk: frame its full height (about one page width) explicitly.
  const turnShot = (target: [number, number, number], yaw: number, pitch: number, width: number): BookCamera => {
    const s = shot(target, yaw, pitch, width, h, cam.turn), p = s.pitch * Math.PI / 180;
    const tall = (1.12 * Math.cos(p) + h * Math.sin(p) + .3) / (2 * Math.tan(fov * Math.PI / 360));
    return { ...s, distance: Math.max(s.distance, tall / (cam.turn?.zoom ?? 1)) };
  };
  const turn = portrait ? turnShot([0, top + .5, .1], -10, 30, 2.35) : turnShot([side * .04, top + .5, .06], -14, 28, 2.8);
  const keys: CameraKey[] = [{ at: 0, shot: far, move: 1 }, { at: establishEnd, shot: establish, move: establishEnd }];
  const move = 40;
  let cursor = establishEnd;
  const add = (at: number, s: BookCamera, m: number) => { const a = Math.max(at, cursor + 2); keys.push({ at: a, shot: s, move: Math.max(8, Math.min(m, a - cursor)) }); cursor = a; };
  const hold = (until: number) => {
    // A second, slower move inside the reading hold: towards the text in landscape, across to the plate in portrait.
    if (until - cursor < 48) return;
    if (portrait) add(Math.min(until, Math.round((cursor + until) / 2) + 20), read((-text) as -1 | 1), 40);
    else add(until, read(0, true), until - cursor);
  };
  add(establishEnd + move, read(portrait ? text : 0), move);
  schedule.forEach(t => {
    hold(t.at - 24);
    add(t.at + 8, turn, 32);
    add(t.at + t.frames + 34, read(portrait ? text : 0), 34);
  });
  hold(durationFrames - 1);
  return keys;
}

/* ------------------------------------------------------------------------ */
/* Renderer slot                                                               */

export interface PageTurnRendererProps {
  spec: SceneTemplateSpec<"page-turn-story">;
  shape: BookShape;
  painted: PaintedBook;
  state: BookFrameState;
  frame: number;
  /** Drawing-buffer size in pixels. */
  pixelWidth: number; pixelHeight: number;
  /** Reports WebGL failure so the stage can switch to the 2.5D book. */
  onUnavailable: (reason: string) => void;
}
/** Host-provided 3D book renderer (see page-turn-book-canvas.tsx). */
export const PageTurnRendererContext = createContext<ComponentType<PageTurnRendererProps> | undefined>(undefined);

/* ------------------------------------------------------------------------ */
/* 2.5D book                                                                    */

const url = (el: HTMLCanvasElement) => { try { return el.toDataURL("image/jpeg", .9); } catch { return ""; } };
/**
 * CSS 3D book through the same orbit camera: the desk plane, two page blocks
 * with fore edges and boards, and the turning leaf as vertical strips placed
 * by the same curl integration as the mesh, each shaded by its own angle.
 * Shared with the cinematic `epic-book` template; `height` is the drawing
 * height in pixels, so the fallback matches the WebGL camera at any stage size.
 */
export function PageTurnFlatBook({ c, shape, painted, state, height }: { c: Content; shape: BookShape; painted?: PaintedBook; state: BookFrameState; height: number }) {
  const urls = useMemo(() => painted ? painted.faces.map(f => url(f.color)) : [], [painted]);
  const edgeUrl = useMemo(() => painted ? url(painted.edge) : "", [painted]);
  const cam = state.camera, h = shape.aspect, top = shape.board + shape.block;
  const P = height / 2 / Math.tan(cam.fov * Math.PI / 360), k = height * .5;
  const paper = c.paper?.color ?? "#efe4cc", side = c.direction === "right" ? -1 : 1;
  const desk = c.environment?.surface, deskMap = desk?.maps?.color?.src, coverMap = c.cover?.maps?.color?.src;
  const face = (i: number): CSSProperties => ({ backgroundColor: paper, backgroundImage: urls[i] ? `url(${urls[i]})` : undefined, backgroundSize: "100% 100%" });
  const abs: CSSProperties = { position: "absolute", left: 0, top: 0, transformStyle: "preserve-3d" };
  const px = (n: number) => `${(n * k).toFixed(2)}px`;
  // Book space (x right, y up, z down the page) → CSS (x right, y down the page, z up).
  const world = `translateZ(${(P - cam.distance * k).toFixed(2)}px) rotateX(${(90 - cam.pitch).toFixed(3)}deg) rotateZ(${(-cam.yaw).toFixed(3)}deg) translate3d(${px(-cam.target[0])},${px(-cam.target[2])},${px(-cam.target[1])})`;
  const segments = 28, xs = new Float32Array(segments + 1), ys = new Float32Array(segments + 1), as = new Float32Array(segments + 1);
  if (state.leaf) leafRow(shape, state.leaf.bend, .5, segments, { x: xs, y: ys, angle: as });
  const lightAz = (c.environment?.light?.azimuth ?? 320) * Math.PI / 180;
  const block = (s: 1 | -1, i: number) => <div key={s} style={{ ...abs }}>
    <div style={{ ...abs, ...face(i), width: px(1), height: px(h), transform: `translate3d(${px(s > 0 ? 0 : -1)},${px(-h / 2)},${px(top)})`,
      boxShadow: "inset 0 0 0 1px rgba(80,60,30,.12)" }}/>
    <div style={{ ...abs, width: px(shape.block), height: px(h), backgroundImage: edgeUrl ? `url(${edgeUrl})` : undefined, backgroundColor: paper, backgroundSize: "100% 100%",
      transformOrigin: "0 0", transform: `translate3d(${px(s)},${px(-h / 2)},${px(shape.board)}) rotateY(-90deg)` }}/>
  </div>;
  return <div aria-hidden="true" data-km-book-flat="" style={{ position: "absolute", inset: 0, overflow: "hidden", perspective: `${P.toFixed(1)}px`, perspectiveOrigin: "50% 50%" }}>
    <div style={{ ...abs, left: "50%", top: "50%", transform: world }}>
      <div style={{ ...abs, width: px(18), height: px(18), transform: `translate3d(${px(-9)},${px(-9)},0)`,
        backgroundColor: desk?.color ?? "#6b4a30", backgroundImage: deskMap ? `url(${deskMap})` : undefined, backgroundSize: `${px(18 / (desk?.maps?.repeat ?? 2.2))} ${px(18 / (desk?.maps?.repeat ?? 2.2))}`,
        backgroundBlendMode: "multiply" }}/>
      <div style={{ ...abs, width: px(2.6), height: px(h + .4), transform: `translate3d(${px(-1.3)},${px(-h / 2 - .2)},.5px)`,
        background: "radial-gradient(closest-side,rgba(0,0,0,.55),rgba(0,0,0,0))", filter: "blur(6px)" }}/>
      <div style={{ ...abs, width: px(2 + shape.squares * 2), height: px(h + shape.squares * 2), transform: `translate3d(${px(-1 - shape.squares)},${px(-h / 2 - shape.squares)},${px(shape.board)})`,
        backgroundColor: c.cover?.color ?? "#24402f", backgroundImage: coverMap ? `url(${coverMap})` : undefined, backgroundSize: `${px(.3)} ${px(.3)}`, backgroundBlendMode: "multiply", borderRadius: px(.01) }}/>
      {block(1, state.right)}{block(-1, state.left)}
      {state.leaf && Array.from({ length: segments }, (_, i) => {
        const phi = as[i], x0 = xs[i], y0 = ys[i], w = Math.hypot(xs[i + 1] - x0, ys[i + 1] - y0);
        // Lambert shade of this strip against the key light's height and side.
        const nx = -Math.sin(phi) * side, ny = Math.cos(phi), lit = Math.max(0, nx * Math.sin(lightAz) * .55 + ny * .85);
        const slice = (f: number, back: boolean): CSSProperties => {
          const u = back ? 1 - (i + 1) / segments : i / segments;
          return { ...abs, width: "100%", height: "100%", backfaceVisibility: "hidden", backgroundColor: paper, backgroundImage: urls[f] ? `url(${urls[f]})` : undefined,
            backgroundSize: `${px(1)} ${px(h)}`, backgroundPosition: `${px(-(side > 0 ? u : 1 - u - 1 / segments))} 0`,
            transform: back ? "rotateY(180deg)" : undefined };
        };
        return <div key={i} style={{ ...abs, width: `${(w * k + .8).toFixed(2)}px`, height: px(h), transformOrigin: "0 0",
          transform: `translate3d(${px(side * x0)},${px(-h / 2)},${px(y0)}) rotateY(${side > 0 ? -phi : phi - Math.PI}rad)` }}>
          <div style={slice(state.leaf!.front, false)}><div style={{ position: "absolute", inset: 0, background: `rgba(30,18,8,${(.42 * (1 - lit)).toFixed(3)})` }}/></div>
          <div style={slice(state.leaf!.back, true)}><div style={{ position: "absolute", inset: 0, background: `rgba(30,18,8,${(.42 * lit).toFixed(3)})` }}/></div>
        </div>;
      })}
    </div>
  </div>;
}

/* ------------------------------------------------------------------------ */
/* Stage                                                                        */

/** Establishing hold before the first move to reading distance. */
export const establishFrames = (spec: SceneTemplateSpec<"page-turn-story">) => Math.round(spec.cueFrames?.[0] ?? spec.durationFrames * .15);

export function PageTurnStoryStage({ spec, f }: { spec: SceneTemplateSpec<"page-turn-story">; f: SceneTemplateFrame }) {
  const c = spec.content, w = spec.width, h = spec.height, portrait = h > w, t = f.frame, reduced = f.reducedMotion, aspect = w / h;
  const spreads = pageTurnSpreads(c);
  const shape = useMemo(() => bookShape({ ...c.book, leaf: c.paper?.thickness }), [c.book, c.paper?.thickness]);
  const side: 1 | -1 = c.direction === "right" ? -1 : 1;
  const accent = spec.accent ?? "#a3462c";
  const E = establishFrames(spec);
  const schedule = useMemo(() => turnSchedule(spreads.length, f.durationFrames, c.turns, E), [spreads.length, f.durationFrames, c.turns, E]);
  const keys = useMemo(() => pageTurnCameraKeys(c, shape, aspect, schedule, E, f.durationFrames), [c, shape, aspect, schedule, E, f.durationFrames]);
  const moment = bookMoment(t, schedule, reduced);
  const camera = reduced ? (t < E ? keys[1].shot : keys.find(k => k.at > E + 1)!.shot) : cameraAt(t, keys);
  const state: BookFrameState = { ...bookFaces(moment, side, c.stiffness ?? .45), camera, aspect };
  const { book, error } = usePaintedBook(c, shape, accent);
  const Renderer = useContext(PageTurnRendererContext);
  const [glFailed, setGlFailed] = useState<string | undefined>();
  const use3d = !!Renderer && c.renderer !== "flat" && !glFailed;
  const look = c.look ?? {}, warmth = look.warmth ?? .35;
  const backdrop = c.environment?.backdrop ?? "#0d0906";
  const serif = c.typography?.headingFont ?? defaultSerif;

  // Copy timing: title over the establishing shot; then a running head, and each spread's caption while it is read.
  const titleOut = E + 26;
  const titleOpacity = reduced ? (t < titleOut ? 1 : 0) : 1 - clamp01((t - titleOut) / 14);
  // The running head waits until the title has gone: in portrait both share the top band.
  const headOpacity = reduced ? (t >= titleOut + 14 ? 1 : 0) : clamp01((t - titleOut - 14) / 14);
  const arrive = (s: number) => s === 0 ? E + 40 : schedule[s - 1].at + schedule[s - 1].frames + 24;
  const leave = (s: number) => s < schedule.length ? schedule[s].at - 16 : f.durationFrames + 99;
  const captionSpread = moment.turning >= 0 ? moment.turning : moment.spread;
  const caption = spreads[captionSpread]?.caption;
  const capIn = arrive(captionSpread), capOut = leave(captionSpread);
  const capOpacity = !caption ? 0 : reduced ? (t >= capIn && t < capOut ? 1 : 0) : Math.min(clamp01((t - capIn) / 14), clamp01((capOut - t) / 12));
  const shown = spreads[moment.spread];
  const overflow = book?.faces.filter(p => p.report.overflow).map((_, i) => i) ?? [];
  const short = portrait ? "1cqw" : "0.5625cqw";
  const em = (n: number) => `calc(${short} * ${n})`;

  return <div data-km-book-state={error ? "error" : book ? "ready" : "loading"} data-km-book-renderer={use3d ? "webgl" : "flat"}
    data-km-book-textures={error ? "error" : book ? "ready" : "pending"}
    data-km-book-spread={moment.spread} data-km-book-turn={moment.turning} data-km-book-turn-progress={moment.progress.toFixed(4)}
    data-km-page-overflow={overflow.length ? overflow.join(" ") : undefined}
    style={{ position: "absolute", inset: 0, overflow: "hidden", background: backdrop, fontFamily: serif }}>
    {book && use3d && Renderer && <Renderer spec={spec} shape={shape} painted={book} state={state} frame={t} pixelWidth={w * 2} pixelHeight={h * 2} onUnavailable={setGlFailed}/>}
    {(!use3d || !book) && <PageTurnFlatBook c={c} shape={shape} painted={book} state={state} height={h}/>}
    {error && <div role="alert" style={{ position: "absolute", left: "6%", right: "6%", bottom: "6%", fontSize: em(2.6), color: "#f3e7d3" }}>{error}</div>}
    {/* Grade: warm lamp light, a little lift in the shadows. */}
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", mixBlendMode: "soft-light",
      background: `radial-gradient(ellipse 80% 70% at 56% 42%,rgba(255,190,120,${(.28 * Math.max(0, warmth)).toFixed(3)}),rgba(40,70,110,${(.2 * Math.max(0, -warmth) + .06).toFixed(3)}) 100%)` }}/>
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: Math.max(titleOpacity, capOpacity * .9),
      background: portrait
        ? "linear-gradient(180deg,rgba(8,5,3,.72) 0%,rgba(8,5,3,0) 30%,rgba(8,5,3,0) 68%,rgba(8,5,3,.78) 100%)"
        : `linear-gradient(90deg,rgba(8,5,3,${(.78 * titleOpacity).toFixed(3)}) 0%,rgba(8,5,3,0) 50%),linear-gradient(0deg,rgba(8,5,3,${(.78 * capOpacity).toFixed(3)}) 0%,rgba(8,5,3,0) 30%)` }}/>
    {/* Running-head band: keeps the small caps legible over a bright page in close shots. */}
    <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: portrait ? "11%" : "17%", pointerEvents: "none", opacity: headOpacity,
      background: "linear-gradient(180deg,rgba(8,5,3,.62) 0%,rgba(8,5,3,.28) 55%,rgba(8,5,3,0) 100%)" }}/>
    <FilmFinish frame={t} reduced={reduced} grain={look.grain ?? .6} vignette={look.vignette ?? 1} vignetteStrength={.55}/>
    <div data-km-book-title="" style={{ position: "absolute", left: portrait ? "7%" : "5.5%", top: portrait ? "6%" : "auto", bottom: portrait ? "auto" : "14%",
      width: portrait ? "86%" : "40%", fontSize: em(portrait ? 9 : 10), opacity: titleOpacity, color: "#f6ecda", textShadow: "0 .05em .5em rgba(0,0,0,.6)", pointerEvents: "none" }}>
      {c.eyebrow && <div data-km-book-eyebrow="" style={{ fontSize: em(2.7), fontWeight: 600, letterSpacing: ".18em", textTransform: "uppercase",
        color: "var(--km-accent, #e0a46a)", marginBottom: ".5em", fontFamily: "var(--km-font-body, system-ui, sans-serif)" }}>{c.eyebrow}</div>}
      <h2 style={{ margin: 0, fontSize: fitLongestWord(c.documentTitle, 1, portrait ? 84 : 38),
        fontWeight: 500, letterSpacing: "-.02em", lineHeight: 1.04, textWrap: "balance" }}>
        <KineticWords text={c.documentTitle} start={2} stagger={3} length={18} frame={t} reduced={reduced} marker="book"/>
      </h2>
    </div>
    <div data-km-book-running-head="" style={{ position: "absolute", left: portrait ? "7%" : "5%", right: portrait ? "7%" : "5%", top: portrait ? "4.5%" : "6%",
      display: "flex", justifyContent: "space-between", gap: "1em", alignItems: "baseline", opacity: headOpacity, color: "rgba(246,236,218,.92)", pointerEvents: "none",
      fontFamily: "var(--km-font-body, system-ui, sans-serif)", fontSize: em(2.4), letterSpacing: ".14em", textTransform: "uppercase", textShadow: "0 1px 8px rgba(0,0,0,.8)" }}>
      <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{c.eyebrow ? `${c.eyebrow} · ${c.documentTitle}` : c.documentTitle}</span>
    </div>
    {caption && <p data-km-book-caption="" aria-hidden={capOpacity < .5 || undefined} style={{ position: "absolute", left: portrait ? "7%" : "5.5%", right: portrait ? "7%" : "auto",
      bottom: portrait ? "6%" : "7%", maxWidth: portrait ? "86%" : "52%", margin: 0, opacity: capOpacity,
      transform: `translate3d(0,${((1 - capOpacity) * .4).toFixed(3)}em,0)`, color: "#fbf3e4", fontSize: em(portrait ? 5 : 4.6), fontWeight: 500, lineHeight: 1.18,
      letterSpacing: "-.01em", textWrap: "balance", textShadow: "0 .04em .6em rgba(0,0,0,.7)" }}>{caption}</p>}
    {c.credit && <div data-km-book-credit="" style={{ position: "absolute", right: portrait ? "7%" : "4%", bottom: portrait ? "2%" : "3%", maxWidth: portrait ? "86%" : "40%",
      textAlign: "right", opacity: Math.max(titleOpacity, .0) * .9, color: "rgba(246,236,218,.85)", fontSize: em(2.3), fontFamily: "var(--km-font-body, system-ui, sans-serif)",
      textShadow: "0 1px 6px rgba(0,0,0,.8)", pointerEvents: "none" }}>{c.credit}</div>}
    {/* The page text is printed into textures; assistive tech gets it here. */}
    <div style={srOnly} aria-live="polite">
      {[shown.left, shown.right].map((p, i) => <div key={i}>{p.heading && <h3>{p.heading}</h3>}{p.text && <p>{p.text}</p>}
        {p.image && <p>{p.image.alt}</p>}{p.caption && <p>{p.caption}</p>}</div>)}
    </div>
  </div>;
}
