import assert from "node:assert/strict";
import { test } from "node:test";
import { proposePerformance, ruleDirector } from "./performance-director.mjs";
import { resolveActionFrames, validatePerformanceIntent } from "./performance-intent.mjs";

const speechWindows = { a: { startFrame: 12, endFrame: 120 }, b: { startFrame: 130, endFrame: 210 }, c: { startFrame: 216, endFrame: 270 } };
const brief = (over = {}) => ({
  objective: "Show that two totals differ.", visualChange: "Two documents become one comparison.", claimIds: [],
  durationFrames: 300, fps: { num: 30, den: 1 }, timing: "natural",
  cast: [
    { id: "pip", start: [-.6, 0, .1], mark: [-.2, 0, .1], yaw: .3, gait: { left: "l", right: "r", stride: .07, lift: 30, swing: 8, bob: 6 } },
    { id: "quill", start: [.12, 0, .04], yaw: -.3 },
  ],
  objects: [
    { id: "invoice", holder: { actor: "pip", effector: "hand.right", grip: "left" }, lay: { to: [-.06, 0, .11], releaseHeight: .03 }, material: "paper", bendable: true },
    { id: "receipt", holder: { actor: "quill", effector: "hand.left", grip: "top" }, examine: { to: [0, .1, .13], toPitch: 1.1 }, lay: { to: [.05, 0, .11], releaseHeight: .03 }, material: "paper", bendable: true },
  ],
  lines: [{ id: "a", actor: "pip", about: "invoice" }, { id: "b", actor: "quill", about: "receipt" }, { id: "c", actor: "pip", gesture: "ask" }],
  shots: { wide: { camera: { position: [0, .1, .9] }, subjects: ["quill"] }, reveal: { camera: { position: [0, .4, .3] }, subjects: ["totals"], bounds: { min: [0, 0, 0], max: [1, 1, 1] } } },
  light: { dim: "window", lift: "bounce" }, ...over,
});
const context = (intent) => ({ speechWindows, knownClaimIds: new Set(intent.claimIds),
  cast: { pip: { effectors: ["hand.right"], expressions: ["focused", "skeptical"], actions: ["ask"] }, quill: { effectors: ["hand.left"], expressions: ["focused", "skeptical"], actions: [] } },
  objects: { invoice: { grips: ["left"] }, receipt: { grips: ["top"] } } });
/** Objects that start in a hand count as held. */
const started = (intent) => ({ ...intent, actions: [...intent.objects.filter(item => item.heldBy).map(item => ({ id: `start-${item.id}`, actor: item.heldBy.actor, verb: "grasp",
  effector: item.heldBy.effector, object: item.id, grip: item.heldBy.grip, at: { frame: 0 }, durationFrames: 1 })), ...intent.actions] });

