import { inspectCameraComposition } from "../visual/camera-composition";
import type { CameraCompositionContract } from "../visual/camera-composition";
import { validateMotionDirection } from "./director-validation";
import { scheduleDirection } from "./director-schedule";
import type { MotionDirection } from "./director-types";
import { AnimationGroup, motionTimelineGroup } from "./director-authoring";
import { createStoryboard, validateStoryboard } from "./storyboard";
import { compileCameraPoses, validateCameraPose } from "./camera-pose-3d";
import { inspectCameraConstraints } from "./camera-framing";
import type { CameraConstraintFailure } from "./camera-framing";
import { resolveCameraProfile } from "./camera-shot-recipes";
import { resolveCameraShotAspect, validateCameraSequence } from "./camera-sequence-validation";
import { cameraShotTargets, prepareCameraShot } from "./camera-shot-planning";
import { createCameraProjector, interpolateCameraPose, vector3 } from "./camera-spatial";
import { validCameraBounds, validCameraQuaternion, validCameraVector } from "./camera-targets";
import { stableStringify } from "./serialize";
import type { CameraDiagnostic, CameraSequenceSpec, CameraTargetRegistry, CameraTargetSample, CinematicCameraCompilation, CinematicCameraPose, CompiledCinematicCamera, FramingConstraint, PlannedCameraShot } from "./cinematic-camera-types";

export * from "./cinematic-camera-types";
export { validateCameraSequence } from "./camera-sequence-validation";

const CANDIDATES: readonly (readonly [number, number])[] = [[0, 1], [0, 1.2], [12, 1], [-12, 1], [24, 1.2], [-24, 1.2], [0, 1.5], [0, 2], [36, 1.5], [-36, 1.5], [48, 2], [-48, 2], [0, 2.5], [60, 2], [-60, 2], [90, 1.5], [-90, 1.5], [120, 2], [-120, 2], [180, 2], [0, 3], [45, 3], [-45, 3], [180, 3]];

