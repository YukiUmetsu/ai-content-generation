import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inspectProduction, parseCliArgs, validateOutputTarget } from "./cli.mjs";

const job = JSON.parse(readFileSync(new URL("../../../../examples/video-production-house-math-smoke.json", import.meta.url), "utf8"));

test("reads CLI flags and refuses unknown arguments", () => {
  assert.deepEqual(parseCliArgs(["--", "--job", "./fixture.json", "--provider", "fish", "--allow-network", "--dry-run", "--out", "./output"]).provider, "fish");
  assert.throws(() => parseCliArgs(["--mystery"]), /unknown/i);
});

test("dry-run inspects config without sending requests or rendering", async () => {
  let toolChecks = 0;
  const result = await inspectProduction(job, {
    dryRun: true,
    provider: "fish",
    allowNetwork: false,
    budgetUsd: 0,
    out: "./production-output",
    env: { FISH_AUDIO_API_KEY: "private-token" },
    probeTool: async () => { toolChecks += 1; return { available: true, version: "test" }; },
  });
  assert.equal(toolChecks, 3);
  assert.equal(result.networkAllowed, false);
  assert.equal(result.provider, "fish");
  assert.equal(result.findings.some((item) => item.code === "network-not-approved"), true);
  assert.equal(JSON.stringify(result).includes("private-token"), false);
});

test("does not accept broad or dangerous output directories", () => {
  assert.throws(() => validateOutputTarget("/"), /output/i);
  assert.throws(() => validateOutputTarget("/tmp"), /output/i);
  assert.throws(() => validateOutputTarget(process.cwd()), /output/i);
  assert.match(validateOutputTarget("./owned-output"), /owned-output$/);
});
