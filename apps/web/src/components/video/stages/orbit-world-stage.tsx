/**
 * Orbit World. Causal beat:
 *   input      real locations (latitude/longitude), great-circle legs between
 *              them and a light source (a subsolar point, a UTC instant or the
 *              illustrative default)
 *   transform  the camera opens over the planet's illuminated limb, tilts down
 *              and pulls back to the whole globe, then travels with the route
 *              as it draws on the surface behind a travelling head
 *   output     an eased arrival holds the destination in geographic context,
 *              with its label, readout and optional media.
 * Lit WebGL globe (day/night maps, terminator, ocean specular, clouds,
 * atmosphere) when textures and WebGL 2 are available; otherwise, and under
 * reduced motion, an orthographic 2D globe with Natural Earth land. Both use
 * the same camera track, so route, markers and labels share one projection.
 * Pure function of the frame: the camera track is computed once from the
 * payload and indexed, and the canvas redraws on the host's frame.
 */
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { SceneTemplateFrame, SceneTemplateSpec } from "../scene-templates";
import type { AnnotationBeats } from "../subject-annotations";
import { annotationState } from "../subject-annotations";
// Three.js is loaded only when the lit globe is actually drawn.
import type { GlobeFrame, GlobeLook, GlobeTextureImages, OrbitGlobeRenderer } from "../orbit-globe-gl";
import { OrbitGlobeFlat, orthoProjector } from "../orbit-globe-flat";
import { cameraMatrices, facing, geoToVec, globeDisc, journeyPoint, labelBox, layoutLabels, planOrbitWorld, projectToStage,
  resolveOrbitWorld, routeProgress, sideRect, textEm, viewAt } from "../orbit-world-model";
import type { LabelRequest, LabelSide, OrbitWorldPayload, Rect, Vec3 } from "../orbit-world-model";
import { Asset, FilmFinish, KineticWords, OverlayRendererContext, RiseIn, cinematicEase, clamp01, cueAt, srOnly } from "./stage-kit";

