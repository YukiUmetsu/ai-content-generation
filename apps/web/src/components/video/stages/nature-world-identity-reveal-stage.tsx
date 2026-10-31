/**
 * Nature-World Identity Reveal. Causal beat:
 *   input      a forest view framed by near trunks, ferns and canopy, with a
 *              clearing beyond; a caller-supplied mark stands in its shade
 *   transform  the camera walks forward (one dolly z drives every depth plane:
 *              near forms grow fast and leave by their edge, uncovering the
 *              clearing they hid); it settles, then a sun shaft through the
 *              canopy sweeps across the clearing and finds the mark
 *   output     the mark held lit, grounded (contact and cast shadow, thickness,
 *              rim light), above its optional name and line.
 * Multi-plane 2.5D built on environment-parallax: not a navigable 3D world.
 * Pure function of the frame.
 */
import { createContext, useContext, useMemo, useState } from "react";
import type { ComponentType, CSSProperties } from "react";
import type { NatureDepthLayer, SceneTemplateFrame, SceneTemplateSpec } from "../scene-templates";
import type { AnnotationBeats } from "../subject-annotations";
import { annotationState, coverPoint } from "../subject-annotations";
import { dollyCameraAtFrame, projectDepthPlane } from "../environment-parallax";
import type { DepthPlane } from "../environment-parallax";
import { Asset, FilmFinish, KineticWords, OverlayRendererContext, RiseIn, cinematicEase, clamp01, cueAt, easeInOut, filmGrain, fitLongestWord, span01 } from "./stage-kit";

