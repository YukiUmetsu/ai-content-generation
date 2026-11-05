import assert from "node:assert/strict";
import test from "node:test";
import { storyThumbnailConcepts } from "./story-thumbnails.mjs";

const objects = [{ id: "invoice", art: "finance:invoice" }, { id: "receipt", art: "finance:receipt" }, { id: "budget", art: "finance:budget" }, { id: "word-fix" }];
const story = (beats) => ({ objects, beats });
const beat = (objectsOnStage, caption, ops = [], emphasis) => ({ arrangement: { objects: objectsOnStage }, ops, caption: { text: caption, ...(emphasis ? { emphasis } : {}) } });
const plan = (...stories) => ({ chapters: stories.map(item => ({ visual: { story: item } })) });
const title = "Why your invoice and your receipt disagree";

test("three different hypotheses come from what the film shows", () => {
  const concepts = storyThumbnailConcepts(plan(story([
    beat(["invoice"], "The invoice says $120", [{ kind: "set-value", object: "invoice" }], ["$120"]),
    beat(["invoice", "receipt"], "Where did the $20 go?", [{ kind: "measure-gap", a: "invoice", b: "receipt", label: "$20" }]),
    beat(["budget"], "It does not check that each number matches", [{ kind: "mark", object: "budget", mark: "cross" }]),
    beat(["budget"], "A clean balance can hide a wrong entry", [{ kind: "mark", object: "budget", mark: "cross" }]),
    beat(["budget"], "Clean books can hide errors", [{ kind: "mark", object: "budget", mark: "cross" }]),
  ])), { title });
  assert.deepEqual(concepts.map(item => item.recipe), ["comparison", "hero-fact", "hidden-mechanism"]);
  assert.deepEqual([concepts[0].headline, concepts[0].cue, concepts[0].primaryArt, concepts[0].secondaryArt], ["Where did the $20 go?", undefined, "finance:invoice", "finance:receipt"]);
  assert.deepEqual([concepts[1].headline, concepts[1].cue, concepts[1].primaryArt], [title, "$120", "finance:invoice"]);
  assert.deepEqual([concepts[2].headline, concepts[2].primaryArt], ["Clean books can hide errors", "finance:budget"]);
  assert.equal(new Set(concepts.map(item => item.headline)).size, 3);
});

test("no number appears that the film did not show, and word objects never become art", () => {
  const concepts = storyThumbnailConcepts(plan(story([
    beat(["word-fix"], "The fix is simple"), beat(["invoice", "receipt"], "Keep them together"),
  ])), { title });
  assert.ok(concepts.every(item => !item.cue));
  assert.ok(concepts.every(item => item.primaryArt !== undefined));
});

test("a film with no measured gap still gets three concepts from its paired objects", () => {
  const concepts = storyThumbnailConcepts(plan(story([
    beat(["invoice"], "Start with one document"),
    beat(["invoice", "receipt"], "It looks fine at first"),
    beat(["invoice", "receipt"], "Two papers tell one story"),
    beat(["budget"], "Your books hide the problem", [{ kind: "mark", object: "budget", mark: "cross" }]),
  ])), { title });
  assert.deepEqual(concepts.map(item => item.headline), ["Two papers tell one story", title, "Your books hide the problem"]);
  assert.deepEqual(concepts.map(item => item.recipe), ["comparison", "hero-fact", "hidden-mechanism"]);
});

test("a duration is never shown beside the title as if it described it", () => {
  const concepts = storyThumbnailConcepts(plan(story([
    beat(["invoice"], "Waiting 90 minutes helps", [{ kind: "set-value", object: "invoice" }], ["90 minutes"]),
    beat(["receipt"], "It costs $40", [{ kind: "set-value", object: "receipt" }], ["$40"]),
  ])), { title });
  assert.equal(concepts.find(item => item.recipe === "hero-fact").cue, "$40");
  const durationOnly = storyThumbnailConcepts(plan(story([beat(["invoice"], "Waiting 90 minutes helps", [{ kind: "set-value", object: "invoice" }], ["90 minutes"])])), { title });
  assert.equal(durationOnly.find(item => item.recipe === "hero-fact").cue, undefined);
});

test("a film with too little to show returns fewer concepts, so the script covers are used", () => {
  assert.equal(storyThumbnailConcepts(plan(), { title }).length, 0);
  assert.equal(storyThumbnailConcepts(plan(story([beat(["word-fix"], "Only a word")])), { title }).length, 0);
  assert.ok(storyThumbnailConcepts(plan(story([beat(["invoice"], "Only one object")])), { title }).length < 3);
});
