/**
 * Orbit World model: pure, frame-addressable geometry for a lit-globe journey.
 * No React, no Three.js, no clock. Everything the stage draws (camera, route,
 * markers, labels, stars, sun) is derived here from the serializable payload,
 * so the WebGL globe and the 2D orthographic fallback share one camera and
 * one set of surface coordinates.
 *
 * World frame: unit sphere, +Y through the North Pole, longitude 0° on +Z,
 * 90° E on +X. Matrices are column-major Float32Arrays, as WebGL expects.
 */
import { sampleGreatCircle } from "./globe-projection";
import type { ImageAsset, SceneLook } from "./scene-templates";

export type Vec3 = [number, number, number];
export interface OrbitWorldLocation {
  id: string; label: string; latitude: number; longitude: number;
  /** Optional media shown beside the destination on arrival. */
  image?: ImageAsset;
  /** Short secondary line under the destination label (e.g. a code or local time). */
  detail?: string;
}
/** A great-circle leg between two location ids, drawn on the surface in order. */
export interface OrbitWorldRoute { id: string; from: string; to: string }
/** A camera position above a surface point; altitude is in Earth radii above the surface. */
export interface OrbitWorldView { latitude: number; longitude: number; altitude?: number }
export interface OrbitWorldCamera {
  /** Legacy (v1) fields: the opening view's surface point. Kept as `start`. */
  latitude?: number; longitude?: number;
  /** Degrees the camera travels along the route's great circle before reaching the origin. Default 32. */
  orbitDegrees?: number;
  /** "limb" opens low over the illuminated horizon; "global" opens on the whole disc. Default "limb". */
  opening?: "limb" | "global";
  /** Explicit opening view; overrides latitude/longitude. */
  start?: OrbitWorldView;
  /** Location id the camera arrives at. Default: the last route's destination. */
  destination?: string;
  /** Altitude (Earth radii) of the establishing view. Default fits the globe to the frame. */
  establishAltitude?: number;
  /** Altitude (Earth radii) of the arrival hold. Default frames the destination with the limb in view. */
  arrivalAltitude?: number;
  /** Smoothing window of the camera path in seconds; larger is calmer. 0.2..2, default 1. */
  smoothing?: number;
  /** Fixed comparison camera at `start` (legacy behaviour); the route and markers still animate. */
  fixed?: boolean;
}
export interface OrbitWorldPayload {
  /** Legacy (v1): stylized texture overlay for `placement: "stylized"`. */
  globe?: ImageAsset;
  locations: OrbitWorldLocation[];
  /** "geographic" draws the lit globe; "stylized" forces the projected 2D globe. */
  placement: "geographic" | "stylized";
  /** Optional marker image that rides the route head (e.g. an aircraft glyph pointing up). */
  subject?: ImageAsset;
  camera?: OrbitWorldCamera;
  /** Establishing globe diameter as a percentage of the frame's short side, 30..90. */
  globeRadiusPercent?: number;
  /** Legs drawn in order. Default: consecutive locations. */
  routes?: OrbitWorldRoute[];
  title?: string;
  eyebrow?: string;
  /** Large figure held with the destination, e.g. a distance, and the line naming it. */
  readout?: { value: string; label?: string };
  /** Source credit line, shown verbatim. */
  credit?: string;
  /** Equirectangular maps (0° longitude at the image centre). Day is required for the lit globe. */
  textures?: { day?: ImageAsset; night?: ImageAsset; water?: ImageAsset; clouds?: ImageAsset };
  /** Subsolar point, or a UTC instant ("2026-06-21T06:00:00Z"). Default: illustrative light that dawns over the opening limb. */
  sun?: { latitude: number; longitude: number } | { time: string };
  /** Atmosphere rim colour (#rrggbb) and strength 0..2. */
  atmosphere?: { color?: string; strength?: number };
  layers?: { clouds?: boolean; stars?: boolean; coastlines?: boolean; graticule?: boolean; nightLights?: boolean };
  /** Colour tokens (#rrggbb). Route and markers default to the scene accent. */
  palette?: { route?: string; marker?: string; ink?: string; space?: string; ocean?: string; land?: string };
  /** CSS font-family stacks for display (title, readout) and body (labels, notes). */
  typography?: { display?: string; body?: string };
  /** "auto": WebGL globe when textures and WebGL 2 are available; "projection": always the 2D globe. */
  renderer?: "auto" | "projection";
  look?: SceneLook;
}

const RAD = Math.PI / 180;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const hex = /^#[0-9a-f]{6}$/i;
const geoOk = (lat: unknown, lon: unknown) => typeof lat === "number" && typeof lon === "number" &&
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
const nonempty = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const assetOk = (a?: ImageAsset) => !!a && nonempty(a.id) && nonempty(a.src) && nonempty(a.alt);