/** Small deterministic PRNG so every frame regenerates identical forms. */
function seeded(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** A leafy branch in a 200×200 box, stem from the bottom edge. */
function foliagePath(seed: number): string {
  const r = seeded(seed); let d = "";
  const bend = (r() - .5) * 70, leaves = 9 + Math.floor(r() * 6);
  d += `M-4 100Q${bend} 10 ${bend * .4} -96L${bend * .4 + 6} -96Q${bend + 6} 10 4 100Z`;
  for (let i = 0; i < leaves; i++) {
    const t = .12 + .86 * i / leaves, side = i % 2 ? 1 : -1;
    const sx = bend * 2 * t * (1 - t) + bend * .4 * t * t, sy = 100 - 196 * t;
    const len = (58 - 30 * t) * (.8 + .4 * r()), wid = len * (.34 + .1 * r()), ang = (side * (48 + 25 * r()) - 8) * Math.PI / 180;
    const ux = Math.sin(ang), uy = -Math.cos(ang), px = -uy, py = ux;
    d += `M${sx} ${sy}C${sx + ux * len * .3 + px * wid} ${sy + uy * len * .3 + py * wid} ${sx + ux * len * .85 + px * wid * .45} ${sy + uy * len * .85 + py * wid * .45} ${sx + ux * len} ${sy + uy * len}`
      + `C${sx + ux * len * .85 - px * wid * .45} ${sy + uy * len * .85 - py * wid * .45} ${sx + ux * len * .3 - px * wid} ${sy + uy * len * .3 - py * wid} ${sx} ${sy}Z`;
  }
  return d;
}
/** A tropical palm frond in the same box: an arching rachis with long, narrow leaflets on both sides. */
function frondPath(seed: number): string {
  const r = seeded(seed), arch = 30 + r() * 40, leaflets = 26 + Math.floor(r() * 8);
  const spine = (t: number) => ({ x: -90 + 180 * t, y: 80 - 150 * t + arch * Math.sin(Math.PI * t) * -1 + 60 * t * t });
  let d = "";
  for (let i = 0; i <= 20; i++) { const p = spine(i / 20); d += (i ? "L" : "M") + `${p.x} ${p.y - 1.6}`; }
  for (let i = 20; i >= 0; i--) { const p = spine(i / 20); d += `L${p.x} ${p.y + 1.6}`; }
  d += "Z";
  for (let i = 0; i < leaflets; i++) {
    const t = .06 + .9 * i / leaflets, p = spine(t), q = spine(t + .01);
    const ang = Math.atan2(q.y - p.y, q.x - p.x), len = (62 - 40 * t) * (.85 + .3 * r()), wid = 3.6 - 1.6 * t;
    for (const side of [-1, 1]) {
      const a = ang + side * (1.05 + .25 * r()) + .35;
      const tx = p.x + Math.cos(a) * len, ty = p.y + Math.sin(a) * len + len * .25;
      const nx = -Math.sin(a) * wid, ny = Math.cos(a) * wid;
      d += `M${p.x} ${p.y}Q${(p.x + tx) / 2 + nx} ${(p.y + ty) / 2 + ny} ${tx} ${ty}Q${(p.x + tx) / 2 - nx} ${(p.y + ty) / 2 - ny} ${p.x} ${p.y}Z`;
    }
  }
  return d;
}
/** A jagged rock mass in the same box, for cave mouths. */
function rockPath(seed: number): string {
  const r = seeded(seed), pts: string[] = [];
  for (let i = 0; i <= 18; i++) { const a = Math.PI * (1 + i / 18), rad = 70 + 30 * r(); pts.push(`${Math.cos(a) * rad * 1.3} ${100 + Math.sin(a) * rad * 1.9}`); }
  return `M-100 100L${pts.join("L")}L100 100Z`;
}
/** Near-lens forms just in front of the camera: they pass in the first part of the walk. */
const NEAR: (DepthPlane & { seed: number; rot: number })[] = [
  { seed: 11, x: .04, y: .18, width: .34, height: .62, depth: .9, rot: 140 },
  { seed: 23, x: .97, y: .88, width: .38, height: .7, depth: 1.05, rot: -38 },
  { seed: 41, x: .98, y: .1, width: .28, height: .52, depth: .8, rot: -150 },
];
/** Once a near plane passes ~2.2× its frame-0 size it no longer reads as forest, only as blur:
 * it dissolves as it reaches the lens instead of blooming across the frame. */
const passFade = (scale: number) => { const t = clamp01((scale - 2.2) / 1.4); return 1 - t * t * (3 - 2 * t); };
const maskStyle = (src: string): CSSProperties => ({ position: "absolute", inset: 0, maskImage: `url("${src}")`, WebkitMaskImage: `url("${src}")`,
  maskSize: "contain", WebkitMaskSize: "contain", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat",
  maskPosition: "center bottom", WebkitMaskPosition: "center bottom" } as CSSProperties);
/** Frame-0 plane of a caller layer, in stage fractions, honouring its portrait override. */
function layerPlane(layer: NatureDepthLayer, w: number, h: number): DepthPlane {
  const place = h > w && layer.portrait ? layer.portrait : layer;
  const width = place.height * (layer.image.width! / layer.image.height!) * h / w;
  return { x: place.x, y: place.y, width, height: place.height, depth: layer.depth };
}

function DepthPlaneStage({ spec, f }: { spec: SceneTemplateSpec<"nature-world-identity-reveal">; f: SceneTemplateFrame }) {
  const c = spec.content, w = spec.width, h = spec.height, portrait = h > w, t = f.frame, reduced = f.reducedMotion;
  const dock = cueAt(f, 0), reveal = cueAt(f, 1), resolve = cueAt(f, 2);
  const env = c.environment, mark = c.mark, kind = c.foreground ?? "foliage";
  const grounded = (c.treatment ?? "grounded") === "grounded";
  const lightColor = c.light?.color ?? "#ffd9a0";
  // Walk: one camera z, settling on the dock beat so the clearing is still before the light arrives.
  const cam = dollyCameraAtFrame(t, { distance: c.walk?.distance ?? 1.7, truck: c.walk?.truck ?? 0, bob: c.walk?.bob ?? .5, start: 0, end: dock }, reduced);
  // Thin-lens focus: the circle of confusion grows with |1/focus − 1/distance|. Focus starts on the hero
  // plane and racks to the clearing as the hero nears and passes; reduced motion rests at the end focus.
  const bgDepth = c.walk?.environmentDepth ?? 30;
  const focusFrom = c.focus?.from ?? 6, focusTo = c.focus?.to ?? bgDepth, [rackA, rackB] = c.focus?.rack ?? [.4, .8];
  const rack = reduced ? (t >= dock ? 1 : 0) : easeInOut((cam.progress - rackA) / Math.max(.01, rackB - rackA));
  const focusDistance = Math.max(.35, focusFrom + (focusTo - focusFrom) * rack - cam.z);
  const aperture = c.focus?.aperture ?? 1;
  const defocus = (gap: number) => Math.min(2.4, aperture * 3.2 * Math.abs(1 / focusDistance - 1 / Math.max(.05, gap)));
  const base0 = coverPoint({ x: c.placement.x, y: c.placement.y }, env, w, h);
  const vp = { x: base0.x / w, y: base0.y / h };
  const bg = projectDepthPlane({ x: .5, y: .5, width: 1.06, height: 1.06, depth: bgDepth }, cam, vp);
  const toScreen = (p: { x: number; y: number }, depth: number) => ({ x: vp.x + ((p.x - vp.x) * depth - cam.x) / (depth - cam.z), y: vp.y + ((p.y - vp.y) * depth - cam.y) / (depth - cam.z) });
  // Mark geometry in stage pixels at frame 0 (it rides the far plane with the clearing).
  const plateH = env.height! * Math.max(w / env.width!, h / env.height!);
  const markH = plateH * c.placement.height, markW = markH * mark.width! / mark.height!;
  const markBase = toScreen(vp, bgDepth), markTop = toScreen({ x: vp.x, y: vp.y - markH / h }, bgDepth);
  // Reveal: a sun shaft sweeps across the clearing onto the mark, then light lands on it.
  const shaftIn = reduced ? (t >= reveal ? 1 : 0) : clamp01(span01(t, reveal - 6, reveal + 16));
  const sweep = reduced ? 1 : easeInOut(span01(t, reveal, reveal + 30));
  const lit = reduced ? (t >= reveal ? 1 : 0) : cinematicEase(span01(t, reveal + 16, reveal + 40));
  const bloom = reduced || t < reveal + 26 ? 0 : Math.exp(-(t - reveal - 26) / 10);
  const lightX = c.light?.x ?? .3;
  const groundX = markBase.x + (1 - sweep) * .24, groundY = markBase.y;
  const markMidY = (markBase.y + markTop.y) / 2;
  const lx = Math.cos(Math.atan2(-.05 - markMidY, lightX - markBase.x));
  const material = c.material ?? { kind: "solid" as const };
  const tone = material.color ?? "#b89b74";
  const thickness = (material.thickness ?? .06) * markH;
  const haze = c.haze ?? .35;
  const nearForms = useMemo(() => NEAR.map(n => ({ ...n, d: kind === "rock" ? rockPath(n.seed) : kind === "tropical" ? frondPath(n.seed) : foliagePath(n.seed) })), [kind]);
  const overlay = useContext(OverlayRendererContext);
  const beats: AnnotationBeats = { dock, reveal, resolve, durationFrames: f.durationFrames, steps: {} };
  const look = c.look ?? {};
  const rect = (r: { x: number; y: number; width: number; height: number }): CSSProperties => ({ position: "absolute",
    left: `${(r.x - r.width / 2) * 100}%`, top: `${(r.y - r.height / 2) * 100}%`, width: `${r.width * 100}%`, height: `${r.height * 100}%` });
  // Defocus grows as a plane nears the lens; the camera is focused on the clearing.
  const face: CSSProperties = maskStyle(mark.src);
  const markLayer = <div data-km-identity-mark={grounded ? "grounded" : "graphic"} data-km-mark-lit={lit.toFixed(4)} style={{ position: "absolute",
    left: `${(base0.x - markW / 2) / w * 100}%`, top: `${(base0.y - markH) / h * 100}%`, width: `${markW / w * 100}%`, height: `${markH / h * 100}%` }}>
    {grounded && <>
      {/* Cast shadow on the ground, falling away from the shaft once it lands. */}
      <div aria-hidden="true" data-km-mark-shadow="" style={{ ...face, background: "rgba(8,12,6,.6)", transformOrigin: "50% 100%", filter: "blur(.7em)",
        transform: `scaleY(-.24) skewX(${lx * 50}deg) translateY(-2%)`, opacity: .1 + .35 * lit }}/>
      <div aria-hidden="true" style={{ position: "absolute", left: "-12%", right: "-12%", bottom: "-5%", height: "10%",
        background: "radial-gradient(ellipse 50% 50% at 50% 50%,rgba(6,9,4,.85),rgba(6,9,4,0) 70%)", filter: "blur(.12em)" }}/>
      {Array.from({ length: 7 }, (_, i) => <div key={i} aria-hidden="true" style={{ ...face,
        background: `color-mix(in srgb,${tone} ${18 + i * 4}%,#120e0a)`, transform: `translate(${-lx * thickness / markW * 100 * (7 - i) / 7}%,${-thickness / markH * 12 * (7 - i) / 7}%)` }}/>)}
      <div aria-hidden="true" style={{ ...face, background: lightColor, opacity: .95 * lit, transform: `translate(${lx * .05}em,-.03em)` }}/>
    </>}
    {material.kind === "artwork" || !grounded
      ? <div style={{ position: "absolute", inset: 0 }}><Asset asset={mark} style={{ borderRadius: 0, objectFit: "contain", objectPosition: "center bottom" }}/></div>
      : <div aria-hidden="true" data-km-mark-face="" style={{ ...face,
          background: `linear-gradient(${lx < 0 ? 120 : 240}deg,color-mix(in srgb,${tone} 85%,${lightColor}) 0%,${tone} 38%,color-mix(in srgb,${tone} 52%,#1a1610) 100%)` }}/>}
    <div aria-hidden="true" style={{ ...face, backgroundImage: filmGrain, backgroundSize: "6em 6em", mixBlendMode: "multiply", opacity: .5 }}/>
    <div aria-hidden="true" style={{ ...face, background: "linear-gradient(0deg,rgba(10,12,6,.7) 0%,transparent 16%)" }}/>
    {/* In the shade the mark is a quiet silhouette; the landing light lifts it. */}
    <div aria-hidden="true" data-km-mark-shade="" style={{ ...face, background: "#0a0e08", opacity: .72 * (1 - lit) + .04 }}/>
    <div aria-hidden="true" style={{ ...face, background: lightColor, mixBlendMode: "screen", opacity: .5 * bloom }}/>
  </div>;
  // Shaft geometry in stage fractions: a soft wedge from the canopy to the ground under the sweep.
  const shaft = `${lightX - .035},-0.05 ${lightX + .035},-0.05 ${groundX + .13},${groundY + .04} ${groundX - .13},${groundY + .04}`;
  return <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#050805",
    fontSize: portrait ? "clamp(13px, 3.5cqw, 44px)" : "clamp(13px, 2cqw, 40px)" }}>
    <div data-km-nature-camera="" data-km-camera-z={cam.z.toFixed(4)} style={{ position: "absolute", inset: "-3%",
      transform: `rotate(${cam.roll}deg)`, transformOrigin: "50% 60%" }}>
      <div style={{ position: "absolute", inset: "2.9%" }}>
        <div data-km-nature-plate="clearing" data-km-focus-distance={focusDistance.toFixed(3)} style={{ ...rect(bg), filter: `blur(${defocus(bgDepth - cam.z)}em)` }}>
          <div style={{ position: "absolute", inset: `${-(1.06 - 1) / 2 / 1.06 * 100}%`, transform: `scale(${1 / 1.06})` }}>
            <Asset asset={env} style={{ borderRadius: 0, filter: "brightness(.8) saturate(1.05) contrast(1.08) sepia(.1)" }}/>
            <div aria-hidden="true" style={{ position: "absolute", inset: 0,
              background: "linear-gradient(180deg,rgba(8,12,10,.6) 0%,rgba(8,12,10,.18) 30%,transparent 44%),linear-gradient(0deg,rgba(6,10,6,.5) 0%,transparent 30%)" }}/>
            <div aria-hidden="true" style={{ position: "absolute", inset: 0, mixBlendMode: "soft-light", opacity: .4 + .6 * shaftIn,
              background: `radial-gradient(ellipse 60% 55% at ${lightX * 100}% 0%,rgba(255,196,120,.85),rgba(255,170,90,.08) 60%,rgba(20,40,60,.45) 100%)` }}/>
            {markLayer}
          </div>
        </div>
        {/* Haze between the clearing and the forest thins as the camera approaches. */}
        <div aria-hidden="true" data-km-nature-haze="" style={{ position: "absolute", inset: 0, pointerEvents: "none",
          background: "linear-gradient(180deg,rgba(214,232,206,.55) 0%,rgba(190,214,186,.32) 60%,rgba(120,146,112,.15) 100%)", opacity: haze * (1 - .8 * cam.progress) }}/>
        {(c.layers ?? []).map((layer, i) => ({ layer, i, plane: layerPlane(layer, w, h) })).sort((a, b) => b.plane.depth - a.plane.depth).map(({ layer, i, plane }) => {
          const p = projectDepthPlane(plane, cam, vp);
          if (!p.visible) return null;
          const gap = plane.depth - cam.z;
          return <div key={i} data-km-depth-layer={layer.image.id} data-km-layer-scale={p.scale.toFixed(3)} style={{ ...rect(p),
            transform: layer.flip ? "scaleX(-1)" : undefined, opacity: passFade(p.scale), filter: `blur(${defocus(gap)}em) brightness(${.55 + .35 * Math.min(1, gap / 6)}) saturate(.92)` }}>
            <Asset asset={layer.image} style={{ borderRadius: 0, objectFit: "fill" }}/>
            {/* Aerial perspective: distant planes take on the haze colour, thinning as they near the lens. */}
            <div aria-hidden="true" data-km-layer-haze="" style={{ position: "absolute", inset: 0, background: "rgb(96,116,92)",
              opacity: Math.min(.3, (gap / bgDepth) * (.3 + haze)), maskImage: `url("${layer.image.src}")`, WebkitMaskImage: `url("${layer.image.src}")`,
              maskSize: "100% 100%", WebkitMaskSize: "100% 100%" } as CSSProperties}/>
          </div>;
        })}
        {kind !== "none" && nearForms.map(form => {
          const p = projectDepthPlane(form, cam, vp);
          if (!p.visible || reduced) return null;
          return <svg key={form.seed} aria-hidden="true" data-km-foreground-form={form.seed} viewBox="-100 -100 200 200" preserveAspectRatio="none"
            style={{ ...rect(p), overflow: "visible", transform: `rotate(${form.rot}deg)`, opacity: passFade(p.scale), filter: `blur(${Math.min(2.4, defocus(form.depth - cam.z) + .3)}em)` }}>
            <path d={form.d} fill={kind === "rock" ? "#08090b" : "#040803"}/>
          </svg>;
        })}
      </div>
    </div>
    {shaftIn > 0 && <svg aria-hidden="true" data-km-nature-shaft={sweep.toFixed(3)} viewBox="0 0 1 1" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
      pointerEvents: "none", mixBlendMode: "screen", opacity: shaftIn * (.8 + .2 * lit), filter: "blur(1.2em)", overflow: "visible" }}>
      <defs><linearGradient id="km-shaft" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={lightColor} stopOpacity=".75"/><stop offset=".7" stopColor={lightColor} stopOpacity=".28"/><stop offset="1" stopColor={lightColor} stopOpacity=".05"/></linearGradient></defs>
      <polygon points={shaft} fill="url(#km-shaft)"/>
      <ellipse cx={groundX} cy={groundY + .01} rx={.2} ry={.05} fill={lightColor} opacity={.18 * lit}/>
    </svg>}
    {!reduced && shaftIn > 0 && <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {Array.from({ length: 22 }, (_, i) => { const r = seeded(200 + i), along = (r() + t * (.002 + r() * .003)) % 1, across = r() * 2 - 1;
        const x = (lightX + (groundX - lightX) * along) + across * (.035 + .095 * along), y = -.05 + (groundY + .09) * along;
        return <div key={i} style={{ position: "absolute", left: `${x * 100}%`, top: `${y * 100}%`, width: `${.1 + r() * .14}em`, height: `${.1 + r() * .14}em`,
          borderRadius: "50%", background: lightColor, opacity: (.25 + .45 * r()) * shaftIn, boxShadow: `0 0 .5em .12em ${lightColor}66` }}/>; })}
    </div>}
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none",
      background: "linear-gradient(0deg,rgba(4,6,4,.8) 0%,rgba(4,6,4,.35) 22%,transparent 40%)", opacity: .15 + .85 * span01(t, resolve - 20, resolve + 10) }}/>
    <FilmFinish frame={t} reduced={reduced} grain={look.grain ?? 1} vignette={look.vignette ?? 1} vignetteStrength={.55}/>
    <div data-km-stage-overlay="" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {overlay?.({ frame: f, width: w, height: h, beats, space: "stage", toStage: p => ({ x: p.x * w, y: p.y * h }),
        state: timing => annotationState(timing, beats, t, reduced) })}
    </div>
    <IdentityCopy c={c} t={t} resolve={resolve} reduced={reduced} portrait={portrait}/>
  </div>;
}

