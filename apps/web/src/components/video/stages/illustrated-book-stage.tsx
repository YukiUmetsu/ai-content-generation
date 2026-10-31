/**
 * Illustrated Book into Living World. Causal beat:
 *   input      a tactile book open on a table: text left, illustration right
 *   transform  a physically curved leaf turns about the spine to the next
 *              spread; the camera rises and pushes into its illustration until
 *              it fills the frame, and the painted page dissolves into the
 *              living scene it depicts (same composition, same aspect)
 *   output     the world held alive (light, mist, drifting motes) under the
 *              chapter title and line.
 * The leaf is 24 strips whose positions integrate a bending angle along the
 * page, so the sheet genuinely curves; the world lives inside the portal art's
 * own box, so the match is registered at every frame. Pure function of the frame.
 * Separate from `page-turn-story`; shared pieces can be consolidated later.
 */
import { useContext } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { IllustratedBookSpread, SceneTemplateFrame, SceneTemplateSpec } from "../scene-templates";
import type { AnnotationBeats } from "../subject-annotations";
import { annotationState } from "../subject-annotations";
import { Asset, FilmFinish, KineticWords, OverlayRendererContext, RiseIn, clamp01, cueAt, easeInOut, filmGrain, fitLongestWord, span01 } from "./stage-kit";

/** Page geometry in book em. */
const PW = 16, PH = 22, ART_M = 1.6, ART_TOP = 2.4;
export interface LeafStrip { s0: number; s1: number; x: number; z: number; phi: number }
/**
 * Curved leaf at turn progress p (0..1), in page widths. The free edge lags the
 * spine (φ falls along the sheet), so the sheet bows like paper; flat at both ends.
 */
export function leafStrips(p: number, strips = 24, curl = 1): LeafStrip[] {
  const t = easeInOut(p), theta = Math.PI * t, bend = curl * Math.sin(Math.PI * clamp01(p)) * 1.25;
  const out: LeafStrip[] = [];
  let x = 0, z = 0;
  for (let i = 0; i < strips; i++) {
    const s0 = i / strips, s1 = (i + 1) / strips, mid = (s0 + s1) / 2;
    const phi = Math.max(0, Math.min(Math.PI, theta - bend * Math.pow(mid, 1.6) + bend * .55 * Math.pow(mid, 3) * (t > .5 ? 1 : 0)));
    out.push({ s0, s1, x, z, phi });
    x += (s1 - s0) * Math.cos(phi); z += (s1 - s0) * Math.sin(phi);
  }
  return out;
}
const paperBase = (paper: string): CSSProperties => ({ position: "absolute", inset: 0, background: paper });
function PaperGrain() {
  return <div aria-hidden="true" style={{ position: "absolute", inset: 0, backgroundImage: filmGrain, backgroundSize: "9em 9em", mixBlendMode: "multiply", opacity: .22, pointerEvents: "none" }}/>;
}
function LeftPage({ spread, paper, ink }: { spread: IllustratedBookSpread; paper: string; ink: string }) {
  return <div data-km-book-page={`${spread.id}-text`} style={{ ...paperBase(paper), color: ink, padding: `${ART_TOP}em 1.9em 0`, boxSizing: "border-box", fontFamily: "var(--km-font-serif, Georgia, 'Times New Roman', serif)" }}>
    {spread.label && <div style={{ fontSize: ".72em", letterSpacing: ".22em", textTransform: "uppercase", opacity: .7, marginBottom: ".9em" }}>{spread.label}</div>}
    <div style={{ fontSize: fitLongestWord(spread.heading, 1.9, 23), fontWeight: 600, lineHeight: 1.08, letterSpacing: "-.01em", textWrap: "balance" }}>{spread.heading}</div>
    <div aria-hidden="true" style={{ width: "3.2em", height: ".12em", background: ink, opacity: .55, margin: "1em 0 1.1em" }}/>
    {spread.text && <div style={{ fontSize: "1.05em", lineHeight: 1.5, textWrap: "pretty", opacity: .92 }}>{spread.text}</div>}
    <PaperGrain/>
    {/* Gutter: pages bow down into the binding. */}
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "linear-gradient(90deg,transparent 70%,rgba(60,40,20,.12) 88%,rgba(40,25,10,.38) 100%)" }}/>
  </div>;
}
function RightPage({ spread, paper, ink, portal, fade = 0 }: { spread: IllustratedBookSpread; paper: string; ink: string; portal?: ReactNode; fade?: number }) {
  const artW = PW - ART_M * 2, artH = artW * spread.art.height! / spread.art.width!;
  return <div data-km-book-page={`${spread.id}-art`} style={{ ...paperBase(paper), color: ink, fontFamily: "var(--km-font-serif, Georgia, 'Times New Roman', serif)" }}>
    <div data-km-book-art={spread.id} style={{ position: "absolute", left: `${ART_M}em`, top: `${ART_TOP}em`, width: `${artW}em`, height: `${artH}em`, overflow: "hidden",
      boxShadow: `0 0 0 .06em ${ink}55` }}>
      <Asset asset={spread.art} style={{ borderRadius: 0 }}/>
      {portal}
    </div>
    {spread.caption && <div style={{ position: "absolute", left: `${ART_M}em`, right: `${ART_M}em`, top: `${ART_TOP + artH + .8}em` }}>
      <div style={{ fontSize: ".9em", fontStyle: "italic", lineHeight: 1.4, opacity: .82 * (1 - fade), textWrap: "balance" }}>{spread.caption}</div>
    </div>}
    <PaperGrain/>
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "linear-gradient(270deg,transparent 70%,rgba(60,40,20,.1) 88%,rgba(40,25,10,.36) 100%)" }}/>
  </div>;
}

