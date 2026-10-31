/**
 * Orthographic 2D globe for Orbit World: the no-WebGL, reduced-motion and
 * stylized renderer. One SVG, pure function of props. It uses the 3D camera's
 * orientation and apparent disc, so route, markers and labels computed for the
 * lit globe land on the same places here.
 *
 * Natural Earth 1:110m land is filled with horizon-correct clipping
 * (Weiler–Atherton against the visible hemisphere), the night side is a set of
 * soft caps around the antisolar point, and the atmosphere is a sun-weighted
 * rim. Stylized: no texture imagery, no clouds.
 */
import { useMemo } from "react";
import type { ReactNode } from "react";
import { LAND_OUTLINES } from "./land-outline-110m";
import { add, cross, dot, geoToVec, normalize, scale, starField, sub } from "./orbit-world-model";
import type { CameraMatrices, Vec3 } from "./orbit-world-model";

export interface Disc { x: number; y: number; r: number }
export interface OrthoPoint { x: number; y: number; z: number }
/** Orthographic projection in the camera's basis onto the apparent globe disc. z > 0 faces the camera. */
export function orthoProjector(m: CameraMatrices, disc: Disc) {
  const toEye = normalize(m.eye);
  const up = normalize(sub(m.upScreen, scale(toEye, dot(m.upScreen, toEye))));
  const right = cross(up, toEye);
  return (p: Vec3): OrthoPoint => ({ x: disc.x + dot(p, right) * disc.r, y: disc.y - dot(p, up) * disc.r, z: dot(p, toEye) });
}
const f1 = (n: number) => n.toFixed(1);
/** Open polylines of the visible parts of a path (no horizon arcs). */
export function visibleRuns(points: Vec3[], project: (p: Vec3) => OrthoPoint, disc: Disc): { x: number; y: number }[][] {
  const runs: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  let prev: OrthoPoint | undefined;
  for (const p of points) {
    const q = project(p);
    if (prev && (prev.z >= 0) !== (q.z >= 0)) {
      const t = prev.z / (prev.z - q.z);
      const e = horizon(prev.x + (q.x - prev.x) * t, prev.y + (q.y - prev.y) * t, disc);
      if (q.z >= 0) run = [e]; else { run.push(e); runs.push(run); run = []; }
    }
    if (q.z >= 0) run.push({ x: q.x, y: q.y });
    prev = q;
  }
  if (run.length > 1) runs.push(run);
  return runs.filter(r => r.length > 1);
}
const horizon = (x: number, y: number, disc: Disc) => {
  const a = Math.atan2(y - disc.y, x - disc.x);
  return { x: disc.x + Math.cos(a) * disc.r, y: disc.y + Math.sin(a) * disc.r, a };
};
/** Rings that wind counter-clockwise seen from outside, so the interior lies on the left. */
function orientCCW(ring: Vec3[]): Vec3[] {
  const c = normalize(ring.reduce<Vec3>((s, p) => add(s, p), [0, 0, 0]));
  let s = 0;
  for (let i = 0; i < ring.length; i++) s += dot(c, cross(ring[i], ring[(i + 1) % ring.length]));
  return s < 0 ? [...ring].reverse() : ring;
}
/**
 * Closed fill paths for a CCW ring on the visible hemisphere. Visible runs are
 * joined along the horizon counter-clockwise (screen y down: decreasing angle),
 * which keeps the interior on the left. `containsView` decides a ring whose
 * boundary is entirely hidden.
 */
