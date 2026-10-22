import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { renderVideoSegments } from "./render.mjs";

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, bytes) {
  const type = Buffer.from(name);
  const header = Buffer.alloc(4); header.writeUInt32BE(bytes.length);
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([type, bytes])));
  return Buffer.concat([header, type, bytes, tail]);
}
function pngFrame(color) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(32, 0); ihdr.writeUInt32BE(18, 4); ihdr[8] = 8; ihdr[9] = 6;
  const pixels = Buffer.alloc(18 * (1 + 32 * 4));
  for (let y = 0; y < 18; y++) for (let x = 0; x < 32; x++) {
    const at = y * 129 + 1 + x * 4;
    pixels.set([color, 64, 180, 255], at);
  }
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

const config = (dir, frames = 301) => ({
  stageUrl: "http://127.0.0.1:4545/video-export.html",
  manifest: { schemaVersion: 1, id: "smoke", width: 32, height: 18, fps: { num: 30, den: 1 }, durationFrames: frames },
  planHash: "f".repeat(64), outDir: dir, maxBatchFrames: 150,
});

async function harness(t) {
  const dir = await mkdtemp(join(tmpdir(), "contentgen-render-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let opened = 0, encoded = 0, captured = [], batchSizes = [], concatCalls = 0;
  const dependencies = {
    openCapture: async (stageUrl, expected) => {
      opened++;
      assert.match(stageUrl, /^http:\/\/127\.0\.0\.1/);
      return {
        manifest: expected,
        captureFrame: async (frame, path) => {
          captured.push(frame);
          await writeFile(path, Buffer.from(`png-frame-${frame}`));
        },
        close: async () => {},
      };
    },
    encodeBatch: async (batch) => {
      encoded++;
      batchSizes.push(batch.frameCount);
      assert.ok(batch.frameCount <= 150);
      await writeFile(batch.outputPath, Buffer.from(`encoded:${batch.startFrame}:${batch.frameCount}`));
    },
    probeSegment: async (path) => {
      const text = await readFile(path, "utf8");
      if (!text.startsWith("encoded:")) throw new Error("corrupt segment");
      return { frameCount: Number(text.split(":")[2]), width: 32, height: 18, fps: { num: 30, den: 1 } };
    },
    concatSegments: async (paths, finalPath) => {
      concatCalls++;
      const content = (await Promise.all(paths.map((p) => readFile(p, "utf8")))).join("|");
      await writeFile(finalPath, content);
    },
    probeFinal: async (path) => {
      const str = await readFile(path, "utf8");
      return { frameCount: str.split("|").reduce((s, part) => s + Number(part.split(":")[2]), 0), width: 32, height: 18, fps: { num: 30, den: 1 } };
    },
  };
  return { dir, dependencies, stats: () => ({ opened, encoded, captured, batchSizes, concatCalls }) };
}

test("301 frames use verified 150+150+1 segments and only absolute seeks", async (t) => {
  const { dir, dependencies, stats } = await harness(t);
  const result = await renderVideoSegments(config(dir), dependencies);
  assert.deepEqual(stats().batchSizes, [150, 150, 1]);
  assert.deepEqual(stats().captured, Array.from({ length: 301 }, (_, i) => i));
  assert.equal(result.frameCount, 301);
  assert.equal(result.segmentHashes.length, 3);
  assert.match(result.videoOnlyPath, /video-only\.mp4$/);
  assert.equal((await readdir(dir)).some((file) => file.startsWith(".capture-")), false, "only the owned PNG batch is reclaimed");
});

test("resume validates hash, manifest and probe before skipping completed segments", async (t) => {
  const { dir, dependencies, stats } = await harness(t);
  await renderVideoSegments(config(dir, 151), dependencies);
  const firstCount = stats().captured.length;
  const second = await renderVideoSegments(config(dir, 151), dependencies);
  assert.equal(stats().captured.length, firstCount);
  assert.equal(stats().encoded, 2);
  assert.equal(second.segmentHashes.length, 2);
  await writeFile(join(dir, "segments", "segment-00000.mp4"), "tampered");
  await assert.rejects(renderVideoSegments(config(dir, 151), dependencies), /hash|corrupt|resume/i);
});

test("capture abort leaves verified segments but never publishes an incomplete MP4", async (t) => {
  const { dir, dependencies } = await harness(t);
  let closed = false;
  const priorOpen = dependencies.openCapture;
  dependencies.openCapture = async (...args) => {
    const driver = await priorOpen(...args);
    return { ...driver, captureFrame: async (frame, path) => {
      if (frame === 151) throw new Error("simulated browser crash");
      return driver.captureFrame(frame, path);
    }, close: async () => { closed = true; } };
  };
  await assert.rejects(renderVideoSegments(config(dir), dependencies), /browser crash/);
  assert.equal(closed, true);
  const children = await readdir(dir);
  assert.equal(children.includes("video-only.mp4"), false);
  assert.equal(children.some((item) => item.startsWith(".capture-")), false);
  assert.ok((await readdir(join(dir, "segments"))).includes("segment-00000.mp4"));
});

test("unsafe endpoint, excessive batch, invalid hash and unsafe directory fail before browser work", async (t) => {
  const { dir, dependencies, stats } = await harness(t);
  await assert.rejects(renderVideoSegments({ ...config(dir), stageUrl: "https://external.example/" }, dependencies), /loopback/i);
  await assert.rejects(renderVideoSegments({ ...config(dir), maxBatchFrames: 151 }, dependencies), /150/i);
  await assert.rejects(renderVideoSegments({ ...config(dir), planHash: "???" }, dependencies), /hash/i);
  await assert.rejects(renderVideoSegments({ ...config(dir), outDir: "/" }, dependencies), /output|root|directory/i);
  assert.equal(stats().opened, 0);
});

test("manifest mismatch aborts before recording any frame", async (t) => {
  const { dir, dependencies, stats } = await harness(t);
  dependencies.openCapture = async () => ({
    manifest: { ...config(dir).manifest, width: 100 },
    captureFrame: async () => { throw new Error("no capture should start"); },
    close: async () => {},
  });
  await assert.rejects(renderVideoSegments(config(dir), dependencies), /manifest/i);
  assert.equal(stats().encoded, 0);
});

test("real FFmpeg encodes two batches and probes a complete H.264 MP4", { skip: spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0 || spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status !== 0 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "contentgen-render-integration-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await renderVideoSegments({ ...config(dir, 3), maxBatchFrames: 2 }, {
    openCapture: async (_url, manifest) => ({
      manifest,
      captureFrame: async (frame, path) => writeFile(path, pngFrame(30 + frame * 50)),
      close: async () => {},
    }),
  });
  assert.equal(result.frameCount, 3);
  assert.equal(result.segmentHashes.length, 2);
  assert.equal(result.peakScratchBytes > 0, true);
  assert.ok((await readFile(result.videoOnlyPath)).length > 1000);
});

