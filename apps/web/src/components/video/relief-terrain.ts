/**
 * Relief terrain geometry for `relief-map-expedition`. Pure and CPU-only.
 *
 * A heightmap (Terrarium-encoded RGB, the open Terrain Tiles format) covers
 * geographic bounds in Web Mercator or equirectangular pixel space. The
 * world frame is kilometres: x east, z south, y up. Vertical scale is the
 * declared exaggeration times real elevation; nothing else rescales height.
 * Camera, route, labels and the GL mesh all use these functions, so overlays
 * stay registered to the terrain at every frame.
 */
export interface HeightField { width: number; height: number; data: Float32Array; min: number; max: number }
export interface GeoBounds { west: number; south: number; east: number; north: number }
export type HeightProjection = "web-mercator" | "equirectangular";
export interface ReliefFrame {
  field: HeightField; bounds: GeoBounds; projection: HeightProjection; exaggeration: number;
  /** Ground size of the heightmap in km. */
  widthKm: number; depthKm: number;
}
export type Vec3 = [number, number, number];
export interface ReliefCamera { target: Vec3; yaw: number; pitch: number; distance: number; fov: number }

const RAD = Math.PI / 180;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + lat * RAD / 2));

/** Terrarium: metres = R × 256 + G + B / 256 − 32768. */
export function decodeTerrarium(rgba: ArrayLike<number>, width: number, height: number): HeightField {
  const data = new Float32Array(width * height);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const m = rgba[i * 4] * 256 + rgba[i * 4 + 1] + rgba[i * 4 + 2] / 256 - 32768;
    data[i] = m; if (m < min) min = m; if (m > max) max = m;
  }
  return { width, height, data, min, max };
}
export function reliefFrame(field: HeightField, bounds: GeoBounds, projection: HeightProjection, exaggeration: number): ReliefFrame {
  const midLat = (bounds.north + bounds.south) / 2;
  const widthKm = (bounds.east - bounds.west) * 111.32 * Math.cos(midLat * RAD);
  const depthKm = (bounds.north - bounds.south) * 110.57;
  return { field, bounds, projection, exaggeration, widthKm, depthKm };
}
/** Geographic point → heightmap texture coordinates (0..1, v grows southward). */
export function geoToUV(r: Pick<ReliefFrame, "bounds" | "projection">, latitude: number, longitude: number): { u: number; v: number } {
  const { west, east, north, south } = r.bounds;
  const u = (longitude - west) / (east - west);
  const v = r.projection === "web-mercator"
    ? (mercY(north) - mercY(latitude)) / (mercY(north) - mercY(south))
    : (north - latitude) / (north - south);
  return { u, v };
}
/** Bilinear elevation in metres at texture coordinates. */
export function sampleHeight(field: HeightField, u: number, v: number): number {
  const x = clamp(u, 0, 1) * (field.width - 1), y = clamp(v, 0, 1) * (field.height - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(field.width - 1, x0 + 1), y1 = Math.min(field.height - 1, y0 + 1);
  const fx = x - x0, fy = y - y0, d = field.data, w = field.width;
  return (d[y0 * w + x0] * (1 - fx) + d[y0 * w + x1] * fx) * (1 - fy) + (d[y1 * w + x0] * (1 - fx) + d[y1 * w + x1] * fx) * fy;
}
/** Texture coordinates and elevation → world km (exaggerated height, centred on the map). */
export function uvToWorld(r: ReliefFrame, u: number, v: number, metres = sampleHeight(r.field, u, v)): Vec3 {
  return [(u - .5) * r.widthKm, metres / 1000 * r.exaggeration, (v - .5) * r.depthKm];
}
export function geoToWorld(r: ReliefFrame, latitude: number, longitude: number, liftMetres = 0): Vec3 {
  const { u, v } = geoToUV(r, latitude, longitude);
  return uvToWorld(r, u, v, sampleHeight(r.field, u, v) + liftMetres);
}

/* ---------- camera ---------- */
export function cameraPosition(c: ReliefCamera): Vec3 {
  const p = c.pitch * RAD, y = c.yaw * RAD;
  return [c.target[0] + c.distance * Math.cos(p) * Math.sin(y), c.target[1] + c.distance * Math.sin(p), c.target[2] + c.distance * Math.cos(p) * Math.cos(y)];
}
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Column-major view-projection matrix (WebGL convention). */
export function viewProjection(c: ReliefCamera, aspect: number, near = .1, far = 400): Float32Array {
  const eye = cameraPosition(c);
  const f = norm(sub(c.target, eye));
  // Near top-down, "up" is north (−z) so the map reads north-up; it blends to world up as the camera tilts.
  const up: Vec3 = c.pitch > 80 ? [0, 0, -1] : [0, 1, 0];
  const s = norm(cross(f, up)), u = cross(s, f);
  const view = [s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0, -dot(s, eye), -dot(u, eye), dot(f, eye), 1];
  const t = 1 / Math.tan(c.fov * RAD / 2);
  const proj = [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
    let sum = 0; for (let k = 0; k < 4; k++) sum += proj[k * 4 + row] * view[col * 4 + k];
    out[col * 4 + row] = sum;
  }
  return out;
}
/** World point → stage pixels; `visible` is false behind the camera. */
export function projectToStage(m: Float32Array, p: Vec3, width: number, height: number): { x: number; y: number; depth: number; visible: boolean } {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14], w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return { x: (x / w * .5 + .5) * width, y: (1 - (y / w * .5 + .5)) * height, depth: z / w, visible: w > 0 };
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (n: number) => { const t = clamp(n, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
export function blendCamera(a: ReliefCamera, b: ReliefCamera, t: number): ReliefCamera {
  return { target: [lerp(a.target[0], b.target[0], t), lerp(a.target[1], b.target[1], t), lerp(a.target[2], b.target[2], t)],
    yaw: lerp(a.yaw, b.yaw, t), pitch: lerp(a.pitch, b.pitch, t), distance: lerp(a.distance, b.distance, t), fov: lerp(a.fov, b.fov, t) };
}
/**
 * One authored camera: hold above the model, descend once to the oblique
 * expedition view between `descendFrom` and `descendTo`, then drift slowly.
 * Reduced motion holds the overhead view before the descent and the settled
 * oblique view after it.
 */
export function reliefCameraAtFrame(frame: number, overhead: ReliefCamera, oblique: ReliefCamera,
  beats: { descendFrom: number; descendTo: number; durationFrames: number }, reducedMotion = false): ReliefCamera {
  if (reducedMotion) return frame < beats.descendTo ? overhead : oblique;
  if (frame < beats.descendFrom) {
    // The hook moves from frame 0: an ease-out push and turn at full speed, settling into the descent.
    const t = 1 - Math.pow(1 - clamp(frame / Math.max(1, beats.descendFrom), 0, 1), 3);
    return { ...overhead, yaw: overhead.yaw - 12 * (1 - t), distance: overhead.distance * (1 + .2 * (1 - t)) };
  }
  if (frame < beats.descendTo) return blendCamera(overhead, oblique, smooth((frame - beats.descendFrom) / (beats.descendTo - beats.descendFrom)));
  const t = (frame - beats.descendTo) / Math.max(1, beats.durationFrames - beats.descendTo);
  return { ...oblique, yaw: oblique.yaw + 3 * t, distance: oblique.distance * (1 - .05 * t) };
}
/** Overhead distance that frames the whole model with a margin, for this aspect. */
export function overheadCamera(r: ReliefFrame, aspect: number, fov = 30): ReliefCamera {
  const half = Math.tan(fov * RAD / 2);
  const distance = Math.max(r.depthKm / 2 / half, r.widthKm / 2 / (half * aspect)) * 1.16 + r.field.max / 1000 * r.exaggeration;
  return { target: [0, 0, 0], yaw: 0, pitch: 86, distance, fov };
}

/* ---------- route ---------- */
/** Densify a geographic route along the terrain surface; returns world points slightly above ground. */
export function drapeRoute(r: ReliefFrame, points: readonly { latitude: number; longitude: number }[], stepKm = .08, liftMetres = 25, smoothKm = 0): Vec3[] {
  const uvs: { u: number; v: number }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = geoToUV(r, points[i].latitude, points[i].longitude), b = geoToUV(r, points[i + 1].latitude, points[i + 1].longitude);
    const km = Math.hypot((b.u - a.u) * r.widthKm, (b.v - a.v) * r.depthKm);
    const n = Math.max(1, Math.ceil(km / stepKm));
    for (let k = 0; k < n; k++) { const t = k / n; uvs.push({ u: lerp(a.u, b.u, t), v: lerp(a.v, b.v, t) }); }
  }
  const last = points[points.length - 1];
  uvs.push(geoToUV(r, last.latitude, last.longitude));
  // Optional along-track smoothing (Gaussian over arc length) calms raster staircases in computed
  // routes. The endpoints stay exact, so start and destination remain registered.
  const k = Math.round(smoothKm / stepKm);
  const smoothed = k < 1 ? uvs : uvs.map((p, i) => {
    if (i === 0 || i === uvs.length - 1) return p;
    let su = 0, sv = 0, sw = 0;
    for (let j = Math.max(0, i - 2 * k); j <= Math.min(uvs.length - 1, i + 2 * k); j++) {
      const wgt = Math.exp(-((j - i) ** 2) / (2 * k * k)); su += uvs[j].u * wgt; sv += uvs[j].v * wgt; sw += wgt;
    }
    // Taper towards the ends so the line meets its exact endpoints without a kink.
    const taper = Math.min(1, i / (2 * k), (uvs.length - 1 - i) / (2 * k));
    return { u: lerp(p.u, su / sw, taper), v: lerp(p.v, sv / sw, taper) };
  });
  return smoothed.map(({ u, v }) => uvToWorld(r, u, v, sampleHeight(r.field, u, v) + liftMetres));
}
/** True when terrain blocks the straight line from the eye to a world point (heightfield march).
 * `marginMetres` ignores grazing hits, so a route on a camera-facing flank is not chopped by small crests. */
export function occluded(r: ReliefFrame, eye: Vec3, p: Vec3, steps = 48, marginMetres = 0): boolean {
  for (let i = 2; i < steps - 1; i++) {
    const t = i / steps;
    const q: Vec3 = [lerp(p[0], eye[0], t), lerp(p[1], eye[1], t), lerp(p[2], eye[2], t)];
    const u = q[0] / r.widthKm + .5, v = q[2] / r.depthKm + .5;
    if (u < 0 || u > 1 || v < 0 || v > 1) return false;
    if (q[1] < (sampleHeight(r.field, u, v) - marginMetres) / 1000 * r.exaggeration) return true;
  }
  return false;
}

/* ---------- lighting bake ---------- */
export interface PaletteStop { elevation: number; color: string }
const hex = (c: string): Vec3 => { const n = parseInt(c.replace("#", "").slice(0, 6), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
/** Elevation-relative default: lowland green, upland olive, rock, then pale summits. */
export function defaultPalette(min: number, max: number): PaletteStop[] {
  const at = (f: number) => min + (max - min) * f;
  return [{ elevation: at(0), color: "#4b6640" }, { elevation: at(.35), color: "#61713f" }, { elevation: at(.6), color: "#7d6d58" },
    { elevation: at(.8), color: "#a39a91" }, { elevation: at(1), color: "#e9ecef" }];
}
/**
 * Bakes albedo × (sky ambient × occlusion + sun × cast shadow) into RGBA.
 * Light uses the exaggerated surface the viewer sees. Azimuth is degrees
 * clockwise from north; altitude is degrees above the horizon.
 */
export function bakeRelief(r: ReliefFrame, light: { azimuth: number; altitude: number }, palette: PaletteStop[], water?: string): Uint8ClampedArray {
  const { width: w, height: h, data } = r.field;
  const cellX = r.widthKm * 1000 / (w - 1), cellZ = r.depthKm * 1000 / (h - 1), ex = r.exaggeration;
  const az = light.azimuth * RAD, alt = light.altitude * RAD;
  const L: Vec3 = norm([Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt)]);
  const stops = [...palette].sort((a, b) => a.elevation - b.elevation).map(s => ({ e: s.elevation, c: hex(s.color) }));
  const albedo = (m: number): Vec3 => {
    if (m <= stops[0].e) return stops[0].c;
    for (let i = 1; i < stops.length; i++) if (m <= stops[i].e) {
      const t = (m - stops[i - 1].e) / Math.max(1e-6, stops[i].e - stops[i - 1].e), a = stops[i - 1].c, b = stops[i].c;
      return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    }
    return stops[stops.length - 1].c;
  };
  // Summed-area table for a local mean: concavities (valleys, gullies) receive less sky.
  const sat = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += data[y * w + x]; sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + row; } }
  const rad = Math.max(3, Math.round(w / 90));
  const mean = (x: number, y: number) => { const x0 = Math.max(0, x - rad), x1 = Math.min(w, x + rad + 1), y0 = Math.max(0, y - rad), y1 = Math.min(h, y + rad + 1);
    return (sat[y1 * (w + 1) + x1] - sat[y0 * (w + 1) + x1] - sat[y1 * (w + 1) + x0] + sat[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0)); };
  const waterRGB = water ? hex(water) : undefined;
  const out = new Uint8ClampedArray(w * h * 4);
  const stepX = L[0] / Math.hypot(L[0], L[2]), stepZ = L[2] / Math.hypot(L[0], L[2]);
  const rise = Math.tan(alt);
  const sky: Vec3 = [.52, .6, .72], sun: Vec3 = [1.08, .98, .86];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, m = data[i];
    const dx = (data[y * w + Math.min(w - 1, x + 1)] - data[y * w + Math.max(0, x - 1)]) * ex / (2 * cellX);
    const dz = (data[Math.min(h - 1, y + 1) * w + x] - data[Math.max(0, y - 1) * w + x]) * ex / (2 * cellZ);
    const n = norm([-dx, 1, -dz]);
    let lit = Math.max(0, dot(n, L));
    if (lit > 0) {
      // March toward the sun; steps lengthen with distance. Heights compared in exaggerated metres.
      let px = x, pz = y, travelled = 0, step = 1;
      for (let k = 0; k < 160; k++) {
        px += stepX * step; pz += stepZ * step; travelled += step; step = Math.min(6, step * 1.04);
        if (px < 0 || pz < 0 || px > w - 1 || pz > h - 1) break;
        const ray = m * ex + rise * travelled * Math.hypot(stepX * cellX, stepZ * cellZ);
        if (sampleHeight(r.field, px / (w - 1), pz / (h - 1)) * ex > ray + 4) { lit *= .08; break; }
      }
    }
    const ao = clamp(1 + (m - mean(x, y)) * ex / 260, .55, 1.12);
    const base = waterRGB && m <= 0 ? waterRGB : albedo(m);
    for (let c = 0; c < 3; c++) {
      const v = base[c] * (sky[c] * .62 * ao * (.6 + .4 * n[1]) + sun[c] * 1.05 * lit);
      out[i * 4 + c] = Math.round(255 * Math.pow(clamp(v, 0, 1), 1 / 1.08));
    }
    out[i * 4 + 3] = 255;
  }
  return out;
}
