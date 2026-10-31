/**
 * Draws SA1 subject annotations for one frame. Pure function of props: no
 * timers, transitions or state, so any frame can be seeked and exported.
 * Mount it once inside a camera transform (space "subject") and once outside
 * (space "stage"); each instance draws only its own space.
 */
import type { CSSProperties } from "react";
import { annotationState, annotationUnit, annotationWindow, coverPoint, resolveLabelSide } from "./subject-annotations";
import type { AnnotationBeats, AnnotationPoint, SubjectAnnotation } from "./subject-annotations";

export interface SubjectAnnotationLayerProps {
  annotations: readonly SubjectAnnotation[];
  beats: AnnotationBeats;
  /** Intrinsic subject size; enables crop-aware placement. */
  subject: { width?: number; height?: number };
  width: number;
  height: number;
  frame: number;
  reducedMotion?: boolean;
  space: "subject" | "stage";
}
const halo = "rgba(6,8,12,.72)";
const ink = "#fffaf0";
const accent = "var(--km-accent, #9fd9ce)";

/** Arrowhead triangle whose size eases in with the shaft, so it never floats detached. */
function arrowHead(tip: AnnotationPoint, ux: number, uy: number, size: number) {
  const base = { x: tip.x - ux * size, y: tip.y - uy * size };
  return { base, d: `M${tip.x} ${tip.y}L${base.x - uy * size * .62} ${base.y + ux * size * .62}L${base.x + uy * size * .62} ${base.y - ux * size * .62}Z` };
}
/** Catmull-Rom through the points, as cubic Béziers. */
function smoothPath(p: AnnotationPoint[]) {
  let d = `M${p[0].x} ${p[0].y}`;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i - 1] ?? p[i], b = p[i], c = p[i + 1], e = p[i + 2] ?? c;
    d += `C${b.x + (c.x - a.x) / 6} ${b.y + (c.y - a.y) / 6} ${c.x - (e.x - b.x) / 6} ${c.y - (e.y - b.y) / 6} ${c.x} ${c.y}`;
  }
  return d;
}
const polyLength = (p: AnnotationPoint[]) => p.slice(1).reduce((sum, q, i) => sum + Math.hypot(q.x - p[i].x, q.y - p[i].y), 0);
/** The point at fraction t along a polyline, plus the heading there. */
function alongPolyline(p: AnnotationPoint[], t: number) {
  let left = polyLength(p) * t;
  for (let i = 0; i < p.length - 1; i++) {
    const seg = Math.hypot(p[i + 1].x - p[i].x, p[i + 1].y - p[i].y);
    if (left <= seg || i === p.length - 2) {
      const k = seg ? Math.min(1, left / seg) : 0;
      return { point: { x: p[i].x + (p[i + 1].x - p[i].x) * k, y: p[i].y + (p[i + 1].y - p[i].y) * k },
        ux: seg ? (p[i + 1].x - p[i].x) / seg : 0, uy: seg ? (p[i + 1].y - p[i].y) / seg : 0 };
    }
    left -= seg;
  }
  return { point: p[p.length - 1], ux: 0, uy: 0 };
}
/** Arrowhead heading: the chord from `window` of the path behind the tip to the tip. */
function chordHeading(p: AnnotationPoint[], enter: number, window: number, minLength: number): [number, number] {
  const end = alongPolyline(p, enter), behind = alongPolyline(p, Math.max(0, enter - window)).point;
  const cx = end.point.x - behind.x, cy = end.point.y - behind.y, cl = Math.hypot(cx, cy);
  return cl > minLength ? [cx / cl, cy / cl] : [end.ux, end.uy];
}
function FlowPulse({ d, stroke, elapsed }: { d: string; stroke: number; elapsed: number }) {
  return <path d={d} pathLength={1} stroke={ink} strokeWidth={stroke * .55} strokeLinecap="round" fill="none"
    strokeDasharray=".14 .86" strokeDashoffset={-((elapsed % 18) / 18)} opacity={.85} />;
}

