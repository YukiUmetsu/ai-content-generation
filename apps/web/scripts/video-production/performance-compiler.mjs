/** Compile a validated PerformanceIntent into Kumiki contracts: choreography, cues, camera, light.
 * Data only. No pose math beyond placing a held object in its starting hand.
 */
import { resolveActionFrames } from "./performance-intent.mjs";

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const rotateY = ([x, y, z], yaw) => [x * Math.cos(yaw) + z * Math.sin(yaw), y, -x * Math.sin(yaw) + z * Math.cos(yaw)];
const orient = ([x, y, z], yaw, pitch) => rotateY([x, y * Math.cos(pitch) - z * Math.sin(pitch), y * Math.sin(pitch) + z * Math.cos(pitch)], yaw);
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function startingObjects(intent, rigs, grips) {
  return intent.objects.map(object => {
    const { heldBy, ...rest } = object;
    const out = { ...rest, grips: grips[object.id] };
    if (!heldBy) return out;
    const actor = intent.cast.find(item => item.id === heldBy.actor);
    const hand = rigs[heldBy.actor].effectors[heldBy.effector];
    // `offset` bends the arm, so a held object has slack against walk bob.
    const world = add(actor.position, rotateY(add(hand.rest, heldBy.offset ?? [0, 0, 0]), actor.yaw));
    const grip = orient(grips[object.id][heldBy.grip], object.yaw ?? 0, object.pitch ?? 0);
    return { ...out, position: subtract(world, grip) };
  });
}

function compileOps(intent, frames, heldObjects) {
  const ops = [];
  for (const object of intent.objects) {
    if (!object.heldBy) continue;
    ops.push({ kind: "grasp", actor: object.heldBy.actor, effector: object.heldBy.effector, object: object.id,
      grip: object.heldBy.grip, startFrame: 0, contactFrame: 1 });
    heldObjects.add(object.id);
  }
  for (const action of intent.actions) {
    const { startFrame, endFrame } = frames[action.id];
    const common = { actor: action.actor, startFrame };
    if (action.verb === "enter")
      ops.push({ ...common, kind: "move", to: action.to, ...(action.toYaw === undefined ? {} : { toYaw: action.toYaw }), endFrame });
    else if (action.verb === "look-at")
      ops.push({ ...common, kind: "look", at: action.target, endFrame });
    else if (action.verb === "grasp")
      ops.push({ ...common, kind: "grasp", effector: action.effector, object: action.object, grip: action.grip, contactFrame: endFrame });
    else if (action.verb === "carry" || action.verb === "examine") {
      ops.push({ ...common, kind: "carry", effector: action.effector, object: action.object, to: action.to,
        ...(action.toPitch === undefined ? {} : { toPitch: action.toPitch }),
        ...(action.toYaw === undefined ? {} : { toYaw: action.toYaw }), endFrame });
      if (action.verb === "examine") ops.push({ ...common, kind: "look", at: { object: action.object }, endFrame: endFrame + (action.holdFrames ?? 0) });
    } else if (action.verb === "place")
      ops.push({ ...common, kind: "place", effector: action.effector, object: action.object, to: action.to, contactFrame: endFrame,
        ...(action.toPitch === undefined ? {} : { toPitch: action.toPitch }),
        ...(action.toYaw === undefined ? {} : { toYaw: action.toYaw }),
        ...(action.releaseHeight === undefined ? {} : { releaseHeight: action.releaseHeight, fallFrames: action.fallFrames })});
    else if (action.verb === "release")
      ops.push({ ...common, kind: "release", effector: action.effector, endFrame });
    else if (action.verb === "point-at")
      ops.push({ ...common, kind: "look", at: action.target, endFrame });
  }
  return ops;
}

function compileCues(intent, frames, speechWindows, lipSync) {
  const cues = new Map(intent.cast.map(actor => [actor.id, []]));
  const push = (actor, cue) => cues.get(actor).push({ id: `${actor}-${cues.get(actor).length}`, instanceId: actor, ...cue });
  for (const actor of intent.cast)
    if (actor.expression) push(actor.id, { kind: "expression", startFrame: 0, name: actor.expression });
  for (const action of intent.actions) {
    const { startFrame, endFrame } = frames[action.id];
    if (action.verb === "react" || action.verb === "examine") {
      if (action.expression) push(action.actor, { kind: "expression", startFrame, name: action.expression });
      if (action.gesture) push(action.actor, { kind: "action", startFrame, name: action.gesture });
    } else if (action.verb === "point-at" && action.gesture) push(action.actor, { kind: "action", startFrame, name: action.gesture });
    else if (action.verb === "speak") {
      const window = speechWindows[action.line];
      const mouth = lipSync?.[action.line];
      if (mouth) for (const cue of mouth) push(action.actor, { kind: "viseme", ...cue, precision: "phoneme" });
      else push(action.actor, { kind: "speech", startFrame: window.startFrame, endFrame: window.endFrame, precision: "approximate" });
    }
  }
  return cues;
}

