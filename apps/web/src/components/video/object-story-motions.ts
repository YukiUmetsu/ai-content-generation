/** OS1 motions: what an object does when the words say so, and the shapes a graph can take.
 * Pure functions of progress. Effects are data for the renderer: particles, copies, paper sheets and rings.
 * To add a motion, add its name and one case. Nothing here knows about any subject.
 */
import { evaluateEasing } from "../motion/easing";
import type { Rect, Vec2 } from "../motion/types";

export const OBJECT_STORY_MOTIONS = ["walk", "hop", "shake", "spin", "grow", "shrink", "drop", "lift", "explode", "pop", "print", "stamp", "split", "vanish",
  "melt", "burn", "inflate", "deflate", "pulse", "wobble", "slide", "rain", "stack", "flip", "burst", "doze"] as const;
export type ObjectStoryMotion = (typeof OBJECT_STORY_MOTIONS)[number];
/** Motions that end with the object gone. A director should drop it from the next beat. */
export const OBJECT_STORY_FINAL_MOTIONS: readonly ObjectStoryMotion[] = ["explode", "pop", "vanish"];

/** Motions that bring the object on. It stays hidden until the motion starts, so it can land on its spoken word. */
export const OBJECT_STORY_ENTRANCE_MOTIONS: readonly ObjectStoryMotion[] = ["burst"];

export const OBJECT_STORY_TREND_SHAPES = ["rise", "fall", "crash", "recover", "spike", "plateau"] as const;
export type ObjectStoryTrendShape = (typeof OBJECT_STORY_TREND_SHAPES)[number];

export interface StoryParticle { x: number; y: number; size: number; opacity: number; rotate: number; tone: "accent" | "warm" | "danger" | "ink"; shape: "dot" | "shard" | "flame" | "drop" | "z" }
export interface StoryCopy { x: number; y: number; scale: number; rotate: number; opacity: number; clip?: "left" | "right" }
export interface StorySheet { x: number; y: number; width: number; height: number; fullWidth: number; opacity: number }
export interface ObjectStoryMotionFrame {
  x: number; y: number; rotate: number; scale: number; scaleX: number; scaleY: number; opacity: number;
  origin: "center" | "bottom";
  /** Offsets of everything here are from the object's centre. */
  particles: readonly StoryParticle[];
  copies: readonly StoryCopy[];
  sheets: readonly StorySheet[];
  rings: readonly { radius: number; opacity: number }[];
  /** 0 to 1. How hard this moment hits, which shakes the stage. */
  impact: number;
}
export const STILL_MOTION: ObjectStoryMotionFrame = { x: 0, y: 0, rotate: 0, scale: 1, scaleX: 1, scaleY: 1, opacity: 1, origin: "center", particles: [], copies: [], sheets: [], rings: [], impact: 0 };

export interface MotionContext { rect: Rect; seconds: number; arrives: boolean; side: number; seed: number }

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const span = (t: number, from: number, to: number) => clamp01((t - from) / (to - from));
/** Stable noise, so a frame looks the same however it is reached. */
const noise = (index: number, salt: number) => { const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453; return value - Math.floor(value); };
export const motionSeed = (id: string) => [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0);

function burst(t: number, size: number, count: number, seed: number, reach: number, shape: StoryParticle["shape"], gravity = .55): StoryParticle[] {
  const tones = ["accent", "warm", "danger", "ink"] as const;
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 + noise(index, seed) * .7, speed = reach * (.45 + noise(index, seed + 1) * .55) * size;
    const eased = evaluateEasing("ease-out-cubic", t);
    return { x: Math.cos(angle) * speed * eased, y: Math.sin(angle) * speed * eased + gravity * size * t * t, size: size * (.05 + noise(index, seed + 2) * .07) * (1 - t * .4),
      opacity: 1 - span(t, .55, 1), rotate: noise(index, seed + 3) * 720 * t, tone: tones[index % tones.length], shape };
  });
}

