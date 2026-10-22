import { staggerOrder } from "./stagger";
import type { Diagnostic } from "./types";
import type { DirectorNode, DirectorScheduleEntry, MotionDirection } from "./director-types";

export interface ScheduledDirection { node: DirectorNode; placement: DirectorScheduleEntry; authoredStartFrame: number }
interface IndexedNode { node: DirectorNode; parent?: string; previous?: string; stagger: number; overlap: number; path: string }
interface Vertex { dependencies: string[]; value: (read: (id: string) => number) => number }

/** Resolve the start/end DAG once. Iterative topology handles long sequences. */
export function scheduleDirection(source: MotionDirection, diagnostics: Diagnostic[]): ScheduledDirection[] {
  const indexed = new Map<string, IndexedNode>();
  const vertices = new Map<string, Vertex>();
  const start = (id: string) => `start:${id}`;
  const end = (id: string) => `end:${id}`;
  function index(nodes: DirectorNode[], parent?: DirectorNode & { children: DirectorNode[] }, path = "children") {
    const ranks = parent?.kind === "group" && parent.mode === "stagger" ? staggerOrder(nodes.length, parent.direction ?? "forward") : [];
    for (const [i, node] of nodes.entries()) {
      const inheritedRecipe = parent ? indexed.get(parent.id)?.node.recipe : undefined;
      const authoredNode = node.recipe || !inheritedRecipe ? node : { ...node, recipe: inheritedRecipe };
      indexed.set(node.id, { node: authoredNode, parent: parent?.id, previous: parent?.kind === "group" && parent.mode === "sequence" && i > 0 ? nodes[i - 1].id : undefined,
        overlap: parent?.kind === "group" ? parent.overlapFrames ?? 0 : 0,
        stagger: (ranks[i] ?? 0) * (parent?.kind === "group" ? parent.intervalFrames ?? 0 : 0), path: `${path}[${i}]` });
      if (node.kind === "group" || node.kind === "shot") index(node.children, node, `${path}[${i}].children`);
    }
  }
  index(source.children);
  const report = (entry: IndexedNode, code: string, message: string, frame?: number) => diagnostics.push({ code, severity: "error", message, path: entry.path, layerId: entry.node.id, frame });
  for (const entry of indexed.values()) {
    const { node, parent, previous, stagger, overlap } = entry;
    const baseKey = parent ? start(parent) : undefined;
    let placementKeys: string[];
    let placement: Vertex["value"];
    if (typeof node.at === "object") {
      const ref = (node.at.edge === "end" ? end : start)(node.at.ref);
      placementKeys = [ref];
      const offset = node.at.offsetFrames ?? 0;
      placement = read => read(ref) + offset;
    } else if (node.at !== undefined) {
      placementKeys = baseKey ? [baseKey] : [];
      const local = node.at;
      placement = read => (baseKey ? read(baseKey) : 0) + local;
    } else if (previous) {
      placementKeys = [end(previous)];
      placement = read => read(end(previous)) - overlap;
    } else {
      placementKeys = baseKey ? [baseKey] : [];
      placement = read => (baseKey ? read(baseKey) : 0) + stagger;
    }
    const dependencies = (node.after ?? []).map(end);
    vertices.set(start(node.id), { dependencies: [...new Set([...placementKeys, ...dependencies])], value: read => {
      const requested = placement(read);
      const earliest = Math.max(0, ...dependencies.map(read));
      if (node.at !== undefined && requested < earliest) report(entry, "director-impossible-dependency", `"${node.id}" starts at ${requested}, before dependencies finish at ${earliest}. Move at or remove the conflicting deadline.`, requested);
      return node.at === undefined ? Math.max(requested, earliest) : requested;
    } });
    if (node.kind === "group" && node.durationFrames === undefined) {
      const childEnds = node.children.map(child => end(child.id));
      vertices.set(end(node.id), { dependencies: [start(node.id), ...childEnds], value: read => Math.max(read(start(node.id)), ...childEnds.map(read)) });
    } else {
      const duration = node.kind === "animation" ? node.track.keyframes[node.track.keyframes.length - 1].frame + 1 : node.durationFrames ?? 0;
      vertices.set(end(node.id), { dependencies: [start(node.id)], value: read => read(start(node.id)) + duration });
    }
  }
  const remaining = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const [id, vertex] of vertices) {
    remaining.set(id, vertex.dependencies.length);
    for (const dependency of vertex.dependencies) {
      if (!vertices.has(dependency)) {
        const entry = indexed.get(id.slice(id.indexOf(":") + 1))!;
        report(entry, "director-reference-missing", `"${entry.node.id}" references unknown ID "${dependency.slice(dependency.indexOf(":") + 1)}". Declare that node or cue, or correct the reference.`);
      }
      const list = dependents.get(dependency) ?? [];
      list.push(id); dependents.set(dependency, list);
    }
  }
  if (diagnostics.some(d => d.severity === "error")) return [];
  const ready = [...vertices.keys()].filter(id => remaining.get(id) === 0);
  const values = new Map<string, number>();
  for (let i = 0; i < ready.length; i++) {
    const id = ready[i];
    values.set(id, vertices.get(id)!.value(key => values.get(key)!));
    for (const next of dependents.get(id) ?? []) {
      remaining.set(next, remaining.get(next)! - 1);
      if (remaining.get(next) === 0) ready.push(next);
    }
  }
  if (values.size !== vertices.size) {
    const blocked = [...vertices.keys()].filter(id => !values.has(id));
    diagnostics.push({ code: "director-dependency-cycle", severity: "error", path: "children", message: `Unresolvable timing cycle (including its dependents): ${blocked.slice(0, 20).join(", ")}. Remove a relative/after dependency; a group's end cannot determine a child's start.` });
    return [];
  }
  const pacing = source.profile?.pacing ?? 1;
  const scale = (frame: number) => Math.round(frame * pacing);
  return [...indexed.values()].map(entry => {
    const a = values.get(start(entry.node.id))!, b = values.get(end(entry.node.id))!;
    const parentStart = entry.parent ? values.get(start(entry.parent))! : 0;
    const parentEnd = entry.parent ? values.get(end(entry.parent))! : source.durationFrames;
    if (a < parentStart || b > parentEnd || a < 0 || b > source.durationFrames || !Number.isSafeInteger(a) || !Number.isSafeInteger(b)) report(entry, "director-impossible-range", `"${entry.node.id}" occupies [${a}, ${b}) outside its container [${parentStart}, ${parentEnd}). Extend the container or move/shorten the node.`, a);
    if (entry.previous && entry.node.at === undefined && entry.overlap > values.get(end(entry.previous))! - values.get(start(entry.previous))!) report(entry, "director-overlap-too-long", `Sequence overlap exceeds the preceding node's duration; reduce overlapFrames.`, a);
    if (b > a && scale(b) <= scale(a)) report(entry, "director-pacing-collapse", `Pacing collapses "${entry.node.id}" to zero frames. Increase its duration or pacing.`, a);
    return { node: entry.node, authoredStartFrame: a, placement: { id: entry.node.id, kind: entry.node.kind, startFrame: scale(a), endFrame: scale(b), parentId: entry.parent, path: entry.path, recipe: entry.node.recipe } };
  });
}
