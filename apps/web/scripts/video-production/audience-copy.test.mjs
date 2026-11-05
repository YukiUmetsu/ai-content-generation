import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AUDIENCE_KICKERS, HEADLINE_MAX, KICKER_MAX, SUPPORT_MAX, audienceCopy, audienceKicker, editorialLeak, fitCopy,
  isAuthoredScreenText, scenePlace, spokenSentences } from "./audience-copy.mjs";
import { SCRIPT_OUTLINE, isOutlineHeading } from "./script-contract.mjs";
import { compileApprovedScriptDirector } from "./approved-script-director.mjs";
import { compilePreproductionRenderJob } from "./preproduction-render-bridge.mjs";
import { compilePreproductionBundle, parsePreproductionPlan } from "./preproduction.mjs";

const fixture = JSON.parse(await readFile(new URL("../../fixtures/reference/invoice-receipt-gap.json", import.meta.url), "utf8"));

test("sentences split on spoken boundaries, not inside numbers, and in Japanese without spaces", () => {
  assert.deepEqual(spokenSentences("It costs 3.5 percent. Why? \"Because it compounds.\" Then it stops"),
    ["It costs 3.5 percent.", "Why?", "\"Because it compounds.\"", "Then it stops"]);
  assert.deepEqual(spokenSentences("請求書は120ドルです。領収書は100ドルです！なぜでしょうか？"),
    ["請求書は120ドルです。", "領収書は100ドルです！", "なぜでしょうか？"]);
  assert.deepEqual(spokenSentences("  "), []);
});

test("copy is cut at a clause, then at a word, and a cut is always marked", () => {
  assert.equal(fitCopy("Short enough", 20), "Short enough");
  assert.equal(fitCopy("Attach the receipt to the invoice, then compare the totals before the month closes", 50), "Attach the receipt to the invoice…");
  assert.equal(fitCopy("Nothing forces anyone to put the two documents side by side", 30), "Nothing forces anyone to put…");
  for (const text of ["a".repeat(200), "word ".repeat(60), "請求書".repeat(40)])
    assert.ok(fitCopy(text, 40).length <= 40 && fitCopy(text, 40).endsWith("…"));
});

test("every default outline heading is recognised, in any case and with trailing punctuation", () => {
  for (const section of SCRIPT_OUTLINE) {
    assert.equal(isOutlineHeading(section.heading), true, section.heading);
    assert.equal(isOutlineHeading(`  ${section.heading.toUpperCase()}: `), true);
    assert.equal(isAuthoredScreenText(section.heading), false);
  }
  assert.equal(isOutlineHeading("Section 12"), true);
  assert.equal(isOutlineHeading("The three costs nobody mentions"), false);
  assert.equal(isAuthoredScreenText("The three costs nobody mentions"), true);
  assert.equal(isAuthoredScreenText("  "), false);
});

test("an unauthored scene shows what it says: first sentence as headline, the next as support", () => {
  const copy = audienceCopy("The invoice says one hundred twenty dollars. The receipt says one hundred. So where did it go?", { authoredHeadline: "Opening hook" });
  assert.deepEqual(copy, { headline: "The invoice says one hundred twenty dollars", support: "The receipt says one hundred.",
    source: { headline: "narration", support: "narration" } });
  assert.equal(audienceCopy("Why does it balance? Because nobody compares the paper.").headline, "Why does it balance?");
});

test("authored words are kept, and support never repeats the headline", () => {
  const authored = audienceCopy("One sentence here. A second sentence follows.", { authoredHeadline: "Twenty dollars, gone", authoredSupport: "Nobody compared the paper." });
  assert.deepEqual(authored, { headline: "Twenty dollars, gone", support: "Nobody compared the paper.", source: { headline: "authored", support: "authored" } });
  const repeated = audienceCopy("One sentence here. A second sentence follows.", { authoredHeadline: "One sentence here", authoredSupport: "One sentence here." });
  assert.equal(repeated.support, "A second sentence follows.");
  assert.equal(repeated.source.support, "narration");
});

test("a single sentence falls back to the viewer question, and a cut headline is completed by its own sentence", () => {
  const single = audienceCopy("A ledger only checks that the numbers add up.", { fallbackSupport: "How can the books balance?" });
  assert.deepEqual([single.support, single.source.support], ["How can the books balance?", "fallback"]);
  assert.throws(() => audienceCopy("A ledger only checks that the numbers add up."), /supporting line or a viewer question/u);
  assert.throws(() => audienceCopy(""), /needs narration/u);
  const long = "Nothing forces anyone to put the two documents side by side, so a short payment or a duplicate charge passes through.";
  const cut = audienceCopy(long);
  assert.ok(cut.headline.endsWith("…") && cut.headline.length <= HEADLINE_MAX);
  assert.ok(cut.support.startsWith("Nothing forces anyone") && cut.support.length <= SUPPORT_MAX);
});

