import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchStudioSources, loadStudioSearch, listStudioSearches, validateStudioSearchMatch } from "./studio-search.mjs";

const brief = { title: "Heat pump costs", viewerQuestion: "Why are heat pumps expensive?", audience: "Homeowners", locale: "en-US" };
const leads = [
  { title: "DOE Heat Pumps", url: "https://www.energy.gov/heat-pumps", snippet: "Efficiency depends on climate." },
  { title: "Efficiency data", url: "https://www.example.org/data", snippet: "Heat pump installation cost varies." },
];

test("search-only returns source leads immediately and saves an immutable, restorable local search", async t => {
  const root = await mkdtemp(join(tmpdir(), "cg-search-only-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let count = 0;
  const result = await searchStudioSources(brief, {
    root, searchEndpoint: "http://127.0.0.1:58023/search",
    search: async query => { count++; assert.equal(query, brief.viewerQuestion); return leads; },
    now: () => new Date("2026-10-24T01:52:50.000Z"),
  });
  assert.equal(count, 1);
  assert.match(result.artifactId, /^search_20261024T015250000Z-[a-f0-9]{12}$/u);
  assert.deepEqual(result.results, leads);
  assert.equal(result.kind, "studio-search-snapshot");
  assert.equal(result.query, brief.viewerQuestion);
  assert.equal((await readdir(root)).length, 1);
  assert.deepEqual(await loadStudioSearch(result.artifactId, { root }), result);
  const listed = await listStudioSearches({ root });
  assert.equal(listed[0].artifactId, result.artifactId);
  assert.equal(listed[0].resultCount, 2);
  validateStudioSearchMatch(result, brief);
  assert.throws(() => validateStudioSearchMatch(result, { ...brief, viewerQuestion: "Different question" }), /does not match/i);
});

test("search refuses empty result sets and unsafe saved leads", async t => {
  const root = await mkdtemp(join(tmpdir(), "cg-search-empty-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(searchStudioSources(brief, { root, searchEndpoint: "http://127.0.0.1:58023/search", search: async () => [] }), /no usable public sources/i);
  await assert.rejects(searchStudioSources(brief, { root, searchEndpoint: "http://127.0.0.1:58023/search", search: async () =>
    [{ title: "Private", url: "http://127.0.0.1/admin" }] }), /no usable public sources/i);
  assert.deepEqual(await readdir(root), []);
});

test("saved search validates file path, content digest, and prevents tampered reuse", async t => {
  const root = await mkdtemp(join(tmpdir(), "cg-search-integrity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await searchStudioSources(brief, { root, searchEndpoint: "http://127.0.0.1:58023/search", search: async () => leads });
  await assert.rejects(loadStudioSearch("../../etc/passwd", { root }), /artifact ID/i);
  const file = join(root, result.artifactId + ".json");
  const saved = JSON.parse(await readFile(file, "utf8"));
  saved.results[0].url = "https://attacker.example/misrepresented";
  await writeFile(file, JSON.stringify(saved));
  await assert.rejects(loadStudioSearch(result.artifactId, { root }), /digest|tamper/i);
});
