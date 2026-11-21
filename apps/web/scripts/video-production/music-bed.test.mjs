import { test } from "node:test";
import assert from "node:assert/strict";
import { bedLevels, chooseMusicWindow } from "./music-bed.mjs";

test("chooses the music window without a silent stretch where nobody speaks", () => {
  // Ten seconds of soft music with a two-second hole at 5–7 s.
  const music = new Int16Array(10 * 48000);
  for (let i = 0; i < music.length; i++) if (i < 5 * 48000 || i > 7 * 48000) music[i] = Math.round(3000 * Math.sin(2 * Math.PI * 220 * i / 48000));
  const window = chooseMusicWindow(music, 3, [{ onset: 2, end: 2.5 }], { from: 0, step: .5 });
  assert.ok(window.start + 3 <= 5 || window.start >= 7, `window ${window.start}–${window.start + 3} overlaps the hole`);
  assert.equal(window.longestQuietSeconds, 0);
  assert.throws(() => chooseMusicWindow(music, 20, []), /shorter than the video/u);
});

test("levels a bed under the voice within the ambience lane, raising a quiet bed first as far as its peak allows", () => {
  // Loud enough: only the lane gain.
  assert.deepEqual(bedLevels({ voiceLufs: -23, bedLufs: -15, bedPeakDb: -3, belowVoiceDb: 11 }), { gainDb: -19, preGainDb: 0, belowVoiceDb: 11 });
  // Quiet: raised 0.4 dB first, then the lane's highest gain.
  assert.deepEqual(bedLevels({ voiceLufs: -23, bedLufs: -22.4, bedPeakDb: -4, belowVoiceDb: 11 }), { gainDb: -12, preGainDb: .4, belowVoiceDb: 11 });
  // Too quiet to reach: the peak stops the raise, and the miss shows in belowVoiceDb.
  assert.deepEqual(bedLevels({ voiceLufs: -23, bedLufs: -45, bedPeakDb: -6, belowVoiceDb: 11 }), { gainDb: -12, preGainDb: 5, belowVoiceDb: 29 });
});