test("captures bounded verified review stills, reuses them on resume and rejects tampering", async (t) => {
  const { dir, dependencies, stats } = await harness(t);
  const originalOpen = dependencies.openCapture;
  dependencies.openCapture = async (...args) => {
    const driver = await originalOpen(...args);
    return { ...driver, captureFrame: (frame, path) => {
      if (path.includes("/stills/")) return writeFile(path, pngFrame(frame % 255));
      return driver.captureFrame(frame, path);
    } };
  };
  const requested = { ...config(dir, 151), reviewFrames: [0, 75, 150] };
  const first = await renderVideoSegments(requested, dependencies);
  assert.deepEqual(first.reviewStills.map((item) => item.frame), [0, 75, 150]);
  for (const item of first.reviewStills) {
    const bytes = await readFile(item.path);
    assert.equal(item.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  }
  const calls = stats().captured.length;
  const second = await renderVideoSegments(requested, dependencies);
  assert.equal(stats().captured.length, calls, "no segment or preview frame recapture on verified resume");
  assert.deepEqual(second.reviewStills, first.reviewStills);
  await writeFile(first.reviewStills[0].path, "tampered");
  await assert.rejects(renderVideoSegments(requested, dependencies), /review still|hash|corrupt/i);
});

test("invalid review frame requests fail before allocating media resources", async (t) => {
  const { dir, dependencies, stats } = await harness(t);
  await assert.rejects(renderVideoSegments({ ...config(dir, 151), reviewFrames: [151] }, dependencies), /review frame/i);
  await assert.rejects(renderVideoSegments({ ...config(dir, 151), reviewFrames: [0, 0] }, dependencies), /review frame/i);
  await assert.rejects(renderVideoSegments({ ...config(dir, 151), reviewFrames: Array.from({ length: 6 }, (_, i) => i) }, dependencies), /review frame/i);
  assert.equal(stats().opened, 0);
});
