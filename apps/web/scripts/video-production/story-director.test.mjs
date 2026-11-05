import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { captionFor, compileVocabulary, mentionedObjects, phraseKeyword, phraseSignals, spokenAmounts } from "./story-language.mjs";
import { directSceneStory, newStoryStage } from "./story-director.mjs";
import { detectPauses, phraseWindows, speechPhrases } from "./speech-phrases.mjs";
import { applyObjectStories, sceneNeedsStory } from "./story-scenes.mjs";
import { compileApprovedScriptDirector } from "./approved-script-director.mjs";
import { compileLiveVisualPreview } from "./live-visual-preview.mjs";
import { STORY_CUES, mixCueTrack, storyCues, thinCues } from "./story-sound.mjs";

const vocabulary = JSON.parse(await readFile(new URL("./story-vocabulary.json", import.meta.url), "utf8"));
const fixture = JSON.parse(await readFile(new URL("../../fixtures/reference/invoice-receipt-gap.json", import.meta.url), "utf8"));
const fps = { num: 30, den: 1 };
const scene = (id, text, secondsPerChar = .075) => {
  const phrases = speechPhrases(text), frames = Math.round(text.length * secondsPerChar * 30);
  return { id, fps, width: 1920, height: 1080, frames, phrases: phraseWindows({ phrases, frames, fps }) };
};
const direct = (text, stage) => directSceneStory(scene("s", text), { vocabulary, stage });

test("amounts are read from digits and from spoken words", () => {
  const usd = spokenAmounts("The invoice says one hundred twenty dollars.")[0];
  assert.deepEqual([usd.value, usd.text], [120, "$120"]);
  assert.equal(spokenAmounts("It costs $1,200 in fees.")[0].value, 1200);
  assert.equal(spokenAmounts("About 20 percent of it.")[0].text, "20%");
  assert.equal(spokenAmounts("$3.5 million raised.")[0].value, 3500000);
  assert.equal(spokenAmounts("The receipt says one hundred.").length, 0, "a bare number needs a unit");
  assert.equal(spokenAmounts("The receipt says one hundred.", { defaultUnit: usd.unit })[0].text, "$100");
  assert.equal(spokenAmounts("One tool and two documents.", { defaultUnit: usd.unit }).length, 0, "small counts are not amounts");
});

test("objects are found in spoken order, longest term first, each once", () => {
  const compiled = compileVocabulary(vocabulary);
  assert.deepEqual(mentionedObjects("Attach the receipt to the invoice and the invoices", compiled).map(item => item.art), ["finance:receipt", "finance:invoice"]);
  assert.deepEqual(mentionedObjects("Pay with a credit card", compiled).map(item => item.art), ["finance:credit-card"]);
  assert.deepEqual(mentionedObjects("Nothing here matches", compiled), []);
  assert.deepEqual(mentionedObjects("請求書と領収書", compileVocabulary(vocabulary, "ja")).map(item => item.art), ["finance:invoice", "finance:receipt"]);
});

test("signals, keywords and captions come from the words", () => {
  assert.equal(phraseSignals("So where did it go?").question, true);
  assert.equal(phraseSignals("It does not check that").negation, true);
  assert.equal(phraseKeyword("Compounding quietly doubles everything"), "Compounding");
  assert.equal(captionFor("So the invoice says one hundred twenty dollars.", spokenAmounts("So the invoice says one hundred twenty dollars.")), "The invoice says $120");
  assert.ok(captionFor("This sentence keeps going far beyond what anyone could read while listening to it").split(" ").length <= 9);
  assert.equal(captionFor("Both are in your books, and your books still balance every single month."), "Both are in your books");
});

test("long sentences split at clauses; windows fill the scene and snap to real pauses", () => {
  assert.equal(speechPhrases("Short one. Another short one.").length, 2);
  const parts = speechPhrases("Nothing forces anyone to put the two documents side by side, so a short payment or a duplicate charge passes through.");
  assert.equal(parts.length, 2);
  const phrases = ["The first phrase.", "The other phrase."];
  const plain = phraseWindows({ phrases, frames: 300, fps, spokenSeconds: 10 });
  assert.deepEqual([plain[0].startFrame, plain[0].endFrame, plain[1].startFrame, plain[1].endFrame], [0, 150, 150, 300]);
  const snapped = phraseWindows({ phrases, frames: 300, fps, spokenSeconds: 10, pauses: [{ start: 4.4, end: 4.6 }] });
  assert.equal(snapped[0].endFrame, 135);
  const far = phraseWindows({ phrases, frames: 300, fps, spokenSeconds: 10, pauses: [{ start: 1, end: 1.2 }] });
  assert.equal(far[0].endFrame, 150, "a distant pause is ignored");
  const many = phraseWindows({ phrases: ["One.", "Two.", "Three.", "Four."], frames: 40, fps, spokenSeconds: 1.3 });
  assert.deepEqual(many.map(item => [item.text, item.startFrame, item.endFrame]), [["One. Two. Three. Four.", 0, 40]], "phrases too short to show a change merge");
  assert.equal(phraseWindows({ phrases: ["One.", "Two."], frames: 1, fps }).length, 1);
});