/** A photographic title shot: establish → canopy light → identity → quiet hold.
 * One dolly camera projects caller photographic foreground planes against the far plate.
 * Only the camera, atmosphere and optical reveal move; the final 2 seconds are locked. */
function CinematicIdentityStage({ spec, f }: { spec: SceneTemplateSpec<"nature-world-identity-reveal">; f: SceneTemplateFrame }) {
  const c = spec.content, t = f.frame, reduced = f.reducedMotion, portrait = spec.height > spec.width;
  const arrival = cueAt(f, 0), reveal = cueAt(f, 1), resolve = cueAt(f, 2);
  const endMove = Math.max(resolve + 1, f.durationFrames - 48);
  const camera = dollyCameraAtFrame(reduced ? endMove : t, {
    distance: c.walk?.distance ?? 4, truck: c.walk?.truck ?? 0, bob: c.walk?.bob ?? 0, start: 0, end: endMove,
  }, reduced);
  const vanishing = { x: .5, y: .43 };
  const plate = projectDepthPlane({ x: .5, y: .5, width: 1.035, height: 1.035, depth: c.walk?.environmentDepth ?? 10 }, camera, vanishing);
  const planeRect = (p: ReturnType<typeof projectDepthPlane>): CSSProperties => ({ position: "absolute",
    left: `${(p.x - p.width / 2) * 100}%`, top: `${(p.y - p.height / 2) * 100}%`, width: `${p.width * 100}%`, height: `${p.height * 100}%` });
  const light = reduced ? 1 : easeInOut(span01(t, arrival - 24, reveal + 32));
  const emblem = reduced ? 1 : cinematicEase(span01(t, reveal, reveal + 42));
  const logoYaw = -8; // Quiet fixed relief: the light reveals it; the emblem never swivels.
  const logoThickness = (c.material?.thickness ?? .1) * (portrait ? 19.36 : 9.68);
  const logoColor = c.material?.color ?? "#e9e3ce";
  const title = reduced ? 1 : cinematicEase(span01(t, resolve, resolve + 38));
  const line = reduced ? 1 : cinematicEase(span01(t, resolve + 24, resolve + 58));
  const atmosphereFrame = reduced ? endMove : Math.min(t, endMove);
  const lightColor = c.light?.color ?? "#f5e6bd", sourceX = (c.light?.x ?? .42) * 100;
  const fill: CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none" };
  const optical = (amount: number): CSSProperties => ({ opacity: amount, transform: `translateY(${(1 - amount) * 14}px)`, filter: `blur(${(1 - amount) * 10}px)` });
  return <div data-km-nature-renderer="cinematic" style={{ ...fill, overflow: "hidden", background: "#07100b", color: "var(--km-identity-ink, #f4efdf)",
    fontSize: portrait ? "3.5cqw" : "2cqw" }}>
    <div data-km-nature-camera="" data-km-camera-progress={camera.progress.toFixed(5)} data-km-camera-scale={plate.scale.toFixed(5)} style={{ ...planeRect(plate),
      transform: `rotate(${camera.roll}deg)`, transformOrigin: "50% 43%" }}>
      <Asset asset={c.environment} style={{ borderRadius: 0, objectPosition: "48% 50%", filter: "saturate(var(--km-environment-saturation,.79)) contrast(1.08) brightness(var(--km-environment-exposure,.78))" }}/>
      {/* Light enters from the existing bright opening in the supplied plate. */}
      <div aria-hidden="true" style={{ ...fill, mixBlendMode: "screen", opacity: .12 + .16 * light,
        background: `radial-gradient(ellipse 36% 66% at ${sourceX}% 12%,${lightColor}88,transparent 76%)` }}/>
    </div>
    {(c.layers ?? []).map(layer => ({ layer, plane: layerPlane(layer, spec.width, spec.height) }))
      .sort((a, b) => b.plane.depth - a.plane.depth).map(({ layer, plane }) => {
        const projected = projectDepthPlane(plane, camera, vanishing);
        if (!projected.visible) return null;
        const gap = plane.depth - camera.z;
        // Increasing circle of confusion as the leaf passes the lens; no idle floating.
        const blur = reduced ? 0 : Math.min(12, Math.max(0, 1 / gap - .25) * 3);
        const flex = reduced ? 0 : Math.sin(t / 34) * .7 * camera.speed * (layer.sway ?? 1);
        return <div key={layer.image.id} aria-hidden="true" data-km-cinematic-leaf={layer.image.id} data-km-layer-scale={projected.scale.toFixed(5)}
          style={{ ...planeRect(projected), transformOrigin: "50% 100%", transform: `rotate(${camera.roll + flex}deg)${layer.flip ? " scaleX(-1)" : ""}`,
            filter: `blur(${blur}px) saturate(.79) contrast(1.08) brightness(var(--km-depth-layer-exposure,.78))` }}>
          <Asset asset={layer.image} style={{ objectFit: "fill", borderRadius: 0 }}/>
        </div>;
      })}
    {/* Broad, feathered shafts: no sharp polygon or artificial sun disc. */}
    <div aria-hidden="true" data-km-canopy-light="" style={{ ...fill, opacity: .22 * light, mixBlendMode: "screen",
      transform: `translateX(${(1 - light) * -3}%)`,
      background: `conic-gradient(from 151deg at ${sourceX}% -12%,transparent 0deg,${lightColor}00 6deg,${lightColor}55 10deg,transparent 14deg,transparent 20deg,${lightColor}33 23deg,transparent 27deg)`, filter: "blur(18px)" }}/>
    {[0, 1].map(i => <div key={i} aria-hidden="true" data-km-nature-mist={i} style={{ ...fill, inset: "-15%", mixBlendMode: "screen",
      opacity: (c.haze ?? .18) * (i ? .32 : .48), transform: `translate(${Math.sin(atmosphereFrame / 180 + i * 2) * 5}%,${Math.cos(atmosphereFrame / 220 + i) * 2}%)`,
      background: i ? "radial-gradient(ellipse 55% 13% at 62% 66%,#bfcdb9,transparent 90%)" : "radial-gradient(ellipse 48% 17% at 30% 39%,#d2dac3,transparent 90%)", filter: "blur(22px)" }}/>)}
    <div aria-hidden="true" style={{ ...fill, background: `radial-gradient(ellipse ${portrait ? 90 : 49}% 60% at 50% 52%,rgba(3,12,8,${.18 + .52 * emblem}),transparent 100%),linear-gradient(0deg,rgba(3,10,7,.5),transparent 40%)` }}/>
    {!reduced && Array.from({ length: 12 }, (_, i) => {
      const random = seeded(830 + i), x = 18 + random() * 64, y = 12 + random() * 65, phase = random() * Math.PI * 2;
      const visibility = Math.pow(Math.sin(atmosphereFrame / 65 + phase), 2) * .32 * light;
      return <div key={i} aria-hidden="true" style={{ position: "absolute", left: `${x}%`, top: `${y}%`, width: i % 3 ? 1 : 2, height: i % 3 ? 1 : 2,
        borderRadius: "50%", background: lightColor, opacity: visibility, filter: "blur(.4px)",
        transform: `translate(${Math.sin(atmosphereFrame / 160 + phase) * 12}px,${-atmosphereFrame * (.018 + random() * .025)}px)` }}/>;
    })}
    <FilmFinish frame={Math.min(t, endMove)} reduced={reduced} grain={c.look?.grain ?? .18} vignette={c.look?.vignette ?? .8} vignetteStrength={.65}/>
    {/* One bounded lockup, with no overlap between the mark, wordmark and line. */}
    <div data-km-identity-lockup="" style={{ position: "absolute", left: "10%", right: "10%", top: "50%", transform: "translateY(-50%)",
      display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: portrait ? "1.35em" : ".8em" }}>
      <div data-km-identity-mark="cinematic" style={{ position: "relative", width: portrait ? "22%" : "11%", aspectRatio: `${c.mark.width ?? 400}/${c.mark.height ?? 440}`,
        opacity: emblem }}>
        {/* Layered masks form a shallow extrusion; perspective is isolated from optical blur. */}
        <div style={{ position: "absolute", inset: 0, perspective: "80em" }}>
          <div data-km-logo-relief="" data-km-logo-yaw={logoYaw.toFixed(3)} style={{ position: "absolute", inset: 0,
            transformStyle: "preserve-3d", transform: `rotateY(${logoYaw}deg) rotateX(0deg)` }}>
            {Array.from({ length: 16 }, (_, i) => <div key={i} aria-hidden="true" data-km-logo-edge="" style={{ ...maskStyle(c.mark.src),
              maskPosition: "center", WebkitMaskPosition: "center", transform: `translateZ(${-logoThickness * (16 - i) / 16}cqw)`,
              background: `linear-gradient(135deg,color-mix(in srgb,${logoColor} 52%,#726442),color-mix(in srgb,${logoColor} 28%,#2b281d))` }}/>) }
            <div aria-hidden="true" data-km-logo-face="" style={{ ...maskStyle(c.mark.src), maskPosition: "center", WebkitMaskPosition: "center",
              transform: "translateZ(.01cqw)", background: `linear-gradient(145deg,#fffbed 0%,${logoColor} 33%,#fff9e6 46%,${logoColor} 62%,#b6aa83 100%)` }}/>
            <div aria-hidden="true" style={{ ...maskStyle(c.mark.src), maskPosition: "center", WebkitMaskPosition: "center",
              transform: `translate(-.025cqw,-.025cqw) translateZ(.02cqw)`, background: `linear-gradient(135deg,${lightColor}bb,transparent 35%,transparent 80%)` }}/>
          </div>
        </div>
        <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}>{c.mark.alt}</span>
      </div>
      {c.name && <h2 data-km-identity-name="" style={{ margin: 0, maxWidth: "100%", overflowWrap: "anywhere", fontFamily: "var(--km-identity-font, 'Newsreader Variable', Georgia, serif)",
        fontSize: fitLongestWord(c.name, portrait ? 3.4 : 3.8, 66), fontWeight: 400, letterSpacing: ".025em", lineHeight: 1.12, textWrap: "balance", ...optical(title) }}>{c.name}</h2>}
      <div aria-hidden="true" style={{ width: "2.5em", height: 1, background: "currentColor", opacity: .5 * line, transform: `scaleX(${line})`, marginTop: ".15em" }}/>
      {c.tagline && <p data-km-identity-tagline="" style={{ margin: 0, maxWidth: "100%", fontSize: portrait ? ".95em" : ".72em", letterSpacing: ".16em", lineHeight: 1.6,
        textTransform: "uppercase", textWrap: "balance", overflowWrap: "anywhere", ...optical(line) }}>{c.tagline}</p>}
    </div>
  </div>;
}