export function SubjectAnnotationLayer({ annotations, beats, subject, width: w, height: h, frame, reducedMotion = false, space }: SubjectAnnotationLayerProps) {
  const own = annotations.filter(a => (a.space ?? "subject") === space);
  // Spotlights sit beneath every other mark.
  const ordered = [...own.filter(a => a.kind === "spotlight"), ...own.filter(a => a.kind !== "spotlight")];
  const unit = annotationUnit(space, subject, w, h);
  const at = (p: AnnotationPoint) => space === "stage" ? { x: p.x * w, y: p.y * h } : coverPoint(p, subject, w, h);
  const labels: SubjectAnnotation[] = [];
  const marks = ordered.map(a => {
    const s = annotationState(a.timing, beats, frame, reducedMotion);
    if (!s.visible) return null;
    const color = a.color ?? accent;
    const stroke = Math.min(w, h) * .014 * (a.weight ?? 1);
    const flowing = !reducedMotion && s.enter > .98;
    const common = { "data-km-annotation": a.id, "data-km-annotation-kind": a.kind, opacity: s.opacity } as const;
    switch (a.kind) {
      case "arrow": {
        const from = at(a.from), to = at(a.to);
        const len = Math.hypot(to.x - from.x, to.y - from.y), ux = (to.x - from.x) / len, uy = (to.y - from.y) / len;
        if (s.enter * len < stroke) return null;
        const tip = { x: from.x + (to.x - from.x) * s.enter, y: from.y + (to.y - from.y) * s.enter };
        const head = arrowHead(tip, ux, uy, stroke * 3.4 * Math.min(1, s.enter * len / (stroke * 7.5)));
        const shaft = `M${from.x} ${from.y}L${head.base.x} ${head.base.y}`;
        return <g key={a.id} {...common}>
          <path d={shaft} stroke={halo} strokeWidth={stroke * 2.5} strokeLinecap="round" fill="none" />
          <path d={head.d} fill={halo} stroke={halo} strokeWidth={stroke * 1.5} strokeLinejoin="round" />
          <path d={shaft} stroke={color} strokeWidth={stroke} strokeLinecap="round" fill="none"
            style={{ filter: `drop-shadow(0 0 ${stroke * 1.4}px ${color})` }} />
          <path d={head.d} fill={color} />
          {a.flow && flowing && <FlowPulse d={shaft} stroke={stroke} elapsed={s.elapsed} />}
          <circle cx={from.x} cy={from.y} r={stroke * 1.15} fill={ink} stroke={color} strokeWidth={stroke * .5}
            opacity={Math.min(1, s.enter * 3)} />
        </g>;
      }
      case "path": {
        const pts = a.points.map(at);
        const d = a.smooth ? smoothPath(pts) : `M${pts.map(p => `${p.x} ${p.y}`).join("L")}`;
        const end = alongPolyline(pts, s.enter);
        // Heading over a trailing window: a chord rather than the local segment, so a dense,
        // wiggly route turns its arrowhead gradually. Stateless: recomputed from the frame alone.
        let [hx, hy] = chordHeading(pts, s.enter, a.headingWindow ?? .05, stroke);
        if (a.maxTurn !== undefined && !reducedMotion) {
          // Replay the capped heading from the mark's first frame: deterministic and seekable.
          const start = annotationWindow(a.timing, beats).start, cap = a.maxTurn * Math.PI / 180;
          let angle: number | undefined;
          for (let k = start; k <= frame; k++) {
            const e = annotationState(a.timing, beats, k, false).enter;
            const [tx, ty] = chordHeading(pts, e, a.headingWindow ?? .05, stroke), target = Math.atan2(ty, tx);
            angle = angle === undefined ? target : angle + Math.max(-cap, Math.min(cap, Math.atan2(Math.sin(target - angle), Math.cos(target - angle))));
          }
          if (angle !== undefined) [hx, hy] = [Math.cos(angle), Math.sin(angle)];
        }
        const head = a.arrowhead ? arrowHead(end.point, hx, hy, stroke * 3.4 * Math.min(1, s.enter * 4)) : undefined;
        // Trim the drawn length by the arrowhead so the stroke never pokes past its tip.
        const trim = head ? stroke * 3.4 / Math.max(1, polyLength(pts)) : 0;
        const drawn = Math.max(0, s.enter - trim);
        return <g key={a.id} {...common}>
          <path d={d} pathLength={1} strokeDasharray={`${drawn} 1`} stroke={halo} strokeWidth={stroke * 2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d={d} pathLength={1} strokeDasharray={`${drawn} 1`} stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" fill="none"
            style={{ filter: `drop-shadow(0 0 ${stroke * 1.4}px ${color})` }} />
          {head && s.enter > .02 && <><path d={head.d} fill={halo} stroke={halo} strokeWidth={stroke * 1.5} strokeLinejoin="round" /><path d={head.d} fill={color} /></>}
          {a.flow && flowing && <FlowPulse d={d} stroke={stroke} elapsed={s.elapsed} />}
        </g>;
      }
      case "ring": {
        const c = at(a.center), r = a.radius * unit;
        const pulse = a.pulse && flowing ? (s.elapsed % 30) / 30 : -1;
        return <g key={a.id} {...common}>
          <circle cx={c.x} cy={c.y} r={r} fill="none" stroke={halo} strokeWidth={stroke * 2.4} pathLength={1}
            strokeDasharray={`${s.enter} 1`} transform={`rotate(-90 ${c.x} ${c.y})`} />
          <circle cx={c.x} cy={c.y} r={r} fill="none" stroke={color} strokeWidth={stroke} pathLength={1}
            strokeDasharray={`${s.enter} 1`} transform={`rotate(-90 ${c.x} ${c.y})`}
            style={{ filter: `drop-shadow(0 0 ${stroke * 1.4}px ${color})` }} />
          {pulse >= 0 && <circle cx={c.x} cy={c.y} r={r * (1 + .45 * pulse)} fill="none" stroke={color}
            strokeWidth={stroke * .7} opacity={.7 * (1 - pulse)} />}
        </g>;
      }
      case "spotlight": {
        const c = at(a.center), r = a.radius * unit, gid = `km-spot-${a.id}`;
        return <g key={a.id} {...common}>
          <defs><radialGradient id={gid} gradientUnits="userSpaceOnUse" cx={c.x} cy={c.y} r={r * 1.6}>
            <stop offset={.62} stopColor="#000" stopOpacity={0} />
            <stop offset={1} stopColor="#000" stopOpacity={(a.dim ?? .55) * s.enter} />
          </radialGradient></defs>
          {/* Oversized so camera push and kick never reveal its edge. */}
          <rect x={-w} y={-h} width={w * 3} height={h * 3} fill={`url(#${gid})`} />
        </g>;
      }
      case "label": {
        labels.push(a);
        const p = at(a.anchor), dist = (a.distance ?? .08) * unit, side = resolveLabelSide(a.side ?? "above", p, w, h);
        const v = { above: [0, -1], below: [0, 1], left: [-1, 0], right: [1, 0] }[side];
        const end = { x: p.x + v[0] * dist * s.enter, y: p.y + v[1] * dist * s.enter };
        return <g key={a.id} {...common}>
          <path d={`M${p.x} ${p.y}L${end.x} ${end.y}`} stroke={halo} strokeWidth={stroke * 1.4} strokeLinecap="round" />
          <path d={`M${p.x} ${p.y}L${end.x} ${end.y}`} stroke={color} strokeWidth={stroke * .55} strokeLinecap="round" />
          <circle cx={p.x} cy={p.y} r={stroke * 1.05} fill={ink} stroke={color} strokeWidth={stroke * .5} />
        </g>;
      }
    }
  });
  return <>
    <svg aria-hidden="true" data-km-annotation-layer={space} viewBox={`0 0 ${w} ${h}`}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
      {marks}
    </svg>
    {labels.map(a => {
      if (a.kind !== "label") return null;
      const s = annotationState(a.timing, beats, frame, reducedMotion);
      const p = at(a.anchor), dist = (a.distance ?? .08) * unit, side = resolveLabelSide(a.side ?? "above", p, w, h);
      const v = { above: [0, -1], below: [0, 1], left: [-1, 0], right: [1, 0] }[side];
      const shift: Record<typeof side, string> = { above: "-50%,-100%", below: "-50%,0", left: "-100%,-50%", right: "0,-50%" };
      const pop = Math.max(0, (s.enter - .5) * 2);
      const style: CSSProperties = {
        position: "absolute", left: `${(p.x + v[0] * dist) / w * 100}%`, top: `${(p.y + v[1] * dist) / h * 100}%`,
        transform: `translate(${shift[side]}) scale(${.86 + .14 * pop})`, transformOrigin: "center",
        opacity: s.opacity * pop, padding: ".3em .65em", borderRadius: ".45em", maxWidth: "32cqw",
        background: "rgba(8,10,14,.78)", border: `1px solid ${a.color ?? accent}`, color: ink,
        fontSize: ".82em", fontWeight: 650, lineHeight: 1.2, letterSpacing: "-.005em", whiteSpace: "normal",
        overflowWrap: "anywhere", pointerEvents: "none", boxShadow: "0 .3em 1em rgba(0,0,0,.35)",
      };
      return <div key={a.id} aria-hidden="true" data-km-annotation-label={a.id} style={style}>{a.text}</div>;
    })}
  </>;
}
