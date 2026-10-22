import { stableStringify } from "./serialize";
import { staggerStartFrames } from "./stagger";
import { nodeDuration } from "./timeline";
import { validateTimeline } from "./validate";
import type { MotionNode, MotionTimeline } from "./types";
import type { DirectorGroup, DirectorNode, DirectorProfile, DirectorShot, MotionDirection } from "./director-types";

/** Semantic builders return ordinary data, never mounted timing components. */
export function AnimationGroup(options: Omit<DirectorGroup, "kind">): DirectorGroup { return { kind: "group", ...options }; }
export function CinematicShot(options: Omit<DirectorShot, "kind">): DirectorShot { return { kind: "shot", ...options }; }
export function EffectSequence(options: Omit<DirectorGroup, "kind" | "mode">): DirectorGroup { return AnimationGroup({ ...options, mode: "sequence" }); }

/** Parameterized authoring boundary. Only the expanded result is serialized. */
export function MotionRecipe<P extends object>(definition: { id: string; version: number; build: (parameters: P) => DirectorNode }) {
  if (!definition.id.trim() || !Number.isSafeInteger(definition.version) || definition.version < 1) throw new Error("MotionRecipe needs a non-empty ID and a positive integer version.");
  return {
    id: definition.id, version: definition.version,
    create(parameters: P): DirectorNode {
      // Validate portability before invoking the trusted, local builder.
      const snapshot = JSON.parse(stableStringify(parameters)) as P;
      const node = definition.build(snapshot);
      const scalars = Object.fromEntries(Object.entries(snapshot).filter(([, value]) => ["number", "string", "boolean"].includes(typeof value))) as Record<string, number | string | boolean>;
      return { ...node, recipe: { id: definition.id, version: definition.version, parameters: scalars } };
    },
  };
}

/** Separate authored arrangements; choosing portrait never stretches landscape. */
export function ScenePreset<A extends string>(options: { id: string; variants: Record<A, { width: number; height: number; direction: MotionDirection }> }) {
  for (const [name, variant] of Object.entries(options.variants) as [A, { width: number; height: number; direction: MotionDirection }][]) {
    if (![variant.width, variant.height].every(v => Number.isFinite(v) && v > 0)) throw new Error(`ScenePreset "${options.id}" variant "${name}" needs positive dimensions.`);
  }
  return {
    id: options.id,
    create(aspect: A, profile?: DirectorProfile) {
      const variant = options.variants[aspect];
      if (!variant) throw new Error(`ScenePreset "${options.id}" has no "${aspect}" arrangement. Choose ${Object.keys(options.variants).join(", ")}.`);
      return { width: variant.width, height: variant.height, direction: { ...JSON.parse(stableStringify(variant.direction)) as MotionDirection, ...(profile ? { profile: { ...variant.direction.profile, ...profile } } : {}) } };
    },
  };
}

/** Import existing MG1 camera/preset/effect tracks without another evaluator.
 * Time-wrapping repeat and clipping hold scopes require their own sampled/baked
 * channels and are rejected rather than silently changing their semantics.
 */
export function motionTimelineGroup(timeline: MotionTimeline, options: { id: string; at?: DirectorGroup["at"] }): DirectorGroup {
  const invalid = validateTimeline(timeline).filter(d => d.severity === "error");
  if (invalid.length) throw new Error(`Cannot import MG1 timeline "${timeline.id}": ${invalid.map(d => d.message).join(" ")}`);
  function convert(node: MotionNode, path: string, extraOffset = 0): DirectorNode {
    const offset = typeof node.offset === "object" ? timeline.cues?.find(c => c.id === (node.offset as { cue: string }).cue)?.frame : node.offset ?? 0;
    if (offset === undefined) throw new Error(`Cannot import "${path}": cue offset is unresolved. Declare it in the source timeline.`);
    const base = { id: path, at: offset + extraOffset };
    switch (node.kind) {
      case "track": return { ...base, kind: "animation", track: { ...node.track, id: path, easing: node.track.easing ?? "linear" } };
      case "parallel": return AnimationGroup({ ...base, mode: "parallel", children: node.children.map((child, i) => convert(child, `${path}/${i}`)) });
      case "sequence": {
        let cursor = 0;
        const context = { fps: timeline.fps, cueFrames: Object.fromEntries((timeline.cues ?? []).map(c => [c.id, c.frame])), diagnostics: [] };
        const children = node.children.map((child, i) => {
          const converted = convert(child, `${path}/${i}`, cursor);
          const offset = typeof child.offset === "object" ? context.cueFrames[child.offset.cue] : child.offset ?? 0;
          cursor += offset + nodeDuration(child, context);
          return converted;
        });
        return AnimationGroup({ ...base, mode: "parallel", children });
      }
      case "stagger": {
        const starts = staggerStartFrames(node.items, node.intervalFrames, node.direction, node.groupSpacingFrames);
        return AnimationGroup({ ...base, mode: "parallel", children: node.items.map((item, i) => convert(item.node, `${path}/${i}`, starts[i])) });
      }
      case "hold":
        if (!node.child) return { ...base, kind: "hold", durationFrames: node.durationFrames };
        throw new Error(`Cannot import clipping hold "${path}" as persistent channels. Pass its authored tracks with explicit lifetime/blend, or keep the scope in MG1.`);
      case "repeat": throw new Error(`Cannot import wrapping repeat "${path}" as persistent channels. Bake its repetitions or keep this scope in MG1.`);
    }
  }
  if (timeline.constraints?.length || timeline.transforms?.length) throw new Error(`Timeline "${timeline.id}" has constraints/transforms. Keep those at its existing MG1 renderer boundary; this import accepts camera/preset channels only.`);
  return AnimationGroup({ id: options.id, at: options.at, mode: "parallel", durationFrames: timeline.durationFrames, importedFps: { ...timeline.fps },
    children: timeline.nodes.map((node, i) => convert(node, `${options.id}/${i}`)) });
}