type Content = SceneTemplateSpec<"nature-world-identity-reveal">["content"];
/** Wordmark and line, shared by the 3D and depth-plane renderings. */
function IdentityCopy({ c, t, resolve, reduced, portrait }: { c: Content; t: number; resolve: number; reduced: boolean; portrait: boolean }) {
  if (!c.name && !c.tagline) return null;
  return <div data-km-identity-copy="" style={{ position: "absolute", left: "8%", right: "8%", bottom: portrait ? "8%" : "6.5%",
    display: "flex", flexDirection: "column", alignItems: "center", gap: ".35em", textAlign: "center", textShadow: "0 .05em .7em rgba(0,0,0,.6)" }}>
    {c.name && <h2 style={{ margin: 0, visibility: reduced || t >= resolve ? "visible" : "hidden", fontSize: fitLongestWord(c.name, portrait ? 2.5 : 2.6, 84),
      fontWeight: 650, letterSpacing: ".14em", textTransform: "uppercase", lineHeight: 1.05, textWrap: "balance" }}>
      <KineticWords text={c.name} start={resolve} stagger={3} length={20} frame={t} reduced={reduced} marker="identity"/>
    </h2>}
    {c.tagline && <RiseIn name="identity-tagline" frame={t} start={resolve + 14} length={20} reduced={reduced}
      style={{ fontSize: "1.1em", fontWeight: 500, letterSpacing: ".04em", opacity: .92, maxWidth: "30em", textWrap: "balance" }}>{c.tagline}</RiseIn>}
  </div>;
}