const SHOT_TYPE = Object.freeze({ establish: "dolly", follow: "follow", "push-in": "dolly", "rack-focus": "inspect", insert: "inspect", "reveal-hold": "inspect" });

function compileCamera(intent, width, height, speechWindows, frames) {
  const start = (shot) => {
    const at = shot.from ?? { frame: 0 };
    if ("frame" in at) return at.frame;
    if ("speech" in at) return (at.edge === "end" ? speechWindows[at.speech].endFrame : speechWindows[at.speech].startFrame) + (at.offsetFrames ?? 0);
    return frames[at.after].endFrame + (at.offsetFrames ?? 0);
  };
  const ordered = [...intent.shots].map(shot => ({ shot, startFrame: start(shot) })).sort((a, b) => a.startFrame - b.startFrame);
  const shots = ordered.map(({ shot, startFrame }, index) => {
    const end = ordered[index + 1]?.startFrame ?? intent.durationFrames;
    return { id: shot.id, type: SHOT_TYPE[shot.kind], target: shot.subjects, durationFrames: end - startFrame,
      ...(shot.movement ? { movement: shot.movement } : {}), overrides: shot.camera,
      ...(index ? { transition: shot.transition ?? { kind: "cut" } } : {}), objective: shot.purpose };
  });
  return { schemaVersion: 1, id: "performance-camera", title: intent.objective, fps: intent.fps, durationFrames: intent.durationFrames,
    output: { width, height }, profile: "cinematic", shots };
}

function compileLights(intent, frames, speechWindows) {
  const lights = {};
  for (const key of intent.light ?? []) {
    const frame = "frame" in key.at ? key.at.frame : "after" in key.at ? frames[key.at.after].endFrame + (key.at.offsetFrames ?? 0)
      : speechWindows[key.at.speech].startFrame + (key.at.offsetFrames ?? 0);
    (lights[key.light] ??= []).push({ frame, level: key.level });
  }
  return lights;
}

/** Everything the offline bake needs. `rigs` come from describe-actor, `definitions` from each character.json. */
export function compilePerformance({ intent, rigs, definitions, grips, speechWindows, width, height, shotId, lipSync }) {
  const frames = resolveActionFrames(intent, { speechWindows });
  const held = new Set();
  const ops = compileOps(intent, frames, held);
  const cues = compileCues(intent, frames, speechWindows, lipSync);
  const interaction = {
    schemaVersion: 1, durationFrames: intent.durationFrames, fps: intent.fps, timing: intent.timing ?? "natural",
    ...(intent.maxHeadTurn === undefined ? {} : { maxHeadTurn: intent.maxHeadTurn }),
    actors: intent.cast.map(actor => ({ id: actor.id, position: actor.position, yaw: actor.yaw, height: rigs[actor.id].height_m,
      effectors: Object.fromEntries(Object.entries(rigs[actor.id].effectors).map(([name, hand]) =>
        [name, { rest: hand.rest, shoulder: hand.shoulder, reach: hand.reach_m }])) })),
    objects: startingObjects(intent, rigs, grips), ops,
  };
  return {
    id: shotId, width, height, interaction,
    actors: intent.cast.map(actor => ({ id: actor.id, definition: definitions[actor.id],
      instance: { instanceId: actor.id, characterId: definitions[actor.id].characterId, revision: definitions[actor.id].revision, seed: actor.seed ?? 11 },
      cues: cues.get(actor.id), headPart: actor.headPart ?? "head",
      limbs: Object.fromEntries(Object.entries(rigs[actor.id].effectors).map(([name, hand]) => [name, hand.part])),
      ...(actor.gait ? { gait: actor.gait } : {}) })),
    camera: compileCamera(intent, width, height, speechWindows, frames),
    targets: (intent.subjects ?? []).map(subject => ({ id: subject.id, frames: [{ frame: 0, bounds: subject.bounds }] })),
    lights: compileLights(intent, frames, speechWindows),
  };
}
