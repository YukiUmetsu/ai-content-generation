/**
 * Follow Subject Through Sections. Causal beat:
 *   input      one recognizable subject enters the first world
 *   transform  the camera tracks it through each world; each boundary is a motivated
 *              transition — a near occluder passing the lens, a whip pan, a continuous
 *              camera carry over a threshold, or a match cut — and the subject keeps its
 *              screen position, direction, scale and light across it
 *   output     it decelerates onto its destination with contact, and the last statement holds.
 * Multi-plane 2.5D: a panning, pushing plate per world, optional depth layers, and
 * procedural near forms at a higher parallax rate. Frame-addressable, no clock.
 */
import { createContext, useContext, useId, useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { ImageAsset, SceneTemplateFrame, SceneTemplateSpec } from "../scene-templates";
import type { AnnotationBeats } from "../subject-annotations";
import { annotationState } from "../subject-annotations";
import { followSubjectAt, followSubjectCopyRegion, followSubjectTimeline } from "../follow-subject-sections";
import type { FollowSubjectForeground, FollowSubjectState, FollowSubjectTimelineSection } from "../follow-subject-sections";
import { Asset, FilmFinish, KineticWords, OverlayRendererContext, RiseIn, clamp01, easeInOut, fitLongestWord, span01, srOnly } from "./stage-kit";

/** What a host rig receives each frame. Draw the subject facing +x inside a `width`×`height` box;
 * the stage positions, pitches and (for rtl travel) mirrors that box. */
export interface FollowSubjectRigProps {
  state: FollowSubjectState;
  frame: SceneTemplateFrame;
  media: ImageAsset;
  width: number; height: number;
  reducedMotion: boolean;
}
export type FollowSubjectRigRenderer = (props: FollowSubjectRigProps) => ReactNode;
/** Runtime-only rig slot, provided by the recipe wrapper's `renderSubject`; never serialized. */
export const FollowSubjectRigContext = createContext<FollowSubjectRigRenderer | undefined>(undefined);

/** Small deterministic PRNG so every frame regenerates identical forms. */
function seeded(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** Near-lens silhouettes in a -100..100 box whose base sits on y = 100. */
function formPath(kind: Exclude<FollowSubjectForeground, "none">, seed: number): string {
  const r = seeded(seed); let d = "";
  if (kind === "trunks") {
    const lean = (r() - .5) * 10, w0 = 30 + r() * 8;
    const side = (s: number) => Array.from({ length: 9 }, (_, i) => { const y = 100 - i * 25; return `${s * (w0 - i * 1.1) + lean * i / 8 + (r() - .5) * 3} ${y}`; });
    const left = side(-1), right = side(1).reverse();
    d = `M${left.join("L")}L${right.join("L")}Z`;
    return d;
  }
  if (kind === "rock") {
    const pts: string[] = [];
    for (let i = 0; i <= 14; i++) { const a = Math.PI * (1 + i / 14), rad = 62 + 26 * r(); pts.push(`${Math.cos(a) * rad * 1.4} ${100 + Math.sin(a) * rad * (1.1 + .4 * r())}`); }
    return `M-100 100L${pts.join("L")}L100 100Z`;
  }
  if (kind === "grass") {
    for (let i = 0; i < 34; i++) { const x = r() * 180 - 90, hgt = 60 + r() * 110, lean = (r() - .5) * 60, wd = 2.5 + r() * 3;
      d += `M${x - wd} 100Q${x + lean * .3} ${100 - hgt * .55} ${x + lean} ${100 - hgt}Q${x + lean * .3 + wd * .4} ${100 - hgt * .5} ${x + wd} 100Z`; }
    return d;
  }
  // foliage: a leafy branch rising from the base.
  const bend = (r() - .5) * 60, leaves = 10 + Math.floor(r() * 6);
  d += `M-5 100Q${bend} 10 ${bend * .4} -90L${bend * .4 + 6} -90Q${bend + 6} 10 5 100Z`;
  for (let i = 0; i < leaves; i++) {
    const t = .12 + .86 * i / leaves, side = i % 2 ? 1 : -1;
    const sx = bend * 2 * t * (1 - t) + bend * .4 * t * t, sy = 100 - 190 * t;
    const len = (60 - 30 * t) * (.8 + .4 * r()), wid = len * (.36 + .1 * r()), ang = (side * (50 + 25 * r()) - 8) * Math.PI / 180;
    const ux = Math.sin(ang), uy = -Math.cos(ang), px = -uy, py = ux;
    d += `M${sx} ${sy}C${sx + ux * len * .3 + px * wid} ${sy + uy * len * .3 + py * wid} ${sx + ux * len * .85 + px * wid * .45} ${sy + uy * len * .85 + py * wid * .45} ${sx + ux * len} ${sy + uy * len}`
      + `C${sx + ux * len * .85 - px * wid * .45} ${sy + uy * len * .85 - py * wid * .45} ${sx + ux * len * .3 - px * wid} ${sy + uy * len * .3 - py * wid} ${sx} ${sy}Z`;
  }
  return d;
}
const formTone: Record<Exclude<FollowSubjectForeground, "none">, [string, string]> = {
  trunks: ["#07090a", "#1c1f1d"], rock: ["#08090b", "#23262a"], grass: ["#050805", "#1c2b12"], foliage: ["#050904", "#1d3312"],
};
/** One near form. `x` is its centre in stage fractions; `h` its height as a fraction of stage height. */
function NearForm({ kind, seed, x, h, w, blur, flip, top, name, opacity = 1 }: {
  kind: Exclude<FollowSubjectForeground, "none">; seed: number; x: number; h: number; w: number; blur: number; flip?: boolean; top?: boolean; name: string; opacity?: number }) {
  const d = useMemo(() => formPath(kind, seed), [kind, seed]);
  const id = `km-fs-form-${name}`, [lo, hi] = formTone[kind];
  return <svg aria-hidden="true" data-km-follow-form={name} viewBox="-100 -100 200 200" preserveAspectRatio="none" style={{ position: "absolute",
    left: `${(x - w / 2) * 100}%`, width: `${w * 100}%`, height: `${h * 100}%`, ...(top ? { top: 0 } : { bottom: 0 }), overflow: "visible", opacity,
    transform: `${top ? "scaleY(-1)" : ""} ${flip ? "scaleX(-1)" : ""}`, filter: `blur(${blur}em)`, pointerEvents: "none" }}>
    <defs><linearGradient id={id} x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor={lo}/><stop offset="1" stopColor={hi}/></linearGradient></defs>
    <path d={d} fill={`url(#${id})`}/>
  </svg>;
}

/** Textured near mass for an occluder wipe: procedural bark, leaf or rock grain with cylinder shading. */
function OccluderMass({ kind, cx, width, light, name }: { kind: Exclude<FollowSubjectForeground, "none">; cx: number; width: number; light: string; name: string }) {
  const grain = kind === "trunks" ? { f: "0.09 0.006", m: "0.34 0 0 0 0.03 0.29 0 0 0 0.03 0.25 0 0 0 0.03 0 0 0 0 1" }
    : kind === "rock" ? { f: "0.022 0.03", m: "0.3 0 0 0 0.03 0.3 0 0 0 0.03 0.32 0 0 0 0.035 0 0 0 0 1" }
    : { f: "0.035 0.035", m: "0.12 0 0 0 0.01 0.24 0 0 0 0.02 0.08 0 0 0 0.01 0 0 0 0 1" };
  const edge = "linear-gradient(90deg,transparent 0%,#000 6%,#000 94%,transparent 100%)";
  return <div style={{ position: "absolute", top: "-6%", bottom: "-6%", left: `${(cx - width / 2) * 100}%`, width: `${width * 100}%`,
    maskImage: edge, WebkitMaskImage: edge, filter: "blur(.3em)" }}>
    <svg width="100%" height="100%" viewBox="0 0 400 400" preserveAspectRatio="none" style={{ display: "block" }}>
      <filter id={name} x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency={grain.f} numOctaves={4} seed={7}/><feColorMatrix type="matrix" values={grain.m}/></filter>
      <rect width="400" height="400" filter={`url(#${name})`}/>
    </svg>
    <div style={{ position: "absolute", inset: 0, background: `linear-gradient(90deg,rgba(0,0,0,.82) 0%,rgba(0,0,0,.2) 32%,${light}38 52%,rgba(0,0,0,.25) 68%,rgba(0,0,0,.85) 100%)` }}/>
  </div>;
}

/** Grass blades for contact occlusion, base on the box bottom. */
function GroundBlades({ seed, tint }: { seed: number; tint: string }) {
  const d = useMemo(() => { const r = seeded(seed); let out = "";
    for (let i = 0; i < 70; i++) { const x = r() * 196 - 98, hgt = 26 + r() * 74, lean = (r() - .5) * 34, wd = 1.1 + r() * 1.4;
      out += `M${x - wd} 100Q${x + lean * .35} ${100 - hgt * .55} ${x + lean} ${100 - hgt}Q${x + lean * .35 + wd * .3} ${100 - hgt * .5} ${x + wd} 100Z`; }
    return out; }, [seed]);
  const id = `km-fs-blades-${seed}`;
  return <svg viewBox="-100 0 200 100" preserveAspectRatio="none" width="100%" height="100%" style={{ display: "block", overflow: "visible" }}>
    <defs><linearGradient id={id} x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#1a2410"/><stop offset=".6" stopColor="#3d5226"/><stop offset="1" stopColor={tint} stopOpacity=".9"/></linearGradient></defs>
    <path d={d} fill={`url(#${id})`}/>
  </svg>;
}

/** Where each world sits horizontally (in stage widths) and how it is treated at frame t. */
interface WorldPlacement { index: number; shift: number; blur: number; flash: number; kick: number;
  /** Fade this world's edge over `band` (stage widths) so the world beneath shows through. */
  feather?: "left" | "right"; band?: number;
  /** Extra overscan so this world reaches under a neighbour's feathered edge. */
  boost?: number }
function worldsAt(timeline: FollowSubjectTimelineSection[], t: number, dir: 1 | -1, reduced: boolean): WorldPlacement[] {
  let i = 0; while (i < timeline.length - 1 && t >= timeline[i + 1].start) i++;
  const base: WorldPlacement[] = [{ index: i, shift: 0, blur: 0, flash: 0, kick: 0 }];
  if (reduced) return base;
  const boundary = (k: number) => { const s = timeline[k]; const half = Math.ceil(s.transitionFrames / 2); return { s, from: s.start - half, to: s.start + half }; };
  // Inside the window of the boundary into i (just cut) or into i + 1 (about to cut)?
  for (const k of [i, i + 1]) {
    if (k < 1 || k >= timeline.length) continue;
    const { s, from, to } = boundary(k);
    if (s.transition === "match-cut") { if (k === i) base[0].kick = 1 - span01(t, s.start, s.start + 10); continue; }
    if (t < from || t >= to) continue;
    const p = (t - from) / Math.max(1, to - from), out = k - 1, inc = k;
    if (s.transition === "camera-carry") {
      // Incoming beneath, over-scanned so it reaches under the seam; the outgoing world on top
      // feathers its leading edge, so the two worlds meet in a soft band, never a hard line.
      const q = easeInOut(p);
      return [{ index: inc, shift: dir * (1 - q), blur: 0, flash: 0, kick: 0, boost: .26 * (1 - q) },
        { index: out, shift: -dir * q, blur: 0, flash: 0, kick: 0, feather: dir > 0 ? "right" : "left", band: .02 + .13 * (1 - q) }];
    }
    if (s.transition === "whip-pan") {
      // The plate travels inside its overscan while a directional blur carries the speed;
      // the swap happens at peak blur, so the frame never empties.
      const blur = Math.pow(Math.sin(Math.PI * p), .8);
      return p < .5
        ? [{ index: out, shift: -dir * Math.pow(p / .5, 2) * .16, blur, flash: blur * .3, kick: 0 }]
        : [{ index: inc, shift: dir * Math.pow(1 - (p - .5) / .5, 2) * .16, blur, flash: blur * .3, kick: 0 }];
    }
    // occluder-wipe: the world swaps while the near form covers the lens.
    return [{ index: p < .5 ? out : inc, shift: 0, blur: 0, flash: 0, kick: 0 }];
  }
  return base;
}

export function FollowSubjectThroughSectionsStage({ spec, f }: { spec: SceneTemplateSpec<"follow-subject-through-sections">; f: SceneTemplateFrame }) {
  const c = spec.content, w = spec.width, h = spec.height, portrait = h > w, t = f.frame, reduced = f.reducedMotion;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const timeline = useMemo(() => followSubjectTimeline(c, spec.durationFrames), [c, spec.durationFrames]);
  const state = followSubjectAt(spec, t, reduced);
  const dir: 1 | -1 = c.direction === "rtl" ? -1 : 1;
  const cam = { pan: c.camera?.pan ?? .14, push: c.camera?.push ?? .06, parallax: c.camera?.parallax ?? 2.6, follow: c.camera?.follow ?? .25 };
  const rig = useContext(FollowSubjectRigContext), overlay = useContext(OverlayRendererContext);
  const look = c.look ?? {}, ink = c.palette?.ink ?? "#f7f4ec", scrim = c.palette?.scrim ?? "#04070b";
  const short = Math.min(w, h);
  // Geometry is computed in spec pixels and placed in percentages, so any CSS size renders the same frame.
  const pctX = (px: number) => `${px / w * 100}%`, pctY = (px: number) => `${px / h * 100}%`;
  const halfIn = (k: number) => Math.ceil(timeline[k].transitionFrames / 2);
  /** Camera progress through a section, over its extended (transition-inclusive) span. */
  const camU = (k: number) => {
    const s = timeline[k], from = s.start - halfIn(k), to = s.end + (timeline[k + 1] ? halfIn(k + 1) : 0);
    return reduced ? .5 : clamp01((t - from) / Math.max(1, to - from));
  };
  const worlds = worldsAt(timeline, t, dir, reduced);
  const followY = reduced ? 0 : -cam.follow * (state.y / h - .5) * .1;

  const world = (pl: WorldPlacement) => {
    const sec = c.sections[pl.index], u = camU(pl.index);
    const pan = sec.camera?.pan ?? cam.pan, push = sec.camera?.push ?? cam.push;
    const S = 1 + Math.max(pan, .1) + push;
    const zoom = 1 + (reduced ? 0 : push * easeInOut(u)) + pl.kick * .035 + pl.blur * .3 + (pl.boost ?? 0);
    const tx = dir * pan * (.5 - u) / S * 100, ty = followY / S * 100;
    const focus = sec.focus ?? { x: .5, y: .5 };
    const mask = pl.feather ? `linear-gradient(${pl.feather === "left" ? "90deg" : "270deg"},transparent 0%,#000 ${((pl.band ?? .15) * 100).toFixed(2)}%)` : undefined;
    const light = sec.light?.color;
    return <div key={sec.id} data-km-follow-world={sec.id} aria-hidden="true" style={{ position: "absolute", inset: 0,
      transform: `translate3d(${pl.shift * 100}%,0,0)`, filter: pl.blur > 0 ? `url(#${uid}-whip-${Math.round(pl.blur * 8)})` : undefined,
      ...(mask ? { maskImage: mask, WebkitMaskImage: mask } : {}) }}>
      <div style={{ position: "absolute", inset: 0, transform: `scale(${S * zoom}) translate3d(${tx}%,${ty}%,0)`, transformOrigin: "50% 50%", willChange: "transform" }}>
        <Asset asset={sec.environment} style={{ borderRadius: 0, objectPosition: `${focus.x * 100}% ${focus.y * 100}%`, filter: "brightness(.9) contrast(1.07) saturate(1.05)" }}/>
        {light && <div style={{ position: "absolute", inset: 0, background: light, mixBlendMode: "soft-light", opacity: .32 }}/>}
      </div>
      {(sec.layers ?? []).map((layer, li) => <div key={layer.asset.id + li} style={{ position: "absolute", inset: 0,
        transform: `scale(${1 + cam.pan * Math.abs(layer.depth) + cam.push}) translate3d(${dir * cam.pan * layer.depth * (.5 - u) * 100 / (1 + cam.pan * Math.abs(layer.depth))}%,0,0)` }}>
        <Asset asset={layer.asset} style={{ borderRadius: 0, objectFit: "cover" }}/>
      </div>)}
      {sec.atmosphere === "mist" && <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {[0, 1].map(m => <div key={m} style={{ position: "absolute", left: "-30%", width: "160%", top: `${38 + m * 22}%`, height: "26%",
          transform: `translate3d(${(-dir * (u * 9 + m * 4) + m * 5)}%,0,0)`, background: "radial-gradient(ellipse 50% 50% at 50% 50%,rgba(226,232,228,.34),transparent 70%)", filter: "blur(1.4em)" }}/>)}
      </div>}
      {sec.atmosphere === "motes" && !reduced && <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {Array.from({ length: 18 }, (_, m) => { const r = seeded(500 + m * 7 + pl.index * 131); const x0 = r(), y0 = r(), z = .4 + r() * .9, sz = .1 + r() * .22;
          const x = ((x0 - dir * u * z * .5) % 1 + 1) % 1, y = (y0 + Math.sin((t + m * 13) / 40) * .01);
          return <div key={m} style={{ position: "absolute", left: `${x * 100}%`, top: `${y * 100}%`, width: `${sz * z}em`, height: `${sz * z}em`, borderRadius: "50%",
            background: light ?? "#fff3d6", opacity: .18 + .3 * r(), boxShadow: `0 0 .5em .12em ${light ?? "#fff3d6"}66` }}/>; })}
      </div>}
    </div>;
  };

  // Near forms ride each world's own camera, at the parallax rate.
  const nearForms = (pl: WorldPlacement) => {
    const sec = c.sections[pl.index], kind = sec.foreground ?? "none";
    if (kind === "none" || reduced) return null;
    const u = camU(pl.index), travel = Math.max(sec.camera?.pan ?? cam.pan, .06) * cam.parallax * 2.6;
    const r = seeded(17 + pl.index * 97);
    const count = kind === "trunks" ? 3 : 4;
    return <div key={"near-" + sec.id} aria-hidden="true" style={{ position: "absolute", inset: 0, transform: `translate3d(${pl.shift * 100}%,0,0)`, pointerEvents: "none" }}>
      {Array.from({ length: count }, (_, m) => {
        const base = .1 + m * (1.15 / count) + r() * .12, x = base + dir * travel * (.5 - u) + (dir < 0 ? 0 : 0);
        const tall = kind === "trunks" ? 1.15 : kind === "foliage" ? .55 + r() * .2 : kind === "grass" ? .2 + r() * .1 : .15 + r() * .1;
        const wide = kind === "trunks" ? .07 + r() * .05 : kind === "grass" ? .34 + r() * .2 : .3 + r() * .14;
        const xs = portrait ? (x - .5) * 1.25 + .5 : x;
        return <NearForm key={m} kind={kind} seed={pl.index * 31 + m * 7 + 3} x={xs} h={tall} w={wide * (portrait ? 1.3 : 1)} blur={kind === "trunks" ? .35 + r() * .5 : kind === "rock" ? .7 + r() * .4 : .22 + r() * .3}
          flip={m % 2 === 1} top={kind === "foliage" && m % 2 === 1} name={`${uid}-${sec.id}-${m}`}/>;
      })}
    </div>;
  };

  // Transition-owned near forms: the occluder that covers a wipe, and the threshold riding a carry seam.
  let occluder: ReactNode = null;
  if (state.transition && !reduced) {
    const { kind, progress: p } = state.transition;
    const into = c.sections[state.transition.into];
    const formKind = (into?.foreground && into.foreground !== "none" ? into.foreground : "foliage") as Exclude<FollowSubjectForeground, "none">;
    if (kind === "occluder-wipe") {
      // A near mass crosses the lens fast enough to hide the swap: it spans the frame on the switch frame.
      const cx = .5 + dir * (1.4 - 2.8 * p), coverKind = formKind === "grass" ? "foliage" : formKind;
      occluder = <div aria-hidden="true" data-km-follow-occluder={coverKind} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <OccluderMass kind={coverKind} cx={cx} width={1.16} light={state.light.color} name={`${uid}-occ`}/>
        {coverKind !== "trunks" && <>
          <NearForm kind={coverKind} seed={91} x={cx - .56 * dir} h={1.15} w={.5} blur={.6} name={`${uid}-occ-a`}/>
          <NearForm kind={coverKind} seed={57} x={cx + .56 * dir} h={1.1} w={.45} blur={.6} flip top name={`${uid}-occ-b`}/>
        </>}
      </div>;
    }
    if (kind === "camera-carry") {
      // The incoming world's leading edge; a near threshold from the world being left passes over it.
      const outKind = c.sections[state.transition.into - 1]?.foreground;
      const th = (outKind && outKind !== "none" && outKind !== "grass" ? outKind : formKind === "grass" ? "rock" : formKind) as Exclude<FollowSubjectForeground, "none">;
      const q = easeInOut(p), seam = dir > 0 ? 1 - q : q, cx = seam + dir * (.5 - p) * .6;
      occluder = <div aria-hidden="true" data-km-follow-threshold={th} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <NearForm kind={th} seed={73} x={cx} h={th === "trunks" ? 1.2 : th === "foliage" ? .95 : .4} w={th === "trunks" ? .22 : portrait ? .9 : .6} blur={th === "rock" ? 1.5 : .8} opacity={th === "rock" ? .8 : 1} name={`${uid}-carry`}/>
      </div>;
    }
  }

  // Subject box.
  const media = c.subject.media, anchor = c.subject.anchor ?? { x: .5, y: .5 };
  const bh = short * (c.subject.size ?? .12) * state.scale, bw = bh * media.width! / media.height!;
  const groundY = (() => {
    const sec = c.sections[state.sectionIndex];
    if (sec.ground !== undefined) return sec.ground * h;
    if (state.sectionIndex === c.sections.length - 1 && c.arrival?.contact !== false) {
      const last = followSubjectAt(spec, spec.durationFrames - 1, reduced);
      return last.y + short * (c.subject.size ?? .12) * last.scale * ((c.subject.contact ?? 1) - anchor.y);
    }
    return undefined;
  })();
  const subjectBottom = state.y + bh * ((c.subject.contact ?? 1) - anchor.y);
  const altitude = groundY === undefined ? 1 : clamp01((groundY - subjectBottom) / (h * .32));
  const exposure = state.light.exposure;
  // Landing in grass: blades at the touchdown point stand in front of the subject's base.
  const lastSec = c.sections[c.sections.length - 1];
  const contactBlades = groundY !== undefined && state.sectionIndex === c.sections.length - 1 && (lastSec.foreground === "grass" || lastSec.foreground === "foliage")
    ? <div aria-hidden="true" data-km-follow-contact="" style={{ position: "absolute", left: pctX(state.x - bw * .95), width: pctX(bw * 1.9),
        top: pctY(groundY - bh * .42), height: pctY(bh * .58), opacity: .35 + .65 * clamp01(1 - altitude * 3), pointerEvents: "none" }}>
        <GroundBlades seed={11} tint={state.light.color}/>
      </div>
    : null;
  const subjectBody = rig
    ? rig({ state, frame: f, media, width: bw, height: bh, reducedMotion: reduced })
    : <div style={{ position: "absolute", inset: 0 }}>
        <Asset asset={media} style={{ borderRadius: 0, objectFit: "contain", filter: `brightness(${exposure})` }}/>
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: state.light.color, mixBlendMode: "multiply", opacity: .35,
          maskImage: `url("${media.src}")`, WebkitMaskImage: `url("${media.src}")`, maskSize: "contain", WebkitMaskSize: "contain",
          maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat", maskPosition: "center", WebkitMaskPosition: "center" } as CSSProperties}/>
      </div>;

  // Copy timing: in after the arriving transition settles, out before the next one begins.
  const sIdx = state.sectionIndex, sec = c.sections[sIdx], tl = timeline[sIdx];
  // The destination statement is the payoff: it waits for touchdown when the subject lands with contact.
  const landing = sIdx === timeline.length - 1 && c.arrival?.contact !== false
    ? Math.round(tl.start + (tl.end - tl.start) * (c.arrival?.settle ?? .72)) - 10 : 0;
  const copyIn = sIdx === 0 ? Math.min(6, tl.end) : Math.max(tl.start + halfIn(sIdx) + 4, landing);
  const nextHalf = timeline[sIdx + 1] ? halfIn(sIdx + 1) : 0;
  const copyOut = timeline[sIdx + 1] ? tl.end - nextHalf - 12 : f.durationFrames + 1;
  const out = reduced ? 0 : span01(t, copyOut, copyOut + 10);
  const region = followSubjectCopyRegion(c, w, h), upper = region.placement === "upper";
  const titleScale = c.typography?.titleScale ?? 1;
  const titleEm = (portrait ? 2.3 : 2.75) * titleScale;
  const titleWidthCqw = region.width * 100 * .96;

  const beats: AnnotationBeats = { dock: timeline[1]?.start ?? 0, reveal: timeline[Math.min(2, timeline.length - 1)].start, resolve: timeline[timeline.length - 1].start, durationFrames: f.durationFrames, steps: {} };
  const railColor = c.palette?.rail ?? ink;
  const letterbox = !portrait && look.letterbox === true;

  return <div data-km-follow-section={state.sectionId} data-km-follow-transition={state.transition?.kind ?? ""} style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#05070a",
    color: ink, fontFamily: c.typography?.body ?? "var(--km-font-body, system-ui, sans-serif)",
    fontSize: portrait ? "clamp(12px, 3.6cqw, 46px)" : "clamp(12px, 2cqw, 40px)" }}>
    <svg aria-hidden="true" width="0" height="0" style={{ position: "absolute" }}>
      {Array.from({ length: 9 }, (_, k) => <filter key={k} id={`${uid}-whip-${k}`} x="-10%" y="0" width="120%" height="100%">
        <feGaussianBlur stdDeviation={`${k * w * .006} ${k * .3}`} edgeMode="duplicate"/>
      </filter>)}
    </svg>
    {worlds.map(world)}
    {/* Grade: settle the ground, keep the sky open. */}
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none",
      background: "linear-gradient(0deg,rgba(4,6,8,.45) 0%,transparent 38%),linear-gradient(180deg,rgba(4,6,8,.22) 0%,transparent 24%)" }}/>
    {worlds.some(wd => wd.flash > 0) && <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", mixBlendMode: "screen",
      background: `linear-gradient(${dir > 0 ? 90 : 270}deg,transparent,rgba(255,244,222,${Math.max(...worlds.map(wd => wd.flash))}) 50%,transparent)` }}/>}
    {/* Contact: a ground shadow that tightens as the subject comes down. */}
    {groundY !== undefined && <div aria-hidden="true" data-km-follow-shadow={(1 - altitude).toFixed(3)} style={{ position: "absolute",
      left: pctX(state.x - bw * (.42 + altitude * .2)), top: pctY(groundY - bh * (.1 + altitude * .1)), width: pctX(bw * (.84 + altitude * .4)), height: pctY(bh * (.2 + altitude * .2)),
      borderRadius: "50%", background: "radial-gradient(ellipse 50% 50% at 50% 50%,rgba(3,5,4,.75),rgba(3,5,4,0) 72%)",
      opacity: .85 * (1 - altitude * .85), filter: `blur(${.06 + altitude * .5}em)`, pointerEvents: "none" }}/>}
    <div data-km-follow-subject={media.id} data-km-follow-x={state.x.toFixed(1)} data-km-follow-y={state.y.toFixed(1)}
      aria-hidden="true" style={{ position: "absolute", left: pctX(state.x - bw * anchor.x), top: pctY(state.y - bh * anchor.y), width: pctX(bw), height: pctY(bh),
        transformOrigin: `${anchor.x * 100}% ${anchor.y * 100}%`, transform: `rotate(${dir * state.heading}deg) scaleX(${dir})`,
        filter: `drop-shadow(0 ${bh * .1 / w * 100}cqw ${bh * .14 / w * 100}cqw rgba(0,0,0,${.28 * altitude + .1}))`, pointerEvents: "none" }}>
      {subjectBody}
    </div>
    {contactBlades}
    {worlds.map(nearForms)}
    {occluder}
    <div data-km-stage-overlay="" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {overlay?.({ frame: f, width: w, height: h, beats, space: "stage", toStage: p => ({ x: p.x * w, y: p.y * h }),
        state: timing => annotationState(timing, beats, t, reduced) })}
    </div>
    <FilmFinish frame={t} reduced={reduced} grain={look.grain ?? .8} vignette={look.vignette ?? 1} vignetteStrength={.5}/>
    {letterbox && <>{[0, 1].map(b => <div key={b} aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, height: "6%", [b ? "bottom" : "top"]: 0, background: "#000" }}/>)}</>}
    {/* Copy scrim sits under the copy only, shaped to its region. */}
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", background: upper
      ? `linear-gradient(180deg,${scrim}cc 0%,${scrim}66 ${(region.y + region.height) * 70}%,transparent ${(region.y + region.height) * 112}%)`
      : `radial-gradient(ellipse ${portrait ? "120% 52%" : "72% 62%"} at ${portrait ? "50%" : "18%"} 100%,${scrim}d9 0%,${scrim}80 45%,transparent 76%)` }}/>
    <div data-km-follow-copy={sec.id} style={{ position: "absolute", left: `${region.x * 100}%`, width: `${region.width * 100}%`,
      ...(upper ? { top: `${region.y * 100}%` } : { bottom: `${(1 - region.y - region.height) * 100}%` }),
      display: "flex", flexDirection: "column", gap: ".42em", textShadow: "0 .04em .6em rgba(0,0,0,.45)",
      opacity: 1 - out, transform: `translate3d(0,${-out * .4}em,0)` }}>
      {c.progress !== false && <div data-km-follow-rail="" aria-hidden="true" style={{ display: "flex", gap: ".32em", width: `${Math.min(14, c.sections.length * 3.4)}em`, marginBottom: ".2em", opacity: 1 - (reduced ? 0 : 1 - span01(t, 2, 12)) }}>
        {c.sections.map((s, k) => { const tk = timeline[k];
          const fill = reduced ? (k <= sIdx ? 1 : 0) : clamp01((t - tk.start) / Math.max(1, tk.end - tk.start - 1));
          return <div key={s.id} style={{ flex: 1, height: ".26em", borderRadius: ".13em", background: `${railColor}38`, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${fill * 100}%`, background: k === sIdx ? "var(--km-accent, #9fd9ce)" : railColor, borderRadius: ".13em" }}/>
          </div>; })}
      </div>}
      {t >= copyIn && <>
        {sec.kicker && <RiseIn name="follow-kicker" frame={t} start={copyIn} length={14} reduced={reduced}
          style={{ fontSize: ".74em", fontWeight: 650, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--km-accent, #9fd9ce)" }}>{sec.kicker}</RiseIn>}
        <h2 data-km-follow-title="" style={{ margin: 0, fontFamily: c.typography?.display ?? "inherit", fontWeight: c.typography?.titleWeight ?? 700,
          fontSize: fitLongestWord(sec.title, titleEm, titleWidthCqw), lineHeight: 1.04, letterSpacing: "-.02em", textWrap: "balance" }}>
          <KineticWords key={sec.id} text={sec.title} start={copyIn + 3} stagger={2.5} length={15} frame={t} reduced={reduced} marker="follow"/>
        </h2>
        {sec.caption && <RiseIn name="follow-caption" frame={t} start={copyIn + 14} length={16} reduced={reduced}
          style={{ fontSize: portrait ? ".98em" : ".96em", fontWeight: 450, lineHeight: 1.36, maxWidth: "28em", opacity: .94, textWrap: "pretty" }}>{sec.caption}</RiseIn>}
      </>}
    </div>
    <p style={srOnly}>{[sec.kicker, sec.title, sec.caption].filter(Boolean).join(". ")}</p>
  </div>;
}