/** Resolved configuration for the host 3D jungle renderer (nature-world-3d.ts). */
export interface NatureWorld3DConfig {
  undergrowth: { id: string; src: string }[];
  hdri: string;
  ground: { diffuse: string; normal?: string; arm?: string };
  bark?: { diffuse: string; normal?: string };
  mark: { src: string; color: string; thickness: number };
  /** Sun direction relative to the view: azimuth 0 = straight behind the mark (backlight), elevation in degrees. */
  sun: { azimuth: number; elevation: number; warmth: number; intensity: number };
  density: number;
  dof: number;
  camera: "glide" | "low-glide" | "rise";
  grade: { saturation: number; warmth: number; exposure: number };
  leafTint: string;
  grove: "bamboo" | "trunks" | "none";
  seed: number;
  /** Composition frames: the mark rises at `dock`, settles at `reveal`; the glide eases out by `glideEnd`. */
  beats: { dock: number; reveal: number; glideEnd: number; fps: number };
}
/** Host-provided 3D renderer (see nature-world-canvas.tsx). The foundation never imports three. */
export interface NatureWorldRendererProps { config: NatureWorld3DConfig; frame: number; pixelWidth: number; pixelHeight: number; onError?: (message: string) => void }
export const NatureWorldRendererContext = createContext<ComponentType<NatureWorldRendererProps> | undefined>(undefined);