export function clipRing(ring: Vec3[], project: (p: Vec3) => OrthoPoint, disc: Disc, containsView = false): string {
  const q = ring.map(project);
  const hiddenAt = q.findIndex(p => p.z < 0);
  if (hiddenAt < 0) return "M" + q.map(p => `${f1(p.x)} ${f1(p.y)}`).join("L") + "Z";
  if (q.every(p => p.z < 0)) return containsView ? circlePath(disc) : "";
  const n = q.length, runs: { entry: number; exit: number; pts: { x: number; y: number }[] }[] = [];
  let cur: { entry: number; pts: { x: number; y: number }[] } | undefined;
  for (let k = 1; k <= n; k++) {
    const a = q[(hiddenAt + k - 1) % n], b = q[(hiddenAt + k) % n];
    if ((a.z >= 0) !== (b.z >= 0)) {
      const t = a.z / (a.z - b.z);
      const e = horizon(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, disc);
      if (b.z >= 0) cur = { entry: e.a, pts: [e] };
      else if (cur) { cur.pts.push(e); runs.push({ ...cur, exit: e.a }); cur = undefined; }
    }
    if (b.z >= 0 && cur) cur.pts.push({ x: b.x, y: b.y });
  }
  if (!runs.length) return "";
  // Screen y points down, so counter-clockwise on the sphere is decreasing screen angle.
  const ccw = (from: number, to: number) => { let d = from - to; while (d < 0) d += Math.PI * 2; return d; };
  const used = new Set<number>();
  let d = "";
  for (let s = 0; s < runs.length; s++) {
    if (used.has(s)) continue;
    let i = s, guard = 0;
    d += "M" + runs[i].pts.map(p => `${f1(p.x)} ${f1(p.y)}`).join("L");
    while (guard++ < runs.length + 1) {
      used.add(i);
      const exit = runs[i].exit;
      let next = s, best = Infinity;
      runs.forEach((r, j) => { if (!used.has(j) || j === s) { const g = ccw(exit, r.entry); if (g < best) { best = g; next = j; } } });
      const steps = Math.ceil(best / (3 * Math.PI / 180));
      for (let k = 1; k <= steps; k++) { const a = exit - best * k / steps; d += `L${f1(disc.x + Math.cos(a) * disc.r)} ${f1(disc.y + Math.sin(a) * disc.r)}`; }
      if (next === s) break;
      i = next;
      d += "L" + runs[i].pts.map(p => `${f1(p.x)} ${f1(p.y)}`).join("L");
    }
    d += "Z";
  }
  return d;
}
const circlePath = (c: Disc) => `M${f1(c.x - c.r)} ${f1(c.y)}a${f1(c.r)} ${f1(c.r)} 0 1 0 ${f1(c.r * 2)} 0a${f1(c.r)} ${f1(c.r)} 0 1 0 ${f1(-c.r * 2)} 0Z`;
/** Boundary of the cap within `radius` radians of `centre`, CCW seen from outside. */
export function capRing(centre: Vec3, radius: number, steps = 180): Vec3[] {
  const helper: Vec3 = Math.abs(centre[1]) < .9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = normalize(cross(helper, centre)), e2 = cross(centre, e1);
  return Array.from({ length: steps }, (_, i) => {
    const t = i / steps * Math.PI * 2;
    return normalize(add(scale(centre, Math.cos(radius)), scale(add(scale(e1, Math.cos(t)), scale(e2, Math.sin(t))), Math.sin(radius))));
  });
}
const LAND: Vec3[][] = LAND_OUTLINES.map(ring => orientCCW(ring.map(([lon, lat]) => geoToVec(lat, lon))));
const GRATICULE: Vec3[][] = [
  ...[-60, -30, 0, 30, 60].map(lat => Array.from({ length: 145 }, (_, i) => geoToVec(lat, -180 + i * 2.5))),
  ...Array.from({ length: 12 }, (_, k) => Array.from({ length: 73 }, (_, i) => geoToVec(-90 + i * 2.5, -180 + k * 30))),
];

