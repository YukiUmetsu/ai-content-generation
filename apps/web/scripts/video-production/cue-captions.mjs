/** Captions (SRT) from timed cues, for a voice-over placed at measured times. */

const stamp = (seconds) => {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const p = (v, n) => String(v).padStart(n, "0");
  return `${p(Math.floor(ms / 3600000), 2)}:${p(Math.floor(ms / 60000) % 60, 2)}:${p(Math.floor(ms / 1000) % 60, 2)},${p(ms % 1000, 3)}`;
};

/** SRT text for cues `{ start, end, text }` (seconds), numbered in order. */
export function srtFromCues(cues) {
  return cues.map((cue, i) => {
    if (!(cue.end > cue.start) || typeof cue.text !== "string" || !cue.text.trim()) throw new Error(`Captions: cue ${i + 1} needs text and an end after its start`);
    return `${i + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text.replace(/\r?\n/gu, " ")}\n`;
  }).join("\n");
}
