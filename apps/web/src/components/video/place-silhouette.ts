/**
 * Place silhouette geometry for `place-shaped-image-reveal`.
 *
 * A caller-licensed boundary (longitude/latitude rings) is drawn in an
 * orthographic projection centred on the place itself, the azimuthal view in
 * which a region of this size keeps its true shape. Context coastlines and the
 * graticule go through the same projection, so nothing drifts. Pure and
 * CPU-only: no DOM, no clock.
 */
import { projectGlobePoint } from "./globe-projection";
import type { GeoPoint } from "./globe-projection";
import { LAND_OUTLINES } from "./land-outline-110m";

export type LonLat = readonly [number, number];
export interface StageBox { x: number; y: number; width: number; height: number }
export interface PlaceSilhouette {
  center: GeoPoint;
  /** Stage-pixel transform of a geographic point at the final framing. */
  toStage: (p: GeoPoint) => { x: number; y: number };
  /** Silhouette outline in stage pixels (one subpath per ring). */
  outline: string;
  /** The same outline relative to `bounds`, for a mask sized to the bounds. */
  maskPath: string;
  bounds: StageBox;
  /** Context coastlines (Natural Earth 110m) except the place itself, in stage pixels. */
  coastlines: string[];
  graticule: string[];
}
const RAD = Math.PI / 180;
const fmt = (n: number) => Math.round(n * 10) / 10;

/** Spherical mean of every vertex: stable across the antimeridian, unlike a lon/lat box. */
export function boundaryCentroid(rings: readonly (readonly LonLat[])[]): GeoPoint {
  let x = 0, y = 0, z = 0;
  for (const ring of rings) for (const [lon, lat] of ring) {
    x += Math.cos(lat * RAD) * Math.cos(lon * RAD); y += Math.cos(lat * RAD) * Math.sin(lon * RAD); z += Math.sin(lat * RAD);
  }
  return { latitude: Math.atan2(z, Math.hypot(x, y)) / RAD, longitude: Math.atan2(y, x) / RAD };
}
/** Largest angular distance (degrees) from the centre; orthographic shape stays honest well inside 90°. */
export function boundaryRadius(rings: readonly (readonly LonLat[])[], center: GeoPoint): number {
  let max = 0;
  for (const ring of rings) for (const [lon, lat] of ring) {
    const p = projectGlobePoint({ latitude: lat, longitude: lon }, center);
    max = Math.max(max, Math.acos(Math.max(-1, Math.min(1, p.depth))) / RAD);
  }
  return max;
}
/** Default hero box: the left 56% in landscape, the upper band in portrait. Text owns the rest. */
export function placeHeroBox(width: number, height: number): StageBox {
  return height > width
    ? { x: width * .07, y: height * .12, width: width * .86, height: height * .42 }
    : { x: width * .05, y: height * .1, width: width * .53, height: height * .8 };
}
const ringPath = (pts: { x: number; y: number }[], close: boolean) =>
  "M" + pts.map(p => `${fmt(p.x)} ${fmt(p.y)}`).join("L") + (close ? "Z" : "");

export function placeSilhouette(rings: readonly (readonly LonLat[])[], width: number, height: number,
  options: { center?: GeoPoint; box?: StageBox; context?: boolean } = {}): PlaceSilhouette {
  const center = options.center ?? boundaryCentroid(rings);
  const box = options.box ?? placeHeroBox(width, height);
  const unit = rings.map(ring => ring.map(([lon, lat]) => projectGlobePoint({ latitude: lat, longitude: lon }, center)));
  const xs = unit.flat().map(p => p.x), ys = unit.flat().map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const k = Math.min(box.width / Math.max(1e-9, maxX - minX), box.height / Math.max(1e-9, maxY - minY));
  const ox = box.x + box.width / 2 - (minX + maxX) / 2 * k, oy = box.y + box.height / 2 - (minY + maxY) / 2 * k;
  const fromUnit = (p: { x: number; y: number }) => ({ x: ox + p.x * k, y: oy + p.y * k });
  const toStage = (p: GeoPoint) => fromUnit(projectGlobePoint(p, center));
  const bounds = { x: ox + minX * k, y: oy + minY * k, width: (maxX - minX) * k, height: (maxY - minY) * k };
  const stage = unit.map(ring => ring.map(fromUnit));
  const outline = stage.map(r => ringPath(r, true)).join("");
  const maskPath = stage.map(r => ringPath(r.map(p => ({ x: p.x - bounds.x, y: p.y - bounds.y })), true)).join("");
  // Context: every 110m land ring except the ones this boundary already draws in detail.
  const lon = rings.flat().map(p => p[0]), lat = rings.flat().map(p => p[1]);
  const inside = (q: readonly [number, number]) => q[0] >= Math.min(...lon) - .3 && q[0] <= Math.max(...lon) + .3
    && q[1] >= Math.min(...lat) - .3 && q[1] <= Math.max(...lat) + .3;
  const coastlines = options.context === false ? [] : LAND_OUTLINES.flatMap(ring => {
    if (ring.filter(inside).length > ring.length * .5) return [];
    const projected = ring.map(([lo, la]) => projectGlobePoint({ latitude: la, longitude: lo }, center));
    if (projected.some(p => p.depth < .2)) return [];
    return [ringPath(projected.map(fromUnit), true)];
  });
  // Graticule spacing scales with the place, so a small island and a continent both read.
  const extent = boundaryRadius(rings, center) * 2;
  const step = [1, 2, 5, 10, 15, 30].find(s => s >= extent * .45) ?? 30;
  const graticule: string[] = [];
  const span = Math.min(80, extent * 4 + step * 2);
  const lat0 = Math.round(center.latitude / step) * step, lon0 = Math.round(center.longitude / step) * step;
  for (let la = lat0 - span; la <= lat0 + span; la += step) {
    if (Math.abs(la) > 85) continue;
    const pts = Array.from({ length: 61 }, (_, i) => ({ latitude: la, longitude: lon0 - span * 2 + i * span * 4 / 60 }))
      .map(p => projectGlobePoint(p, center)).filter(p => p.depth > .2).map(fromUnit);
    if (pts.length > 1) graticule.push(ringPath(pts, false));
  }
  for (let lo = lon0 - span * 2; lo <= lon0 + span * 2; lo += step) {
    const pts = Array.from({ length: 41 }, (_, i) => ({ latitude: Math.max(-85, Math.min(85, lat0 - span + i * span * 2 / 40)), longitude: lo }))
      .map(p => projectGlobePoint(p, center)).filter(p => p.depth > .2).map(fromUnit);
    if (pts.length > 1) graticule.push(ringPath(pts, false));
  }
  return { center, toStage, outline, maskPath, bounds, coastlines, graticule };
}