export function IllustratedBookStage({ spec, f }: { spec: SceneTemplateSpec<"illustrated-book-into-living-world">; f: SceneTemplateFrame }) {
  const c = spec.content, w = spec.width, h = spec.height, portrait = h > w, t = f.frame, reduced = f.reducedMotion;
  const dock = cueAt(f, 0), reveal = cueAt(f, 1), resolve = cueAt(f, 2);
  const paper = c.book?.paper ?? "#efe3c8", ink = c.book?.ink ?? "#2c241c", cover = c.book?.cover ?? "#3b2a20";
  const lightColor = c.light?.color ?? "#ffd9a6";
  const spreads = c.spreads, turns = spreads.length - 1;
  // Turns share dock → (reveal − hold) evenly; each turn takes 85% of its slot, the rest is reading time.
  const hold = Math.min(36, (reveal - dock) * .3), slot = (reveal - hold - dock) / turns;
  const turnIndex = reduced ? -1 : Math.min(turns - 1, Math.floor((t - dock) / slot));
  const turnP = turnIndex < 0 || t < dock ? 0 : clamp01((t - dock - turnIndex * slot) / (slot * .85));
  const turning = !reduced && t >= dock && turnIndex >= 0 && turnP > 0 && turnP < 1;
  const settled = reduced ? (t >= dock ? turns : 0) : t < dock ? 0 : Math.min(turns, turnIndex + (turnP >= 1 ? 1 : 0));
  const leftSpread = spreads[turning ? turnIndex : settled], rightSpread = spreads[turning ? turnIndex + 1 : settled];
  // Camera: settle on the book from frame 0, then rise and push into the portal art on the reveal.
  const bookScale = portrait ? .78 : 1;
  const stageW = (portrait ? 1 / .035 : 1 / .02) / bookScale, stageH = stageW * h / w;
  const portal = spreads[turns].art, artW = PW - ART_M * 2, artH = artW * portal.height! / portal.width!;
  // Portal art centre relative to the book centre (the right page starts at the spine).
  const artCx = ART_M + artW / 2, artCy = -PH / 2 + ART_TOP + artH / 2;
  const cover0 = Math.max(stageW / artW, stageH / artH);
  const push = reduced ? (t >= reveal ? 1 : 0) : easeInOut(span01(t, reveal, resolve));
  const settle = reduced ? 1 : 1 - Math.pow(1 - span01(t, 0, dock + 30), 3);
  const alive = reduced ? 0 : span01(t, resolve, f.durationFrames);
  const rest = portrait ? 1.24 : 1.1;
  const scale = rest * (.9 + .1 * settle) * (1 - push) + cover0 * (1 + .05 * alive) * push;
  const tilt = 24 * (1 - push), lift = (1 - settle) * 1.2;
  const tx = -artCx * scale * push, ty = (-artCy * scale) * push + lift;
  const bloom = reduced ? (t >= reveal ? 1 : 0) : span01(t, reveal + (resolve - reveal) * .42, resolve - 4);
  const strips = turning ? leafStrips(turnP) : [];
  const shade = (phi: number, back: boolean) => { const n = back ? [Math.sin(phi), -Math.cos(phi)] : [-Math.sin(phi), Math.cos(phi)];
    return .62 + .38 * Math.max(0, n[0] * -.42 + n[1] * .91); };
  const overlay = useContext(OverlayRendererContext);
  const beats: AnnotationBeats = { dock, reveal, resolve, durationFrames: f.durationFrames, steps: {} };
  const look = c.look ?? {};
  const world = <div data-km-book-world={bloom.toFixed(3)} aria-hidden={bloom < .5} style={{ position: "absolute", inset: 0,
    maskImage: `radial-gradient(circle at 50% 55%,#000 ${bloom * 120 - 20}%,transparent ${bloom * 120 + 10}%)`,
    WebkitMaskImage: `radial-gradient(circle at 50% 55%,#000 ${bloom * 120 - 20}%,transparent ${bloom * 120 + 10}%)` }}>
    <div style={{ position: "absolute", inset: 0, transform: `scale(${1 + .04 * alive})` }}>
      <Asset asset={c.world} style={{ borderRadius: 0, filter: "saturate(1.08) contrast(1.05)" }}/>
    </div>
    {/* The world wakes: warm light sweeps in, and a mist band drifts over the water. */}
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, mixBlendMode: "soft-light", opacity: .5 + .4 * alive,
      background: `radial-gradient(ellipse 60% 70% at ${20 + 30 * alive}% 10%,${lightColor},transparent 70%)` }}/>
    <div aria-hidden="true" style={{ position: "absolute", left: "-30%", right: "-30%", top: "48%", height: "14%", filter: "blur(1em)",
      background: "linear-gradient(90deg,transparent,rgba(235,240,245,.35),transparent 60%,rgba(235,240,245,.25),transparent)",
      transform: `translateX(${-8 + 16 * alive}%)`, opacity: .8 * bloom }}/>
  </div>;
  return <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#120c08",
    fontSize: portrait ? "clamp(13px, 3.5cqw, 44px)" : "clamp(13px, 2cqw, 40px)" }}>
    {c.surface && <div aria-hidden="true" style={{ position: "absolute", inset: "-10%", transform: `scale(${1 + .04 * settle})` }}>
      <Asset asset={c.surface} style={{ borderRadius: 0, filter: "brightness(.62) saturate(.9) sepia(.25)" }}/>
    </div>}
    {/* Window light across the table. */}
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 70% 80% at 30% 20%,rgba(255,214,160,.35),transparent 60%),radial-gradient(ellipse 120% 100% at 50% 50%,transparent 45%,rgba(5,3,2,.7) 100%)" }}/>
    <div data-km-book-camera={push.toFixed(4)} style={{ position: "absolute", inset: 0, perspective: "120em", perspectiveOrigin: "50% 35%", fontSize: `${bookScale}em` }}>
      {/* Diegetic print on the book is judged visually; overlay bounds checks apply to the title and line. */}
      <div data-km-book="" data-km-bounds-ignore="" style={{ position: "absolute", left: "50%", top: portrait ? "44%" : "50%", width: `${PW * 2}em`, height: `${PH}em`,
        transform: `translate(-50%,-50%) translate3d(${tx}em,${ty}em,0) scale(${scale}) rotateX(${tilt}deg)`, transformStyle: "preserve-3d" }}>
        {/* Boards and page block: the cover overhangs, page edges stack at the fore-edges. */}
        <div aria-hidden="true" style={{ position: "absolute", inset: "-.7em -1em", borderRadius: ".35em", background: `linear-gradient(160deg,${cover},color-mix(in srgb,${cover} 60%,#000))`,
          boxShadow: "0 2.4em 3em rgba(0,0,0,.55),0 .5em 1em rgba(0,0,0,.4)", transform: "translateZ(-.4em)" }}/>
        <div aria-hidden="true" style={{ position: "absolute", inset: "-.18em -.3em", borderRadius: ".15em",
          background: `repeating-linear-gradient(90deg,${paper} 0 .05em,color-mix(in srgb,${paper} 70%,#6b5a44) .05em .1em)`, transform: "translateZ(-.2em)" }}/>
        <div style={{ position: "absolute", left: 0, top: 0, width: `${PW}em`, height: `${PH}em`, overflow: "hidden" }}><LeftPage spread={leftSpread} paper={paper} ink={ink}/></div>
        <div style={{ position: "absolute", left: `${PW}em`, top: 0, width: `${PW}em`, height: `${PH}em`, overflow: rightSpread === spreads[turns] && push > 0 ? "visible" : "hidden" }}>
          <RightPage spread={rightSpread} paper={paper} ink={ink} fade={clamp01(push * 4)} portal={rightSpread === spreads[turns] && bloom > 0 ? world : undefined}/>
          {turning && <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none",
            background: `linear-gradient(90deg,rgba(30,20,10,${.42 * Math.sin(Math.PI * turnP)}) 0%,transparent ${30 + 60 * turnP}%)` }}/>}
        </div>
        {turning && <div data-km-book-leaf={turnP.toFixed(4)} style={{ position: "absolute", left: `${PW}em`, top: 0, width: `${PW}em`, height: `${PH}em`, transformStyle: "preserve-3d" }}>
          {strips.map((s, i) => <div key={i} data-km-leaf-strip={i} style={{ position: "absolute", left: 0, top: 0, width: `${(s.s1 - s.s0) * PW * 1.04}em`, height: `${PH}em`,
            transformOrigin: "0 50%", transformStyle: "preserve-3d", transform: `translate3d(${s.x * PW}em,0,${s.z * PW + .03}em) rotateY(${-s.phi}rad)` }}>
            <div style={{ position: "absolute", inset: 0, overflow: "hidden", backfaceVisibility: "hidden", filter: `brightness(${shade(s.phi, false)})` }}>
              <div style={{ position: "absolute", top: 0, left: `${-s.s0 * PW}em`, width: `${PW}em`, height: `${PH}em` }}><RightPage spread={spreads[turnIndex]} paper={paper} ink={ink}/></div>
            </div>
            <div style={{ position: "absolute", inset: 0, overflow: "hidden", backfaceVisibility: "hidden", transform: "rotateY(180deg)", filter: `brightness(${shade(s.phi, true)})` }}>
              <div style={{ position: "absolute", top: 0, left: `${-(1 - s.s1) * PW}em`, width: `${PW}em`, height: `${PH}em` }}><LeftPage spread={spreads[turnIndex + 1]} paper={paper} ink={ink}/></div>
            </div>
          </div>)}
        </div>}
        {/* Binding shadow down the spine. */}
        <div aria-hidden="true" style={{ position: "absolute", left: `${PW - .6}em`, width: "1.2em", top: 0, bottom: 0, pointerEvents: "none",
          background: "linear-gradient(90deg,transparent,rgba(30,18,8,.35),transparent)", opacity: 1 - push }}/>
      </div>
    </div>
    {!reduced && bloom > .2 && <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {Array.from({ length: 18 }, (_, i) => { const a = Math.sin(i * 12.9898) * 43758.5453, r = a - Math.floor(a), b = Math.sin(i * 78.233) * 12345.678, q = b - Math.floor(b);
        return <div key={i} style={{ position: "absolute", left: `${(r * 100 + t * .05 * (1 + q)) % 100}%`, top: `${(q * 70 + 10 - t * .03 * (1 + r) + 200) % 80}%`,
          width: `${.1 + q * .12}em`, height: `${.1 + q * .12}em`, borderRadius: "50%", background: lightColor, opacity: (.2 + .4 * r) * (bloom - .2), boxShadow: `0 0 .5em .1em ${lightColor}66` }}/>; })}
    </div>}
    {/* Title scrim and title, held over the living world. */}
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: span01(t, resolve - 10, resolve + 14) * (reduced ? (t >= resolve ? 1 : 0) : 1),
      background: portrait ? "linear-gradient(0deg,rgba(6,8,10,.82) 0%,rgba(6,8,10,.4) 26%,transparent 44%)" : "linear-gradient(0deg,rgba(6,8,10,.8) 0%,rgba(6,8,10,.35) 28%,transparent 46%)" }}/>
    <FilmFinish frame={t} reduced={reduced} grain={look.grain ?? 1} vignette={look.vignette ?? 1}/>
    <div data-km-stage-overlay="" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {overlay?.({ frame: f, width: w, height: h, beats, space: "stage", toStage: p => ({ x: p.x * w, y: p.y * h }),
        state: timing => annotationState(timing, beats, t, reduced) })}
    </div>
    {(c.title || c.line) && <div data-km-book-title="" style={{ position: "absolute", left: portrait ? "7%" : "6%", right: portrait ? "7%" : "30%", bottom: portrait ? "7%" : "8%",
      display: "flex", flexDirection: "column", gap: ".4em", textShadow: "0 .05em .7em rgba(0,0,0,.6)" }}>
      {c.title && <h2 style={{ margin: 0, visibility: reduced ? (t >= resolve ? "visible" : "hidden") : t >= resolve ? "visible" : "hidden",
        fontSize: fitLongestWord(c.title, portrait ? 2.9 : 3.2, portrait ? 84 : 62), fontFamily: "var(--km-font-serif, Georgia, 'Times New Roman', serif)",
        fontWeight: 600, letterSpacing: "-.01em", lineHeight: 1.05, textWrap: "balance" }}>
        <KineticWords text={c.title} start={resolve} stagger={3} length={18} frame={t} reduced={reduced} marker="book"/>
      </h2>}
      {c.line && <RiseIn name="book-line" frame={t} start={resolve + 14} length={18} reduced={reduced} style={{ fontSize: "1.08em", lineHeight: 1.35, opacity: .92, maxWidth: "28em", textWrap: "pretty" }}>{c.line}</RiseIn>}
    </div>}
  </div>;
}