test("the rule director writes a valid intent", () => {
  const intent = ruleDirector(brief());
  assert.deepEqual(validatePerformanceIntent(started(intent), context(intent)).findings, []);
});
test("repeat runs match exactly", () => assert.deepEqual(ruleDirector(brief()), ruleDirector(brief())));
test("an actor who enters arrives before laying down what they carry", () => {
  const intent = ruleDirector(brief()), frames = resolveActionFrames(intent, { speechWindows });
  assert.ok(frames["pip-enters"].endFrame <= frames["invoice-laid"].startFrame);
});
test("an object is read during the line about it, then laid down", () => {
  const intent = ruleDirector(brief()), frames = resolveActionFrames(intent, { speechWindows });
  assert.ok(frames["receipt-examined"].startFrame < speechWindows.b.startFrame);
  assert.ok(frames["receipt-laid"].startFrame > frames["receipt-examined"].endFrame);
});
test("the reveal starts as the last object lands, and the light follows it", () => {
  const intent = ruleDirector(brief()), reveal = intent.shots.find(shot => shot.id === "reveal");
  assert.equal(reveal.from.after, "receipt-laid");
  assert.ok(intent.light.some(key => key.light === "window" && key.level < 1));
});
test("each spoken line gets a speak action and a gesture when asked", () => {
  const intent = ruleDirector(brief());
  assert.equal(intent.actions.filter(action => action.verb === "speak").length, 3);
  assert.ok(intent.actions.some(action => action.verb === "react" && action.gesture === "ask"));
});
test("different scenes come from data with no scene code", () => {
  const other = ruleDirector(brief({ objects: [{ id: "receipt", holder: { actor: "quill", effector: "hand.left", grip: "top" }, lay: { to: [.05, 0, .11], releaseHeight: .03 } }],
    lines: [{ id: "b", actor: "quill", about: "receipt" }] }));
  assert.equal(other.objects.length, 1);
  assert.equal(other.actions.filter(action => action.verb === "speak").length, 1);
});
test("an actor who stays put lays an object down during the line about it", () => {
  const still = brief({ cast: [{ id: "pip", start: [-.2, 0, .1], yaw: .3 }, brief().cast[1]] });
  const frames = resolveActionFrames(ruleDirector(still), { speechWindows });
  assert.equal(frames["invoice-laid"].startFrame, speechWindows.a.startFrame + 6);
});
test("actors with a clear mark step out before a reveal, the last to lay an object after laying it", () => {
  const marked = brief({ cast: [{ ...brief().cast[0], clear: [-.3, 0, .1] }, { ...brief().cast[1], clear: [.25, 0, .04] }] });
  const intent = ruleDirector(marked), frames = resolveActionFrames(intent, { speechWindows });
  assert.equal(frames["pip-clears"].startFrame, frames["receipt-laid"].endFrame - 10, "leaves as the camera starts to move");
  assert.equal(frames["quill-clears"].startFrame, frames["receipt-laid"].endFrame + 2);
  assert.deepEqual(validatePerformanceIntent(started(intent), context(intent)).findings, []);
  assert.equal(ruleDirector(brief()).actions.some(action => action.id.endsWith("-clears")), false);
});
test("listeners look at whoever is speaking", () => {
  const listening = ruleDirector(brief()).actions.filter(action => action.verb === "look-at");
  assert.deepEqual(listening.map(action => [action.actor, action.target.actor]), [["quill", "pip"], ["pip", "quill"], ["quill", "pip"]]);
});
const reply = (body) => async () => JSON.stringify(body);
test("a usable model reply changes the performance choices", async () => {
  const result = await proposePerformance(brief(), context(ruleDirector(brief())), { complete: reply({ timing: "restrained", reactions: { b: { expression: "skeptical" } } }) });
  assert.equal(result.source, "model");
  assert.equal(result.intent.timing, "restrained");
  assert.ok(result.intent.actions.some(action => action.verb === "react" && action.expression === "skeptical"));
});
test("a bad model reply is reported and the rules stand", async () => {
  const result = await proposePerformance(brief(), context(ruleDirector(brief())), { complete: reply({ reactions: { b: { expression: "furious" } } }) });
  assert.equal(result.source, "rules");
  assert.ok(result.findings.some(item => item.code === "unknown-expression"));
});
test("broken JSON and a failed model are reported, not hidden", async () => {
  const broken = await proposePerformance(brief(), context(ruleDirector(brief())), { complete: async () => "not json" });
  assert.equal(broken.source, "rules");
  assert.equal(broken.findings[0].code, "model-unusable");
  const down = await proposePerformance(brief(), context(ruleDirector(brief())), { complete: async () => { throw Error("offline"); } });
  assert.equal(down.findings[0].code, "model-unusable");
});
test("a model cannot add fields, numbers or lines", async () => {
  const result = await proposePerformance(brief(), context(ruleDirector(brief())), { complete: reply({ objective: "Save 999 dollars", actions: [{ verb: "teleport" }], reactions: { nope: { expression: "focused" } } }) });
  assert.equal(result.intent.objective, brief().objective);
  assert.ok(!result.intent.actions.some(action => action.verb === "teleport"));
  assert.ok(result.findings.some(item => item.code === "unknown-line"));
});
test("with no model the rules are used and that is stated", async () => {
  const result = await proposePerformance(brief(), context(ruleDirector(brief())));
  assert.equal(result.source, "rules");
  assert.deepEqual(result.findings, []);
});