/** Resolve -> plan -> project/constrain -> bake into MG1. No runtime solver. */
export function compileCinematicCamera(input: unknown, registry: CameraTargetRegistry, contract?: CameraCompositionContract): CinematicCameraCompilation {
  const validated = validateCameraSequence(input), diagnostics = [...validated.diagnostics];
  if (!validated.spec) return { ok: false, diagnostics };
  const spec = validated.spec, profile = resolveCameraProfile(spec.profile), cameraId = spec.cameraId ?? "camera3d";
  const error = (code: string, message: string, context: Partial<CameraDiagnostic> = {}) => diagnostics.push({ code, severity: "error", message, ...context });
  if (!registry?.revision?.trim() || !Array.isArray(registry.ids) || registry.ids.some(id => typeof id !== "string" || !id.trim()) || new Set(registry.ids).size !== registry.ids.length || !Array.isArray(registry.diagnostics) || typeof registry.sample !== "function") return { ok: false, diagnostics: [{ code: "camera-registry-invalid", severity: "error", message: "Supply a versioned CameraTargetRegistry with distinct non-empty IDs, diagnostics and an absolute-frame sample method." }] };
  diagnostics.push(...registry.diagnostics);

  // MotionDirector remains the scheduling authority. Holds here describe shot
  // occupancy, not a second timeline; actual camera channels are compiled below.
  const timingSource: MotionDirection = { schemaVersion: 1, id: `${spec.id}/timing`, title: spec.title, fps: spec.fps, durationFrames: spec.durationFrames, targets: [],
    children: [AnimationGroup({ id: `${spec.id}/sequence`, mode: "sequence", children: spec.shots.map(shot => ({ kind: "hold", id: shot.id, durationFrames: shot.durationFrames, at: shot.at, after: shot.after })) }),
      ...(spec.anchors ?? []).map(anchor => ({ kind: "cue" as const, id: anchor.id, at: anchor.at, payload: { kind: "event" as const, name: anchor.id } }))] };
  const timingDiagnostics = validateMotionDirection(timingSource);
  if (timingDiagnostics.some(d => d.severity === "error")) return { ok: false, diagnostics: [...diagnostics, ...timingDiagnostics] };
  const timing = scheduleDirection(timingSource, timingDiagnostics);
  if (timingDiagnostics.some(d => d.severity === "error")) return { ok: false, diagnostics: [...diagnostics, ...timingDiagnostics] };
  const timingById = new Map(timing.map(entry => [entry.node.id, entry.placement]));
  const shots: PlannedCameraShot[] = spec.shots.map(shot => ({ id: shot.id, startFrame: timingById.get(shot.id)!.startFrame, endFrame: timingById.get(shot.id)!.endFrame, spec: resolveCameraShotAspect(shot, spec.output) })).sort((a, b) => a.startFrame - b.startFrame);
  for (const shot of shots) for (const id of [...cameraShotTargets(shot.spec), ...(shot.spec.endTarget ? [shot.spec.endTarget] : [])]) {
    if (!registry.ids.includes(id)) error("camera-target-missing", `Shot "${shot.id}" references missing target "${id}". Register its semantic ID or correct the shot.`, { shotId: shot.id, targetIds: [id], frame: shot.startFrame });
  }
  const storyboard = createStoryboard({ id: spec.id, title: spec.title, fps: spec.fps, durationFrames: spec.durationFrames,
    shots: shots.map(shot => ({ id: shot.id, sceneRef: `${spec.id}/scene`, startFrame: shot.startFrame, durationFrames: shot.endFrame - shot.startFrame,
      claim: shot.spec.title ?? `${shot.spec.type}: ${cameraShotTargets(shot.spec).join(", ")}`,
      visualObjective: shot.spec.objective ?? `Film the declared subject using ${shot.spec.type} framing.`, focusTarget: cameraShotTargets(shot.spec)[0], onScreenLabels: cameraShotTargets(shot.spec), staticFallback: shot.spec.objective ?? `A ${shot.spec.type} view of ${cameraShotTargets(shot.spec).join(", ")}.` })) });
  diagnostics.push(...validateStoryboard(storyboard));
  if (diagnostics.some(d => d.severity === "error")) return { ok: false, diagnostics };

  const stats = { frames: spec.durationFrames, candidateEvaluations: 0, correctedFrames: 0, targetSamples: 0 };
  const cache = new Map<string, Map<number, CameraTargetSample>>();
  function read(id: string, frame: number): CameraTargetSample {
    const frames = cache.get(id) ?? new Map<number, CameraTargetSample>();
    cache.set(id, frames);
    const existing = frames.get(frame);
    if (existing) return existing;
    const sampled = registry.sample(id, frame);
    if (!sampled || sampled.id !== id || !validCameraBounds(sampled.bounds) || !validCameraVector(sampled.focus) || !validCameraQuaternion(sampled.orientation) || !validCameraVector(sampled.worldMatrix, 16) || !Number.isFinite(sampled.importance) || sampled.importance <= 0) throw new Error(`Target "${id}" returned invalid world bounds, transform, focus or importance at frame ${frame}. Fix its absolute-frame adapter.`);
    const snapshot = structuredClone(sampled); frames.set(frame, snapshot); stats.targetSamples++; return snapshot;
  }
  const poses: CinematicCameraPose[] = [], projector = createCameraProjector();
  let reportedHardFailure = false, truncatedDiagnostics = 0;
  const diagnosticRanges = new Map<string, CameraDiagnostic>();
  function report(diagnostic: CameraDiagnostic) {
    if (diagnostic.severity === "error") reportedHardFailure = true;
    const key = `${diagnostic.code}/${diagnostic.shotId}/${diagnostic.constraintId}/${diagnostic.targetIds?.join(",")}/${diagnostic.message}`;
    const prior = diagnosticRanges.get(key);
    if (prior && prior.endFrame === diagnostic.frame) { prior.endFrame = (diagnostic.frame ?? 0) + 1; return; }
    const next = { ...diagnostic, endFrame: diagnostic.frame === undefined ? undefined : diagnostic.frame + 1 };
    if (diagnostics.length < 256) diagnostics.push(next); else truncatedDiagnostics++;
    diagnosticRanges.set(key, next);
  }
  for (const placement of shots) {
    const context = { shotId: placement.id, targetIds: cameraShotTargets(placement.spec) };
    try {
      const prepared = prepareCameraShot(placement, spec, profile, read), shot = prepared.shot;
      const constraints: FramingConstraint[] = [...(shot.constraints ?? [])];
      if (!constraints.some(c => c.kind === "framing")) constraints.push({ id: "subject-safe-region", kind: "framing", strength: "hard", priority: 100, tolerance: 0.002 });
      if (!constraints.some(c => c.kind === "collision") && registry.obstacles) constraints.push({ id: "camera-clearance", kind: "collision", strength: "hard", priority: 100, clearance: 0.08 });
      if (!constraints.some(c => c.kind === "occlusion") && registry.visibility) constraints.push({ id: "subject-visibility", kind: "occlusion", strength: "soft", priority: 70, minimumVisible: 0.6 });
      if (constraints.some(c => c.kind === "occlusion" && c.strength === "hard") && registry.diagnostics.some(d => d.code === "camera-occlusion-unsupported-material")) {
        error("camera-occlusion-incomplete", "Hard occlusion cannot be certified with excluded transparent/deformed occluders. Supply a complete visibility adapter or explicitly use a soft constraint.", context); continue;
      }
      const priorities = [...new Set(constraints.filter(c => c.strength === "soft").map(c => c.priority))].sort((a, b) => b - a);
      const cost = (failures: CameraConstraintFailure[]) => priorities.map(priority => failures.filter(f => f.constraint.strength === "soft" && f.constraint.priority === priority).reduce((sum, f) => sum + f.amount, 0));
      const lowerCost = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) { if (Math.abs(a[i] - b[i]) > 1e-8) return a[i] < b[i]; } return false; };
      const transition = shot.transition, previous = poses[placement.startFrame - 1];
      if (transition?.kind === "continuous" && !previous) throw new Error("The first shot has no predecessor for a continuous handoff. Start it with a cut.");
      const transitionFrames = transition?.kind === "continuous" ? Math.min(placement.endFrame - placement.startFrame, transition.durationFrames ?? profile.transitionFrames) : 0;
      const stationaryC1 = previous && placement.startFrame > 1 && stableStringify(previous) === stableStringify(poses[placement.startFrame - 2]);
      if (transition?.kind === "continuous" && transition.continuity === "C1" && !stationaryC1) {
        error("camera-c1-unavailable", "C1 entry requires a stationary preceding hold. Add a hold, request C0, or author a cut; general angular/velocity matching is not inferred.", { ...context, frame: placement.startFrame }); continue;
      }
      const locked = !!(shot.path || shot.overrides?.position || shot.overrides?.endPosition || shot.overrides?.orientation || shot.overrides?.endOrientation || shot.overrides?.distance || shot.overrides?.orthographicScale) && !shot.overrides?.allowCorrections;
      if (constraints.some(c => c.kind === "collision" && c.strength === "hard") && !registry.obstacles) throw new Error("Hard collision constraints need a registry with declared obstacle bounds; provide its geometry adapter.");
      type CandidateFrame = { pose: CinematicCameraPose; failures: CameraConstraintFailure[] };
      let best: { frames: CandidateFrame[]; cost: number[]; hard: number; index: number } | undefined;
      const budget = locked ? 1 : spec.maxCandidates ?? 12;
      // Select one correction for the whole trajectory. Switching the winning
      // angle at individual frames would introduce accidental camera cuts.
      for (let index = 0; index < budget; index++) {
        const candidate: CandidateFrame[] = [], score = priorities.map(() => 0); let hard = 0;
        for (let frame = placement.startFrame; frame < placement.endFrame; frame++) {
          const local = frame - placement.startFrame, inTransition = !!previous && local < transitionFrames;
          const allowPartial = inTransition && transition?.kind === "continuous" && !!transition.allowPartialFraming;
          const obstacles = registry.obstacles?.(frame) ?? [];
          if (!Array.isArray(obstacles) || obstacles.some(obstacle => !obstacle.id?.trim() || !validCameraBounds(obstacle.bounds))) throw new Error(`Obstacle adapter returned invalid IDs/world boxes at frame ${frame}. Supply finite declared collision bounds.`);
          const [angle, distance] = CANDIDATES[index];
          const planned = prepared.sample(frame, angle, distance), targets = planned.targets;
          let pose = planned.pose;
          if (inTransition) {
            const c1 = transition?.kind === "continuous" && transition.continuity === "C1";
            const u = c1 ? Math.max(0, local - 1) / Math.max(1, transitionFrames - 2) : local / Math.max(1, transitionFrames - 1);
            const smooth = u * u * (3 - 2 * u);
            pose = interpolateCameraPose(previous!, pose, smooth);
          }
          validateCameraPose(pose, frame); registry.prepareFrame?.(frame);
          const failures = inspectCameraConstraints({ pose, targets, shot, aspect: spec.output.width / spec.output.height, margin: profile.margin, frame, registry, constraints, obstacles,
            previous: local === 0 ? transition?.kind === "continuous" ? previous : undefined : candidate[local - 1].pose, allowPartial, projector });
          stats.candidateEvaluations++;
          hard += failures.filter(f => f.constraint.strength === "hard").length;
          cost(failures).forEach((value, p) => { score[p] += value; });
          candidate.push({ pose, failures });
        }
        if (!best || hard < best.hard || (hard === best.hard && lowerCost(score, best.cost))) best = { frames: candidate, cost: score, hard, index };
        if (hard === 0 && score.every(value => value === 0)) break;
      }
      if (!best) throw new Error("No camera candidate was generated. Increase the bounded candidate budget.");
      if (best.index > 0) {
        stats.correctedFrames += best.frames.length;
        diagnostics.push({ code: "camera-shot-corrected", severity: "warning", message: `A fixed ${CANDIDATES[best.index][0]}° viewing offset and ${CANDIDATES[best.index][1]}× distance correction were selected for the entire shot to avoid framewise correction jumps.`, ...context, frame: placement.startFrame, endFrame: placement.endFrame });
      }
      for (let local = 0; local < best.frames.length; local++) {
        const frame = placement.startFrame + local, selected = best.frames[local];
        for (const failure of selected.failures) report({ code: failure.constraint.strength === "hard" ? "camera-constraint-unsatisfied" : "camera-soft-constraint", severity: failure.constraint.strength === "hard" ? "error" : "warning",
          message: `${failure.reason} ${failure.constraint.strength === "hard" ? "Modify the shot/geometry or explicitly change its constraint policy." : "Review this soft composition tradeoff."}`,
          ...context, targetIds: failure.targetId ? [failure.targetId] : context.targetIds, constraintId: failure.constraint.id, frame,
          attemptedCorrection: `Evaluated at most ${budget} deterministic distance/angle candidates${locked ? "; manual pose/path locked" : ""}.`, remainingLimitation: "Declared world boxes and sampled geometry only; no scene-wide pixel or continuous-time guarantee." });
        if (previous && local === 0 && transition?.kind === "continuous" && stableStringify(previous) !== stableStringify(selected.pose)) error("camera-continuity-broken", "Constraint correction broke the requested C0 boundary. Change the constraints or choose a cut.", { ...context, frame });
        if (local < transitionFrames && transition?.kind === "continuous" && transition.allowPartialFraming) report({ code: "camera-transition-partial-framing", severity: "warning", message: "Partial framing is explicitly allowed during this target handoff; full safe-region checks resume afterward.", ...context, frame });
        poses[frame] = selected.pose;
      }
    } catch (cause) { error("camera-shot-planning-failed", `Shot "${placement.id}" could not be planned: ${cause instanceof Error ? cause.message : String(cause)}`, { ...context, frame: placement.startFrame }); }
  }
  // Frame-domain speed/acceleration limits exclude intentional cuts.
  for (const shot of shots) for (let frame = shot.startFrame + 1; frame < shot.endFrame; frame++) {
    if (!poses[frame] || !poses[frame - 1]) continue;
    const velocity = vector3(poses[frame].position).sub(vector3(poses[frame - 1].position));
    if (profile.maxTravelPerFrame && velocity.length() > profile.maxTravelPerFrame) report({ code: "camera-travel-limit", severity: "error", message: "Camera travel exceeds maxTravelPerFrame. Lengthen the shot, reduce movement or adjust the explicit limit.", shotId: shot.id, frame });
    if (profile.maxAccelerationPerFrame && frame > shot.startFrame + 1 && poses[frame - 2]) {
      const previousVelocity = vector3(poses[frame - 1].position).sub(vector3(poses[frame - 2].position));
      if (velocity.sub(previousVelocity).length() > profile.maxAccelerationPerFrame) report({ code: "camera-acceleration-limit", severity: "error", message: "Camera acceleration exceeds maxAccelerationPerFrame. Adjust the trajectory/corrections or increase the explicit limit.", shotId: shot.id, frame });
    }
  }
  if (poses.length !== spec.durationFrames || Array.from({ length: spec.durationFrames }, (_, frame) => poses[frame]).some(pose => !pose)) error("camera-frame-coverage", "Not every composition frame has a valid planned camera pose. Correct the shot timing and planning diagnostics.");
  if (truncatedDiagnostics) diagnostics.push({ code: "camera-diagnostics-truncated", severity: reportedHardFailure ? "error" : "warning", message: `${truncatedDiagnostics} additional diagnostic ranges were omitted from the bounded report. Split the sequence or resolve earlier constraints to inspect them.` });
  if (reportedHardFailure || diagnostics.some(d => d.severity === "error")) return { ok: false, diagnostics };
  const timeline = compileCameraPoses({ id: spec.id, cameraId, fps: spec.fps, poses });
  timeline.cues = shots.map(shot => ({ id: `${spec.id}/shot/${shot.id}`, frame: shot.startFrame, kind: "camera-shot", targetId: cameraId }));
  const plan: CompiledCinematicCamera = { spec, timeline, shots, storyboard, diagnostics, targetRevision: registry.revision, stats };
  if (contract) diagnostics.push(...inspectCameraComposition(plan, registry, contract));
  return diagnostics.some(d => d.severity === "error") ? { ok: false, diagnostics } : { ok: true, diagnostics, plan };
}