type Textures = NonNullable<OrbitWorldPayload["textures"]>;
const imageCache = new Map<string, Promise<HTMLImageElement>>();
function loadImage(src: string): Promise<HTMLImageElement> {
  let job = imageCache.get(src);
  if (!job) {
    job = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("texture"));
      img.src = src;
    });
    imageCache.set(src, job);
    job.catch(() => imageCache.delete(src));
  }
  return job;
}
/** Loads the globe maps. The day map is required; a missing optional map is simply left out. */
function useGlobeTextures(t: Textures | undefined): { images?: GlobeTextureImages; failed?: boolean } {
  const key = t ? [t.day?.src, t.night?.src, t.water?.src, t.clouds?.src].join("|") : "";
  const [state, setState] = useState<{ key: string; images?: GlobeTextureImages; failed?: boolean }>({ key });
  useEffect(() => {
    if (!t?.day) return;
    let live = true;
    const optional = (a?: { src: string }) => a ? loadImage(a.src).catch(() => undefined) : Promise.resolve(undefined);
    Promise.all([loadImage(t.day.src), optional(t.night), optional(t.water), optional(t.clouds)])
      .then(([day, night, water, clouds]) => live && setState({ key, images: { day, night, water, clouds } }),
        () => live && setState({ key, failed: true }));
    return () => { live = false; };
    // The key captures every source the effect reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state : {};
}

/** The WebGL globe. Owns its canvas so a remount always gets a fresh context. */
function GlobeCanvas({ images, look, frame, pixelWidth, pixelHeight, draw, onFail }: {
  images: GlobeTextureImages; look: GlobeLook; frame: number; pixelWidth: number; pixelHeight: number;
  draw: GlobeFrame; onFail: () => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const renderer = useRef<{ r: OrbitGlobeRenderer; canvas: HTMLCanvasElement } | null>(null);
  const latest = useRef({ draw, frame });
  latest.current = { draw, frame };
  const lookKey = JSON.stringify(look);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const canvas = document.createElement("canvas");
    canvas.width = pixelWidth; canvas.height = pixelHeight;
    canvas.setAttribute("aria-hidden", "true");
    canvas.dataset.kmGlobeCanvas = "";
    Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", display: "block" });
    el.appendChild(canvas);
    let r: OrbitGlobeRenderer | undefined, live = true;
    import("../orbit-globe-gl").then(({ OrbitGlobeRenderer: Renderer }) => {
      if (!live) return;
      try { r = new Renderer(canvas, pixelWidth, pixelHeight, images, look); }
      catch { canvas.remove(); onFail(); return; }
      renderer.current = { r, canvas };
      r.render(latest.current.draw);
      canvas.dataset.kmGlFrame = String(latest.current.frame);
    }, () => { canvas.remove(); onFail(); });
    return () => { live = false; renderer.current = null; r?.dispose(); canvas.remove(); };
    // lookKey stands in for `look`; onFail is a stable state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images, lookKey, pixelWidth, pixelHeight]);
  useLayoutEffect(() => {
    const cur = renderer.current;
    if (!cur) return;
    cur.r.render(draw);
    cur.canvas.dataset.kmGlFrame = String(frame);
  });
  return <div ref={host} style={{ position: "absolute", inset: 0 }}/>;
}

interface Projected { x: number; y: number; front: number }
/** Visible stretches of a surface polyline, cut exactly at the limb. */
function visibleStretches(points: Vec3[], project: (p: Vec3) => Projected): { x: number; y: number }[][] {
  const out: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [], prev: Projected | undefined, prevP: Vec3 | undefined;
  for (const p of points) {
    const q = project(p);
    if (prev && prevP && (prev.front >= 0) !== (q.front >= 0)) {
      const t = prev.front / (prev.front - q.front);
      const e = project([prevP[0] + (p[0] - prevP[0]) * t, prevP[1] + (p[1] - prevP[1]) * t, prevP[2] + (p[2] - prevP[2]) * t]);
      if (q.front >= 0) run = [{ x: e.x, y: e.y }]; else { run.push({ x: e.x, y: e.y }); out.push(run); run = []; }
    }
    if (q.front >= 0) run.push({ x: q.x, y: q.y });
    prev = q; prevP = p;
  }
  if (run.length > 1) out.push(run);
  return out.filter(r => r.length > 1);
}
const pathOf = (pts: { x: number; y: number }[]) => "M" + pts.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("L");

export function OrbitWorldStage({ spec, f }: { spec: SceneTemplateSpec<"orbit-world">; f: SceneTemplateFrame }) {
  const c = spec.content, w = spec.width, h = spec.height, portrait = h > w, aspect = w / h, t = f.frame, reduced = f.reducedMotion;
  const S = Math.min(w, h);
  /** Composition px → stage-relative font size, so preview and export scale together. */
  const cq = (px: number) => `${(px / w * 100).toFixed(3)}cqw`;
  const dock = cueAt(f, 0), reveal = cueAt(f, 1), resolve = cueAt(f, 2);
  const fps = spec.fps.num / spec.fps.den;
  const r = useMemo(() => resolveOrbitWorld(c), [c]);
  const plan = useMemo(() => planOrbitWorld(r, { durationFrames: f.durationFrames, fps, dock, reveal, resolve }, aspect,
    { globeRadiusPercent: c.globeRadiusPercent, camera: c.camera }), [r, f.durationFrames, fps, dock, reveal, resolve, aspect, c.globeRadiusPercent, c.camera]);
  const view = viewAt(plan, t, reduced);
  const m = useMemo(() => cameraMatrices(view, aspect), [view, aspect]);
  const disc = useMemo(() => globeDisc(m, view, w, h), [m, view, w, h]);
  const wantGlobe = c.placement === "geographic" && c.renderer !== "projection" && !!c.textures?.day && !reduced;
  const tex = useGlobeTextures(wantGlobe ? c.textures : undefined);
  const [glFailed, setGlFailed] = useState(false);
  const mode: "globe" | "projection" = wantGlobe && tex.images && !glFailed ? "globe" : "projection";
  const state = mode === "globe" ? "globe" : wantGlobe && !tex.failed && !glFailed ? "loading" : "projection";
  const palette = c.palette ?? {};
  const accent = palette.route ?? "var(--km-accent, #ffb547)";
  const markerColor = palette.marker ?? accent;
  const ink = palette.ink ?? "#f6f3ec";
  const space = palette.space ?? "#02050a";
  const atmoColor = c.atmosphere?.color ?? "#5aa9ff", atmoStrength = c.atmosphere?.strength ?? 1;
  const display = c.typography?.display ?? "var(--km-font-display, var(--km-font-body, system-ui, sans-serif))";
  const body = c.typography?.body ?? "var(--km-font-body, system-ui, sans-serif)";

  const ortho = useMemo(() => orthoProjector(m, disc), [m, disc]);
  const project = useMemo<(p: Vec3) => Projected>(() => mode === "globe"
    ? p => { const s = projectToStage(m, p, w, h); return { x: s.x, y: s.y, front: facing(m, p) }; }
    : p => { const q = ortho(p); return { x: q.x, y: q.y, front: q.z }; }, [mode, m, w, h, ortho]);

  // Route: legs draw in order behind one head.
  const progress = routeProgress(plan, t, reduced);
  let before = 0;
  const drawn = r.legs.map(leg => {
    const share = r.totalAngle ? clamp01((progress * r.totalAngle - before) / Math.max(1e-9, leg.angle)) : 1;
    before += leg.angle;
    const n = leg.points.length - 1, cut = share * n, whole = Math.floor(cut);
    const pts = leg.points.slice(0, whole + 1);
    if (cut > whole && whole < n) { const a = leg.points[whole], b = leg.points[whole + 1], k = cut - whole;
      pts.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]); }
    return share > 0 && pts.length > 1 ? visibleStretches(pts, project) : [];
  });
  const head = journeyPoint(r, progress).point;
  const headBehind = journeyPoint(r, Math.max(0, progress - .01)).point;
  const headP = project(head), headQ = project(headBehind);
  const drawing = !reduced && t >= plan.drawStart && t < plan.drawEnd + 8;
  const headFade = reduced ? 0 : clamp01((t - plan.drawStart) / 6) * (1 - clamp01((t - plan.drawEnd) / 8));

  // Markers and their beats.
  const appearAt = (id: string) => id === r.origin.id ? plan.originAt : id === r.destination.id ? plan.destinationAt : (() => {
    let acc = 0;
    for (const leg of r.legs) { acc += leg.angle; if (leg.route.to === id) return Math.round(plan.drawStart + (plan.drawEnd - plan.drawStart) * acc / Math.max(1e-9, r.totalAngle)); }
    return dock;
  })();
  const beat = (start: number, length = 12) => reduced ? (t >= start ? 1 : 0) : cinematicEase((t - start) / length);
  const markers = r.locations.map(loc => {
    const p = project(geoToVec(loc.latitude, loc.longitude));
    const role = loc.id === r.destination.id ? "destination" : loc.id === r.origin.id ? "origin" : "waypoint";
    const radius = S * (role === "destination" ? .017 : role === "origin" ? .013 : .01);
    const vis = clamp01(p.front / .08) * beat(appearAt(loc.id));
    return { loc, p, role, radius, vis };
  });

  // Copy regions labels must avoid, in composition px.
  const S2 = S * .023;
  const titleSize = c.title ? Math.min(S * (portrait ? .085 : .09), (portrait ? w * .86 : w * .42) / Math.max(1, ...c.title.split(/\s+/).map(textEm))) : 0;
  const titleW = portrait ? w * .86 : w * .42;
  const titleBox = c.title ? labelBox([{ text: c.title, size: titleSize }], titleW, 0, 0) : { w: 0, h: 0 };
  const titleTop = portrait ? h * .06 : h * .08, titleLeft = portrait ? w * .07 : w * .06;
  const eyebrowH = c.eyebrow ? S * .026 * 1.6 : 0;
  const readoutSize = c.readout ? Math.min(S * .085, (portrait ? w * .86 : w * .36) / Math.max(1, textEm(c.readout.value))) : 0;
  const readoutH = c.readout ? readoutSize * 1.15 + (c.readout.label ? S * .026 * 1.5 : 0) : 0;
  const readoutBottom = portrait ? h * .1 : h * .1;
  const creditH = c.credit ? S2 * 1.4 * Math.ceil(textEm(c.credit) * S2 / (portrait ? w * .86 : w * .4)) : 0;
  const avoid: Rect[] = [];
  if (c.title || c.eyebrow) avoid.push({ x: titleLeft, y: titleTop, w: Math.max(titleBox.w, w * .2), h: titleBox.h + eyebrowH });
  if (c.readout) avoid.push({ x: titleLeft, y: h - readoutBottom - readoutH, w: Math.max(...[textEm(c.readout.value) * readoutSize, textEm(c.readout.label ?? "") * S * .026]), h: readoutH });
  if (c.credit) avoid.push(portrait ? { x: w * .07, y: h - h * .035 - creditH, w: w * .86, h: creditH } : { x: w * .56, y: h - h * .05 - creditH, w: w * .4, h: creditH });
  const titleMask: Rect | undefined = c.title || c.eyebrow ? { x: titleLeft - S * .02, y: titleTop - S * .02,
    w: Math.max(titleBox.w, w * .2) + S * .04, h: titleBox.h + eyebrowH + S * .04 } : undefined;
  const media = r.destination.image;
  const mediaRect: Rect | undefined = media ? (portrait ? { x: w * .07, y: titleTop + titleBox.h + eyebrowH + h * .03, w: w * .4, h: w * .3 }
    : { x: titleLeft, y: titleTop + titleBox.h + eyebrowH + h * .05, w: w * .24, h: w * .18 }) : undefined;
  if (mediaRect) avoid.push(mediaRect);
  const safe: Rect = { x: w * .04, y: h * .04, w: w * .92, h: h * .92 };

  // Labels: sides are chosen once, at each label's reference frame, then held while the camera moves.
  const labelSpec = (loc: typeof r.locations[number], role: string) => {
    const name = S * (role === "destination" ? .036 : role === "origin" ? .028 : .025);
    const lines = [{ text: loc.label, size: name }, ...(loc.detail && role === "destination" ? [{ text: loc.detail, size: S * .024 }] : [])];
    return { name, lines, box: labelBox(lines, portrait ? w * .6 : w * .3, S * .021, S * .01) };
  };
  const refLayout = useMemo(() => {
    const at = (frame: number, ids: Set<string>) => {
      const v = viewAt(plan, frame, reduced), mm = cameraMatrices(v, aspect), dd = globeDisc(mm, v, w, h), oo = orthoProjector(mm, dd);
      const pr = (p: Vec3): Projected => { if (mode === "globe") { const s = projectToStage(mm, p, w, h); return { x: s.x, y: s.y, front: facing(mm, p) }; } const q = oo(p); return { x: q.x, y: q.y, front: q.z }; };
      const reqs: LabelRequest[] = [];
      const marks: { x: number; y: number; r: number }[] = [];
      for (const loc of r.locations) {
        const p = pr(geoToVec(loc.latitude, loc.longitude));
        if (p.front <= .05) continue;
        const role = loc.id === r.destination.id ? "destination" : loc.id === r.origin.id ? "origin" : "waypoint";
        const rad = S * (role === "destination" ? .017 : .013);
        marks.push({ x: p.x, y: p.y, r: rad * 1.6 });
        if (!ids.has(loc.id)) continue;
        const pref: LabelSide[] = p.x > w * (portrait ? .5 : .62) ? ["left", "above", "below", "right"] : ["right", "above", "below", "left"];
        reqs.push({ id: loc.id, anchor: p, box: labelSpec(loc, role).box, gap: rad + S * .022, sides: pref, priority: role === "destination" ? 10 : role === "origin" ? 5 : 1 });
      }
      return layoutLabels(reqs, safe, avoid, marks);
    };
    const end = at(plan.arrive, new Set(r.locations.filter(l => l.id !== r.origin.id || r.origin.id === r.destination.id).map(l => l.id)));
    const start = at(Math.min(f.durationFrames - 1, plan.originAt + 14), new Set([r.origin.id]));
    return new Map([...end, ...start]);
    // Layout depends on the plan, copy regions and output size, all captured here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, mode, w, h, aspect, reduced, c.title, c.eyebrow, c.readout, c.credit, r]);

  const overlay = useContext(OverlayRendererContext);
  const beats: AnnotationBeats = { dock, reveal, resolve, durationFrames: f.durationFrames, steps: { arrive: plan.drawEnd } };
  const look = c.look ?? {};
  const pulse = reduced ? 0 : clamp01((t - plan.drawEnd) / 26);
  const strokeCore = S * .0075, strokeCase = S * .016;
  const starGain = Math.max(.35, Math.min(1, 1.15 - disc.r / S * .55));
  const sun = r.sun;
  const globeDraw = { view: m.view, projection: m.projection, sun, cloudShift: reduced ? 0 : t * .000018, starGain };
  const glLook: GlobeLook = { atmosphereColor: atmoColor, atmosphereStrength: atmoStrength, space, clouds: r.layers.clouds,
    stars: r.layers.stars, nightLights: r.layers.nightLights };
  const headAngle = Math.atan2(headP.y - headQ.y, headP.x - headQ.x) * 180 / Math.PI + 90;
  /**
   * A held side can drift into a copy region as the camera moves. Secondary labels then fade out
   * over the 8 frames before the collision (and back in after it), and are hidden while it lasts.
   */
  const clearShare = (loc: typeof r.locations[number], role: string, side: LabelSide) => {
    if (role === "destination" || reduced) return 1;
    let nearest = 9;
    for (let k = -8; k <= 8; k++) {
      const fv = viewAt(plan, Math.max(0, Math.min(f.durationFrames - 1, t + k))), mm = cameraMatrices(fv, aspect);
      const g = geoToVec(loc.latitude, loc.longitude);
      const q = mode === "globe" ? projectToStage(mm, g, w, h) : orthoProjector(mm, globeDisc(mm, fv, w, h))(g);
      const rad = S * (role === "origin" ? .013 : .01);
      const rect = clampRect(sideRect(q, labelSpec(loc, role).box, side, rad + S * .022), safe);
      if (avoid.some(a => rect.x < a.x + a.w && a.x < rect.x + rect.w && rect.y < a.y + a.h && a.y < rect.y + rect.h)) nearest = Math.min(nearest, Math.abs(k));
    }
    return nearest > 8 ? 1 : smooth01(nearest / 9);
  };
  const labelsOn = (id: string) => refLayout.get(id);

  return <div data-km-globe-state={state} data-km-orbit-mode={mode} style={{ position: "absolute", inset: 0, overflow: "hidden", background: space,
    fontFamily: body, color: ink }}>
    <p style={srOnly}>{[c.eyebrow, c.title, r.legs.length ? `${r.origin.label} → ${r.destination.label}` : r.destination.label,
      c.readout && [c.readout.label, c.readout.value].filter(Boolean).join(" "), c.credit].filter(Boolean).join(". ")}</p>
    {mode === "projection" && <OrbitGlobeFlat width={w} height={h} matrices={m} disc={disc} sun={sun} starGain={starGain}
      colors={{ space, ocean: palette.ocean ?? "#0d2a44", land: palette.land ?? "#36524c", coast: "rgba(196,232,222,.55)", atmosphere: atmoColor }}
      atmosphereStrength={atmoStrength} layers={{ stars: r.layers.stars, coastlines: r.layers.coastlines || !c.textures?.day, graticule: r.layers.graticule }}
      overlay={c.placement === "stylized" && c.globe ? <foreignObject x={disc.x - disc.r} y={disc.y - disc.r} width={disc.r * 2} height={disc.r * 2} opacity={.18}>
        <Asset asset={c.globe} style={{ borderRadius: "50%" }}/></foreignObject> : undefined}/>}
    {mode === "globe" && tex.images && <GlobeCanvas images={tex.images} look={glLook} frame={t} pixelWidth={w * 2} pixelHeight={h * 2}
      draw={globeDraw} onFail={() => setGlFailed(true)}/>}
    {/* Copy scrims: weighted to the title column and the readout. */}
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none",
      background: portrait
        ? "linear-gradient(180deg,rgba(2,5,10,.72) 0%,rgba(2,5,10,.3) 22%,transparent 34%,transparent 74%,rgba(2,5,10,.72) 100%)"
        : "linear-gradient(98deg,rgba(2,5,10,.66) 0%,rgba(2,5,10,.32) 30%,transparent 48%),linear-gradient(0deg,rgba(2,5,10,.5) 0%,transparent 24%)" }}/>
    <svg aria-hidden="true" data-km-orbit-overlay="" viewBox={`0 0 ${w} ${h}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
      <defs><filter id="km-ow-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation={S * .006}/></filter>
        {/* The route yields to the title: it is masked, with a feathered edge, where the title sits. */}
        <filter id="km-ow-feather" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation={S * .02}/></filter>
        <mask id="km-ow-copy" maskUnits="userSpaceOnUse" x={0} y={0} width={w} height={h}>
          <rect width={w} height={h} fill="#fff"/>
          {titleMask && <rect x={titleMask.x} y={titleMask.y} width={titleMask.w} height={titleMask.h} fill="#000" filter="url(#km-ow-feather)"/>}
        </mask></defs>
      {drawn.map((runs, i) => runs.map((run, j) => <g key={`${i}-${j}`} data-km-orbit-route={r.legs[i].route.id} mask="url(#km-ow-copy)">
        <path d={pathOf(run)} fill="none" stroke="rgba(2,6,12,.62)" strokeWidth={strokeCase} strokeLinecap="round" strokeLinejoin="round"/>
        <path d={pathOf(run)} fill="none" stroke={accent} strokeWidth={strokeCore * 2.2} strokeLinecap="round" opacity={.35} filter="url(#km-ow-glow)"/>
        <path d={pathOf(run)} fill="none" stroke={accent} strokeWidth={strokeCore} strokeLinecap="round" strokeLinejoin="round"/>
      </g>))}
      {markers.map(({ loc, p, role, radius, vis }) => vis > .01 && <g key={loc.id} data-km-world-location={loc.id} data-km-world-x={(p.x / w * 100).toFixed(2)}
        data-km-world-y={(p.y / h * 100).toFixed(2)} opacity={vis} mask={role === "destination" ? undefined : "url(#km-ow-copy)"}>
        {role === "destination" && pulse > 0 && pulse < 1 && <circle cx={p.x} cy={p.y} r={radius * (1 + pulse * 2.6)} fill="none" stroke={markerColor} strokeWidth={S * .005 * (1 - pulse)} opacity={1 - pulse}/>}
        <circle cx={p.x} cy={p.y} r={radius * 1.35} fill="rgba(2,6,12,.55)"/>
        <circle cx={p.x} cy={p.y} r={radius} fill="none" stroke={markerColor} strokeWidth={S * (role === "waypoint" ? .004 : .005)}/>
        <circle cx={p.x} cy={p.y} r={radius * .42} fill={role === "destination" ? markerColor : ink}/>
      </g>)}
      {drawing && headP.front > 0 && !c.subject && <g data-km-orbit-head="" opacity={headFade} transform={`translate(${headP.x.toFixed(1)} ${headP.y.toFixed(1)})`}>
        <circle r={S * .022} fill={accent} opacity={.3} filter="url(#km-ow-glow)"/>
        <circle r={S * .0105} fill={accent}/>
        <circle r={S * .0055} fill="#fffdf6"/>
      </g>}
      {/* Leader lines from each marker to its label. */}
      {markers.map(({ loc, p, role, radius, vis }) => {
        const placed = labelsOn(loc.id);
        if (!placed || vis < .01) return null;
        const shown = vis * clearShare(loc, role, placed.side);
        if (shown < .01) return null;
        const box = labelSpec(loc, role).box;
        const rect = clampRect(sideRect(p, box, placed.side, radius + S * .022), safe);
        const target = nearestEdge(rect, p);
        const len = Math.hypot(target.x - p.x, target.y - p.y);
        if (len <= radius * 1.4) return null;
        const ux = (target.x - p.x) / len, uy = (target.y - p.y) / len;
        const reach = beat(appearAt(loc.id) + 4, 10);
        const from = { x: p.x + ux * radius * 1.35, y: p.y + uy * radius * 1.35 };
        return <path key={loc.id} d={`M${from.x.toFixed(1)} ${from.y.toFixed(1)}L${(from.x + (target.x - from.x) * reach).toFixed(1)} ${(from.y + (target.y - from.y) * reach).toFixed(1)}`}
          stroke={markerColor} strokeWidth={S * .004} strokeLinecap="round" opacity={shown}/>;
      })}
    </svg>
    {c.subject && drawing && headP.front > 0 && <div data-km-orbit-subject="" aria-hidden="true" style={{ position: "absolute", left: `${headP.x / w * 100}%`, top: `${headP.y / h * 100}%`,
      width: cq(S * .06), height: cq(S * .06), opacity: headFade, transform: `translate(-50%,-50%) rotate(${headAngle.toFixed(1)}deg)`, filter: "drop-shadow(0 .2em .4em rgba(0,0,0,.6))" }}>
      <Asset asset={c.subject} style={{ objectFit: "contain", borderRadius: 0 }}/>
    </div>}
    <FilmFinish frame={t} reduced={reduced} grain={look.grain ?? .7} vignette={look.vignette ?? 1} vignetteStrength={.5}/>
    {markers.map(({ loc, p, role, radius, vis }) => {
      const placed = labelsOn(loc.id);
      if (!placed || vis < .01) return null;
      const shown = vis * clearShare(loc, role, placed.side);
      if (shown < .01) return null;
      const { name, lines, box } = labelSpec(loc, role);
      const rect = clampRect(sideRect(p, box, placed.side, radius + S * .022), safe);
      const pop = beat(appearAt(loc.id) + 6, 12);
      const style: CSSProperties = { position: "absolute", left: `${rect.x / w * 100}%`, top: `${rect.y / h * 100}%`, width: `${rect.w / w * 100}%`,
        minHeight: `${rect.h / h * 100}%`, boxSizing: "border-box", padding: `${cq(S * .009)} ${cq(S * .018)}`, opacity: shown * pop,
        transform: `translate3d(0,${((1 - pop) * S * .012 / h * 100).toFixed(3)}%,0)`, background: "rgba(4,8,14,.8)", borderRadius: cq(S * .008),
        borderLeft: `${cq(S * .006)} solid ${role === "waypoint" ? "rgba(246,243,236,.5)" : markerColor}`, boxShadow: "0 .4em 1.4em rgba(0,0,0,.4)",
        display: "flex", flexDirection: "column", justifyContent: "center", lineHeight: 1.22, overflowWrap: "anywhere", pointerEvents: "none" };
      return <div key={loc.id} aria-hidden="true" data-km-orbit-label={loc.id} data-km-label-side={placed.side} style={style}>
        <span style={{ fontSize: cq(name), fontWeight: role === "destination" ? 760 : 680, letterSpacing: "-.01em", fontFamily: role === "destination" ? display : body }}>{loc.label}</span>
        {lines[1] && <span style={{ fontSize: cq(lines[1].size), fontWeight: 560, opacity: .82, fontVariantNumeric: "tabular-nums" }}>{lines[1].text}</span>}
      </div>;
    })}
    {media && mediaRect && <RiseIn name="orbit-media" frame={t} start={plan.destinationAt + 14} length={18} reduced={reduced}
      style={{ position: "absolute", left: `${mediaRect.x / w * 100}%`, top: `${mediaRect.y / h * 100}%`, width: `${mediaRect.w / w * 100}%`, height: `${mediaRect.h / h * 100}%`,
        borderRadius: cq(S * .012), overflow: "hidden", boxShadow: `0 0 0 ${cq(S * .004)} ${markerColor}, 0 .8em 2em rgba(0,0,0,.5)` }}>
      <Asset asset={media} style={{ borderRadius: 0 }}/>
    </RiseIn>}
    <div data-km-orbit-title="" style={{ position: "absolute", left: `${titleLeft / w * 100}%`, top: `${titleTop / h * 100}%`, width: `${titleW / w * 100}%`,
      display: "flex", flexDirection: "column", gap: cq(S * .012), textShadow: "0 .05em .6em rgba(0,0,0,.55)" }}>
      {c.eyebrow && <RiseIn name="orbit-eyebrow" frame={t} start={-6} reduced={reduced} style={{ fontSize: cq(S * .026), fontWeight: 760,
        letterSpacing: ".16em", textTransform: "uppercase", color: accent }}>{c.eyebrow}</RiseIn>}
      {c.title && <h2 style={{ margin: 0, fontFamily: display, fontSize: cq(titleSize), fontWeight: 780, letterSpacing: "-.035em", lineHeight: 1.04, textWrap: "balance" }}>
        <KineticWords text={c.title} start={0} stagger={3} length={18} frame={t} reduced={reduced} marker="orbit"/>
      </h2>}
    </div>
    {c.readout && <RiseIn name="orbit-readout" frame={t} start={plan.drawEnd + 8} length={18} reduced={reduced} style={{ position: "absolute",
      left: `${titleLeft / w * 100}%`, bottom: `${readoutBottom / h * 100}%`, maxWidth: portrait ? "86%" : "40%", textShadow: "0 .05em .6em rgba(0,0,0,.6)" }}>
      {c.readout.label && <div style={{ fontSize: cq(S * .026), fontWeight: 720, letterSpacing: ".12em", textTransform: "uppercase", color: accent }}>{c.readout.label}</div>}
      <div data-km-orbit-readout="" style={{ fontFamily: display, fontSize: cq(readoutSize), fontWeight: 760, letterSpacing: "-.035em", lineHeight: 1.08, fontVariantNumeric: "tabular-nums" }}>{c.readout.value}</div>
    </RiseIn>}
    {c.credit && <RiseIn name="orbit-credit" frame={t} start={dock} reduced={reduced} style={{ position: "absolute", ...(portrait ? { left: "7%", right: "7%", bottom: "3.5%" } : { right: "4%", bottom: "5%", maxWidth: "40%", textAlign: "right" }),
      fontSize: cq(S2), lineHeight: 1.35, color: "rgba(236,240,244,.74)", textShadow: "0 1px 6px rgba(0,0,0,.7)" }}>{c.credit}</RiseIn>}
    {overlay && <div data-km-stage-overlay="" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {overlay({ frame: f, width: w, height: h, beats, space: "stage", toStage: p => ({ x: p.x * w, y: p.y * h }), state: timing => annotationState(timing, beats, t, reduced) })}
    </div>}
  </div>;
}
const smooth01 = (x: number) => x * x * (3 - 2 * x);
const clampRect = (r: Rect, safe: Rect): Rect => ({ ...r, x: Math.max(safe.x, Math.min(safe.x + safe.w - r.w, r.x)), y: Math.max(safe.y, Math.min(safe.y + safe.h - r.h, r.y)) });
/** Closest point on a rectangle's border to `p`. */
function nearestEdge(r: Rect, p: { x: number; y: number }) {
  return { x: Math.max(r.x, Math.min(r.x + r.w, p.x)), y: Math.max(r.y, Math.min(r.y + r.h, p.y)) };
}
