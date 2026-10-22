import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTopicCli, runTopicCli } from "./topic-cli.mjs";

test("topic CLI accepts clear model/topic flags, not implicit paid or portrait modes", () => {
  const opts = parseTopicCli(["--topic", "How do clocks work?", "--audience", "curious adults", "--model", "local-model", "--out", "draft-job.json"]);
  assert.equal(opts.topic, "How do clocks work?");
  assert.equal(opts.mode, "smoke");
  assert.throws(() => parseTopicCli(["--mode", "portrait"]), /mode|smoke|long/i);
});

test("topic CLI has a discoverable help screen with no model invocation", async () => {
  const lines = [];
  const result = await runTopicCli(["--help"], { generate: async () => { throw new Error("must not call model"); }, logger: (value) => lines.push(value) });
  assert.equal(result, null);
  assert.match(lines.join("\n"), /--topic|--audience|--endpoint|--mode|--locale|--out/);
});

test("topic CLI creates a new editable job without overwriting a previous one or invoking TTS", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "contentgen-topic-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const out = join(root, "video-job.json");
  let calls = 0;
  const generate = async () => { calls++; return { job: { kind: "video-production-job", id: "sample" } }; };
  await runTopicCli(["--topic", "How do clocks work?", "--audience", "learners", "--model", "local", "--out", out], { generate });
  assert.equal(JSON.parse(await readFile(out, "utf8")).id, "sample");
  await assert.rejects(runTopicCli(["--topic", "How do clocks work?", "--audience", "learners", "--model", "local", "--out", out], { generate }), /EEXIST/i);
  assert.equal(calls, 2);
});
