import { test } from "node:test";
import assert from "node:assert/strict";
import { pitchContour, pitchShape } from "./narration-pitch.mjs";

/** A voiced tone gliding from `from` to `to` Hz, with harmonics like a voice. */
function glide(seconds, from, to, { rate = 48000 } = {}) {
  const n = Math.round(seconds * rate), out = new Int16Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const hz = from + (to - from) * (i / n);
    phase += 2 * Math.PI * hz / rate;
    out[i] = Math.round(9000 * (Math.sin(phase) + .5 * Math.sin(2 * phase) + .25 * Math.sin(3 * phase)));
  }
  return out;
}
const join = (...parts) => { const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };

test("measures a steady pitch within a few Hz, and silence as unvoiced", () => {
  const contour = pitchContour(join(new Int16Array(4800), glide(.4, 200, 200)));
  const voiced = contour.filter(f => f.hz);
  assert.ok(voiced.length > 25);
  assert.ok(voiced.every(f => Math.abs(f.hz - 200) < 4), JSON.stringify(voiced.slice(0, 3)));
  assert.ok(contour.slice(0, 4).every(f => f.hz === null), "the leading silence is unvoiced");
});

test("tells a question-like rise at the end from a fall after the peak and a level take", () => {
  // Level, then climbing 4 semitones to the end (a question); high then low (今: い high, ま low); a rise into
  // the accent then a fall; and level.
  const rises = pitchShape(pitchContour(join(glide(.25, 180, 180), glide(.25, 180, 180 * 2 ** (4 / 12)))));
  const falls = pitchShape(pitchContour(join(glide(.25, 220, 220), glide(.25, 220, 220 / 2 ** (4 / 12)))));
  const peaked = pitchShape(pitchContour(join(glide(.2, 125, 165), glide(.3, 165, 145))));
  const level = pitchShape(pitchContour(glide(.5, 200, 200)));
  assert.equal(rises.shape, "rises"); assert.ok(rises.rise > 2, String(rises.rise));
  assert.equal(falls.shape, "falls"); assert.ok(falls.fall < -2, String(falls.fall));
  assert.equal(peaked.shape, "falls", JSON.stringify(peaked));   // its start-to-end rise does not make it a question
  assert.equal(level.shape, "level");
  assert.deepEqual(pitchShape(pitchContour(new Int16Array(24000))), { shape: null, rise: null, fall: null });
});
