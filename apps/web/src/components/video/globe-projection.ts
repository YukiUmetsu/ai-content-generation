/**
 * Orthographic globe geometry for OrbitWorld.
 * Pure, frame-addressable, source-distributed, no Three.js/WebGL dependency.
 * Geographic coordinates are degrees; rendered coordinates are normalized
 * to the unit disc (x right, y down). No basemap is fabricated.
 */
import { LAND_OUTLINES } from "./land-outline-110m";

export interface GeoPoint { latitude: number; longitude: number }
export interface GlobeCamera extends GeoPoint {}
export interface GlobePoint { x: number; y: number; depth: number; visible: boolean }
export interface GlobePath { id: string; d: string }
const RAD = Math.PI / 180;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const wrap = (lon: number) => ((lon + 180) % 360 + 360) % 360 - 180;
const smooth = (t: number) => { const p = clamp(t, 0, 1); return p * p * (3 - 2 * p); };
const finiteGeo = (p: GeoPoint) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
  && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;

/** A visible point has depth >= 0. Back-side coordinates are not displayed. */
export function projectGlobePoint(point: GeoPoint, camera: GlobeCamera): GlobePoint {
  if (!finiteGeo(point) || !finiteGeo(camera)) throw new Error("Invalid globe latitude/longitude.");
  const lat = point.latitude * RAD, camLat = camera.latitude * RAD;
  const delta = wrap(point.longitude - camera.longitude) * RAD;
  const east = Math.cos(lat) * Math.sin(delta);
  const north = Math.cos(camLat) * Math.sin(lat) -
    Math.sin(camLat) * Math.cos(lat) * Math.cos(delta);
  const depth = Math.sin(camLat) * Math.sin(lat) +
    Math.cos(camLat) * Math.cos(lat) * Math.cos(delta);
  return { x: east, y: -north, depth, visible: depth >= -1e-9 };
}

/** Continuous camera motion across the International Date Line; no 358° spins. */
export function interpolateGlobeCamera(from: GlobeCamera, to: GlobeCamera, fraction: number): GlobeCamera {
  if (!finiteGeo(from) || !finiteGeo(to) || !Number.isFinite(fraction)) throw new Error("Invalid globe camera track.");
  const t = smooth(fraction);
  return {
    latitude: from.latitude + (to.latitude - from.latitude) * t,
    longitude: wrap(from.longitude + wrap(to.longitude - from.longitude) * t),
  };
}
export function globeCameraAtFrame(
  locations: readonly GeoPoint[], frame: number, durationFrames: number,
  fixedCamera?: GlobeCamera, reducedMotion = false, orbitDegrees = 0,
): GlobeCamera {
  if (locations.length === 0 || !locations.every(finiteGeo) ||
      !Number.isSafeInteger(frame) || !Number.isSafeInteger(durationFrames) || durationFrames < 1)
    throw new Error("Invalid globe itinerary or frame.");
  if (fixedCamera && !finiteGeo(fixedCamera)) throw new Error("Invalid fixed camera.");
  const progress = clamp(frame / Math.max(1, durationFrames - 1), 0, 1);
  const step = progress * Math.max(0, locations.length - 1);
  const index = Math.min(locations.length - 1, Math.floor(step));
  const target = locations[Math.min(locations.length - 1, index + 1)];
  const cam = fixedCamera ?? (reducedMotion
    ? locations[Math.min(locations.length - 1, Math.round(step))]
    : interpolateGlobeCamera(locations[index], target, step - index));
  return { latitude: cam.latitude, longitude: wrap(cam.longitude +
    (reducedMotion ? 0 : orbitDegrees * Math.sin(progress * Math.PI * 2) * 0.2)) };
}

const fmt = (v: number) => (Math.abs(v) < 0.0005 ? 0 : v).toFixed(3);
const xy = (point: GlobePoint, radius = 1) => `${fmt(point.x * radius)} ${fmt(point.y * radius)}`;