/** A motion at linear progress `t`, sized to the object so it reads at any scale. */
export function motionFrame(motion: ObjectStoryMotion, t: number, { rect, seconds, arrives, side, seed }: MotionContext): ObjectStoryMotionFrame {
  const size = Math.min(rect.width, rect.height);
  const frame = (partial: Partial<ObjectStoryMotionFrame>) => ({ ...STILL_MOTION, ...partial });
  const decay = (from: number, length: number) => (t < from ? 0 : Math.max(0, 1 - (t - from) / length));
  switch (motion) {
    case "walk": {
      const steps = Math.max(2, Math.round(seconds * 2.4)), swing = Math.sin(t * steps * Math.PI);
      return frame({ x: (arrives ? 1 - t : Math.sin(Math.PI * t)) * rect.width * 1.1 * side, y: -Math.abs(swing) * size * .05, rotate: swing * 5 * (1 - t * .2) });
    }
    case "hop": return frame({ y: -Math.abs(Math.sin(t * 2 * Math.PI)) * size * .14 });
    case "shake": return frame({ x: Math.sin(t * Math.PI * 12) * (1 - t) * size * .05, rotate: Math.sin(t * Math.PI * 9) * (1 - t) * 6 });
    case "spin": return frame({ rotate: evaluateEasing("ease-in-out-cubic", t) * 360 });
    case "grow": case "shrink": return STILL_MOTION;
    case "drop": {
      // Falls in from above, lands hard, then settles with one bounce.
      const fall = t < .55 ? 1 - (t / .55) ** 2 : Math.sin(span(t, .55, 1) * Math.PI) * .14;
      return frame({ y: -fall * size * .55, impact: decay(.55, .25), scaleY: 1 - decay(.55, .2) * .16, origin: "bottom" });
    }
    case "lift": return frame({ y: -Math.sin(Math.PI * t) * size * .32, rotate: Math.sin(Math.PI * t) * -4 });
    case "explode": {
      if (t < .2) { const swell = t / .2; return frame({ scale: 1 + swell * .22, x: Math.sin(t * 90) * swell * size * .03 }); }
      const after = span(t, .2, 1);
      return frame({ opacity: 0, particles: burst(after, size, 18, seed, 1.25, "shard"), rings: [{ radius: size * (.3 + after * 1.1), opacity: (1 - after) * .8 }], impact: decay(.2, .3) });
    }
    case "pop": {
      if (t < .42) return frame({ scale: 1 + span(t, 0, .42) ** 2 * .34 });
      const after = span(t, .42, 1);
      return frame({ opacity: 0, particles: burst(after, size, 9, seed, .75, "dot", .3), rings: [{ radius: size * (.4 + after * .5), opacity: (1 - after) * .9 }], impact: decay(.42, .15) * .35 });
    }
    case "print": {
      // Pages feed out of the object's side, toward the middle of the stage, so they cover neither its label nor the caption.
      const sheets = [0, 1, 2].map(index => {
        const feed = evaluateEasing("ease-out-cubic", span(t, index * .22, index * .22 + .42)), width = size * .46 * feed;
        return { x: -side * (size * .48 + width / 2 + index * size * .04), y: -size * .3 + index * size * .06, width, height: size * .6, fullWidth: size * .46, opacity: feed > 0 ? 1 : 0 };
      });
      return frame({ sheets, y: Math.sin(t * 60) * (1 - t) * size * .006 });
    }
    case "stamp": {
      if (t < .28) { const fall = evaluateEasing("ease-in-cubic", t / .28); return frame({ scale: 2.1 - fall * 1.1, opacity: .25 + fall * .75 }); }
      const after = span(t, .28, .6);
      return frame({ scaleY: 1 - decay(.28, .2) * .22, scaleX: 1 + decay(.28, .2) * .12, origin: "bottom", rings: t < .6 ? [{ radius: size * (.45 + after * .35), opacity: (1 - after) * .7 }] : [], impact: decay(.28, .22) * .8 });
    }
    case "split": {
      const apart = evaluateEasing("ease-in-out-cubic", span(t, .1, .75)) * size * .24;
      return frame({ opacity: 0, copies: [{ x: -apart, y: 0, scale: 1, rotate: -apart / size * 14, opacity: 1, clip: "left" }, { x: apart, y: 0, scale: 1, rotate: apart / size * 14, opacity: 1, clip: "right" }] });
    }
    case "vanish": return frame({ opacity: 1 - span(t, 0, .8), scale: 1 - t * .3, particles: t > .1 ? burst(span(t, .1, 1), size, 8, seed, .6, "dot", -.5) : [] });
    case "melt": return frame({ scaleY: 1 - evaluateEasing("ease-in-out-cubic", t) * .62, scaleX: 1 + t * .28, origin: "bottom",
      particles: [0, 1, 2, 3].map(index => { const drip = (t * 1.6 + index * .23) % 1; return { x: (index - 1.5) * size * .2, y: size * .4 + drip * size * .16, size: size * .05, opacity: t > .15 ? 1 - drip : 0, rotate: 0, tone: "accent" as const, shape: "drop" as const }; }) });
    case "burn": return frame({ opacity: 1 - t * .55, rotate: Math.sin(t * 40) * 1.5,
      particles: Array.from({ length: 12 }, (_, index) => { const rise = (t * 2.4 + noise(index, seed)) % 1;
        return { x: (noise(index, seed + 1) - .5) * size * .7 * (1 - rise * .6), y: size * .3 - rise * size * .85, size: size * (.14 - rise * .09), opacity: span(t, 0, .12) * (1 - rise), rotate: 0, tone: index % 2 ? "warm" as const : "danger" as const, shape: "flame" as const }; }) });
    case "inflate": { const swell = evaluateEasing("ease-out-back", t); return frame({ scale: 1 + swell * .24, scaleY: 1 + Math.sin(t * 14) * (1 - t) * .05 }); }
    case "deflate": return frame({ scale: 1 - evaluateEasing("ease-in-out-cubic", t) * .45, rotate: Math.sin(t * 34) * 16 * (1 - t), x: Math.sin(t * 17) * (1 - t) * size * .1 });
    case "pulse": { const beat = (from: number) => Math.sin(span(t, from, from + .18) * Math.PI); return frame({ scale: 1 + (beat(.08) + beat(.34) * .8 + beat(.62) + beat(.86) * .8) * .16 }); }
    case "wobble": return frame({ rotate: Math.sin(t * Math.PI * 7) * 13 * (1 - t), origin: "bottom" });
    case "slide": { const moved = evaluateEasing("ease-out-cubic", t); return frame({ x: (1 - moved) * rect.width * .9 * side, rotate: (1 - moved) * 9 * side }); }
    case "rain": return frame({ copies: Array.from({ length: 9 }, (_, index) => {
      const fall = span(t, index * .07, index * .07 + .4);
      return { x: (noise(index, seed) - .5) * size * 1.1, y: -size * .9 + fall * size * 1.2, scale: .24, rotate: noise(index, seed + 1) * 60 - 30, opacity: fall > 0 ? 1 - span(fall, .8, 1) : 0 };
    }) });
    case "stack": return frame({ copies: [0, 1, 2, 3].map(index => {
      const land = evaluateEasing("ease-out-cubic", span(t, index * .2, index * .2 + .3));
      return { x: (index % 2 ? 1 : -1) * size * .03, y: -(index + 1) * size * .13 - (1 - land) * size * .5, scale: .94, rotate: (index % 2 ? 1 : -1) * 2, opacity: land > 0 ? 1 : 0 };
    }) });
    case "flip": return frame({ scaleX: Math.cos(evaluateEasing("ease-in-out-cubic", t) * Math.PI * 2) });
    case "burst": {
      const arrive = evaluateEasing("ease-out-back", span(t, 0, .4)), after = span(t, .08, 1);
      return frame({ scale: Math.max(.02, arrive), rotate: (1 - arrive) * -18, particles: burst(after, size, 16, seed, 1.1, "shard", .2), rings: [{ radius: size * (.35 + after * .75), opacity: (1 - after) * .85 }], impact: decay(0, .24) * .75 });
    }
    case "doze": return frame({ rotate: Math.sin(span(t, 0, 1) * Math.PI * 3) ** 2 * 7, origin: "bottom",
      particles: [0, 1, 2].map(index => { const rise = (t * 1.5 + index * .33) % 1; return { x: size * (.3 + rise * .16), y: -size * (.2 + rise * .3), size: size * (.08 + rise * .06), opacity: t > index * .12 ? Math.sin(rise * Math.PI) : 0, rotate: rise * 12, tone: "accent" as const, shape: "z" as const }; }) });
  }
}

