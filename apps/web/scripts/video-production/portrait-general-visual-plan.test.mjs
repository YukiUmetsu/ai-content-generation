import assert from "node:assert/strict";
import test from "node:test";
import { createManualVideoDraft } from "./manual-draft.mjs";
import { compileGeneralVisuals } from "./general-visual-plan.mjs";

const base = {
  title: "A message's journey", viewerQuestion: "How does it arrive?",
  audience: "Curious learners", locale: "en-US", length: "smoke",
  hookStrategy: "unexpected-reveal", typographyStyle: "wipe", platform: "tiktok",
  scenes: [
    { headline: "Where does it go?", narration: "A message is broken into data packets before it travels through several connected networks.", items: ["Message", "Packets"] },
    { headline: "Several handoffs", narration: "Routers examine a packet destination and move it onward one connection at a time until the destination network.", items: ["Router", "Next router", "Destination"], intent: "general-flow" },
    { headline: "It arrives", narration: "The receiving device can reconstruct the data from packets and present the original message to the person.", items: ["Received packets", "Original message"] },
  ],
};
function timeline(job, frames = 900) {
  const size = Math.floor(frames / job.beats.length);
  return { sampleRate: 48000, totalFrames: frames, totalSamples: frames * 1600,
    fps: { num: 30, den: 1 },
    beats: job.beats.map((beat, index) => ({ id: beat.id, startFrame: index * size, endFrame: (index + 1) * size })),
    eventFrames: { "topic-payoff": (job.beats.length - 1) * size } };
}
test("short visual manifests keep the target preset and native 9:16 dimensions", () => {
  for (const platform of ["youtube-shorts", "instagram-reels", "tiktok"]) {
    const job = createManualVideoDraft({ ...base, platform }).job;
    const result = compileGeneralVisuals(job, timeline(job));
    assert.equal(result.manifest.width, 1080);
    assert.equal(result.manifest.height, 1920);
    assert.equal(result.manifest.preset, platform);
    assert.equal(result.manifest.durationFrames, 900);
    assert.equal(result.chapters[0].visual.hookStrategy, "unexpected-reveal");
    assert.equal(result.commercialReady, false);
  }
});
test("portrait compilation refuses to clip measured narration after 180s", () => {
  const job = createManualVideoDraft(base).job;
  assert.throws(() => compileGeneralVisuals(job, timeline(job, 5401)), /180-second/);
});
test("landscape jobs remain unchanged", () => {
  const job = createManualVideoDraft({ ...base, platform: "youtube" }).job;
  const result = compileGeneralVisuals(job, timeline(job));
  assert.deepEqual([result.manifest.width, result.manifest.height, result.manifest.preset], [1920, 1080, "youtube"]);
});