/** Resolves the serializable scene3d spec into the renderer's configuration. */
export function natureWorld3DConfig(spec: SceneTemplateSpec<"nature-world-identity-reveal">, f: SceneTemplateFrame): NatureWorld3DConfig | undefined {
  const c = spec.content, g = c.scene3d;
  if (!g) return undefined;
  const fps = spec.fps.num / spec.fps.den;
  return {
    undergrowth: g.undergrowth.map(u => ({ id: u.id, src: u.src })), hdri: g.hdri.src,
    ground: { diffuse: g.ground.diffuse, normal: g.ground.normal, arm: g.ground.arm },
    bark: g.bark && { diffuse: g.bark.diffuse, normal: g.bark.normal },
    mark: { src: c.mark.src, color: c.material?.color ?? "#f2eee6", thickness: c.material?.thickness ?? .08 },
    sun: { azimuth: g.sun?.azimuth ?? 18, elevation: g.sun?.elevation ?? 16, warmth: g.sun?.warmth ?? .7, intensity: g.sun?.intensity ?? 1 },
    density: g.density ?? 1, dof: g.dof ?? 1, camera: g.camera ?? "glide",
    grade: { saturation: g.grade?.saturation ?? 1.12, warmth: g.grade?.warmth ?? .5, exposure: g.grade?.exposure ?? 1 },
    leafTint: g.leafTint ?? "#ffffff", grove: g.grove ?? "bamboo", seed: g.seed ?? 7,
    beats: { dock: cueAt(f, 0), reveal: cueAt(f, 1), glideEnd: Math.min(f.durationFrames - 1, Math.round(cueAt(f, 2) + (f.durationFrames - cueAt(f, 2)) * .5)), fps },
  };
}