/* ---------- vectors ---------- */
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => { const l = length(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** Angle between unit vectors, radians. */
export const angleBetween = (a: Vec3, b: Vec3) => Math.atan2(length(cross(a, b)), dot(a, b));
export function geoToVec(latitude: number, longitude: number): Vec3 {
  const la = latitude * RAD, lo = longitude * RAD;
  return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
}
export function vecToGeo(v: Vec3): { latitude: number; longitude: number } {
  const n = normalize(v);
  return { latitude: Math.asin(clamp(n[1], -1, 1)) / RAD, longitude: Math.atan2(n[0], n[2]) / RAD };
}
/** Spherical interpolation between unit vectors. */
export function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const omega = angleBetween(a, b);
  if (omega < 1e-6) return normalize(add(scale(a, 1 - t), scale(b, t)));
  const s = Math.sin(omega);
  return normalize(add(scale(a, Math.sin((1 - t) * omega) / s), scale(b, Math.sin(t * omega) / s)));
}
/** Unit tangent at `p` pointing along the great circle towards `q`. */
export function headingTangent(p: Vec3, q: Vec3): Vec3 {
  const t = sub(q, scale(p, dot(p, q)));
  return length(t) < 1e-9 ? northTangent(p) : normalize(t);
}
/** Unit tangent at `p` pointing to geographic north (east at a pole). */
export function northTangent(p: Vec3): Vec3 {
  const t = sub([0, 1, 0], scale(p, p[1]));
  return length(t) < 1e-6 ? [1, 0, 0] : normalize(t);
}
/** Great-circle distance in kilometres on a 6,371 km sphere. */
export const greatCircleKm = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) =>
  angleBetween(geoToVec(a.latitude, a.longitude), geoToVec(b.latitude, b.longitude)) * 6371.0088;

/* ---------- sun ---------- */
/** Subsolar point for a UTC instant (NOAA low-precision solar position, about 0.1°). */
export function subsolarPoint(time: string | Date): { latitude: number; longitude: number } {
  const date = typeof time === "string" ? new Date(time) : time;
  const ms = date.getTime();
  if (!Number.isFinite(ms)) throw new Error("Orbit world: sun time must be a valid date.");
  const d = ms / 86400000 + 2440587.5 - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD;
  const dec = Math.asin(Math.sin(e) * Math.sin(L)) / RAD;
  const eqt = (((q - ra) % 360) + 540) % 360 - 180; // degrees of hour angle, ±180
  const utcHours = (ms / 3600000) % 24;
  const lon = (((12 - utcHours) * 15 - eqt) % 360 + 540) % 360 - 180;
  return { latitude: dec, longitude: lon };
}

/* ---------- payload normalisation (v1 → v2 migration) ---------- */
export interface ResolvedOrbitWorld {
  locations: OrbitWorldLocation[];
  byId: Map<string, OrbitWorldLocation>;
  routes: OrbitWorldRoute[];
  origin: OrbitWorldLocation;
  destination: OrbitWorldLocation;
  /** Route legs as dense surface samples, in drawing order, with each leg's share of the total angle. */
  legs: { route: OrbitWorldRoute; points: Vec3[]; angle: number }[];
  totalAngle: number;
  start: Vec3 | undefined;
  opening: "limb" | "global";
  orbitDegrees: number;
  fixed: boolean;
  sun: Vec3;
  layers: Required<NonNullable<OrbitWorldPayload["layers"]>>;
}
/**
 * Resolves defaults and migrates v1 payloads: v1 `camera` (a fixed camera
 * with a small orbit wobble) becomes the opening view, routes default to
 * consecutive location legs, and the destination is the last leg's end.
 */
