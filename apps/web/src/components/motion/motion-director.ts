import { validateMotionDirection } from "./director-validation";
import { scheduleDirection } from "./director-schedule";
import { stableStringify } from "./serialize";
import { interpolateValue } from "./interpolate";
import { validateTimeline } from "./validate";
import { applyInterruption, evaluateTimeline, outputKey } from "./timeline";
import { createStoryboard, validateStoryboard } from "./storyboard";
import { compileVisualTransformation } from "./visual-transformation";
import type { AnimationTrack, Diagnostic, Keyframe, MotionNode, MotionTimeline } from "./types";
import { DIRECTOR_PERSONALITIES } from "./director-types";
import type { CompiledMotionDirector, DirectorCompilation, DirectorFrame, DirectorSource, MotionDirection } from "./director-types";

export * from "./director-types";
export { validateMotionDirection } from "./director-validation";

interface ChannelWriter { track: AnimationTrack; source: DirectorSource; entry: "continuous" | "cut" }

/** Pure compiler: data/decisions first, no renderer, playback or external effects. */
export function compileMotionDirector(input: unknown): DirectorCompilation {
  const diagnostics = validateMotionDirection(input);
  if (diagnostics.some(d => d.severity === "error")) return { ok: false, diagnostics };
  // Clone once so compilation and future caller mutations cannot rewrite this film.
  const source = JSON.parse(stableStringify(input)) as MotionDirection;
  const schedule = scheduleDirection(source, diagnostics);
  if (diagnostics.some(d => d.severity === "error")) return { ok: false, diagnostics };
  const pacing = source.profile?.pacing ?? 1;
  const durationFrames = Math.round(source.durationFrames * pacing);
  const timeline: MotionTimeline = { schemaVersion: 1, id: source.id, fps: source.fps, durationFrames, nodes: [], cues: [] };
  const scenes = source.scenes ?? [];
  const sceneById = new Map(scenes.map(scene => [scene.id, scene]));
  const targets = new Set([...source.targets, ...scenes.flatMap(scene => scene.elements.map(element => element.id))]);
  const writers = new Map<string, ChannelWriter[]>();
  const sourceMap: CompiledMotionDirector["sourceMap"] = Object.create(null);
  const cues: CompiledMotionDirector["cues"] = [];
  const shots: CompiledMotionDirector["shots"] = [];
  const transformations: CompiledMotionDirector["transformations"] = [];
  const error = (code: string, message: string, location?: Partial<Diagnostic>) => diagnostics.push({ code, severity: "error", message, ...location });
  const add = (writer: ChannelWriter) => {
    const key = outputKey(writer.track.targetId, writer.track.property);
    const channel = writers.get(key) ?? [];
    if (channel[0] && (channel[0].track.targetId !== writer.track.targetId || channel[0].track.property !== writer.track.property)) error("director-ambiguous-channel", `Target/property names collide at "${key}". Rename the dotted ID or property.`, { path: writer.source.path });
    channel.push(writer); writers.set(key, channel);
  };

  for (const { node, placement, authoredStartFrame } of schedule) {
    const { startFrame, endFrame, path } = placement;
    const location = { path, layerId: node.id, frame: startFrame };
    const sourceFor = (track: AnimationTrack): DirectorSource => ({ nodeId: node.id, targetId: track.targetId, property: track.property, startFrame, endFrame, path, recipe: placement.recipe });
    switch (node.kind) {
      case "animation": {
        if (!targets.has(node.track.targetId)) error("director-target-missing", `Animation "${node.id}" targets unknown "${node.track.targetId}". Add it to targets or a scene.`, location);
        const keyframes = node.track.keyframes.map(keyframe => ({ ...keyframe,
          frame: Math.round((authoredStartFrame + keyframe.frame) * pacing),
          value: node.intensityOrigin === undefined ? keyframe.value : interpolateValue(node.track.valueType, node.intensityOrigin, keyframe.value, source.profile?.intensity ?? 1, { angleMode: node.track.angleMode }),
          // Authored easing wins. Personality controls only unspecified easing.
          easing: keyframe.easing ?? node.track.easing ?? (node.track.valueType === "opacity" ? "ease-in-out" : DIRECTOR_PERSONALITIES[source.profile?.personality ?? "precise"]),
        }));
        if (keyframes.some((kf, i) => i > 0 && kf.frame <= keyframes[i - 1].frame)) error("director-pacing-keyframe-collision", `Pacing merges keyframes in "${node.id}". Space them farther apart or increase pacing.`, location);
        add({ track: { ...node.track, keyframes }, source: sourceFor(node.track), entry: node.entry ?? "continuous" });
        break;
      }
      case "cue":
        if (startFrame >= durationFrames) error("director-cue-out-of-range", `Cue "${node.id}" lands after the last frame. Move it inside the film.`, location);
        if (node.targetId && !targets.has(node.targetId)) error("director-target-missing", `Cue "${node.id}" has unknown target "${node.targetId}". Declare that target.`, location);
        cues.push({ ...node, frame: startFrame, durationFrames: endFrame - startFrame });
        timeline.cues!.push({ id: node.id, frame: startFrame, kind: node.payload.kind, targetId: node.targetId });
        break;
      case "shot":
        if (!sceneById.has(node.sceneRef)) error("director-scene-missing", `Shot "${node.id}" references unknown scene "${node.sceneRef}". Add that VisualScene to scenes.`, location);
        if (!targets.has(node.focusTarget)) error("director-target-missing", `Shot "${node.id}" focuses unknown target "${node.focusTarget}". Declare it.`, location);
        if (node.cameraRef && !targets.has(node.cameraRef)) error("director-camera-missing", `Shot "${node.id}" references unknown camera "${node.cameraRef}". Declare the camera target.`, location);
        shots.push({ id: node.id, sceneRef: node.sceneRef, startFrame, durationFrames: endFrame - startFrame,
          claim: node.claim, visualObjective: node.visualObjective, focusTarget: node.focusTarget, cameraRef: node.cameraRef,
          narrationCue: node.narrationCue, onScreenLabels: node.onScreenLabels, staticFallback: node.staticFallback });
        break;
      case "group":
        if (node.importedFps && node.importedFps.num * source.fps.den !== source.fps.num * node.importedFps.den) error("director-fps-mismatch", `Imported group "${node.id}" uses ${node.importedFps.num}/${node.importedFps.den} fps, but this direction uses ${source.fps.num}/${source.fps.den}. Re-author the imported tracks in the composition's frame domain.`, location);
        break;
      case "transformation": {
        const from = sceneById.get(node.fromScene), to = sceneById.get(node.toScene);
        if (!from || !to) { error("director-scene-missing", `Transformation "${node.id}" needs scenes "${node.fromScene}" and "${node.toScene}". Add both snapshots.`, location); break; }
        if (endFrame - startFrame < 2) { error("director-pacing-collapse", `Transformation "${node.id}" needs two frames after pacing. Increase its duration.`, location); break; }
        try {
          const compiled = compileVisualTransformation({ schemaVersion: 1, id: node.id, fps: source.fps, durationFrames,
            range: { startFrame, endFrame: endFrame - 1 }, from, to, mappings: node.mappings,
            strategy: node.strategy, fallback: node.fallback, easing: node.easing ?? DIRECTOR_PERSONALITIES[source.profile?.personality ?? "precise"], particles: node.particles });
          // Namespace VT's private channels, retaining the existing lane evaluator.
          const names = new Map(compiled.lanes.map(lane => [lane.id, `@director/${node.id}/${lane.id}`]));
          for (const lane of compiled.lanes) {
            lane.id = names.get(lane.id)!;
            if (lane.parentLaneId) lane.parentLaneId = names.get(lane.parentLaneId);
            if (targets.has(lane.id)) error("director-reserved-target", `Target "${lane.id}" is reserved for compiled transformation lanes; rename it.`, location);
          }
          const scopedTracks: MotionNode[] = [];
          for (const [index, trackNode] of compiled.timeline.nodes.entries()) {
            if (trackNode.kind !== "track") throw new Error("VT1 emitted a non-track channel; update the director adapter for this VT version.");
            const track = { ...trackNode.track, targetId: names.get(trackNode.track.targetId)! };
            trackNode.track = track;
            const id = `director-vt-${transformations.length}-${index}`;
            scopedTracks.push({ kind: "track", id, track: { ...track, id, keyframes: track.keyframes.map(k => ({ ...k, frame: k.frame - startFrame })) } });
            sourceMap[id] = [sourceFor(track)];
          }
          // VT never reads channels outside its handoff (it returns exact scene
          // snapshots). Gate private lanes using MG1's existing hold scope.
          timeline.nodes.push({ kind: "hold", id: `director-vt-${transformations.length}`, offset: startFrame, durationFrames: endFrame - startFrame,
            child: { kind: "parallel", id: `director-vt-${transformations.length}-lanes`, children: scopedTracks } });
          diagnostics.push(...compiled.diagnostics.map(d => ({ ...d, ...location })));
          transformations.push({ id: node.id, startFrame, endFrame, compiled });
        } catch (cause) { error("director-transformation-invalid", `Transformation "${node.id}" could not compile: ${cause instanceof Error ? cause.message : String(cause)}`, location); }
        break;
      }
    }
  }

  for (let a = 0; a < transformations.length; a++) for (let b = a + 1; b < transformations.length; b++) {
    const first = transformations[a], next = transformations[b];
    if (first.startFrame >= next.endFrame || next.startFrame >= first.endFrame) continue;
    const owned = new Set(first.compiled.lanes.map(lane => lane.semanticId));
    const shared = next.compiled.lanes.find(lane => owned.has(lane.semanticId));
    if (shared) error("director-transformation-ownership-conflict", `Transformations "${first.id}" and "${next.id}" both own semantic identity "${shared.semanticId}" during overlapping ranges. Separate the handoffs or use one VT1 mapping.`, { layerId: next.id, frame: Math.max(first.startFrame, next.startFrame) });
  }

  // MG1 clamps track endpoints. Join disjoint authors before evaluating; appending
  // all clips as tracks would create permanent writers, even before their starts.
  let channelIndex = 0;
  for (const [key, channel] of writers) {
    channel.sort((a, b) => a.source.startFrame - b.source.startFrame);
    const first = channel[0];
    const id = `director-channel-${channelIndex++}`;
    if (channel.some(writer => writer.track.valueType !== first.track.valueType || (writer.track.angleMode ?? "shortest") !== (first.track.angleMode ?? "shortest"))) error("director-channel-type-conflict", `Writers of "${key}" disagree on valueType or angleMode. Use one channel contract.`, { path: first.source.path });
    let priorEnd = -1;
    const overlaps = channel.some(writer => { const overlap = writer.source.startFrame < priorEnd; priorEnd = Math.max(priorEnd, writer.source.endFrame); return overlap; });
    if (overlaps) {
      const policy = first.track.conflict;
      if (!policy || policy === "error" || channel.some(w => w.track.conflict !== policy)) {
        error("director-property-conflict", `Overlapping writers of "${key}": ${channel.map(w => w.source.nodeId).join(", ")}. Separate their ranges or give every writer the same explicit priority/additive policy.`, { path: first.source.path });
        continue;
      }
      if (policy === "additive" && !["number", "opacity", "length", "angle", "vec2", "transform"].includes(first.track.valueType)) error("director-additive-type", `"${key}" cannot blend ${first.track.valueType} additively. Use separate channels or explicit priority.`, { path: first.source.path });
      for (let a = 0; a < channel.length; a++) for (let b = a + 1; b < channel.length; b++) {
        if (policy === "priority" && channel[b].source.startFrame < channel[a].source.endFrame && (channel[a].track.priority ?? 0) === (channel[b].track.priority ?? 0)) error("director-priority-tie", `"${key}" has overlapping equal priorities in ${channel[a].source.nodeId} and ${channel[b].source.nodeId}. Set distinct priorities.`, { path: channel[b].source.path });
      }
      channel.forEach((writer, i) => {
        const nodeId = `${id}-${i}`;
        // Explicit overlapping writers have clip-local lifetimes. Endpoint state
        // after the final clip must be authored separately if needed.
        timeline.nodes.push({ kind: "hold", id: `${nodeId}-scope`, offset: writer.source.startFrame,
          durationFrames: writer.source.endFrame - writer.source.startFrame,
          child: { kind: "track", id: nodeId, track: { ...writer.track, id: nodeId,
            keyframes: writer.track.keyframes.map(k => ({ ...k, frame: k.frame - writer.source.startFrame })) } } });
        sourceMap[nodeId] = [writer.source];
      });
      continue;
    }
    const keyframes: Keyframe[] = [];
    for (const writer of channel) {
      const previous = keyframes[keyframes.length - 1], incoming = writer.track.keyframes[0];
      if (previous) {
        if (writer.entry !== "cut" && stableStringify(previous.value) !== stableStringify(incoming.value)) error("director-discontinuous-channel", `"${key}" jumps entering "${writer.source.nodeId}" at ${incoming.frame}. Start from the preceding endpoint or declare entry: 'cut'.`, { path: writer.source.path, frame: incoming.frame });
        if (incoming.frame > previous.frame + 1) keyframes.push({ frame: incoming.frame - 1, value: previous.value, easing: "linear" });
      }
      keyframes.push(...writer.track.keyframes.map((kf, i) => ({ ...kf, easing: i === 0 && previous ? "step-end" : kf.easing })));
    }
    timeline.nodes.push({ kind: "track", id, track: { ...first.track, id, keyframes, conflict: "error" } });
    sourceMap[id] = channel.map(writer => writer.source);
  }
  cues.sort((a, b) => a.frame - b.frame || a.id.localeCompare(b.id));
  shots.sort((a, b) => a.startFrame - b.startFrame);
  const cueById = new Map(cues.map(cue => [cue.id, cue]));
  for (const shot of shots) if (shot.cameraRef && ![...writers.values()].some(channel => channel[0].track.targetId === shot.cameraRef)) error("director-camera-unanimated", `Shot "${shot.id}" references camera "${shot.cameraRef}", but no MG1 camera channels were supplied. Import an existing camera timeline.`, { layerId: shot.id, frame: shot.startFrame });
  for (const cue of cues) if (cue.payload.kind === "speech-marker") {
    const narration = cueById.get(cue.payload.narrationId);
    if (!narration || narration.payload.kind !== "narration") error("director-narration-missing", `Speech marker "${cue.id}" needs narration cue "${cue.payload.narrationId}". Declare that narration.`, { layerId: cue.id, frame: cue.frame });
    else if (cue.frame < narration.frame || cue.frame >= narration.frame + narration.durationFrames) error("director-speech-marker-outside", `Speech marker "${cue.id}" is outside narration "${narration.id}". Fix the marker time or narration duration.`, { layerId: cue.id, frame: cue.frame });
  }
  const storyboard = createStoryboard({ id: source.id, title: source.title, fps: source.fps, durationFrames, shots, cues: timeline.cues });
  if (shots.length) diagnostics.push(...validateStoryboard(storyboard, { knownCues: cues.map(c => c.id) }));
  // Cues have already been consumed by the compile-time DAG/audio metadata;
  // the flattened MG1 graph intentionally no longer has cue offsets.
  diagnostics.push(...validateTimeline(timeline).filter(d => d.code !== "motion-cue-unused"));
  if (diagnostics.some(d => d.severity === "error")) return { ok: false, diagnostics };
  return { ok: true, diagnostics, director: { source, timeline, scenes, storyboard, shots, cues,
    schedule: schedule.map(item => item.placement), transformations, sourceMap, diagnostics } };
}