/** Clips curves at the horizon to avoid connector strokes across the back of Earth. */
export function projectedGlobePath(
  points: readonly GeoPoint[], camera: GlobeCamera, radius = 1,
): string {
  if (!Number.isFinite(radius) || radius <= 0) throw new Error("Invalid globe radius.");
  if (points.length < 2) return "";
  const samples = points.map(p => projectGlobePoint(p, camera));
  let d = "", drawing = false;
  for (let i = 0; i < samples.length; i++) {
    const now = samples[i];
    const before = samples[i - 1];
    if (before && now.visible !== before.visible) {
      // Projected edge crosses the horizon at depth=0. Linear intersection
      // is a stable approximation on dense sampled geodesic curves.
      const t = clamp(before.depth / (before.depth - now.depth), 0, 1);
      const edge: GlobePoint = { x: before.x + (now.x - before.x) * t,
        y: before.y + (now.y - before.y) * t, depth: 0, visible: true };
      if (before.visible) d += "L" + xy(edge, radius);
      else { d += "M" + xy(edge, radius); drawing = true; }
    }
    if (!now.visible) { drawing = false; continue; }
    d += (drawing ? "L" : "M") + xy(now, radius);
    drawing = true;
  }
  return d;
}

/** Spherical interpolation follows the short great-circle path. */
export function sampleGreatCircle(a: GeoPoint, b: GeoPoint, steps = 80): GeoPoint[] {
  if (!finiteGeo(a) || !finiteGeo(b) || !Number.isSafeInteger(steps) || steps < 2 || steps > 1000)
    throw new Error("Invalid great-circle route.");
  const vec = (p: GeoPoint) => {
    const lat = p.latitude * RAD, lon = p.longitude * RAD;
    return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  };
  const av = vec(a), bv = vec(b);
  const dot = clamp(av.reduce((sum, n, i) => sum + n * bv[i], 0), -1, 1);
  const omega = Math.acos(dot), sin = Math.sin(omega);
  // For antipodal endpoints, geodesics are ambiguous: choose a stable
  // orthogonal great-circle plane rather than normalizing the zero vector
  // at the midpoint (which would teleport the route through 0° longitude).
  const axis = Math.abs(av[2]) < .9 ? [0,0,1] : [1,0,0];
  const ortho = [av[1]*axis[2]-av[2]*axis[1],
    av[2]*axis[0]-av[0]*axis[2],av[0]*axis[1]-av[1]*axis[0]];
  const orthoLength = Math.hypot(...ortho);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const left = sin > 1e-6 ? Math.sin((1 - t) * omega) / sin : 1 - t;
    const right = sin > 1e-6 ? Math.sin(t * omega) / sin : t;
    const v = dot < -.999999 ? av.map((n,j)=>n*Math.cos(Math.PI*t)+
      ortho[j]/orthoLength*Math.sin(Math.PI*t)) :
      av.map((n,j)=>left*n+right*bv[j]);
    const norm = Math.hypot(...v) || 1;
    return { latitude: Math.asin(clamp(v[2] / norm, -1, 1)) / RAD,
      longitude: wrap(Math.atan2(v[1], v[0]) / RAD) };
  });
}

/** Geographic grid is generated in the same projection as the city markers. */
export function projectedGlobeGraticule(camera: GlobeCamera): GlobePath[] {
  const lines: GlobePath[] = [];
  for (let lat = -60; lat <= 60; lat += 30) {
    const samples = Array.from({ length: 145 }, (_, i) => ({ latitude: lat, longitude: -180 + 2.5 * i }));
    lines.push({ id: "parallel-" + lat, d: projectedGlobePath(samples, camera) });
  }
  for (let lon = -180; lon < 180; lon += 30) {
    const samples = Array.from({ length: 73 }, (_, i) => ({ latitude: -90 + i * 2.5, longitude: lon }));
    lines.push({ id: "meridian-" + lon, d: projectedGlobePath(samples, camera) });
  }
  return lines.filter(line => line.d.length > 0);
}

/** Coastline data is projected through the exact same camera as route and city dots. */
const LAND_POINTS: readonly (readonly GeoPoint[])[] = LAND_OUTLINES.map(ring =>
  ring.map(([longitude,latitude])=>({latitude,longitude})),
);
export function projectedGlobeCoastlines(camera: GlobeCamera): GlobePath[] {
  return LAND_POINTS.map((ring,index)=>({id:"coast-"+index,d:projectedGlobePath(ring,camera)}))
    .filter(line=>line.d.length>0);
}
