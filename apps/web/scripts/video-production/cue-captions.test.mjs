import { test } from "node:test";
import assert from "node:assert/strict";
import { srtFromCues } from "./cue-captions.mjs";

test("writes numbered SRT cues from seconds, one line each", () => {
  assert.equal(srtFromCues([{ start: .35, end: 3.081, text: "Do you know how to write the kanji mizu?" }, { start: 3725.5, end: 3726, text: "水\n道" }]),
    "1\n00:00:00,350 --> 00:00:03,081\nDo you know how to write the kanji mizu?\n\n2\n01:02:05,500 --> 01:02:06,000\n水 道\n");
  assert.throws(() => srtFromCues([{ start: 1, end: 1, text: "x" }]), /cue 1/u);
});
