import assert from "node:assert/strict";
import test from "node:test";
import { generateTopicDraft, validateTopicBrief, localChatEndpoint } from "./topic-generator.mjs";
import { parseVideoProductionJob } from "./job.mjs";

const request = {
  topic: "How does a refrigerator stay cold?", viewerQuestion: "Where does the heat go?", audience: "Curious homeowners",
  notes: "Illustrative cycle, not a claim about a particular refrigerant or appliance.",
  mode: "smoke", locale: "en-US", endpoint: "http://127.0.0.1:11434/v1/chat/completions", model: "installed-local-model",
};

const response = {
  title: "Where Does a Refrigerator's Heat Go?",
  viewerQuestion: "How does a refrigerator move heat?",
  packaging: [
    { strategy: "mystery", title: "Where Does the Heat Go?", thumbnail: "Fridge heat escaping behind it", hook: "The cold comes from heat going elsewhere." },
    { strategy: "mechanism", title: "The Cooling Loop", thumbnail: "Colored flow arrows around a coil", hook: "Follow the loop." },
    { strategy: "comparison", title: "Inside vs Outside a Fridge", thumbnail: "Two temperature regions separated by a wall", hook: "Two places, one exchange." },
  ],
  beats: [
    { narration: "A refrigerator feels cold inside because energy moves out of its interior. Follow a simplified cycle to see where the heat goes.", intent: "general-intro", headline: "THE HEAT HAS TO GO SOMEWHERE", subhead: "A simple cooling model", emphasis: "THE QUESTION", items: ["Inside", "Heat transfer", "Outside"] },
    { narration: "The moving fluid collects thermal energy inside the refrigerator and passes it to equipment that moves this energy outward in a repeating cycle.", intent: "general-flow", headline: "A LOOP THAT MOVES HEAT", subhead: "Conceptual steps, not a machine specification", emphasis: "THE PROCESS", items: ["Collect heat", "Move heat", "Release heat"] },
    { narration: "The inside space is cooler than the room, so the refrigerator must use energy to keep moving heat outward. This is a conceptual sketch.", intent: "general-comparison", headline: "TWO SIDES OF THE APPLIANCE", subhead: "Inside and outside", emphasis: "THE COMPARISON", items: ["Cool interior", "Warmer room"] },
    { narration: "The key is not creating cold from nothing. It is moving thermal energy to another place using a loop powered by electricity.", intent: "general-payoff", headline: "HEAT MOVES OUT", subhead: "The simple idea", emphasis: "THE ANSWER", items: ["Collect", "Transfer", "Release"] },
  ],
};

const fakeTransport = async (_url, init) => ({
  ok: true, status: 200,
  text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] }),
});

test("topic brief and endpoint reject remote hosts, credentials, redirects, oversized inputs", () => {
  assert.equal(validateTopicBrief(request).topic, request.topic);
  for (const bad of ["https://example.com/v1/chat/completions", "http://192.168.1.1:8080/v1/chat/completions", "http://user:pass@localhost:11434/v1/chat/completions", "http://localhost:11434/evil"]) {
    assert.throws(() => localChatEndpoint(bad), /loopback|local|endpoint/i);
  }
  assert.throws(() => validateTopicBrief({ ...request, topic: "x".repeat(500) }), /topic/i);
  assert.throws(() => validateTopicBrief({ ...request, mode: "portrait" }), /mode/i);
});

test("local model produces validated general video job with three distinct packaging strategies, no approval or fabricated sources", async () => {
  let called = 0;
  const draft = await generateTopicDraft(request, { transport: async (url, init) => { called++; assert.equal(url, request.endpoint); assert.equal(init.redirect, "error"); return fakeTransport(url, init); } });
  assert.equal(called, 1);
  assert.equal(draft.job.visualFamily, "general-explainer-v1");
  assert.equal(draft.job.beats.length, 4);
  assert.equal(draft.packaging.length, 3);
  assert.equal(new Set(draft.packaging.map((p) => p.strategy)).size, 3);
  assert.equal(draft.job.beats.at(-1).visualIntent, "general-payoff");
  assert.equal(draft.job.topic.payoffEventId, "topic-payoff");
  assert.equal(draft.job.claims[0].status, "unverified");
  assert.equal(draft.job.approval, "test-only");
  assert.equal(draft.job.policy.commercialRightsVerified, false);
  assert.equal(parseVideoProductionJob(draft.job).ok, true);
  assert.equal(JSON.stringify(draft).includes("12345secret"), false);
});

test("malformed completion, duplicate packaging and invented scene intents fail rather than falling back to a fake script", async () => {
  const make = (content) => async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) });
  await assert.rejects(generateTopicDraft(request, { transport: make("not-json") }), /json|model|parse/i);
  await assert.rejects(generateTopicDraft(request, { transport: make(JSON.stringify({ ...response, packaging: response.packaging.map((p) => ({ ...p, strategy: "same" })) })) }), /distinct|packaging/i);
  await assert.rejects(generateTopicDraft(request, { transport: make(JSON.stringify({ ...response, beats: response.beats.map((b, i) => i === 1 ? { ...b, intent: "run-code" } : b) })) }), /intent|scene/i);
});

test("long video generator refuses a short script rather than padding silence to eight minutes", async () => {
  await assert.rejects(generateTopicDraft({ ...request, mode: "youtube-long" }, { transport: fakeTransport }), /long|word|substantive|length/i);
});

test("Japanese draft uses spoken character count rather than whitespace-separated words", async () => {
  const jpResponse = { ...response, beats: response.beats.map((beat) => ({ ...beat, narration: "冷蔵庫は電気の力で熱を外に運びます。".repeat(12) })) };
  const transport = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(jpResponse) } }] }) });
  const draft = await generateTopicDraft({ ...request, locale: "ja-JP" }, { transport });
  assert.equal(draft.narrationLength.unit, "characters");
  assert.ok(draft.narrationLength.count > 150);
  const longButInsufficient = { ...jpResponse, beats: Array.from({ length: 20 }, (_, i) => ({
    ...jpResponse.beats[i === 0 ? 0 : i === 19 ? 3 : 1], narration: "冷蔵庫は電気の力で熱を外に運びます。".repeat(4),
  })) };
  const shortLongTransport = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(longButInsufficient) } }] }) });
  await assert.rejects(generateTopicDraft({ ...request, locale: "ja-JP", mode: "youtube-long" }, { transport: shortLongTransport }), /too short/);
});

test("model errors and redirect responses fail clearly, and no cloud fallback is made", async () => {
  await assert.rejects(generateTopicDraft(request, { transport: async () => { throw new Error("ECONNREFUSED"); } }), /local|connect|unavailable/i);
  await assert.rejects(generateTopicDraft(request, { transport: async () => ({ ok: false, status: 302, text: async () => "" }) }), /model|local|302/i);
});
