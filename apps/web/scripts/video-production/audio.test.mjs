import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { buildSampleTimeline } from "./timeline.mjs";
import { renderMasterAudio } from "./audio.mjs";

function toneWav(samples, amplitude = 2000, sampleRate = 48000) {
  const b = Buffer.alloc(44 + samples * 2);
  b.write("RIFF", 0); b.writeUInt32LE(b.length - 8, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36);
  b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) b.writeInt16LE(amplitude === 0 ? 0 : Math.round(Math.sin(2 * Math.PI * 220 * i / sampleRate) * amplitude), 44 + 2 * i);
  return b;
}
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const enabled = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 && spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;

async function fixture(t, { amplitude = 2000, sampleRate = 48000 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "contentgen-master-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const beats = [];
  for (const [i, id] of ["intro", "payoff"].entries()) {
    const audio = toneWav(sampleRate, amplitude, sampleRate);
    const wavPath = join(dir, `${id}.wav`);
    await writeFile(wavPath, audio);
    beats.push({ id, wavPath, samples: sampleRate, sha256: sha256(audio), text: `An illustrative ${id} sentence.`, pauseAfterMs: i === 0 ? 250 : 0, eventIds: i === 1 ? ["lifetime-total-reveal"] : [], licenseStatus: "test-only" });
  }
  const events = [{ id: "lifetime-total-reveal", beatId: "payoff" }];
  const timeline = buildSampleTimeline(beats, { fps: { num: 30, den: 1 }, events });
  const sfx = [{ id: "reveal", eventId: "lifetime-total-reveal", assetRef: "self-authored-test-chime", licenseStatus: "test-only" }];
  return { dir, beats, timeline, sfx };
}

test("rendered master matches measured speech samples with silent gaps, SRT and event-timed chime", { skip: !enabled }, async (t) => {
  const { dir, beats, timeline, sfx } = await fixture(t);
  const result = await renderMasterAudio({ beats, timeline, sfx }, { outputDir: join(dir, "output"), allowTestAssets: true });
  assert.equal(result.samples, 108000);
  assert.equal(result.sfxCueSamples.reveal, 60000);
  assert.match(result.srtText, /00:00:01,250 --> 00:00:02,250/);
  const voice = await readFile(result.voiceStemPath);
  assert.equal(voice.readUInt32LE(40), timeline.totalSamples * 2);
  assert.equal(voice.readInt16LE(44 + 48000 * 2), 0, "silence must not be filled by a stretched narration beat");
  assert.ok(result.loudness.integratedLufs < 0);
  assert.ok(result.loudness.truePeakDbtp <= -1.45, "measured peak must be within approved limit");
  assert.ok((await readFile(result.wavPath)).length > 1000);
});

test("intentional no-SFX mix remains playable without inserting sounds", { skip: !enabled }, async (t) => {
  const { dir, beats, timeline } = await fixture(t);
  const result = await renderMasterAudio({ beats, timeline, sfx: [] }, { outputDir: join(dir, "no-sfx") });
  assert.equal(result.samples, timeline.totalSamples);
  assert.deepEqual(result.sfxCueSamples, {});
  assert.equal(result.findings.length, 0);
});

test("reviewed SFX is mixed at the exact event sample only when the imported WAV hash still matches", { skip: !enabled }, async t=>{
  const {dir,beats,timeline}=await fixture(t);
  const wav=toneWav(12000,1900),assetPath=join(dir,"reviewed-sound.wav");
  await writeFile(assetPath,wav);
  const sound={id:"reviewed",eventId:"lifetime-total-reveal",assetRef:assetPath,
    assetPath,assetSha256:sha256(wav),licenseStatus:"verified"};
  const verified=await renderMasterAudio({beats,timeline,sfx:[sound]},
    {outputDir:join(dir,"verified")});
  assert.equal(verified.sfxCueSamples.reviewed,60000);
  assert.equal(verified.samples,timeline.totalSamples);
  await writeFile(assetPath,toneWav(12000,2100));
  await assert.rejects(renderMasterAudio({beats,timeline,sfx:[sound]},
    {outputDir:join(dir,"tampered")}),/checksum|hash|changed/i);
});

test("orphan event, mismatched asset/rights, missing speech, wrong rate and clipped input fail closed", { skip: !enabled }, async (t) => {
  const { dir, beats, timeline, sfx } = await fixture(t);
  const out = (name) => ({ outputDir: join(dir, name), allowTestAssets: true });
  await assert.rejects(renderMasterAudio({ beats, timeline, sfx: [{ ...sfx[0], eventId: "missing" }] }, out("orphan")), /event/i);
  await assert.rejects(renderMasterAudio({ beats, timeline, sfx: [{ ...sfx[0], startSample: timeline.eventSamples["lifetime-total-reveal"] + 480 }] }, out("shifted")), /timing/i);
  await assert.rejects(renderMasterAudio({ beats, timeline, sfx: [{ ...sfx[0], assetRef: "unlicensed-file", licenseStatus: "unknown" }] }, out("rights")), /license|rights/i);
  await assert.rejects(renderMasterAudio({ beats, timeline, sfx }, { outputDir: join(dir, "no-test-permission") }), /test-only|permission/i);
  await assert.rejects(renderMasterAudio({ beats: [{ ...beats[0], wavPath: "/missing.wav" }, beats[1]], timeline, sfx }, out("missing-audio")), /missing|read|speech/i);
  const wrongRate = await fixture(t, { sampleRate: 16000 });
  await assert.rejects(renderMasterAudio({ beats: wrongRate.beats, timeline: wrongRate.timeline, sfx: wrongRate.sfx }, { outputDir: join(wrongRate.dir, "wrong"), allowTestAssets: true }), /48 kHz|sample.rate|format/i);
  const clipped = await fixture(t, { amplitude: 32767 });
  await assert.rejects(renderMasterAudio({ beats: clipped.beats, timeline: clipped.timeline, sfx: clipped.sfx }, { outputDir: join(clipped.dir, "clip"), allowTestAssets: true }), /clipp/i);
  const silent = await fixture(t, { amplitude: 0 });
  await assert.rejects(renderMasterAudio({ beats: silent.beats, timeline: silent.timeline, sfx: silent.sfx }, { outputDir: join(silent.dir, "silent"), allowTestAssets: true }), /silence|silent/i);
  const halfSilent = await fixture(t);
  const silentPayoffBytes = toneWav(48000, 0);
  await writeFile(halfSilent.beats[1].wavPath, silentPayoffBytes);
  halfSilent.beats[1].sha256 = sha256(silentPayoffBytes);
  await assert.rejects(renderMasterAudio({ beats: halfSilent.beats, timeline: halfSilent.timeline, sfx: halfSilent.sfx }, { outputDir: join(halfSilent.dir, "half-silent"), allowTestAssets: true }), /silence|silent/i);
});