test("kickers come from a per-locale table and never from internal vocabulary", () => {
  const shots = [{ purpose: "hook" }, { purpose: "explain" }, { purpose: "answer" }, { purpose: "postscript" }];
  assert.deepEqual(shots.map((_, index) => scenePlace(shots, index)), ["opening", "step", "closing", "postscript"]);
  assert.equal(scenePlace([{ purpose: "hook" }, { purpose: "explain" }, { purpose: "explain" }], 2), "closing");
  const shown = shots.map((_, index) => audienceKicker({ place: scenePlace(shots, index), index, total: shots.length }));
  assert.deepEqual(shown, ["THE QUESTION", "2 / 4", "THE ANSWER", "ONE MORE THING"]);
  assert.equal(audienceKicker({ place: "opening", index: 0, total: 3, locale: "ja-JP" }), AUDIENCE_KICKERS.ja.opening);
  assert.equal(audienceKicker({ place: "step", index: 1, total: 3, locale: "fr-FR" }), "2 / 3");
  assert.equal(audienceKicker({ place: "step", index: 1, total: 3, kickers: { en: { step: "PART {index}" } } }), "PART 2");
  for (const table of Object.values(AUDIENCE_KICKERS)) for (const text of Object.values(table)) assert.ok(text.length <= KICKER_MAX);
});

test("an outline label or a direction note on screen is a leak; spoken words are not", () => {
  const notes = ["Opening hook: The invoice says one hundred twenty dollars", "Establish relatable stakes, baseline and scope without repeating the hook."];
  assert.equal(editorialLeak("Opening hook", notes), "outline-label");
  assert.equal(editorialLeak("Opening hook: The invoice says one hundred twenty dollars", notes), "outline-label");
  assert.equal(editorialLeak("Establish relatable stakes, baseline and scope without repeating the hook.", notes), "direction-note");
  assert.equal(editorialLeak("Establish relatable stakes, baseline and scope…", notes), "direction-note");
  assert.equal(editorialLeak("The invoice says one hundred twenty dollars", notes), null);
  assert.equal(editorialLeak("", notes), null);
});

test("the reference script compiles with no outline label, purpose or internal word on screen", () => {
  const { dossier, bundle } = compileApprovedScriptDirector(fixture);
  assert.equal(parsePreproductionPlan(bundle.plan, dossier).ok, true);
  const { job, warnings } = compilePreproductionRenderJob(dossier, bundle);
  const outline = fixture.script.sections.flatMap(section => [section.heading, section.purpose]);
  for (const [index, beat] of job.beats.entries()) {
    const { headline, subhead, emphasis } = beat.visual, narration = fixture.script.sections[index].text;
    for (const label of outline) for (const shown of [headline, subhead, emphasis]) assert.ok(!shown.includes(label), `${shown} shows ${label}`);
    assert.ok(narration.includes(headline.replace(/…$/u, "")), `headline is spoken: ${headline}`);
    assert.ok(narration.includes(subhead.replace(/…$/u, "")), `support is spoken: ${subhead}`);
    assert.notEqual(headline.toLowerCase(), subhead.toLowerCase().replace(/\.$/u, ""));
    assert.ok(!/^(explain|mechanism|problem|payoff|hook|answer|postscript)$/iu.test(emphasis), emphasis);
  }
  assert.deepEqual(job.beats.map(beat => beat.visual.emphasis), ["THE QUESTION", "2 / 5", "3 / 5", "4 / 5", "THE ANSWER"]);
  assert.equal(bundle.plan.story.hook, "The invoice says one hundred twenty dollars.");
  assert.equal(warnings.some(warning => /screen title|supporting line/u.test(warning)), false);
});

test("a title an author wrote is shown; a storyboard that only carries the derived default is not treated as authored", () => {
  const authoredScript = structuredClone(fixture);
  authoredScript.script.sections[1].heading = "A clean balance can still be wrong";
  const { dossier, bundle } = compileApprovedScriptDirector(authoredScript);
  assert.equal(bundle.plan.shots[1].onScreenText, "A clean balance can still be wrong");
  assert.equal(bundle.plan.shots[1].audienceCopy, "A ledger only checks that the numbers add up.");
  assert.equal(compilePreproductionRenderJob(dossier, bundle).job.beats[1].visual.headline, "A clean balance can still be wrong");
});

test("an older plan with an outline label and no viewer copy is repaired from narration, with a warning", () => {
  const { dossier, bundle } = compileApprovedScriptDirector(fixture);
  const plan = structuredClone(bundle.plan);
  for (const shot of plan.shots) delete shot.audienceCopy;
  plan.shots[0].onScreenText = "Opening hook";
  plan.shots[1].visualChange = "Establish relatable stakes, baseline and scope without repeating the hook.";
  const older = compilePreproductionBundle(dossier, plan);
  const { job, warnings } = compilePreproductionRenderJob(dossier, older);
  assert.equal(job.beats[0].visual.headline, "The invoice says one hundred twenty dollars");
  assert.equal(job.beats[1].visual.subhead, "It does not check that each number matches the paper behind it.");
  assert.ok(warnings.some(warning => /shot_1_1.*outline label/u.test(warning)));
  assert.ok(warnings.some(warning => /shot_2_1.*no supporting line/u.test(warning)));
});