test("pauses are read from FFmpeg's silence log", async () => {
  const run = async () => ({ stderr: "[silencedetect] silence_start: -0.01\n[silencedetect] silence_end: 0.2 | silence_duration: 0.2\nsilence_start: 3.5\nsilence_end: 3.9 | d\nsilence_start: 9" });
  assert.deepEqual(await detectPauses("/a.wav", { run }), [{ start: 0, end: .2 }, { start: 3.5, end: 3.9 }]);
});

test("the reference opening stages the mismatch from its words alone", () => {
  const { spec } = direct(fixture.script.sections[0].text);
  assert.deepEqual(spec.beats.map(beat => beat.arrangement.objects), [["invoice"], ["invoice", "receipt"], ["invoice", "budget", "receipt"], ["invoice", "receipt"]]);
  assert.deepEqual(spec.beats[0].ops[0], { kind: "set-value", object: "invoice", value: 120, durationFrames: spec.beats[0].ops[0].durationFrames, atFrame: spec.beats[0].ops[0].atFrame });
  assert.equal(spec.beats[1].ops[0].value, 100);
  assert.deepEqual(spec.beats[2].ops.filter(op => op.kind === "connect").map(op => [op.from, op.to]), [["invoice", "budget"], ["receipt", "budget"]]);
  assert.equal(spec.beats[3].ops[0].kind, "measure-gap");
  assert.equal(spec.beats[3].ops[0].label, "$20");
  assert.equal(spec.beats[3].caption.text, "Where did the $20 go?");
  assert.equal(spec.objects.find(item => item.id === "budget").label, "Books");
});

test("every beat changes something, operations stay inside their beat, and the words decide the verdict", () => {
  let stage;
  for (const section of fixture.script.sections) {
    const directed = direct(section.text, stage);
    stage = directed.stage;
    let previous = directed.spec.carried?.objects ?? [];
    for (const beat of directed.spec.beats) {
      const moved = JSON.stringify(previous) !== JSON.stringify(beat.arrangement.objects);
      assert.ok(moved || beat.ops.length, `${beat.id} changes nothing`);
      for (const op of beat.ops) assert.ok(op.atFrame >= beat.startFrame && op.atFrame + op.durationFrames <= beat.endFrame, `${beat.id} ${op.kind}`);
      assert.ok(beat.arrangement.objects.length <= 3);
      previous = beat.arrangement.objects;
    }
  }
  const denied = direct("The fix is a habit, not a tool.").spec.beats[0];
  assert.deepEqual(denied.ops.find(op => op.kind === "mark"), { ...denied.ops.find(op => op.kind === "mark"), object: "laptop", mark: "cross" });
  const relieved = direct("The money was never missing from the ledger.").spec.beats[0];
  assert.equal(relieved.ops.find(op => op.kind === "mark").mark, "check");
});

test("the stage continues into the next scene with its values", () => {
  const first = direct("The invoice says one hundred twenty dollars.");
  const second = direct("That invoice keeps growing to two hundred dollars.", first.stage);
  assert.deepEqual(second.spec.carried, { kind: "solo", objects: ["invoice"] });
  assert.deepEqual([second.spec.objects[0].value.initial, second.spec.objects[0].value.shownFromStart], [120, true]);
  assert.equal(second.spec.beats[0].ops[0].value, 200);
});

test("an idea with no picture becomes a word on an empty stage", () => {
  const { spec } = direct("Compounding quietly doubles everything.");
  assert.deepEqual(spec.objects.map(item => item.label), ["Compounding"]);
  assert.equal(spec.objects[0].art, undefined);
});

test("Japanese narration finds objects and places a caption", () => {
  const text = "請求書は高いです。領収書はありません。";
  const { spec } = directSceneStory({ ...scene("s", text, .25), locale: "ja" }, { vocabulary });
  assert.deepEqual(spec.beats.flatMap(beat => beat.arrangement.objects).includes("invoice"), true);
  assert.ok(spec.beats.every(beat => beat.caption.text.length));
});

const plan = () => ({ kind: "general-explainer-visual-plan", locale: "en", manifest: { fps, width: 1920, height: 1080 }, chapters: [
  { id: "a", narration: "The invoice says one hundred twenty dollars.", startFrame: 0, endFrame: 120, visual: { items: [] } },
  { id: "b", narration: "This scene has footage.", startFrame: 120, endFrame: 240, visual: { stockMedia: { assetType: "video" } } },
  { id: "c", narration: "The receipt says one hundred dollars.", startFrame: 240, endFrame: 360, visual: { items: [] } },
] });