export function resolveOrbitWorld(c: OrbitWorldPayload): ResolvedOrbitWorld {
  const locations = c.locations;
  const byId = new Map(locations.map(l => [l.id, l]));
  const routes = c.routes ?? locations.slice(1).map((l, i) => ({ id: `${locations[i].id}-${l.id}`, from: locations[i].id, to: l.id }));
  const destination = byId.get(c.camera?.destination ?? routes[routes.length - 1]?.to ?? locations[locations.length - 1].id)!;
  const origin = byId.get(routes[0]?.from ?? locations[0].id)!;
  const legs = routes.map(route => {
    const a = byId.get(route.from)!, b = byId.get(route.to)!;
    const angle = angleBetween(geoToVec(a.latitude, a.longitude), geoToVec(b.latitude, b.longitude));
    const steps = Math.max(8, Math.min(720, Math.ceil(angle / RAD * 3)));
    const points = sampleGreatCircle(a, b, steps).map(p => geoToVec(p.latitude, p.longitude));
    return { route, points, angle };
  });
  const totalAngle = legs.reduce((s, l) => s + l.angle, 0);
  const cam = c.camera ?? {};
  const startGeo = cam.start ?? (cam.latitude !== undefined && cam.longitude !== undefined ? { latitude: cam.latitude, longitude: cam.longitude } : undefined);
  const start = startGeo ? geoToVec(startGeo.latitude, startGeo.longitude) : undefined;
  const orbitDegrees = cam.orbitDegrees ?? 32;
  const o = geoToVec(origin.latitude, origin.longitude), d = geoToVec(destination.latitude, destination.longitude);
  const opener = start ?? openingPoint(o, d, orbitDegrees);
  let sun: Vec3;
  if (c.sun && "time" in c.sun) { const s = subsolarPoint(c.sun.time); sun = geoToVec(s.latitude, s.longitude); }
  else if (c.sun) sun = geoToVec(c.sun.latitude, c.sun.longitude);
  else sun = illustrativeSun(opener, d);
  const L = c.layers ?? {};
  return { locations, byId, routes, origin, destination, legs, totalAngle, start, opening: cam.opening ?? "limb",
    orbitDegrees, fixed: !!cam.fixed, sun,
    layers: { clouds: L.clouds ?? true, stars: L.stars ?? true, coastlines: L.coastlines ?? false, graticule: L.graticule ?? false, nightLights: L.nightLights ?? true } };
}
/** The opening surface point: `orbitDegrees` back along the route's great circle from the origin. */
function openingPoint(o: Vec3, d: Vec3, degrees: number): Vec3 {
  if (angleBetween(o, d) < 1e-4) return slerp(o, northTangentPoint(o), -degrees / 90);
  const axis = normalize(cross(d, o));
  return rotate(o, axis, degrees * RAD);
}
const northTangentPoint = (p: Vec3): Vec3 => normalize(add(p, northTangent(p)));
/** Rodrigues rotation of v about a unit axis. */
export function rotate(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
}
/**
 * Illustrative light when no sun is given: solved so the destination is held
 * in oblique morning light (~42° from the subsolar point) while the opening
 * point is ~125° away, so the horizon it looks across is at dawn. The sun is
 * placed on the northern side of the route. Not the sun of any real instant.
 */
