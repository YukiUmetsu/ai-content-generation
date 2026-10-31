/**
 * Place-Shaped Image Reveal. Causal beat:
 *   input      a licensed boundary in its geographic context
 *   transform  the camera locates the place while its outline traces on, then
 *              photographs taken there flood the outline as a window
 *   output     the silhouette holds the imagery, each photograph pinned to
 *              where it was taken, beside the place name and context.
 * The composite is always disclosed: imagery is framed by the outline, it is
 * not an aerial view. Frame-addressable, no clock.
 */
import { useContext, useMemo } from "react";
import type { CSSProperties } from "react";
import type { SceneTemplateFrame, SceneTemplateSpec } from "../scene-templates";
import type { AnnotationBeats, SubjectAnnotation } from "../subject-annotations";
import { annotationState } from "../subject-annotations";
import { SubjectAnnotationLayer } from "../subject-annotations-react";
import { placeSilhouette } from "../place-silhouette";
import { Asset, FilmFinish, KineticWords, OverlayRendererContext, RiseIn, beatAt, cinematicEase, cueAt, easeInOut, fitLongestWord, span01 } from "./stage-kit";

/** Frames over which one photograph dissolves into the next. */
const FADE = 18;
/** Scene frames at which each image starts; the sequence shares dock..end evenly. */
export function placeImageSchedule(count: number, dock: number, durationFrames: number): number[] {
  const each = (durationFrames - dock) / Math.max(1, count);
  return Array.from({ length: count }, (_, i) => Math.round(dock + i * each));
}

