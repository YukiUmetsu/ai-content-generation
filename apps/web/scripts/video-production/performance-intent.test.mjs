import assert from "node:assert/strict";
import { test } from "node:test";
import { validatePerformanceIntent, resolveActionFrames } from "./performance-intent.mjs";

const context = () => ({
  knownClaimIds: new Set(["claim-1"]),
  cast: { pip: { effectors: ["hand.right"], expressions: ["default", "happy"], actions: ["walk", "wave"] },
    quill: { effectors: ["hand.right"], expressions: ["default", "skeptical"], actions: ["nod"] } },
  objects: { invoice: { grips: ["bottom"] }, receipt: { grips: ["top"] } },
  speechWindows: { "pip-line": { startFrame: 20, endFrame: 80 }, "quill-line": { startFrame: 100, endFrame: 170 } },
  allowedNumbers: ["120", "100", "20"],
});
const intent = (actions, over = {}) => ({
  version: 1, objective: "Show that the two totals differ.", visualChange: "Two documents become one comparison.",
  claimIds: ["claim-1"], durationFrames: 300, fps: { num: 30, den: 1 }, timing: "natural",
  cast: [{ id: "pip", position: [0, 0, 0], yaw: 0 }, { id: "quill", position: [.2, 0, 0], yaw: 0 }],
  objects: [{ id: "invoice", position: [0, 0, 0] }, { id: "receipt", position: [.1, 0, 0] }],
  actions, shots: [{ id: "wide", kind: "establish", subjects: ["pip"], from: { frame: 0 }, camera: {} }], ...over,
});
const grasp = { id: "take", actor: "pip", verb: "grasp", effector: "hand.right", object: "invoice", grip: "bottom", at: { frame: 5 }, durationFrames: 20 };
const place = { id: "put", actor: "pip", verb: "place", effector: "hand.right", object: "invoice", to: [.1, 0, .1], at: { after: "take", offsetFrames: 5 }, durationFrames: 20 };
const codes = (candidate, ctx = context()) => validatePerformanceIntent(candidate, ctx).findings.map(item => item.code);

test("accepts a coherent intent", () => assert.deepEqual(codes(intent([grasp, place])), []));
test("names an unknown actor, object, grip and effector", () => {
  assert.ok(codes(intent([{ ...grasp, actor: "ghost" }])).includes("unknown-actor"));
  assert.ok(codes(intent([{ ...grasp, object: "ghost" }])).includes("unknown-object"));
  assert.ok(codes(intent([{ ...grasp, grip: "ghost" }])).includes("unknown-grip"));
  assert.ok(codes(intent([{ ...grasp, effector: "ghost" }])).includes("unknown-effector"));
});
test("rejects a verb outside the closed list", () => assert.ok(codes(intent([{ ...grasp, verb: "teleport" }])).includes("unknown-verb")));
test("rejects place before grasp", () => assert.ok(codes(intent([{ ...place, at: { frame: 1 } }])).includes("not-held")));
test("rejects a second actor grabbing a held object", () => {
  const other = { ...grasp, id: "steal", actor: "quill", at: { after: "take" } };
  assert.ok(codes(intent([grasp, other])).includes("already-held"));
});
test("rejects an unknown expression or gesture", () => {
  assert.ok(codes(intent([{ id: "r", actor: "pip", verb: "react", expression: "furious", at: { frame: 1 } }])).includes("unknown-expression"));
  assert.ok(codes(intent([{ id: "r", actor: "pip", verb: "react", gesture: "dab", at: { frame: 1 } }])).includes("unknown-gesture"));
});
test("rejects an anchor to a missing line or action", () => {
  assert.ok(codes(intent([{ ...grasp, at: { speech: "nope" } }])).includes("unknown-anchor"));
  assert.ok(codes(intent([{ ...grasp, at: { after: "nope" } }])).includes("unknown-anchor"));
});
test("rejects a cycle of anchors", () => {
  const a = { ...grasp, id: "a", at: { after: "b" } }, b = { ...place, id: "b", at: { after: "a" } };
  assert.ok(codes(intent([a, b])).includes("anchor-cycle"));
});
test("rejects an action past the end of the shot", () => {
  assert.ok(codes(intent([{ ...grasp, at: { frame: 295 } }])).includes("frame-range"));
});
test("rejects a number that is not in the source", () => {
  assert.ok(codes(intent([grasp], { objective: "Show the 999 dollar gap." })).includes("invented-number"));
});
test("rejects an unknown claim and a missing subject on a shot", () => {
  assert.ok(codes(intent([grasp], { claimIds: ["nope"] })).includes("unknown-claim"));
  assert.ok(codes(intent([grasp], { shots: [{ id: "s", kind: "establish", subjects: ["ghost"], from: { frame: 0 }, camera: {} }] })).includes("unknown-subject"));
});
test("rejects a shot kind outside the closed list", () => {
  assert.ok(codes(intent([grasp], { shots: [{ id: "s", kind: "drone", subjects: ["pip"], from: { frame: 0 }, camera: {} }] })).includes("unknown-shot"));
});
test("rejects an actor that lacks an effector a held object needs", () => {
  const ctx = context();
  ctx.cast.pip.effectors = [];
  assert.ok(codes(intent([grasp]), ctx).includes("unknown-effector"));
});
test("anchors follow a spoken line, so new narration retimes the action", () => {
  const action = { ...grasp, at: { speech: "quill-line", edge: "start", offsetFrames: -6 } };
  const before = resolveActionFrames(intent([action]), context());
  const ctx = context();
  ctx.speechWindows["quill-line"] = { startFrame: 140, endFrame: 200 };
  const after = resolveActionFrames(intent([action]), ctx);
  assert.equal(before.take.startFrame, 94);
  assert.equal(after.take.startFrame, 134);
});
test("accepts a job with no performance field", () => assert.equal(validatePerformanceIntent(undefined, context()).ok, true));
