/** Choreography recipes reuse MG1 tracks; geometry/effects stay in their owners. */
import { AnimationGroup, EffectSequence, MotionRecipe } from "./director-authoring";
import type { DirectorAnimation, DirectorNode, DirectorTransformation } from "./director-types";
import type { AnimationTrack, MotionValue, Vec2 } from "./types";
import { materializePreset } from "./presets";

export interface RecipeTiming { id: string; durationFrames: number; at?: DirectorNode["at"] }
export interface AssemblySubject { targetId: string; offset: Vec2; rotation?: number }

function channel(id: string, targetId: string, property: string, valueType: AnimationTrack["valueType"], values: Array<[number, MotionValue]>, options: Partial<DirectorAnimation> = {}): DirectorAnimation {
  return { kind: "animation", id, track: { id, targetId, property, valueType, keyframes: values.map(([frame, value]) => ({ frame, value })) }, ...options };
}
function positiveDuration(value: number) {
  if (!Number.isSafeInteger(value) || value < 4) throw new Error("Choreography recipes need durationFrames >= 4; use a hold or cut for shorter actions.");
}

export const particleAssemblyRecipe = MotionRecipe<RecipeTiming & { subjects: AssemblySubject[]; staggerFrames?: number }>({
  id: "particle-object-assembly", version: 1,
  build({ id, at, durationFrames, subjects, staggerFrames = 2 }) {
    positiveDuration(durationFrames);
    return AnimationGroup({ id, at, mode: "stagger", intervalFrames: staggerFrames, children: subjects.map(({ targetId, offset, rotation = 0 }, i) => {
      const name = `${id}/${i}`;
      const fade = materializePreset({ preset: "fade-reveal", version: 1, targetId, startFrame: 0, timing: Math.max(1, Math.floor(durationFrames / 3)) });
      const fadeTrack = fade.nodes[0];
      if (fade.diagnostics.some(d => d.severity === "error") || fadeTrack?.kind !== "track") throw new Error(`Cannot build assembly fade for "${targetId}"; install the existing fade-reveal preset version 1.`);
      return AnimationGroup({ id: name, mode: "parallel", children: [
        channel(`${name}/position`, targetId, "offset", "vec2", [[0, offset], [durationFrames - 1, { x: 0, y: 0 }]], { intensityOrigin: { x: 0, y: 0 } }),
        channel(`${name}/rotation`, targetId, "rotation", "angle", [[0, rotation], [durationFrames - 1, 0]], { intensityOrigin: 0 }),
        { kind: "animation", id: `${name}/opacity`, track: { ...fadeTrack.track, easing: fadeTrack.track.easing ?? "linear" } },
      ] });
    }) });
  },
});

export interface DataFlowSubject {
  targetId: string;
  waypoints: Vec2[];
  /** Optional third spatial coordinate; existing 2D adapters can ignore it. */
  depth?: number[];
  /** Optional local MG1 frames, beginning at 0 and ending at durationFrames-1. */
  waypointFrames?: number[];
}
export const sequentialDataFlowRecipe = MotionRecipe<RecipeTiming & { packets: DataFlowSubject[]; staggerFrames?: number }>({
  id: "sequential-data-flow", version: 1,
  build({ id, at, durationFrames, packets, staggerFrames = 8 }) {
    positiveDuration(durationFrames);
    return AnimationGroup({ id, at, mode: "stagger", intervalFrames: staggerFrames, children: packets.map(({ targetId, waypoints, depth, waypointFrames }, i) => {
      if (waypoints.length < 2 || waypoints.length > durationFrames) throw new Error(`Packet "${targetId}" needs 2..durationFrames waypoints.`);
      if (depth && (depth.length !== waypoints.length || !depth.every(Number.isFinite))) throw new Error(`Packet "${targetId}" depth must supply one finite coordinate per waypoint.`);
      if (waypointFrames && (waypointFrames.length !== waypoints.length || waypointFrames[0] !== 0 || waypointFrames[waypointFrames.length - 1] !== durationFrames - 1 || waypointFrames.some((frame, index) => !Number.isSafeInteger(frame) || frame < 0 || (index > 0 && frame <= waypointFrames[index - 1])))) throw new Error(`Packet "${targetId}" waypointFrames must ascend from 0 to durationFrames-1 with one frame per waypoint.`);
      const time = (index: number) => waypointFrames?.[index] ?? Math.round(index / (waypoints.length - 1) * (durationFrames - 1));
      const name = `${id}/${i}`;
      return AnimationGroup({ id: name, mode: "parallel", children: [
        channel(`${name}/travel`, targetId, "offset", "vec2", waypoints.map((point, n) => [time(n), point]), { entry: "cut" }),
        ...(depth ? [channel(`${name}/depth`, targetId, "depth", "number", depth.map((value, n) => [time(n), value]), { entry: "cut" })] : []),
        channel(`${name}/visibility`, targetId, "opacity", "opacity", [[0, 0], [1, 1], [durationFrames - 2, 1], [durationFrames - 1, 0]]),
      ] });
    }) });
  },
});

