import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readModelProfiles, saveModelProfiles, validateModelProfiles, resolveModelForTaskSync,
  resolveModelForTask } from "./model-profiles.mjs";

const magna = "http://127.0.0.1:10100/inference/v1/chat/completions";
const ollama = "http://127.0.0.1:11434/v1/chat/completions";
const config = { version: 1,
  profiles: [{ id: "a", name: "Research on Magnitude", provider: "magnitude", endpoint: magna, model: "qwen3.6-35b-a3b" },
    { id: "b", name: "Fast drafts", provider: "ollama", endpoint: ollama, model: "qwen3:8b" }],
  defaultProfileId: "b", assignments: { research: "a", story: "b", hooks: "a", script: "b" } };

test("validates independent assignments and explicit Custom identity", () => {
  const saved = validateModelProfiles(config);
  assert.equal(saved.profiles[0].endpoint, magna);
  assert.equal(saved.assignments.research, "a");
  assert.equal(validateModelProfiles({ ...config, profiles: [{ ...config.profiles[0], provider: "custom" }, config.profiles[1]] }).profiles[0].provider, "custom");
  for (const task of ["research", "story", "hooks", "script"])
    assert.equal(saved.assignments[task], config.assignments[task]);
});
test("rejects unsafe, malformed, orphaned and duplicated profiles", () => {
  const altered = p => [{ ...config.profiles[0], ...p }, config.profiles[1]];
  for (const value of ["http://example.com/v1/chat/completions", "http://127.0.0.1:10100/metrics", "http://user:pw@127.0.0.1:10100/v1/chat/completions", "http://127.0.0.1:10100/v1/chat/completions?token=secret"])
    assert.throws(() => validateModelProfiles({ ...config, profiles: altered({ endpoint: value }) }));
  assert.throws(() => validateModelProfiles({ ...config, profiles: [...config.profiles, config.profiles[0]] }), /duplicate/i);
  assert.throws(() => validateModelProfiles({ ...config, assignments: { research: "missing" } }), /profile|assignment/i);
  assert.throws(() => validateModelProfiles({ ...config, assignments: { unknown: "a" } }), /task|assignment/i);
  assert.throws(() => validateModelProfiles({ ...config, password: "not allowed" }));
});
test("saved profiles reload; every task selects its configured model; fallback uses legacy without overwriting it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "contentgen-ai-profiles-"));
  const path = join(dir, "profiles.json"), legacyPath = join(dir, "legacy.json");
  await writeFile(legacyPath, JSON.stringify({ version: 1, endpoint: ollama, model: "legacy" }));
  const before = await readModelProfiles(path, legacyPath);
  assert.equal(before.profiles[0].model, "legacy");
  await saveModelProfiles(config, path);
  assert.deepEqual(await readModelProfiles(path, legacyPath), config);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await resolveModelForTask("research", { path, legacyPath })).model, "qwen3.6-35b-a3b");
  assert.equal(resolveModelForTaskSync("story", { path, legacyPath }).model, "qwen3:8b");
  assert.equal(resolveModelForTaskSync("hooks", { path, legacyPath }).endpoint, magna);
  assert.equal(resolveModelForTaskSync("script", { path, legacyPath }).endpoint, ollama);
  assert.match(await readFile(legacyPath, "utf8"), /legacy/);
});