/** One MG1 evaluation for the whole composition. No frame-history caches. */
export function evaluateMotionDirector(director: CompiledMotionDirector, frame: number): DirectorFrame {
  if (!Number.isSafeInteger(frame)) throw new Error(`MotionDirector needs an integer frame; received ${frame}. Quantize the caller's clock first.`);
  const evaluation = evaluateTimeline(director.timeline, frame);
  return { director, evaluation, shot: director.shots.find(shot => evaluation.frame >= shot.startFrame && evaluation.frame < shot.startFrame + shot.durationFrames) };
}

/** Pure cue query. The caller decides seek/replay/deduplication and audio policy. */
export function directorCuesBetween<K extends CompiledMotionDirector["cues"][number]["payload"]["kind"]>(director: CompiledMotionDirector, fromExclusive: number, toInclusive: number, kind?: K) {
  return director.cues.filter(cue => cue.frame > fromExclusive && cue.frame <= toInclusive && (!kind || cue.payload.kind === kind));
}

export function serializeMotionDirection(source: MotionDirection, space = 2): string {
  const result = compileMotionDirector(source);
  if (!result.ok) throw new Error(`Cannot save choreography: ${result.diagnostics.filter(d => d.severity === "error").map(d => `${d.path ?? d.code}: ${d.message}`).join("\n")}`);
  return stableStringify(result.director.source, space);
}
export function parseMotionDirection(json: string): DirectorCompilation {
  try { return compileMotionDirector(JSON.parse(json)); }
  catch (cause) { return { ok: false, diagnostics: [{ code: "director-json-invalid", severity: "error", message: `Cannot read choreography JSON: ${String(cause)}. Correct its syntax and retry.` }] }; }
}

