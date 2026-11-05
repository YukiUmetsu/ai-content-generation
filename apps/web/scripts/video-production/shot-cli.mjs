#!/usr/bin/env node
/** Render a performance fixture from a staged shot folder. */
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { renderPerformanceShot } from "./shot-render.mjs";
import { validatePerformanceIntent } from "./performance-intent.mjs";
import { localModelComplete, proposePerformance, ruleDirector, withStartingHolds } from "./performance-director.mjs";
import { mouthCuesFor, visemeCues } from "./shot-lipsync.mjs";
import { layoutLines, masterShotAudio, synthesizeLines } from "./shot-audio.mjs";
import { muxVideo } from "./produce.mjs";
import { productionProviderKey } from "./provider-keychain.mjs";
import { composeShotFilm } from "./shot-compose.mjs";

const { values } = parseArgs({ options: { fixture: { type: "string" }, root: { type: "string" }, voice: { type: "boolean", default: false }, "plan-only": { type: "boolean", default: false }, model: { type: "string" }, chromium: { type: "string" },
  profile: { type: "string", default: "draft" }, output: { type: "string" }, width: { type: "string", default: "1920" }, height: { type: "string", default: "1080" } } });
const read = async path => JSON.parse(await readFile(path, "utf8"));
const fixture = resolve(values.fixture), root = resolve(values.root);
const brief = await read(join(fixture, "brief.json")), grips = await read(join(fixture, "grips.json"));
const script = await read(join(fixture, "lines.json"));
for (const line of brief.lines) line.text = script.lines.find(item => item.id === line.id)?.text;
const firstDraft = ruleDirector(brief);
let windows, spoken = null, layout = null;
if (!values.voice) windows = (await read(join(fixture, "draft-timing.json"))).windows;
else {
  // Measured speech replaces the draft timing, so every anchored action retimes itself.
  const apiKey = await productionProviderKey("fish");
  spoken = await synthesizeLines(script.lines, { dir: join(root, "voice"), locale: script.locale, modelId: script.modelId, apiKey });
  layout = layoutLines(spoken, { fps: brief.fps, durationFrames: brief.durationFrames, minGapFrames: script.minGapFrames });
  windows = layout.windows;
}
const cast = firstDraft.cast.map(actor => ({ id: actor.id, pack: `packs/${actor.id}`, profile: `cast/${actor.id}.json`, rig: `cast/${actor.id}.rig.json` }));
const definitions = {}, rigs = {};
for (const actor of cast) {
  definitions[actor.id] = await read(join(root, actor.pack, "character.json"));
  rigs[actor.id] = await read(join(root, actor.rig));
}
const context = {
  knownClaimIds: new Set(brief.claimIds), speechWindows: windows, allowedNumbers: [],
  cast: Object.fromEntries(cast.map(({ id }) => [id, { effectors: Object.keys(rigs[id].effectors),
    expressions: Object.keys(definitions[id].expressions?.sets ?? {}), actions: Object.keys(definitions[id].actions ?? {}) }])),
  objects: Object.fromEntries(Object.entries(grips).map(([id, value]) => [id, { grips: Object.keys(value) }])),
};
const proposed = await proposePerformance(brief, context, values.model ? { complete: localModelComplete(values.model) } : {});
const intent = proposed.intent;
console.log(JSON.stringify({ director: proposed.source, findings: proposed.findings }));
const verdict = validatePerformanceIntent(withStartingHolds(intent), context);
if (!verdict.ok) { console.error(JSON.stringify(verdict.findings, null, 1)); process.exit(2); }
let lipSync, lipSource = "approximate cycle";
if (spoken) {
  const cues = {};
  for (const line of spoken) {
    const mouth = await mouthCuesFor(line.wavPath);
    if (mouth) cues[line.id] = visemeCues(mouth, windows[line.id], intent.fps, Object.keys(definitions[line.actor].speech?.visemes ?? {}));
  }
  if (Object.keys(cues).length === spoken.length) { lipSync = cues; lipSource = "rhubarb"; }
}
console.log(JSON.stringify({ windows, lipSource }));
const started = Date.now();
const look = await read(join(fixture, "look.json"));
if (values["plan-only"]) {
  const planned = await renderPerformanceShot({ root, intent, cast, grips, speechWindows: windows, lipSync, shotId: "shot", profile: values.profile,
    width: Number(values.width), height: Number(values.height), look, planOnly: true });
  console.log(JSON.stringify({ planned: planned.specPath, contacts: planned.contacts }));
  process.exit(0);
}
const finished = await access(join(resolve(values.output), "shot-manifest.json")).then(() => true, () => false);
const result = finished ? { manifest: await read(join(resolve(values.output), "shot-manifest.json")) }
  : await renderPerformanceShot({ root, intent, cast, grips, speechWindows: windows, lipSync, shotId: "shot", profile: values.profile,
    width: Number(values.width), height: Number(values.height), look, output: resolve(values.output),
    onEvent: event => { if (event.done % 30 === 0) console.log(`frame ${event.done}/${event.total}`); } });
if (spoken) {
  const bake = await read(join(root, "shot.bake.json"));
  const output = resolve(values.output);
  const audio = await masterShotAudio({ lines: spoken, layout, contacts: bake.contacts, materials: intent.materials ?? {},
    accentFrame: intent.accentFrame, fps: intent.fps, dir: join(output, "audio-work"), output: join(output, "audio") });
  await muxVideo(join(output, "shot.mp4"), audio.wavPath, join(output, "final.mp4"));
  if (values.chromium) {
    const composed = await composeShotFilm({ clipPath: join(output, "shot.mp4"), audioPath: audio.wavPath, out: join(output, "composed"),
      browserExecutable: values.chromium, id: "shot", title: intent.objective, fps: intent.fps, durationFrames: intent.durationFrames,
      width: Number(values.width), height: Number(values.height), label: intent.label });
    console.log(JSON.stringify(composed));
  }
  console.log(JSON.stringify({ loudness: audio.loudness, sfx: audio.sfxCueSamples }));
}
console.log(JSON.stringify({ seconds: Math.round((Date.now() - started) / 1000), contact: result.manifest.contact_error_m, frames_rendered: result.manifest.frames_rendered }));
