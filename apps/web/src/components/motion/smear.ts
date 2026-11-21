/** Smears and squash: cartoon physics for anything that moves (doc 34, A6).
 *
 * - **Stretch.** While a shape moves fast it stretches along its path and thins across it, keeping its area, so speed reads in the shape.
 * - **Smear.** On its fastest frames, fading copies trail behind it, the motion-graphics stand-in for a hand-drawn smear frame.
 * - **Squash.** When it stops hard, it flattens for a moment and springs back.
 *
 * Practice: smear frames go back to 1940s cartoons; motion design builds them from stretching and duplicated copies (CG Wire; Jake Parker).
 * Too little and it does nothing, too much and it breaks the flow, so every amount is bounded.
 *
 * Pure: it reads a shape's centre on the frames around the current one (`path[LOOK_BACK]` is now), so it needs no history and gives the
 * same answer for a frame reached in any order.
 */

export interface SmearPoint { x: number; y: number }
export interface SmearFrame {
  /** Direction of travel, in degrees. */
  angle: number;
  /** Scale along the direction of travel, and across it. */
  along: number;
  across: number;
  /** Fading copies behind the shape, as offsets from it in pixels. */
  ghosts: ReadonlyArray<{ dx: number; dy: number; opacity: number }>;
  /** How flat the shape is after a hard stop: up to `maxSquash`, then a little negative as it springs back taller. */
  squash: number;
}
/** Frames looked back for a stop to squash after (the bounce settles within them), and the frames of the path a smear reads: `LOOK_BACK`
 * before now, now, and one after. */
export const LOOK_BACK = 10;
export const SMEAR_PATH = LOOK_BACK + 2;

const speedAt = (path: readonly SmearPoint[], i: number) => i <= 0 ? 0 : Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);

/** The smear at the current frame, from a shape's centre on frames now-7 to now+1 and its size in pixels. */
export function smearAt(path: readonly SmearPoint[], size: number, { amount = 1, maxStretch = .45, maxSquash = .22 } = {}): SmearFrame {
  const now = LOOK_BACK, a = path[now - 1] ?? path[now], b = path[now + 1] ?? path[now];
  // Speed through now, centred: half the distance from the frame before to the frame after, as a share of the shape's size per frame.
  const dx = (b.x - a.x) / 2, dy = (b.y - a.y) / 2, speed = Math.hypot(dx, dy) / Math.max(1, size);
  const stretch = Math.min(maxStretch, speed * 2.2 * amount), along = 1 + stretch, across = 1 / Math.sqrt(along);
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  const ghosts = speed > .1 / amount ? [1, 2, 3].map(k => ({ dx: -dx * k * .55, dy: -dy * k * .55, opacity: Math.min(.32, (speed - .1) * 1.6) * (1 - k * .27) })) : [];
  // A hard stop: fast on one frame, nearly still on the next. The squash is a damped bounce from that frame.
  let squash = 0;
  for (let i = now; i > 0; i--) {
    const before = speedAt(path, i), after = speedAt(path, i + 1);
    if (i + 1 <= now && before / Math.max(1, size) > .06 && after < before * .3) {
      // Flat for about three frames, a small rebound taller around frame six, settled by ten.
      const t = now - i, bounce = Math.cos(t * .55) * Math.exp(-t * .3);
      squash = Math.max(-maxSquash * .45, Math.min(maxSquash, maxSquash * bounce * Math.min(1, before / Math.max(1, size) / .12)));
      break;
    }
  }
  return { angle, along, across, ghosts, squash: amount > 0 ? squash : 0 };
}
/** A CSS transform for a smear: stretch along the direction of travel, then the squash, flattening toward the shape's base. */
export function smearTransform(frame: SmearFrame): string {
  const parts: string[] = [];
  if (frame.along > 1.005) parts.push(`rotate(${frame.angle}deg) scale(${frame.along}, ${frame.across}) rotate(${-frame.angle}deg)`);
  if (Math.abs(frame.squash) > .002) parts.push(`scale(${1 + frame.squash}, ${1 - frame.squash})`);
  return parts.join(" ");
}