export interface MotionReach { left: number; right: number; top: number; bottom: number }
/** Anything fainter passes over the stage. It is not a thing a caption has to dodge. */
const SOLID = .9;
const EVERY_MOMENT = Array.from({ length: 25 }, (_, index) => index / 24);

/** How far past its rect a motion carries the solid parts of an object, in pixels on each side.
 * Measured from the motion itself, so a new motion needs no table. Particles and rings fly past and do not count.
 * Pass `moments` to ask about one point, such as `[1]` for where the object rests.
 */
export function motionReach(motion: ObjectStoryMotion, context: MotionContext, moments: readonly number[] = EVERY_MOMENT): MotionReach {
  const { width, height } = context.rect;
  const reach: MotionReach = { left: 0, right: 0, top: 0, bottom: 0 };
  const cover = (left: number, right: number, top: number, bottom: number) => {
    reach.left = Math.max(reach.left, -left - width / 2);
    reach.right = Math.max(reach.right, right - width / 2);
    reach.top = Math.max(reach.top, -top - height / 2);
    reach.bottom = Math.max(reach.bottom, bottom - height / 2);
  };
  for (const t of moments) {
    const frame = motionFrame(motion, t, context);
    if (frame.opacity >= SOLID) {
      const shownWidth = width * frame.scale * Math.abs(frame.scaleX), shownHeight = height * frame.scale * frame.scaleY;
      const y = frame.origin === "bottom" ? frame.y + height / 2 - shownHeight / 2 : frame.y;
      cover(frame.x - shownWidth / 2, frame.x + shownWidth / 2, y - shownHeight / 2, y + shownHeight / 2);
    }
    for (const copy of frame.copies) {
      if (copy.opacity < SOLID) continue;
      const shownWidth = width * copy.scale, shownHeight = height * copy.scale;
      cover(copy.x - (copy.clip === "right" ? 0 : shownWidth / 2), copy.x + (copy.clip === "left" ? 0 : shownWidth / 2), copy.y - shownHeight / 2, copy.y + shownHeight / 2);
    }
    for (const sheet of frame.sheets) if (sheet.opacity >= SOLID) cover(sheet.x - sheet.width / 2, sheet.x + sheet.width / 2, sheet.y, sheet.y + sheet.height);
  }
  return reach;
}