export const diagramConstructionRecipe = MotionRecipe<RecipeTiming & { stages: string[][]; holdFrames?: number }>({
  id: "complex-diagram-construction", version: 1,
  build({ id, at, durationFrames, stages, holdFrames = 12 }) {
    positiveDuration(durationFrames);
    return EffectSequence({ id, at, overlapFrames: Math.floor(durationFrames / 4), children: stages.map((targets, i) => AnimationGroup({ id: `${id}/stage-${i}`, mode: "parallel", children: [
      ...targets.map((target, n) => channel(`${id}/${i}/${n}`, target, "emphasis", "number", [[0, 0], [Math.floor(durationFrames / 2), 1], [durationFrames - 1, 0]], { intensityOrigin: 0 })),
      { kind: "hold", id: `${id}/read-${i}`, at: durationFrames, durationFrames: holdFrames },
    ] })) });
  },
});

export const cinematicRevealRecipe = MotionRecipe<RecipeTiming & { targets: string[]; distance?: number }>({
  id: "cinematic-object-reveal", version: 1,
  build({ id, at, durationFrames, targets, distance = 28 }) {
    positiveDuration(durationFrames);
    return AnimationGroup({ id, at, mode: "stagger", intervalFrames: 3, direction: "from-center", children: targets.map((target, i) => AnimationGroup({ id: `${id}/${i}`, mode: "parallel", children: [
      channel(`${id}/${i}/lift`, target, "offset", "vec2", [[0, { x: 0, y: 0 }], [Math.floor(durationFrames / 2), { x: 0, y: -distance }], [durationFrames - 1, { x: 0, y: 0 }]], { intensityOrigin: { x: 0, y: 0 } }),
      channel(`${id}/${i}/scale`, target, "scale", "number", [[0, 1], [Math.floor(durationFrames / 2), 1.14], [durationFrames - 1, 1]], { intensityOrigin: 1 }),
    ] })) });
  },
});

export const synchronizedTransformationsRecipe = MotionRecipe<{ id: string; at?: DirectorNode["at"]; transformations: Omit<DirectorTransformation, "kind" | "id" | "at">[] }>({
  id: "synchronized-transformations", version: 1,
  build({ id, at, transformations }) {
    return AnimationGroup({ id, at, mode: "parallel", children: transformations.map((transformation, i) => ({ kind: "transformation", ...transformation, id: `${id}/${i}` })) });
  },
});

export const technicalExplanationRecipe = MotionRecipe<RecipeTiming & { targets: string[]; includeRecap?: boolean }>({
  id: "technical-concept-explanation", version: 1,
  build({ id, at, durationFrames, targets, includeRecap = true }) {
    positiveDuration(durationFrames);
    return EffectSequence({ id, at, children: [
      diagramConstructionRecipe.create({ id: `${id}/explain`, durationFrames, stages: targets.map(target => [target]), holdFrames: 18 }),
      { kind: "hold", id: `${id}/consider`, durationFrames: 30 },
      // Conditions are resolved by trusted authoring, never by eval in scene JSON.
      ...(includeRecap ? [cinematicRevealRecipe.create({ id: `${id}/recap`, durationFrames, targets, distance: 12 })] : []),
    ] });
  },
});

export const sceneContinuityRecipe = MotionRecipe<RecipeTiming & { fromScene: string; toScene: string; strategy?: DirectorTransformation["strategy"] }>({
  id: "scene-to-scene-continuity", version: 1,
  build({ id, at, durationFrames, fromScene, toScene, strategy = "shared-element" }) {
    positiveDuration(durationFrames);
    return { kind: "transformation", id, at, durationFrames, fromScene, toScene, strategy };
  },
});

export const DIRECTOR_RECIPES = [particleAssemblyRecipe, sequentialDataFlowRecipe, diagramConstructionRecipe, cinematicRevealRecipe, synchronizedTransformationsRecipe, technicalExplanationRecipe, sceneContinuityRecipe] as const;
