/** Pure, frame-addressed 2.5D camera rig for cinematic environment reveals.
 * Coordinates are normalized to the authored image; output translation uses
 * percentages relative to each visual plane. No accumulating CSS transitions.
 */
export interface EnvironmentCameraPoint {x:number;y:number;zoom:number}
export interface EnvironmentCameraPath {from:EnvironmentCameraPoint;to:EnvironmentCameraPoint}
export interface EnvironmentFrame {
  progress:number;zoom:number;
  background:{x:number;y:number;scale:number};
  foreground:{x:number;y:number;scale:number};
  subject:{x:number;y:number};
  lightSweep:number;
}
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const smooth=(n:number)=>{const t=clamp(n,0,1);return t*t*t*(t*(t*6-15)+10)};
export function sampleEnvironmentFrame(
  path:EnvironmentCameraPath,anchor:{x:number;y:number},
  frame:number,durationFrames:number,
  options:{foregroundStrength?:number;reducedMotion?:boolean}={},
):EnvironmentFrame{
  const points=[...Object.values(path.from),...Object.values(path.to),anchor.x,anchor.y];
  if(!points.every(Number.isFinite)||!Number.isFinite(frame)||!Number.isFinite(durationFrames)||
      durationFrames<=0||![path.from.x,path.from.y,path.to.x,path.to.y,anchor.x,anchor.y]
        .every(v=>v>=0&&v<=1)||
      ![path.from.zoom,path.to.zoom].every(v=>v>.0&&v<=3))
    throw new Error("Invalid 2.5D environment camera");
  const strength=options.foregroundStrength??1.3;
  if(!Number.isFinite(strength)||strength<1||strength>2.5)throw Error("Foreground strength must be 1..2.5");
  const t=options.reducedMotion?1:smooth(frame/Math.max(1,durationFrames-1));
  const lerp=(a:number,b:number)=>a+(b-a)*t;
  const cx=lerp(path.from.x,path.to.x);
  const cy=lerp(path.from.y,path.to.y);
  // Keep overscan to prevent hard empty borders even when a camera author
  // requests a very wide lens. The underlying source is still user-authored.
  const zoom=Math.max(1.035,lerp(path.from.zoom,path.to.zoom));
  const dx=clamp((.5-cx)*(zoom-1),-(zoom-1)*.5,(zoom-1)*.5);
  const dy=clamp((.5-cy)*(zoom-1),-(zoom-1)*.5,(zoom-1)*.5);
  const fgScale=1+(zoom-1)*strength+.045;
  const fx=clamp(dx*strength,-(fgScale-1)*.5,(fgScale-1)*.5);
  const fy=clamp(dy*strength,-(fgScale-1)*.5,(fgScale-1)*.5);
  return {progress:t,zoom,
    background:{x:dx*100,y:dy*100,scale:zoom},
    foreground:{x:fx*100,y:fy*100,scale:fgScale},
    subject:{
      x:50+(anchor.x-.5)*zoom*100+dx*100,
      y:50+(anchor.y-.5)*zoom*100+dy*100,
    },
    lightSweep:options.reducedMotion?0:smooth((t-.16)/.7),
  };
}

/* ---------- Dolly through depth planes ---------- */
/**
 * A plane authored by its frame-0 screen rectangle (centre x/y and size, as
 * fractions of the stage) and its distance from the camera. One camera z drives
 * every plane: scale = depth / (depth − z), and positions spread from the
 * vanishing point by the same factor, so nearer planes grow and leave faster.
 */
export interface DepthPlane { x: number; y: number; width: number; height: number; depth: number }
export interface DollyPath {
  /** Camera travel along the view axis, in the same units as plane depth. */
  distance: number;
  /** Sideways and vertical travel over the move (stage fractions at depth 1). */
  truck?: number; rise?: number;
  /** Walking bob amplitude 0..1 (vertical sway and roll), scaled by speed. */
  bob?: number;
  /** Frames over which the move runs; it starts on frame `start` and settles at `end`. */
  start: number; end: number;
}
export interface DollyCamera { z: number; x: number; y: number; roll: number; progress: number; speed: number }
const dollyCurve = (u: number, rampFraction: number) => {
  // Velocity ramps up over the first frames, holds a walking pace, then eases to rest on arrival.
  const v = (s: number) => Math.min(1, s / Math.max(1e-6, rampFraction)) * (1 - Math.pow(s, 2.2));
  const steps = 240; let total = 0, at = 0;
  for (let i = 0; i < steps; i++) {
    const s = (i + .5) / steps, dv = v(s) / steps;
    total += dv;
    // Partial bins prevent repeated positions on shots longer than 240 frames.
    at += dv * clamp(u * steps - i, 0, 1);
  }
  return { position: at / total, velocity: v(u) / total };
};
/** Camera at one frame. Pure; reduced motion holds the start, then cuts to the arrival at `end`. */
export function dollyCameraAtFrame(frame: number, path: DollyPath, reducedMotion = false): DollyCamera {
  if (![frame, path.distance, path.start, path.end].every(Number.isFinite) || path.end <= path.start) throw new Error("Invalid dolly path");
  const span = path.end - path.start;
  const u = reducedMotion ? (frame >= path.end ? 1 : 0) : clamp((frame - path.start) / span, 0, 1);
  const { position, velocity } = reducedMotion ? { position: u, velocity: 0 } : dollyCurve(u, Math.min(.2, 8 / span));
  const speed = clamp(velocity / 1.6, 0, 1);
  // Two steps per ~26 frames: a small vertical bob and half-rate roll, only while moving.
  const phase = (frame - path.start) * Math.PI * 2 / 26;
  const bob = (path.bob ?? .5) * speed * (reducedMotion ? 0 : 1);
  return { z: path.distance * position, x: (path.truck ?? 0) * position, y: (path.rise ?? 0) * position + bob * .006 * Math.sin(phase),
    roll: bob * .45 * Math.sin(phase / 2), progress: position, speed };
}
/** Screen rectangle of a plane for this camera (stage fractions); `visible` is false once passed. */
export function projectDepthPlane(plane: DepthPlane, camera: DollyCamera, vanishing: { x: number; y: number }) {
  const gap = plane.depth - camera.z;
  if (gap <= .02) return { x: 0, y: 0, width: 0, height: 0, scale: Infinity, visible: false };
  const scale = plane.depth / gap;
  const x = vanishing.x + ((plane.x - vanishing.x) * plane.depth - camera.x) / gap;
  const y = vanishing.y + ((plane.y - vanishing.y) * plane.depth - camera.y) / gap;
  const width = plane.width * scale, height = plane.height * scale;
  const visible = x + width / 2 > 0 && x - width / 2 < 1 && y + height / 2 > 0 && y - height / 2 < 1;
  return { x, y, width, height, scale, visible };
}