test("scenes with their own picture keep it, and a picture breaks stage continuity", async () => {
  assert.equal(sceneNeedsStory({ narration: "x", visual: { chart: {} } }), false);
  assert.equal(sceneNeedsStory({ narration: "x", dialogue: {}, visual: {} }), false);
  assert.equal(sceneNeedsStory({ narration: "x", visual: {} }), true);
  const seen = [];
  const { plan: directed, report } = await applyObjectStories(plan(), { speech: [{ id: "a", wavPath: "/a.wav", samples: 192000 }] }, { vocabulary, detectPauses: async path => { seen.push(path); return []; },
    check: () => ({ ok: true, diagnostics: [{ severity: "warning", code: "still-stretch" }], pacing: { longestStillSeconds: 3 } }) });
  assert.deepEqual(seen, ["/a.wav"]);
  assert.ok(directed.chapters[0].visual.story);
  assert.equal(directed.chapters[1].visual.story, undefined);
  assert.equal(directed.chapters[2].visual.story.carried, undefined);
  assert.deepEqual(report.map(item => item.chapterId), ["a", "c"]);
  assert.deepEqual(report[0].warnings, ["still-stretch"]);
});

test("a failed pause scan keeps the estimated timing and says so, unless the run was cancelled", async () => {
  const check = () => ({ ok: true, diagnostics: [], pacing: null });
  const { report } = await applyObjectStories(plan(), { speech: [{ id: "a", wavPath: "/a.wav" }] }, { vocabulary, check, detectPauses: async () => { throw Error("no tool"); } });
  assert.equal(report[0].timing, "estimated");
  const stop = new AbortController();
  stop.abort();
  await assert.rejects(applyObjectStories(plan(), { speech: [{ id: "a", wavPath: "/a.wav" }], signal: stop.signal }, { vocabulary, check, detectPauses: async () => { throw Error("aborted"); } }), /aborted/u);
});

test("an invalid story stops production, and a portrait or disabled run changes nothing", async () => {
  await assert.rejects(applyObjectStories(plan(), {}, { vocabulary, detectPauses: async () => [], check: () => ({ ok: false, diagnostics: [{ severity: "error", message: "No room." }] }) }), /scene a is invalid: No room/u);
  const disabled = plan();
  assert.equal((await applyObjectStories(disabled, { enabled: false })).plan, disabled);
  const portrait = { ...plan(), manifest: { fps, width: 1080, height: 1920 } };
  assert.equal((await applyObjectStories(portrait, {}, { vocabulary, check: () => ({ ok: true, diagnostics: [] }) })).plan, portrait);
});

test("each visible change gets a cue on its frame, and a mark sounds like its meaning", () => {
  const { spec } = direct(fixture.script.sections[0].text);
  const cues = storyCues(spec);
  const first = spec.beats[0];
  assert.equal(cues[0].sound, "story-pop");
  assert.equal(cues[0].frame, first.startFrame);
  assert.ok(cues.some(cue => cue.sound === "story-tick" && cue.frame === first.ops[0].atFrame));
  assert.ok(cues.some(cue => cue.sound === "story-measure"));
  assert.ok(cues.some(cue => cue.sound === "story-check"));
  assert.ok(cues.some(cue => cue.sound === "story-question"));
  assert.equal(cues.find(cue => cue.sound === "story-tick").sample, Math.round(first.ops[0].atFrame * 1600));
  const carried = storyCues({ ...spec, carried: { kind: "solo", objects: ["invoice"] } });
  assert.ok(!carried.some(cue => cue.id === `${first.id}-enter`), "a carried object does not arrive again");
});

test("close cues give way to the more meaningful one", () => {
  const cue = (absolute, key) => ({ ...STORY_CUES[key], absolute });
  const thin = thinCues([cue(10, "highlight"), cue(11, "check"), cue(100, "enter")], { fps });
  assert.deepEqual(thin.map(item => item.sound), ["story-check", "story-pop"]);
  assert.equal(thinCues(Array.from({ length: 900 }, (_, index) => cue(index * 30, "enter")), { fps }).length, 900, "a long film keeps every cue");
});

test("cues mix at their samples with their gains, and the track never wraps", () => {
  const pcm = Int16Array.from([1000, 1000]);
  assert.deepEqual([...mixCueTrack([{ sample: 1, pcm, gainDb: 0 }, { sample: 2, pcm, gainDb: -6.0206 }], 4)], [0, 1000, 1500, 500]);
  assert.deepEqual([...mixCueTrack([{ sample: 0, pcm: Int16Array.from([30000]), gainDb: 0 }, { sample: 0, pcm: Int16Array.from([30000]), gainDb: 0 }], 1)], [32767]);
  assert.deepEqual([...mixCueTrack([{ sample: 3, pcm, gainDb: 0 }], 4)], [0, 0, 0, 1000], "a cue is cut at the end of the film");
});

test("the Studio preview shows the same stories the MP4 will, before any voice exists", () => {
  const { dossier, bundle } = compileApprovedScriptDirector(fixture);
  const preview = compileLiveVisualPreview(dossier, bundle);
  assert.equal(preview.plan.chapters.length, 5);
  assert.ok(preview.plan.chapters.every(chapter => chapter.visual.story?.beats.length));
  assert.deepEqual(preview.plan.chapters[0].visual.story.beats[0].arrangement.objects, ["invoice"]);
  assert.equal(preview.quality.findings.some(item => item.code === "repeated-schematic"), false);
});