function illustrativeSun(opener: Vec3, d: Vec3): Vec3 {
  const delta = angleBetween(opener, d);
  if (delta < 1e-4) return normalize(rotate(opener, normalize(cross(opener, northTangent(opener))), -42 * RAD));
  const a = clamp(delta + 8 * RAD, 100 * RAD, 132 * RAD), b = 42 * RAD;
  const t = headingTangent(opener, d), n = normalize(cross(opener, t));
  const cosA = clamp((Math.cos(b) - Math.cos(a) * Math.cos(delta)) / Math.max(1e-6, Math.sin(a) * Math.sin(delta)), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const pick = (sign: number) => normalize(add(scale(opener, Math.cos(a)), scale(add(scale(t, cosA), scale(n, sign * sinA)), Math.sin(a))));
  const p = pick(1), q = pick(-1);
  return p[1] >= q[1] ? p : q;
}
/** The tangent at the opening view that looks towards the sun's horizon, for a backlit dawn limb. */
export function dawnHeading(opener: Vec3, sun: Vec3): Vec3 { return headingTangent(opener, sun); }

/* ---------- validation ---------- */
/** Returns the first problem with an orbit-world payload, or undefined. */
export function checkOrbitWorld(c: OrbitWorldPayload): string | undefined {
  if (!Array.isArray(c.locations) || c.locations.length < 1 || !["geographic", "stylized"].includes(c.placement)) return "orbit needs placed locations and placement type.";
  if (!c.locations.every(l => l && nonempty(l.id)) || new Set(c.locations.map(l => l.id)).size !== c.locations.length) return "world locations need unique stable IDs.";
  if (!c.locations.every(l => nonempty(l.label) && geoOk(l.latitude, l.longitude))) return "world locations need valid latitude/longitude.";
  if (c.locations.some(l => l.image && !assetOk(l.image))) return "location image needs id, src, and alt.";
  if (c.locations.some(l => l.detail !== undefined && !nonempty(l.detail))) return "location detail must not be empty when given.";
  if ((c.placement === "stylized" || c.globe) && !assetOk(c.globe)) return "globe needs id, src, and alt.";
  if (c.subject && !assetOk(c.subject)) return "orbiter needs id, src, and alt.";
  const ids = new Set(c.locations.map(l => l.id));
  if (c.routes !== undefined) {
    if (!Array.isArray(c.routes) || !c.routes.every(r => r && nonempty(r.id)) || new Set(c.routes.map(r => r.id)).size !== c.routes.length) return "routes need unique stable IDs.";
    if (!c.routes.every(r => ids.has(r.from) && ids.has(r.to) && r.from !== r.to)) return "route refers to a missing location or joins a location to itself.";
  }
  const cam = c.camera;
  if (cam) {
    if ((cam.latitude !== undefined || cam.longitude !== undefined) && !geoOk(cam.latitude, cam.longitude)) return "orbit camera needs valid latitude, longitude and degrees.";
    if (!Number.isFinite(cam.orbitDegrees ?? 0) || Math.abs(cam.orbitDegrees ?? 0) > 360) return "orbit camera needs valid latitude, longitude and degrees.";
    if (cam.opening !== undefined && !["limb", "global"].includes(cam.opening)) return "unknown camera opening.";
    if (cam.start && (!geoOk(cam.start.latitude, cam.start.longitude) || (cam.start.altitude !== undefined && !(cam.start.altitude >= .15 && cam.start.altitude <= 12)))) return "camera start needs valid latitude/longitude and altitude 0.15..12.";
    if (cam.destination !== undefined && !ids.has(cam.destination)) return "camera destination must be a location id.";
    for (const a of [cam.establishAltitude, cam.arrivalAltitude]) if (a !== undefined && !(a >= .15 && a <= 12)) return "camera altitudes must be 0.15..12 Earth radii.";
    if (cam.smoothing !== undefined && !(cam.smoothing >= .2 && cam.smoothing <= 2)) return "camera smoothing must be 0.2..2 seconds.";
  }
  if (c.globeRadiusPercent !== undefined && (!Number.isFinite(c.globeRadiusPercent) || c.globeRadiusPercent < 30 || c.globeRadiusPercent > 90)) return "globe radius percent needs 30..90.";
  for (const t of Object.values(c.textures ?? {})) if (t && !assetOk(t)) return "textures need id, src, and alt.";
  if (c.sun) {
    if ("time" in c.sun) { if (!nonempty(c.sun.time) || !Number.isFinite(Date.parse(c.sun.time))) return "sun time must be a valid ISO date."; }
    else if (!geoOk(c.sun.latitude, c.sun.longitude)) return "sun needs a subsolar latitude/longitude or a time.";
  }
  if (c.atmosphere && ((c.atmosphere.color !== undefined && !hex.test(c.atmosphere.color)) || (c.atmosphere.strength !== undefined && !(c.atmosphere.strength >= 0 && c.atmosphere.strength <= 2)))) return "atmosphere needs a #rrggbb colour and strength 0..2.";
  if (c.palette && Object.values(c.palette).some(v => v !== undefined && !hex.test(v))) return "palette colours must be #rrggbb.";
  if (c.layers && Object.values(c.layers).some(v => v !== undefined && typeof v !== "boolean")) return "layers are booleans.";
  if (c.renderer !== undefined && !["auto", "projection"].includes(c.renderer)) return "unknown renderer.";
  for (const s of [c.title, c.eyebrow, c.credit, c.readout?.value, c.readout?.label]) if (s !== undefined && !nonempty(s)) return "copy fields must not be empty when given.";
  if (c.look && [c.look.grain, c.look.vignette].some(n => n !== undefined && !(n >= 0 && n <= 1))) return "look grain and vignette must be 0..1.";
  return undefined;
}

/* ---------- camera ---------- */
/** One camera state. `up` is the unit tangent at `n` that points up the screen; the camera pitches towards it. */
export interface GlobeView {
  n: Vec3; distance: number; pitch: number; up: Vec3;
  /** Lens shift of the globe centre in NDC (x right, y up). */
  shiftX: number; shiftY: number;
}
export const GLOBE_FOV = 28;
const halfTan = Math.tan(GLOBE_FOV * RAD / 2);
/** Camera distance (radii from centre) at which the globe's screen radius is `ndc` of the half-height. */
export const distanceForRadius = (ndc: number) => Math.sqrt(1 + 1 / Math.pow(ndc * halfTan, 2));
/** Apparent globe radius in NDC half-heights at a distance. */
export const radiusAtDistance = (d: number) => 1 / Math.sqrt(Math.max(1e-6, d * d - 1)) / halfTan;

export interface OrbitPlanTiming { durationFrames: number; fps: number; dock: number; reveal: number; resolve: number }
export interface OrbitPlan {
  views: GlobeView[];
  /** Route draw window (frames) and the frame the head reaches the destination. */
  drawStart: number; drawEnd: number; arrive: number;
  originAt: number; destinationAt: number;
}
const smootherstep = (t: number) => { const x = clamp(t, 0, 1); return x * x * x * (x * (x * 6 - 15) + 10); };
const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
/** Route head progress 0..1: a calm in-out traverse, linear in the middle. */
export function routeProgress(plan: Pick<OrbitPlan, "drawStart" | "drawEnd">, frame: number, reduced = false) {
  if (reduced) return frame >= plan.drawStart ? 1 : 0;
  return smootherstep((frame - plan.drawStart) / Math.max(1, plan.drawEnd - plan.drawStart));
}
/** The point at a fraction of the whole journey (all legs) and the leg index it falls on. */
export function journeyPoint(r: ResolvedOrbitWorld, fraction: number): { point: Vec3; leg: number; legFraction: number } {
  if (!r.legs.length) return { point: geoToVec(r.destination.latitude, r.destination.longitude), leg: -1, legFraction: 1 };
  let left = clamp(fraction, 0, 1) * r.totalAngle;
  for (let i = 0; i < r.legs.length; i++) {
    const leg = r.legs[i];
    if (left <= leg.angle || i === r.legs.length - 1) {
      const t = leg.angle ? clamp(left / leg.angle, 0, 1) : 1;
      const a = leg.points[0], b = leg.points[leg.points.length - 1];
      return { point: slerp(a, b, t), leg: i, legFraction: t };
    }
    left -= leg.angle;
  }
  return { point: r.legs[r.legs.length - 1].points[r.legs[r.legs.length - 1].points.length - 1], leg: r.legs.length - 1, legFraction: 1 };
}
interface Key { frame: number; v: GlobeView; ease?: "linear" | "out" | "inout" }
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function blendView(a: GlobeView, b: GlobeView, t: number): GlobeView {
  const n = slerp(a.n, b.n, t);
  // Keep `up` tangent to the moving sub-point.
  const upRaw = slerp(a.up, b.up, t);
  const up = normalize(sub(upRaw, scale(n, dot(upRaw, n))));
  return { n, up, distance: lerp(a.distance, b.distance, t), pitch: lerp(a.pitch, b.pitch, t),
    shiftX: lerp(a.shiftX, b.shiftX, t), shiftY: lerp(a.shiftY, b.shiftY, t) };
}
/**
 * The whole camera track, one view per frame. Built once from the payload and
 * timing (a pure function of them), then indexed by frame, so random access is
 * exact and repeatable. Keyframes give the beats; a zero-phase Gaussian pass
 * rounds every corner so heading and roll change at a bounded, calm rate.
 */
export function planOrbitWorld(r: ResolvedOrbitWorld, timing: OrbitPlanTiming, aspect: number,
  options: { globeRadiusPercent?: number; camera?: OrbitWorldCamera } = {}): OrbitPlan {
  const { durationFrames: N, fps, dock, reveal, resolve } = timing;
  const portrait = aspect < 1;
  const cam = options.camera ?? {};
  const o = geoToVec(r.origin.latitude, r.origin.longitude), d = geoToVec(r.destination.latitude, r.destination.longitude);
  const opener = r.start ?? openingPoint(o, d, r.orbitDegrees);
  // The opening looks across the horizon between the route and the sun, so the limb it frames is lit.
  const toRoute = headingTangent(opener, angleBetween(opener, d) > 1e-4 ? d : northTangentPoint(opener));
  const toSun = headingTangent(opener, r.sun);
  const towards = dot(toRoute, toSun) > -.5 ? normalize(add(toRoute, toSun)) : toRoute;
  // Establishing globe: diameter as a share of the short side. NDC radius is in half-heights.
  const shortShare = clamp(options.globeRadiusPercent ?? (portrait ? 84 : 78), 30, 90) / 100;
  const establishNdc = shortShare * (portrait ? aspect : 1);
  const establishD = cam.establishAltitude !== undefined ? 1 + cam.establishAltitude : distanceForRadius(establishNdc);
  const arriveD = cam.arrivalAltitude !== undefined ? 1 + cam.arrivalAltitude : distanceForRadius(portrait ? 1.25 * aspect : 1.45);
  const shiftX = portrait ? 0 : .3, shiftY = portrait ? -.06 : -.04;
  const span = r.totalAngle;
  // Establish over the early journey; arrive just short of the destination so the incoming route stays in view.
  const establishN = r.legs.length ? journeyPoint(r, .12).point : d;
  // The pull-back to the whole planet finishes a quarter of the way into the route draw: a long, calm move.
  const establishAt = Math.min(Math.round(dock + (reveal - dock) * .25), resolve - 1);
  const arriveBack = span > 1e-4 ? Math.min(.16, 9 * RAD / span) : 0;
  const arriveN = r.legs.length ? journeyPoint(r, 1 - arriveBack).point : d;
  const north = (p: Vec3) => northTangent(p);
  const drawStart = Math.round(dock + 6);
  const drawEnd = Math.round(reveal + (resolve - reveal) * .55);
  const arrive = resolve;
  const limbD = cam.start?.altitude !== undefined ? 1 + cam.start.altitude : 1.32;
  const limbPitch = Math.asin(1 / limbD) + Math.atan(.3 * halfTan);
  const views: GlobeView[] = [];
  const keys: Key[] = [];
  if (r.fixed) {
    const v: GlobeView = { n: opener, distance: establishD, pitch: 0, up: north(opener), shiftX, shiftY };
    for (let f = 0; f < N; f++) views.push(v);
    return { views, drawStart, drawEnd, arrive, originAt: drawStart - 8, destinationAt: drawEnd - 4 };
  }
  if (r.opening === "limb") {
    keys.push({ frame: 0, v: { n: opener, distance: limbD, pitch: limbPitch, up: towards, shiftX: 0, shiftY: 0 } });
    // A slow rise across the limb from the first frame, then the tilt down to the whole planet.
    // Drift along the coming move, so the heading never reverses when the pull-back starts.
    const gap = angleBetween(opener, establishN);
    const drift = gap > 1e-4 ? slerp(opener, establishN, Math.min(.5, 3 * RAD / gap)) : opener;
    keys.push({ frame: Math.round(dock * .3), v: { n: drift, distance: limbD + .1, pitch: limbPitch * .95, up: normalize(sub(towards, scale(drift, dot(towards, drift)))), shiftX: 0, shiftY: 0 }, ease: "linear" });
  } else {
    keys.push({ frame: 0, v: { n: opener, distance: establishD * 1.12, pitch: 0, up: north(opener), shiftX, shiftY } });
  }
  keys.push({ frame: establishAt, v: { n: establishN, distance: establishD, pitch: 0, up: north(establishN), shiftX, shiftY }, ease: "inout" });
  keys.push({ frame: arrive, v: { n: arriveN, distance: arriveD, pitch: 0, up: north(arriveN), shiftX, shiftY }, ease: "inout" });
  // Hold: a slow push of a few percent, settling by the last frame.
  keys.push({ frame: N - 1, v: { n: arriveN, distance: 1 + (arriveD - 1) * .94, pitch: 0, up: north(arriveN), shiftX, shiftY }, ease: "out" });
  const raw: GlobeView[] = [];
  for (let f = 0; f < N; f++) {
    let k = 0;
    while (k < keys.length - 2 && f >= keys[k + 1].frame) k++;
    const a = keys[k], b = keys[k + 1];
    const t = clamp((f - a.frame) / Math.max(1, b.frame - a.frame), 0, 1);
    const e = b.ease === "out" ? easeOutCubic(t) : b.ease === "inout" ? smootherstep(t) : t;
    const v = blendView(a.v, b.v, f <= a.frame ? 0 : e);
    // Roll to north-up at an even, slow rate from the first frame to the arrival, not inside one eased segment.
    if (f < arrive) {
      const u = slerp(keys[0].v.up, north(arriveN), smootherstep(f / arrive) * .5 + f / arrive * .5);
      v.up = normalize(sub(u, scale(v.n, dot(u, v.n))));
    }
    raw.push(v);
  }
  const sigma = (cam.smoothing ?? 1) * fps / 2.5;
  const smooth = smoothViews(raw, sigma);
  if (r.opening === "limb") {
    // Pitch follows the (smoothed) distance, so the horizon holds the lower third while the camera
    // pulls back; then the camera tilts down onto the whole planet.
    const k1 = keys[1].frame;
    for (let f = 0; f < Math.min(establishAt + 1, N); f++) {
      const hold = f <= k1 ? 1 : 1 - smootherstep((f - k1) / Math.max(1, establishAt - k1));
      smooth[f] = { ...smooth[f], pitch: (Math.asin(1 / Math.max(1.0001, smooth[f].distance)) + Math.atan(.3 * halfTan)) * hold };
    }
  }
  return { views: limitRoll(smooth, MAX_ROLL * RAD / fps), drawStart, drawEnd, arrive, originAt: drawStart - 8, destinationAt: drawEnd - 4 };
}
/** Screen roll never exceeds this many degrees per second (north-up over a pole would otherwise spin). */
export const MAX_ROLL = 14;
/**
 * Rate limiter on screen roll: the previous frame's up is parallel-transported
 * along the camera's move, then turned towards the desired up by at most
 * `maxStep` radians. A deterministic pass over the precomputed track.
 */
function limitRoll(views: GlobeView[], maxStep: number): GlobeView[] {
  const out = views.slice();
  for (let f = 1; f < out.length; f++) {
    const a = out[f - 1], b = out[f];
    const step = angleBetween(a.n, b.n);
    const carried = step > 1e-9 ? rotate(a.up, normalize(cross(a.n, b.n)), step) : a.up;
    const c = normalize(sub(carried, scale(b.n, dot(carried, b.n))));
    const signed = Math.atan2(dot(cross(c, b.up), b.n), dot(c, b.up));
    out[f] = { ...b, up: rotate(c, b.n, clamp(signed, -maxStep, maxStep)) };
  }
  return out;
}
/** Zero-phase Gaussian smoothing with clamped ends; vectors are renormalised afterwards. */
function smoothViews(raw: GlobeView[], sigma: number): GlobeView[] {
  if (sigma < .5) return raw;
  const radius = Math.ceil(sigma * 3);
  const weights = Array.from({ length: radius * 2 + 1 }, (_, i) => Math.exp(-Math.pow(i - radius, 2) / (2 * sigma * sigma)));
  const total = weights.reduce((s, w) => s + w, 0);
  return raw.map((_, f) => {
    let n: Vec3 = [0, 0, 0], up: Vec3 = [0, 0, 0], distance = 0, pitch = 0, shiftX = 0, shiftY = 0;
    for (let k = -radius; k <= radius; k++) {
      const v = raw[clamp(f + k, 0, raw.length - 1)], w = weights[k + radius] / total;
      n = add(n, scale(v.n, w)); up = add(up, scale(v.up, w));
      distance += v.distance * w; pitch += v.pitch * w; shiftX += v.shiftX * w; shiftY += v.shiftY * w;
    }
    const nn = normalize(n);
    const uu = normalize(sub(up, scale(nn, dot(up, nn))));
    return { n: nn, up: uu, distance, pitch, shiftX, shiftY };
  });
}
export const viewAt = (plan: OrbitPlan, frame: number, reduced = false) =>
  plan.views[reduced ? plan.views.length - 1 : clamp(Math.round(frame), 0, plan.views.length - 1)];
/** Heading (direction of travel over the surface), screen roll and surface speed, in degrees per second. */
export function cameraRates(views: GlobeView[], fps: number): { heading: number[]; roll: number[]; speed: number[] } {
  const heading: number[] = [], roll: number[] = [], speed: number[] = [];
  let prevDir: Vec3 | undefined;
  for (let f = 1; f < views.length - 1; f++) {
    const a = views[f - 1].n, b = views[f + 1].n;
    const move = angleBetween(a, b) / 2;
    speed.push(move / RAD * fps);
    // Roll: screen rotation left after parallel-transporting the previous up along the move.
    const step = angleBetween(views[f - 1].n, views[f].n), axis = cross(views[f - 1].n, views[f].n);
    const carried = step > 1e-9 ? rotate(views[f - 1].up, normalize(axis), step) : views[f - 1].up;
    roll.push(angleBetween(carried, views[f].up) / RAD * fps);
    if (move > .02 * RAD / fps) {
      const dir = headingTangent(views[f].n, b);
      if (prevDir) heading.push(angleBetween(prevDir, dir) / RAD * fps);
      prevDir = dir;
    } else prevDir = undefined;
  }
  return { heading, roll, speed };
}

/* ---------- matrices and projection ---------- */
export interface CameraMatrices { eye: Vec3; view: Float32Array; projection: Float32Array; viewProjection: Float32Array; forward: Vec3; upScreen: Vec3; right: Vec3 }
export function cameraMatrices(v: GlobeView, aspect: number, near = .01, far = 200): CameraMatrices {
  const eye = scale(v.n, v.distance);
  const forward = normalize(add(scale(v.n, -Math.cos(v.pitch)), scale(v.up, Math.sin(v.pitch))));
  const upScreen = normalize(add(scale(v.n, Math.sin(v.pitch)), scale(v.up, Math.cos(v.pitch))));
  const right = normalize(cross(forward, upScreen));
  const view = new Float32Array([
    right[0], upScreen[0], -forward[0], 0,
    right[1], upScreen[1], -forward[1], 0,
    right[2], upScreen[2], -forward[2], 0,
    -dot(right, eye), -dot(upScreen, eye), dot(forward, eye), 1]);
  const fy = 1 / halfTan;
  const projection = new Float32Array([
    fy / aspect, 0, 0, 0,
    0, fy, 0, 0,
    -v.shiftX, -v.shiftY, (far + near) / (near - far), -1,
    0, 0, 2 * far * near / (near - far), 0]);
  return { eye, view, projection, viewProjection: multiply(projection, view), forward, upScreen, right };
}
function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    out[c * 4 + r] = s;
  }
  return out;
}
export interface StagePoint { x: number; y: number; depth: number }
/** World point → stage pixels (y down). `depth` is the clip w; negative means behind the camera. */
export function projectToStage(m: CameraMatrices, p: Vec3, w: number, h: number): StagePoint {
  const v = m.viewProjection;
  const cx = v[0] * p[0] + v[4] * p[1] + v[8] * p[2] + v[12];
  const cy = v[1] * p[0] + v[5] * p[1] + v[9] * p[2] + v[13];
  const cw = v[3] * p[0] + v[7] * p[1] + v[11] * p[2] + v[15];
  const k = 1 / (Math.abs(cw) < 1e-9 ? 1e-9 : cw);
  return { x: (cx * k + 1) / 2 * w, y: (1 - cy * k) / 2 * h, depth: cw };
}
/** A direction at infinity (stars) → stage pixels, or undefined when behind the camera. */
export function projectDirection(m: CameraMatrices, dir: Vec3, w: number, h: number): { x: number; y: number } | undefined {
  const v = m.viewProjection;
  const cw = v[3] * dir[0] + v[7] * dir[1] + v[11] * dir[2];
  if (cw <= 1e-6) return undefined;
  return { x: ((v[0] * dir[0] + v[4] * dir[1] + v[8] * dir[2]) / cw + 1) / 2 * w, y: (1 - (v[1] * dir[0] + v[5] * dir[1] + v[9] * dir[2]) / cw) / 2 * h };
}
/** How far a surface point faces the camera: > 0 visible, 0 on the limb. */
export const facing = (m: CameraMatrices, p: Vec3) => dot(p, normalize(sub(m.eye, p)));
/** Globe centre and apparent radius on the stage, for the 2D fallback and atmosphere. */
export function globeDisc(m: CameraMatrices, v: GlobeView, w: number, h: number) {
  const c = projectToStage(m, [0, 0, 0], w, h);
  // The limb point in the up-screen direction gives the apparent radius under pitch.
  const toEye = normalize(m.eye), side = normalize(sub(m.upScreen, scale(toEye, dot(m.upScreen, toEye))));
  const limbAngle = Math.acos(1 / v.distance);
  const limb = add(scale(toEye, Math.cos(limbAngle)), scale(side, Math.sin(limbAngle)));
  const e = projectToStage(m, limb, w, h);
  return { x: c.x, y: c.y, r: Math.hypot(e.x - c.x, e.y - c.y) };
}