export interface FlatGlobeProps {
  width: number; height: number; matrices: CameraMatrices; disc: Disc; sun: Vec3;
  colors: { space: string; ocean: string; land: string; coast: string; atmosphere: string };
  atmosphereStrength: number; layers: { stars: boolean; coastlines: boolean; graticule: boolean };
  /** Stylized overlay (legacy `globe` asset) drawn inside the disc. */
  overlay?: ReactNode;
  starGain?: number;
}
export function OrbitGlobeFlat({ width: w, height: h, matrices: m, disc, sun, colors, atmosphereStrength, layers, overlay, starGain = 1 }: FlatGlobeProps) {
  const project = useMemo(() => orthoProjector(m, disc), [m, disc]);
  const toEye = normalize(m.eye);
  const land = useMemo(() => LAND.map(r => clipRing(r, project, disc)).filter(Boolean), [project, disc]);
  const coast = useMemo(() => layers.coastlines ? LAND.flatMap(r => visibleRuns([...r, r[0]], project, disc)) : [], [layers.coastlines, project, disc]);
  const grid = useMemo(() => layers.graticule ? GRATICULE.flatMap(r => visibleRuns(r, project, disc)) : [], [layers.graticule, project, disc]);
  const anti = scale(normalize(sun), -1);
  // Night: nested caps around the antisolar point give a soft, twilight-wide terminator.
  const night = [{ r: 96, o: .34 }, { r: 90, o: .22 }, { r: 84, o: .16 }, { r: 76, o: .12 }].map(c => ({
    d: clipRing(capRing(anti, c.r * Math.PI / 180), project, disc, dot(toEye, anti) > Math.cos(c.r * Math.PI / 180)), o: c.o }));
  const s = project(normalize(sun));
  const sx = s.x - disc.x, sy = s.y - disc.y, sl = Math.hypot(sx, sy) || 1;
  const gx = sx / sl, gy = sy / sl;
  const stars = useMemo(() => layers.stars ? starField(700) : [], [layers.stars]);
  const line = (pts: { x: number; y: number }[]) => "M" + pts.map(p => `${f1(p.x)} ${f1(p.y)}`).join("L");
  const short = Math.min(w, h);
  return <svg aria-hidden="true" data-km-globe-flat="" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"
    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}>
    <defs>
      <radialGradient id="km-ow-ocean" cx={disc.x + gx * disc.r * .35} cy={disc.y + gy * disc.r * .35} r={disc.r * 1.25} gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor={colors.ocean} stopOpacity="1"/><stop offset="1" stopColor="#02070d"/>
      </radialGradient>
      <linearGradient id="km-ow-rim" x1={disc.x - gx * disc.r} y1={disc.y - gy * disc.r} x2={disc.x + gx * disc.r} y2={disc.y + gy * disc.r} gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor={colors.atmosphere} stopOpacity={.12 * atmosphereStrength}/>
        <stop offset=".55" stopColor={colors.atmosphere} stopOpacity={.5 * atmosphereStrength}/>
        <stop offset="1" stopColor={colors.atmosphere} stopOpacity={Math.min(1, .95 * atmosphereStrength)}/>
      </linearGradient>
      <radialGradient id="km-ow-halo" cx={disc.x} cy={disc.y} r={disc.r * 1.14} gradientUnits="userSpaceOnUse">
        <stop offset={.86} stopColor={colors.atmosphere} stopOpacity="0"/>
        <stop offset={.875} stopColor={colors.atmosphere} stopOpacity={.42 * Math.min(1, atmosphereStrength)}/>
        <stop offset="1" stopColor={colors.atmosphere} stopOpacity="0"/>
      </radialGradient>
      <filter id="km-ow-soft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation={disc.r * .012}/></filter>
      <clipPath id="km-ow-disc"><circle cx={disc.x} cy={disc.y} r={disc.r}/></clipPath>
    </defs>
    <rect width={w} height={h} fill={colors.space}/>
    {stars.map((st, i) => {
      const dir = st.dir;
      if (dot(dir, m.forward) <= .05) return null;
      const v = m.viewProjection, cw = v[3] * dir[0] + v[7] * dir[1] + v[11] * dir[2];
      const x = ((v[0] * dir[0] + v[4] * dir[1] + v[8] * dir[2]) / cw + 1) / 2 * w, y = (1 - (v[1] * dir[0] + v[5] * dir[1] + v[9] * dir[2]) / cw) / 2 * h;
      if (x < 0 || y < 0 || x > w || y > h || Math.hypot(x - disc.x, y - disc.y) < disc.r * 1.02) return null;
      return <circle key={i} cx={f1(x)} cy={f1(y)} r={(.7 + st.mag * 1.6) * short / 540} fill="#eef3ff" opacity={(.25 + st.mag * .7) * starGain}/>;
    })}
    <circle cx={disc.x} cy={disc.y} r={disc.r * 1.14} fill="url(#km-ow-halo)"/>
    <circle cx={disc.x} cy={disc.y} r={disc.r} fill="url(#km-ow-ocean)"/>
    <g clipPath="url(#km-ow-disc)">
      {land.map((d, i) => <path key={i} d={d} fill={colors.land} fillRule="evenodd"/>)}
      {coast.map((r, i) => <path key={i} d={line(r)} fill="none" stroke={colors.coast} strokeWidth={short * .0022} strokeLinejoin="round"/>)}
      {grid.map((r, i) => <path key={i} d={line(r)} fill="none" stroke="rgba(214,234,255,.16)" strokeWidth={short * .0019}/>)}
      {overlay}
      {night.map((n, i) => n.d && <path key={i} d={n.d} fill="#01040a" opacity={n.o} filter="url(#km-ow-soft)"/>)}
      <circle cx={disc.x} cy={disc.y} r={disc.r * .985} fill="none" stroke="url(#km-ow-rim)" strokeWidth={disc.r * .05} filter="url(#km-ow-soft)"/>
    </g>
    <circle cx={disc.x} cy={disc.y} r={disc.r * 1.006} fill="none" stroke="url(#km-ow-rim)" strokeWidth={Math.max(2, disc.r * .014)}/>
  </svg>;
}