/** Footprints from where a walk began to where the walker is now, in stage pixels. */
export function walkTrail(rect: Rect, t: number, { seconds, arrives, side }: Pick<MotionContext, "seconds" | "arrives" | "side">) {
  const steps = Math.max(2, Math.round(seconds * 2.4));
  const start = arrives ? rect.width * 1.1 * side : 0, end = arrives ? 0 : rect.width * 1.1 * side;
  const shown = Math.floor(t * steps);
  return Array.from({ length: shown }, (_, index) => ({ x: rect.x + rect.width / 2 + start + (end - start) * ((index + .5) / steps),
    y: rect.y + rect.height * .9 + (index % 2 ? 1 : -1) * rect.height * .03, opacity: Math.max(.15, 1 - (shown - index) * .14) }));
}

interface TrendPoint extends Vec2 { at: number }
const point = (x: number, y: number, at: number): TrendPoint => ({ x, y, at });
/** Each line has a dip or two, as real series do. Shapes show a direction and are not data. `at` paces the line,
 * so a crash climbs slowly and falls fast. `turn` is where the good part ends.
 */
const TREND_SHAPES: Record<ObjectStoryTrendShape, { points: readonly TrendPoint[]; turn: number; impactAt?: number }> = {
  rise: { turn: 6, points: [point(.08, .86, 0), point(.28, .72, .22), point(.4, .77, .36), point(.6, .5, .6), point(.72, .55, .74), point(.92, .14, 1)] },
  fall: { turn: 0, points: [point(.08, .14, 0), point(.28, .28, .22), point(.4, .23, .36), point(.6, .5, .6), point(.72, .45, .74), point(.92, .86, 1)] },
  crash: { turn: 5, impactAt: .8, points: [point(.06, .8, 0), point(.2, .62, .18), point(.3, .67, .3), point(.46, .36, .48), point(.54, .4, .56), point(.66, .12, .7), point(.74, .9, .8), point(.84, .82, .9), point(.94, .88, 1)] },
  recover: { turn: 0, points: [point(.08, .2, 0), point(.3, .4, .2), point(.44, .84, .42), point(.56, .78, .55), point(.74, .42, .78), point(.92, .16, 1)] },
  spike: { turn: 4, points: [point(.08, .82, 0), point(.3, .78, .3), point(.42, .74, .42), point(.54, .12, .6), point(.66, .7, .78), point(.92, .76, 1)] },
  plateau: { turn: 6, points: [point(.08, .84, 0), point(.3, .5, .3), point(.46, .3, .5), point(.62, .28, .68), point(.78, .29, .84), point(.92, .28, 1)] },
};

export interface StoryTrendFrame { shape: ObjectStoryTrendShape; points: readonly Vec2[]; head: Vec2; turn: number; impact: number }
export function trendFrame(shape: ObjectStoryTrendShape, t: number): StoryTrendFrame {
  const { points: all, turn, impactAt } = TREND_SHAPES[shape];
  const points: Vec2[] = [all[0]];
  for (let index = 1; index < all.length; index++) {
    const from = all[index - 1], to = all[index];
    if (t >= to.at) { points.push(to); continue; }
    if (t > from.at) { const share = (t - from.at) / (to.at - from.at); points.push({ x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share }); }
    break;
  }
  return { shape, points, head: points[points.length - 1], turn, impact: impactAt !== undefined && t >= impactAt ? Math.max(0, 1 - (t - impactAt) / .14) : 0 };
}