/** Existing MotionDirector imports the same channels and camera-shot anchors. */
export function cameraSequenceGroup(plan: CompiledCinematicCamera, id = `${plan.spec.id}/camera`) {
  return AnimationGroup({ id, mode: "parallel", durationFrames: plan.timeline.durationFrames, children: [motionTimelineGroup(plan.timeline, { id: `${id}/tracks` }),
    ...(plan.timeline.cues ?? []).map(cue => ({ kind: "cue" as const, id: cue.id, at: cue.frame, targetId: cue.targetId, payload: { kind: "event" as const, name: cue.kind ?? "camera-shot" } }))] });
}
export function serializeCameraSequence(spec: CameraSequenceSpec, space = 2): string {
  const result = validateCameraSequence(spec);
  if (!result.spec) throw new Error(`Cannot save camera direction: ${result.diagnostics.map(d => `${d.path}: ${d.message}`).join("\n")}`);
  return stableStringify(result.spec, space);
}
export function parseCameraSequence(json: string): { ok: true; spec: CameraSequenceSpec; diagnostics: CameraDiagnostic[] } | { ok: false; diagnostics: CameraDiagnostic[] } {
  try { const result = validateCameraSequence(JSON.parse(json)); return result.spec ? { ok: true, spec: result.spec, diagnostics: result.diagnostics } : { ok: false, diagnostics: result.diagnostics }; }
  catch (cause) { return { ok: false, diagnostics: [{ code: "camera-json-invalid", severity: "error", message: `Cannot parse camera JSON: ${String(cause)}. Fix its syntax and retry.` }] }; }
}