/** C0 retarget using MG1's interruption mechanism. Earlier keys remain seekable.
 * Returns a runtime timeline; save it with serializeTimeline, not the old recipe.
 * Reported velocity can seed a caller's spring; C1 continuity is not implied.
 */
export function interruptDirectorChannel(director: CompiledMotionDirector, request: { frame: number; targetId: string; property: string; keyframes: Keyframe[] }) {
  const { frame, targetId, property } = request;
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= director.timeline.durationFrames) throw new Error("Interruption frame must be an integer inside the film; seek into range first.");
  const matches = director.timeline.nodes.filter((node): node is Extract<MotionNode, { kind: "track" }> => node.kind === "track" && node.track.targetId === targetId && node.track.property === property);
  if (matches.length !== 1) throw new Error(`Cannot retarget "${targetId}.${property}" as one channel. Select an unblended compiled channel; overlapping priority/additive scopes need an authored replacement.`);
  const node = matches[0];
  if (request.keyframes.length === 0 || request.keyframes.some((kf, i) => !Number.isSafeInteger(kf.frame) || kf.frame <= frame || kf.frame >= director.timeline.durationFrames || (i > 0 && kf.frame <= request.keyframes[i - 1].frame))) throw new Error("Retarget keyframes must be strictly ascending global frames after the interruption and before the film ends.");
  const track = { ...node.track, keyframes: request.keyframes };
  const invalid = validateTimeline({ ...director.timeline, nodes: [{ ...node, track }] }).filter(d => d.severity === "error");
  if (invalid.length) throw new Error(`Invalid retarget: ${invalid.map(d => d.message).join(" ")}`);
  const interruption = applyInterruption(director.timeline, { frame, targetId, property, nodeId: node.id, track });
  const seeded = interruption.timeline.nodes.find(n => n.id === `${track.id}-interrupt-${frame}`);
  if (!seeded || seeded.kind !== "track") throw new Error("MG1 did not return the interrupted channel. Check compatibility with the installed motion-track version.");
  // Inserting a seed into an old eased segment would change its earlier curve.
  // Preserve the entire original curve behind a history scope, and activate the
  // MG1-seeded replacement exactly at the event. Both scopes are ordinary MG1.
  const history: MotionNode[] = frame === 0 ? [] : [{ kind: "hold", id: `${node.id}-history-scope-${frame}`, durationFrames: frame,
    child: { ...node, id: `${node.id}-history-${frame}`, track: { ...node.track, id: `${node.id}-history-${frame}`, conflict: "priority", priority: 0 } } }];
  const future: MotionNode = { kind: "hold", id: `${node.id}-future-scope-${frame}`, offset: frame, durationFrames: director.timeline.durationFrames - frame,
    child: { ...seeded, track: { ...seeded.track, conflict: "priority", priority: 1, keyframes: seeded.track.keyframes.map(k => ({ ...k, frame: k.frame - frame })) } } };
  return { ...interruption, timeline: { ...interruption.timeline, nodes: interruption.timeline.nodes.flatMap(n => n.id === seeded.id ? [...history, future] : [n]) } };
}
