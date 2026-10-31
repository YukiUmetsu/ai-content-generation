import test from "node:test";
import assert from "node:assert/strict";
import { assetMotion, planScriptInteractions, visibleScriptPhrase } from "./script-interaction.mjs";

const narration = "File automation watches an inbox, files each invoice into the right folder, and leaves a receipt the bookkeeper can find.";

test("a long spoken scene changes interaction at least every ten seconds and not faster than five", () => {
  const frames = 45 * 30;
  const plan = planScriptInteractions({ text: narration, frames, fps: { num: 30, den: 1 }, intent: "general-flow" });
  assert.equal(plan.slots[0].startFrame, 0);
  assert.equal(plan.slots.at(-1).endFrame, frames);
  for (let index = 0; index < plan.slots.length; index += 1) {
    const slot = plan.slots[index];
    const length = slot.endFrame - slot.startFrame;
    assert.ok(length >= 5 * 30 && length <= 10 * 30, `slot ${index} is ${length} frames`);
    if (index > 0) assert.equal(slot.startFrame, plan.slots[index - 1].endFrame);
    if (slot.phrase) assert.ok(narration.toLocaleLowerCase().includes(slot.phrase.toLocaleLowerCase().replace(/…$/u, "")));
  }
  assert.ok(plan.slots.length >= 5);
  const filing = plan.slots.find(slot => /into the right folder/u.test(slot.phrase));
  const result = plan.slots.find(slot => /leaves a receipt/u.test(slot.phrase));
  assert.equal(filing.style, "journey");
  assert.equal(result.style, "synthesis");
  assert.notEqual(assetMotion(filing.style, 0).x, assetMotion(result.style, 0).x);
});

test("a comparison inside a process scene uses the contrast layout", () => {
  const text = "File automation watches an inbox, unlike a manual folder, and leaves a receipt the bookkeeper can find.";
  const plan = planScriptInteractions({ text, frames: 45 * 30, intent: "general-flow" });
  const contrast = plan.slots.find(slot => /unlike a manual folder/u.test(slot.phrase));
  assert.equal(contrast.style, "contrast");
  assert.equal(contrast.intent, "general-comparison");
});

test("two steps of the same process keep the journey layout", () => {
  const text = "The worker files each invoice into the right folder, then sends the receipt through the archive.";
  const plan = planScriptInteractions({ text, frames: 20 * 30, intent: "general-intro" });
  assert.ok(plan.slots.length >= 2);
  assert.equal(plan.slots[0].style, "journey");
  assert.equal(plan.slots[1].style, "journey");
});

test("a phrase stays hidden until every named diagram label is already on screen", () => {
  assert.equal(visibleScriptPhrase("Rent, Buy, Repair", ["Rent", "Buy", "Repair"], 2), "");
  assert.equal(visibleScriptPhrase("Rent, Buy, Repair", ["Rent", "Buy", "Repair"], 3), "Rent, Buy, Repair");
  assert.equal(visibleScriptPhrase("The router forwards a packet", ["Route"], 0), "The router forwards a packet");
});

test("an example, a cause, and a warning each choose their own picture", () => {
  const frames = 12 * 30;
  const example = planScriptInteractions({
    text: "For example the inbox keeps every invoice the bookkeeper still needs.",
    frames, intent: "general-flow",
  });
  const cause = planScriptInteractions({
    text: "The worker waits because the folder path is full right now.",
    frames, intent: "general-flow",
  });
  const warning = planScriptInteractions({
    text: "Avoid leaving the receipt where nobody can find it later.",
    frames, intent: "general-flow",
  });
  assert.equal(example.slots[0].style, "example");
  assert.equal(cause.slots[0].style, "cause");
  assert.equal(warning.slots[0].style, "warning");
  assert.notEqual(assetMotion("example", 0.2).y, assetMotion("cause", 0.2).y);
  assert.notEqual(assetMotion("cause", 0.2).x, assetMotion("warning", 0.2).x);
});

test("a list of diagram labels keeps the scene layout", () => {
  const plan = planScriptInteractions({ text: "Send, Route, Deliver", frames: 60, intent: "general-payoff" });
  assert.equal(plan.slots[0].style, "synthesis");
  assert.equal(plan.slots[0].intent, "general-payoff");
});

test("the first interaction keeps the scene's own Kumiki layout", () => {
  const plan = planScriptInteractions({ text: narration, frames: 60, intent: "general-flow" });
  assert.equal(plan.slots.length, 1);
  assert.equal(plan.slots[0].style, "journey");
  assert.equal(plan.slots[0].intent, "general-flow");
});