export function NatureWorldIdentityRevealStage({ spec, f }: { spec: SceneTemplateSpec<"nature-world-identity-reveal">; f: SceneTemplateFrame }) {
  const Renderer = useContext(NatureWorldRendererContext);
  const [glError, setGlError] = useState<string>();
  const c = spec.content, w = spec.width, h = spec.height, portrait = h > w, t = f.frame, reduced = f.reducedMotion;
  const config = useMemo(() => natureWorld3DConfig(spec, { ...f, frame: 0 }), [spec, f.durationFrames, f.cueFrames?.[0], f.cueFrames?.[1], f.cueFrames?.[2]]); // eslint-disable-line react-hooks/exhaustive-deps
  if (c.treatment === "cinematic") return <CinematicIdentityStage spec={spec} f={f}/>;
  if (!Renderer || !config || reduced || glError) return <DepthPlaneStage spec={spec} f={f}/>;
  const resolve = cueAt(f, 2), scale = c.scene3d?.resolutionScale ?? 1.5, look = c.look ?? {};
  return <div data-km-nature-renderer="webgl" style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#0c1408",
    fontSize: portrait ? "clamp(13px, 3.5cqw, 44px)" : "clamp(13px, 2cqw, 40px)" }}>
    <Renderer config={config} frame={t} pixelWidth={Math.round(w * scale)} pixelHeight={Math.round(h * scale)} onError={setGlError}/>
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none",
      background: "linear-gradient(0deg,rgba(4,8,3,.72) 0%,rgba(4,8,3,.3) 22%,transparent 40%)", opacity: span01(t, resolve - 20, resolve + 10) }}/>
    <FilmFinish frame={t} reduced={reduced} grain={(look.grain ?? 1) * .7} vignette={look.vignette ?? 1} vignetteStrength={.45}/>
    <IdentityCopy c={c} t={t} resolve={resolve} reduced={reduced} portrait={portrait}/>
  </div>;
}