/* ---------- stars ---------- */
/** Deterministic star field: unit directions with magnitudes 0..1 (1 = brightest). */
export function starField(count = 1400, seed = 0x5eed): { dir: Vec3; mag: number; warm: number }[] {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return Array.from({ length: count }, () => {
    const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    return { dir: [r * Math.cos(a), z, r * Math.sin(a)] as Vec3, mag: Math.pow(rnd(), 6), warm: rnd() };
  });
}

/* ---------- labels ---------- */
export type LabelSide = "right" | "left" | "above" | "below";
export interface Rect { x: number; y: number; w: number; h: number }
const cjk = /[⺀-鿿가-힯豈-﫿＀-￯]/;
/** Conservative advance of a string in em: CJK glyphs are full width, other glyphs about .6em in a bold sans. */
export const textEm = (text: string) => [...text].reduce((s, ch) => s + (cjk.test(ch) ? 1.02 : ch === " " ? .3 : .64), 0);
/** A conservative label box (px) for one or two lines of text at a size, wrapping at `maxWidth`. */
export function labelBox(lines: { text: string; size: number }[], maxWidth: number, padX: number, padY: number): { w: number; h: number } {
  let w = 0, h = 0;
  for (const l of lines) {
    const natural = textEm(l.text) * l.size;
    const rows = Math.max(1, Math.ceil(natural / maxWidth));
    w = Math.max(w, Math.min(natural, maxWidth)); h += rows * l.size * 1.22;
  }
  return { w: w + padX * 2, h: h + padY * 2 };
}
const overlaps = (a: Rect, b: Rect, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
/** Box for a label on one side of its anchor, `gap` px away. */
export function sideRect(anchor: { x: number; y: number }, box: { w: number; h: number }, side: LabelSide, gap: number): Rect {
  switch (side) {
    case "right": return { x: anchor.x + gap, y: anchor.y - box.h / 2, w: box.w, h: box.h };
    case "left": return { x: anchor.x - gap - box.w, y: anchor.y - box.h / 2, w: box.w, h: box.h };
    case "above": return { x: anchor.x - box.w / 2, y: anchor.y - gap - box.h, w: box.w, h: box.h };
    case "below": return { x: anchor.x - box.w / 2, y: anchor.y + gap, w: box.w, h: box.h };
  }
}
export interface LabelRequest { id: string; anchor: { x: number; y: number }; box: { w: number; h: number }; gap: number; sides: LabelSide[]; priority: number }
/**
 * Greedy placement, highest priority first: each label takes the first side
 * that stays inside `safe`, clear of `avoid` regions, other labels and
 * markers. A label with no clean side keeps its least-bad side clamped into
 * the safe area when its priority is >= 10 (destination), else it is hidden.
 */
export function layoutLabels(requests: LabelRequest[], safe: Rect, avoid: Rect[], markers: { x: number; y: number; r: number }[] = []):
  Map<string, { side: LabelSide; rect: Rect } | null> {
  const placed: Rect[] = [];
  const out = new Map<string, { side: LabelSide; rect: Rect } | null>();
  const inside = (r: Rect) => r.x >= safe.x && r.y >= safe.y && r.x + r.w <= safe.x + safe.w && r.y + r.h <= safe.y + safe.h;
  const markerRects = markers.map(m => ({ x: m.x - m.r, y: m.y - m.r, w: m.r * 2, h: m.r * 2 }));
  for (const q of [...requests].sort((a, b) => b.priority - a.priority)) {
    let best: { side: LabelSide; rect: Rect; cost: number } | undefined;
    q.sides.forEach((side, i) => {
      const rect = sideRect(q.anchor, q.box, side, q.gap);
      const ownMarker = (m: Rect) => Math.abs(m.x + m.w / 2 - q.anchor.x) < 1 && Math.abs(m.y + m.h / 2 - q.anchor.y) < 1;
      const cost = (inside(rect) ? 0 : 100) + avoid.filter(a => overlaps(rect, a)).length * 40 +
        placed.filter(p => overlaps(rect, p, 6)).length * 60 + markerRects.filter(m => !ownMarker(m) && overlaps(rect, m)).length * 30 + i;
      if (!best || cost < best.cost) best = { side, rect, cost };
    });
    if (!best) { out.set(q.id, null); continue; }
    if (best.cost >= 30 && q.priority < 10) { out.set(q.id, null); continue; }
    const r = best.rect;
    const rect = { ...r, x: clamp(r.x, safe.x, safe.x + safe.w - r.w), y: clamp(r.y, safe.y, safe.y + safe.h - r.h) };
    placed.push(rect);
    out.set(q.id, { side: best.side, rect });
  }
  return out;
}
