import assert from "node:assert/strict";
import { test } from "node:test";
import { compilePerformance } from "./performance-compiler.mjs";
import { visemeCues, visemeFor } from "./shot-lipsync.mjs";

const fps = { num: 30, den: 1 };
const rig = { height_m: .2, effectors: { hand: { rest: [.1, .05, .02], shoulder: [.1, .12, .02], reach_m: .1, part: "arm" } } };
const definition = { characterId: "c", revision: "r1", actions: { nod: { phases: [{ frames: 10 }] } } };
const base = (over = {}) => ({
  version: 1, objective: "o", visualChange: "v", durationFrames: 120, fps, timing: "natural",
  cast: [{ id: "a", position: [0, 0, 0], yaw: 0, gait: { left: "l", right: "r", stride: .05, lift: 10, swing: 5, bob: 2 } }],
  objects: [{ id: "page", heldBy: { actor: "a", effector: "hand", grip: "edge", offset: [0, .01, 0] }, pitch: 0 }],
  actions: [{ id: "says", actor: "a", verb: "speak", line: "one", at: { speech: "one" } },
    { id: "go", actor: "a", verb: "enter", to: [.1, 0, 0], at: { speech: "one", offsetFrames: -2 }, durationFrames: 30 }],
  shots: [{ id: "s", kind: "establish", subjects: ["a"], from: { frame: 0 }, camera: { position: [0, .1, 1] } }], ...over,
});
const compile = (over, extra) => compilePerformance({ intent: base(over), rigs: { a: rig }, definitions: { a: definition }, grips: { page: { edge: [0, 0, 0] } },
  speechWindows: { one: { startFrame: 10, endFrame: 40 } }, width: 1920, height: 1080, shotId: "s", ...extra });

test("objects that start in a hand sit on that hand", () => {
  const { interaction } = compile();
  for (const [got, want] of interaction.objects[0].position.map((value, index) => [value, [.1, .06, .02][index]]))
    assert.ok(Math.abs(got - want) < 1e-12);
  assert.equal(interaction.ops[0].kind, "grasp");
  assert.equal(interaction.ops[0].contactFrame, 1);
});
test("each actor's gait and limbs reach the bake, and no walk action is cued", () => {
  const [actor] = compile().actors;
  assert.equal(actor.gait.stride, .05);
  assert.deepEqual(actor.limbs, { hand: "arm" });
  assert.equal(actor.cues.filter(cue => cue.kind === "action").length, 0);
});
test("a drawing fade on an actor reaches the bake", () => {
  const [actor] = compile({ cast: [{ ...base().cast[0], variantFadeFrames: 4 }] }).actors;
  assert.equal(actor.variantFadeFrames, 4);
});
test("spoken lines fall back to the labelled approximate cycle without mouth data", () => {
  const speech = compile().actors[0].cues.filter(cue => cue.kind === "speech");
  assert.deepEqual(speech.map(cue => [cue.startFrame, cue.endFrame, cue.precision]), [[10, 40, "approximate"]]);
});
test("real mouth cues replace the approximate cycle", () => {
  const { actors } = compile({}, { lipSync: { one: [{ startFrame: 12, endFrame: 15, viseme: "A" }] } });
  assert.equal(actors[0].cues.filter(cue => cue.kind === "speech").length, 0);
  assert.deepEqual(actors[0].cues.filter(cue => cue.kind === "viseme").map(cue => cue.viseme), ["A"]);
});
test("camera subjects and head limits pass through", () => {
  const request = compile({ maxHeadTurn: 12, subjects: [{ id: "box", bounds: { min: [0, 0, 0], max: [1, 1, 1] } }] });
  assert.equal(request.interaction.maxHeadTurn, 12);
  assert.equal(request.targets[0].id, "box");
});
test("a rig maps mouth shapes to its own visemes", () => {
  assert.equal(visemeFor("A", ["closed", "open"]), "closed");
  assert.equal(visemeFor("A", ["A", "O", "M"]), "M");
  assert.equal(visemeFor("E", ["A", "O", "M"]), "O");
  assert.equal(visemeFor("X", ["A"]), null);
});
test("mouth timing stays inside its spoken line", () => {
  const cues = visemeCues([{ start: 0, end: .1, value: "X" }, { start: .1, end: .5, value: "D" }, { start: .5, end: 9, value: "E" }],
    { startFrame: 100, endFrame: 112 }, fps, ["A", "O", "M"]);
  assert.deepEqual(cues, [{ startFrame: 103, endFrame: 112, viseme: "A" }]);
});
