import test from "node:test";
import assert from "node:assert/strict";
import { applyWindowLayouts, planExplainerLayouts, titleNamesNarration } from "./script-layout-plan.mjs";
import { planScriptInteractions } from "./script-interaction.mjs";

const narration = "File automation watches an inbox, then sends the receipt through the archive.";
const fps = { num: 30, den: 1 };

function plan() {
  return {
    kind: "general-explainer-visual-plan",
    manifest: { fps },
    chapters: [{
      id: "beat-01", intent: "general-flow", narration,
      startFrame: 0, endFrame: 20 * 30,
    }],
  };
}

function reply(body) {
  return {
    ok: true,
    text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }),
  };
}

function directed(slot) {
  const words = slot.phrase.match(/\p{L}[\p{L}\p{N}'-]*/gu) ?? [];
  const noun = words.find(word => word.length >= 4) ?? words[0];
  return { phrase: slot.phrase, action: "ring", objects: [noun], line: words.slice(0, 4).join(" ") };
}

const localModel = async () => ({ model: "installed-local", endpoint: "http://127.0.0.1:11434/v1/chat/completions" });
const passthrough = async (action) => {
  const response = await action();
  return { response, raw: await response.text() };
};

test("a local model names the copied objects, one existing action, and a short line", async () => {
  const rules = planScriptInteractions({ text: narration, frames: 20 * 30, fps, intent: "general-flow" });
  const sections = rules.slots.map(directed);
  let called = 0;
  const result = await planExplainerLayouts(plan(), {
    readModel: localModel,
    transport: async (url, request) => {
      called += 1;
      assert.equal(url, "http://127.0.0.1:11434/v1/chat/completions");
      const body = JSON.parse(request.body);
      assert.equal(body.model, "installed-local");
      assert.equal(body.messages[1].content.includes("https://"), false);
      assert.equal(body.messages[1].content.includes("photoTitle"), false);
      return reply({ sections });
    },
    inference: passthrough,
  });
  assert.equal(called, 1);
  assert.equal(result.chapters[0].interactions.source, "model");
  assert.equal(result.chapters[0].interactions.slots[0].style, "example");
  assert.equal(result.chapters[0].interactions.slots[0].action, "ring");
  assert.equal(result.chapters[0].interactions.slots[0].intent, "general-intro");
  assert.deepEqual(result.chapters[0].interactions.slots[0].objects, [sections[0].objects[0]]);
  assert.equal(result.chapters[0].interactions.slots[0].line, sections[0].line);
  assert.equal(result.chapters[0].interactions.slots[0].phrase, rules.slots[0].phrase);
  assert.deepEqual(result.chapters[0].interactions.slots.map(slot => [slot.startFrame, slot.endFrame]),
    rules.slots.map(slot => [slot.startFrame, slot.endFrame]));
});

test("an unknown action, a changed phrase, a new noun, or a cloud endpoint keeps the sentence rules", async () => {
  const rules = planScriptInteractions({ text: narration, frames: 20 * 30, fps, intent: "general-flow" });
  const unknown = await planExplainerLayouts(plan(), {
    readModel: localModel,
    transport: async () => reply({ sections: rules.slots.map(slot => ({ ...directed(slot), action: "orbit" })) }),
    inference: passthrough,
  });
  assert.equal(unknown.chapters[0].interactions.source, "rules");
  assert.equal(unknown.chapters[0].interactions.slots[0].style, rules.slots[0].style);
  assert.equal(unknown.chapters[0].interactions.slots[0].line, undefined);
  const changed = applyWindowLayouts(rules, rules.slots.map(slot => ({ ...directed(slot), phrase: "a different sentence" })));
  assert.equal(changed.source, "rules");
  const invented = applyWindowLayouts(rules, rules.slots.map(slot => ({ ...directed(slot), objects: ["glacier"] })));
  assert.equal(invented.source, "rules");
  const numbered = applyWindowLayouts(rules, rules.slots.map(slot => ({ ...directed(slot), line: "costs 40 percent more" })));
  assert.equal(numbered.source, "rules");
  let called = 0;
  const cloud = await planExplainerLayouts(plan(), {
    readModel: async () => ({ model: "cloud", endpoint: "https://api.openai.com/v1/chat/completions" }),
    transport: async () => { called += 1; throw Error("should not send"); },
  });
  assert.equal(called, 0);
  assert.equal(cloud.chapters[0].interactions, undefined);
});

test("a photo stays only when its title names the narration and the model keeps it", async () => {
  const rules = planScriptInteractions({ text: narration, frames: 20 * 30, fps, intent: "general-flow" });
  const photo = { assetType: "photo", url: "/__video_media/" + "a".repeat(64) + ".jpg", title: "Mountain glacier" };
  const withPhoto = () => ({ ...plan(), chapters: [{ ...plan().chapters[0], visual: { stockMedia: photo } }] });
  const dropped = await planExplainerLayouts(withPhoto(), {
    readModel: localModel,
    transport: async (_url, request) => {
      const body = JSON.parse(request.body);
      assert.equal(JSON.parse(body.messages[1].content).photoTitle, "Mountain glacier");
      return reply({ sections: rules.slots.map(directed), photo: "drop" });
    },
    inference: passthrough,
  });
  assert.equal(dropped.chapters[0].interactions.source, "model");
  assert.equal(dropped.chapters[0].visual.stockMedia, undefined);
  const unrelated = await planExplainerLayouts(withPhoto(), {
    readModel: localModel,
    transport: async () => reply({ sections: rules.slots.map(directed), photo: "keep" }),
    inference: passthrough,
  });
  assert.equal(unrelated.chapters[0].interactions.source, "rules");
  assert.equal(unrelated.chapters[0].visual.stockMedia, photo);
  assert.equal(titleNamesNarration("Inbox of paper receipts", narration), true);
  const kept = await planExplainerLayouts({
    ...plan(), chapters: [{ ...plan().chapters[0], visual: { stockMedia: { ...photo, title: "Inbox of paper receipts" } } }],
  }, {
    readModel: localModel,
    transport: async () => reply({ sections: rules.slots.map(directed), photo: "keep" }),
    inference: passthrough,
  });
  assert.equal(kept.chapters[0].interactions.source, "model");
  assert.equal(kept.chapters[0].visual.stockMedia.title, "Inbox of paper receipts");
});

test("a missing model and a non-explainer plan do not call the provider", async () => {
  let called = 0;
  const transport = async () => { called += 1; throw Error("should not send"); };
  const missing = await planExplainerLayouts(plan(), {
    readModel: async () => ({ model: "", endpoint: "http://127.0.0.1:11434/v1/chat/completions" }),
    transport,
  });
  const other = await planExplainerLayouts({ kind: "house-math-visual-plan", chapters: [] }, {
    readModel: async () => { called += 1; return { model: "installed-local", endpoint: "http://127.0.0.1:11434/v1/chat/completions" }; },
    transport,
  });
  assert.equal(called, 0);
  assert.equal(missing.chapters[0].interactions, undefined);
  assert.equal(other.kind, "house-math-visual-plan");
});