export function PlaceShapedImageRevealStage({ spec, f }: { spec: SceneTemplateSpec<"place-shaped-image-reveal">; f: SceneTemplateFrame }) {
  const c = spec.content, w = spec.width, h = spec.height, portrait = h > w, t = f.frame, reduced = f.reducedMotion;
  const dock = cueAt(f, 0), reveal = cueAt(f, 1), resolve = cueAt(f, 2);
  const geo = useMemo(() => placeSilhouette(c.boundary.rings, w, h,
    { center: c.projection, context: c.mapContext !== "none" }), [c.boundary.rings, c.projection, c.mapContext, w, h]);
  const b = geo.bounds, cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  // Locate: start wide on the place, push in to the final framing as the outline traces, then breathe.
  const locate = beatAt(f, 0, dock + 8, easeInOut);
  const zoom = ((c.locateZoom ?? .3) + (1 - (c.locateZoom ?? .3)) * locate) * (1 + (reduced ? 0 : .035 * span01(t, dock, f.durationFrames)));
  // The push lands where the place is framed; no drift, so the copy region is never crossed.
  const driftX = 0, driftY = 0;
  const trace = f.reducedMotion ? 1 : .04 + .96 * cinematicEase(span01(t, 0, dock - 4));
  const wipe = beatAt(f, dock, dock + 26, easeInOut);
  // A finished trace draws the whole path with no dash at all, so no rounding can leave a gap.
  const dash = trace >= .999 ? {} : { pathLength: 1, strokeDasharray: `${trace} 1` };
  const lift = beatAt(f, dock + 6, dock + 30);
  const starts = placeImageSchedule(c.imagery.length, dock, f.durationFrames);
  const active = starts.reduce((n, s, i) => t >= s ? i : n, 0);
  // Camera maps final-framing stage pixels to the frame; marks and pins use it so they stay attached.
  const toFrame = (p: { x: number; y: number }) => ({ x: cx + driftX + (p.x - cx) * zoom, y: cy + driftY + (p.y - cy) * zoom });
  const plane: CSSProperties = { position: "absolute", inset: 0, transformOrigin: `${cx / w * 100}% ${cy / h * 100}%`,
    transform: `translate3d(${driftX / w * 100}%,${driftY / h * 100}%,0) scale(${zoom})`, willChange: "transform" };
  const mask = useMemo(() => `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${b.width.toFixed(1)} ${b.height.toFixed(1)}" preserveAspectRatio="none"><path fill="#000" fill-rule="evenodd" d="${geo.maskPath}"/></svg>`)}")`, [geo, b.width, b.height]);
  // Imagery spreads from where the first photograph was taken (or the centre), so the reveal starts on a real place.
  const first = c.imagery[0];
  const origin = first.latitude !== undefined && first.longitude !== undefined
    ? geo.toStage({ latitude: first.latitude, longitude: first.longitude }) : { x: cx, y: cy };
  const ox = (origin.x - b.x) / b.width * 100, oy = (origin.y - b.y) / b.height * 100;
  const reach = Math.hypot(Math.max(ox, 100 - ox), Math.max(oy, 100 - oy) * b.height / b.width) * 1.15;
  const radius = wipe * reach;
  // Pins: where each photograph was taken, shown while it is on screen.
  const pins: SubjectAnnotation[] = c.imagery.flatMap((item, i) => {
    if (item.latitude === undefined || item.longitude === undefined) return [];
    const at = toFrame(geo.toStage({ latitude: item.latitude, longitude: item.longitude }));
    const anchor = { x: Math.max(0, Math.min(1, at.x / w)), y: Math.max(0, Math.min(1, at.y / h)) };
    const from = i === 0 ? dock + 24 : starts[i] + 4;
    const until = i < starts.length - 1 ? starts[i + 1] - 2 : undefined;
    const timing = { at: from, until, exit: 6, enter: 12 };
    const marks: SubjectAnnotation[] = [{ id: `pin-${i}`, kind: "ring", center: anchor, radius: .014, weight: .75, space: "stage", timing }];
    if (item.caption) marks.push({ id: `pin-label-${i}`, kind: "label", anchor, text: item.caption, space: "stage", distance: .075,
      side: at.y < cy + driftY ? "above" : "below", timing: { ...timing, at: from + 4 } });
    return marks;
  });
  // Locator: a pulsing ring finds the place on the wide map, then hands over to the outline.
  const home = toFrame({ x: cx, y: cy });
  if (!reduced) pins.unshift({ id: "locator", kind: "ring", center: { x: home.x / w, y: home.y / h }, radius: .07 * (1 - .5 * locate),
    pulse: true, weight: .6, space: "stage", timing: { at: 0, until: Math.round(dock * .6), enter: 10, exit: 10 } });
  const beats: AnnotationBeats = { dock, reveal, resolve, durationFrames: f.durationFrames, steps: {} };
  const overlay = useContext(OverlayRendererContext);
  const look = c.look ?? {};
  const textLeft = portrait ? "7%" : "62%", textWidth = portrait ? "86%" : "33%";
  const nameStart = Math.round(dock * .35);
  return <div style={{ position: "absolute", inset: 0, overflow: "hidden",
    background: "radial-gradient(ellipse 90% 80% at 38% 45%,#0c1823 0%,#060c13 58%,#030609 100%)",
    fontSize: portrait ? "clamp(13px, 3.5cqw, 44px)" : "clamp(13px, 2cqw, 40px)" }}>
    <div data-km-place-camera="" data-km-camera-zoom={zoom.toFixed(4)} style={plane}>
      <svg aria-hidden="true" viewBox={`0 0 ${w} ${h}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
        <g opacity={1 - .45 * lift}>
          {geo.graticule.map((d, i) => <path key={i} d={d} fill="none" stroke="rgba(164,196,220,.13)" strokeWidth={1} vectorEffect="non-scaling-stroke"/>)}
          {geo.coastlines.map((d, i) => <path key={i} data-km-place-context="" d={d} fill="rgba(120,150,170,.10)"
            stroke="rgba(176,205,222,.42)" strokeWidth={1.1} strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>)}
        </g>
        {/* The place before its imagery: a dark plate the outline is drawn around. */}
        <path data-km-place-plate="" d={geo.outline} fillRule="evenodd" fill="#173043" opacity={.55 + .4 * span01(trace, .4, 1)}/>
      </svg>
      <div data-km-place-imagery={c.imagery[active].image.id} data-km-place-wipe={wipe.toFixed(4)} style={{ position: "absolute",
        left: `${b.x / w * 100}%`, top: `${b.y / h * 100}%`, width: `${b.width / w * 100}%`, height: `${b.height / h * 100}%`,
        filter: `drop-shadow(0 ${.9 * lift}em ${1.6 * lift}em rgba(0,0,0,${.62 * lift}))`, visibility: wipe > 0 ? "visible" : "hidden" }}>
        <div style={{ position: "absolute", inset: 0,
          maskImage: `${mask},radial-gradient(circle at ${ox}% ${oy}%,#000 ${radius}%,transparent ${radius + 14}%)`,
          WebkitMaskImage: `${mask},radial-gradient(circle at ${ox}% ${oy}%,#000 ${radius}%,transparent ${radius + 14}%)`,
          maskSize: "100% 100%", WebkitMaskSize: "100% 100%", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat",
          maskComposite: "intersect", WebkitMaskComposite: "source-in" } as CSSProperties}>
          {c.imagery.map((item, i) => {
            const start = starts[i], next = starts[i + 1];
            const fadeIn = i === 0 ? 1 : reduced ? (t >= start ? 1 : 0) : span01(t, start - FADE / 2, start + FADE / 2);
            const fadeOut = next === undefined ? 1 : reduced ? (t >= next ? 0 : 1) : 1 - span01(t, next - FADE / 2, next + FADE / 2);
            const opacity = Math.min(fadeIn, fadeOut);
            if (opacity <= 0) return null;
            const life = span01(t, start - FADE, (next ?? f.durationFrames) + FADE);
            return <div key={item.image.id} data-km-place-image={item.image.id} style={{ position: "absolute", inset: 0, opacity,
              transform: reduced ? undefined : `scale(${1.12 - .1 * life}) translate3d(${(i % 2 ? 1 : -1) * 1.4 * (life - .5)}%,0,0)`,
              transformOrigin: "50% 55%" }}>
              <Asset asset={item.image} style={{ borderRadius: 0, filter: "saturate(1.06) contrast(1.06) brightness(.95)" }}/>
            </div>;
          })}
          {/* Inner falloff gives the cut-out edge depth; the top grade keeps bright skies off the rim. */}
          <div aria-hidden="true" style={{ position: "absolute", inset: 0,
            background: "linear-gradient(180deg,rgba(6,14,22,.42) 0%,transparent 34%),radial-gradient(ellipse 70% 70% at 45% 45%,transparent 55%,rgba(2,6,10,.4) 100%)" }}/>
        </div>
      </div>
      <svg aria-hidden="true" viewBox={`0 0 ${w} ${h}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
        {/* Every ring of the boundary, in the same geometry as the mask. Stroke widths are in
            composition pixels divided by the camera zoom: no non-scaling-stroke, whose screen-space
            dashes disagree with pathLength whenever the stage is shown at another size. */}
        <path d={geo.outline} fill="none" stroke="var(--km-accent, #9fd9ce)" strokeOpacity={.55 * (1 - lift) + .2}
          strokeWidth={6 / zoom} strokeLinejoin="round" style={{ filter: "blur(3px)" }} {...dash}/>
        <path d={geo.outline} fill="none" stroke="rgba(3,8,12,.55)" strokeOpacity={lift}
          strokeWidth={4.2 / zoom} strokeLinejoin="round" {...dash}/>
        <path data-km-place-outline={trace.toFixed(4)} d={geo.outline} fill="none"
          stroke={lift > 0 ? `rgba(255,248,236,${.95 - .2 * lift})` : "var(--km-accent, #9fd9ce)"}
          strokeWidth={(2.2 - .5 * lift) / zoom} strokeLinejoin="round" {...dash}/>
      </svg>
    </div>
    <FilmFinish frame={t} reduced={reduced} grain={look.grain ?? 1} vignette={look.vignette ?? 1}/>
    <div data-km-stage-overlay="" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <SubjectAnnotationLayer annotations={pins} beats={beats} subject={{}} width={w} height={h} frame={t} reducedMotion={reduced} space="stage"/>
      {overlay?.({ frame: f, width: w, height: h, beats, space: "stage", toStage: p => ({ x: p.x * w, y: p.y * h }),
        state: timing => annotationState(timing, beats, t, reduced) })}
    </div>
    <div data-km-place-copy="" style={{ position: "absolute", left: textLeft, width: textWidth,
      top: portrait ? "61%" : "50%", transform: portrait ? undefined : "translateY(-50%)",
      display: "flex", flexDirection: "column", gap: ".5em", textShadow: "0 .05em .6em rgba(0,0,0,.55)" }}>
      {c.eyebrow && <RiseIn name="place-eyebrow" frame={t} start={-6} reduced={reduced} style={{ fontSize: ".74em", fontWeight: 760,
        letterSpacing: ".16em", textTransform: "uppercase", color: "var(--km-accent, #9fd9ce)" }}>{c.eyebrow}</RiseIn>}
      <h2 data-km-place-name="" style={{ margin: 0, fontSize: fitLongestWord(c.name, portrait ? 4.3 : 4.1, portrait ? 84 : 31, !/\s/.test(c.name.trim())),
        fontWeight: 780, letterSpacing: "-.045em", lineHeight: 1.0, textWrap: "balance" }}>
        <KineticWords text={c.name} start={nameStart} stagger={3} length={18} frame={t} reduced={reduced} marker="place"/>
      </h2>
      {c.context && <RiseIn name="place-context" frame={t} start={reveal} reduced={reduced} style={{ fontSize: portrait ? "1.08em" : "1.1em",
        fontWeight: 520, lineHeight: 1.3, maxWidth: "24em", textWrap: "pretty", opacity: .94 }}>{c.context}</RiseIn>}
    </div>
    <RiseIn name="place-disclosure" frame={t} start={dock + 20} reduced={reduced} style={{ position: "absolute",
      left: portrait ? "7%" : "62%", right: portrait ? "7%" : "5%", bottom: portrait ? "4.5%" : "7%",
      fontSize: ".7em", lineHeight: 1.35, color: "rgba(236,240,244,.78)", textWrap: "pretty" }}>
      <div data-km-place-disclosure="">{c.compositeNote}</div>
      {c.credit && <div data-km-place-credit="" style={{ opacity: .8 }}>{c.credit}</div>}
    </RiseIn>
  </div>;
}
