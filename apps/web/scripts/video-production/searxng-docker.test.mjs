import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, stat, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSearchManagerArgs, ensureLocalSecret, composeArgs, checkLocalSearch,
  manageLocalSearch, SEARCH_IMAGE, SEARCH_URL, COMPOSE_FILE } from "./searxng-docker.mjs";

const commands = () => {
  const received = [];
  const fn = async args => {
    received.push(args);
    if (args[0] === "image" && args[1] === "inspect") throw Error("image not installed");
    return "mock docker";
  };
  return { received, fn };
};

test("repository Compose configuration is localhost-only, JSON-capable and uses isolated secret", async () => {
  const compose = await readFile(COMPOSE_FILE, "utf8");
  const settings = await readFile(new URL("../../../../tools/searxng/settings.yml", import.meta.url), "utf8");
  const ignore = await readFile(new URL("../../../../tools/searxng/.gitignore", import.meta.url), "utf8");
  assert.match(compose, /127\.0\.0\.1:\$\{SEARXNG_PORT[^}]*\}:8080/u);
  assert.doesNotMatch(compose, /0\.0\.0\.0:8080/u);
  assert.match(compose, /SEARXNG_SECRET/u);
  assert.match(compose, /settings\.yml:ro/u);
  assert.match(settings, /use_default_settings: true/u);
  assert.match(settings, /formats:\s*\n\s+- html\s*\n\s+- json/u);
  assert.match(ignore, /^\.env\s*$/u);
  assert.ok(composeArgs(["up", "-d", "--pull", "never"]).includes("--env-file"));
});

test("CLI only accepts known local lifecycle operations and explicit pull permission", () => {
  assert.deepEqual(parseSearchManagerArgs(["up"]), { operation: "up", allowImagePull: false });
  assert.deepEqual(parseSearchManagerArgs(["up", "--allow-image-pull"]), { operation: "up", allowImagePull: true });
  assert.deepEqual(parseSearchManagerArgs(["up", "--", "--allow-image-pull"]), { operation: "up", allowImagePull: true });
  assert.throws(() => parseSearchManagerArgs(["down", "--allow-image-pull"]), /applies to up/);
  assert.throws(() => parseSearchManagerArgs(["oops"]), /up, down/);
  assert.equal(parseSearchManagerArgs(["--help"]).help, true);
});

test("bootstrap creates private secret once, never overwrites existing or unusual content", async t => {
  const root = await mkdtemp(join(tmpdir(), "contentgen-search-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, ".env");
  const random = () => Buffer.alloc(32, 0x2b);
  assert.equal(await ensureLocalSecret({ file: path, random }), "created");
  const original = await readFile(path, "utf8");
  assert.match(original, new RegExp("^SEARXNG_SECRET=" + "2b".repeat(32) + "\\nSEARXNG_PORT=\\d{5}\\n$"));
  assert.equal((await stat(path)).mode & 0o077, 0);
  assert.equal(await ensureLocalSecret({ file: path, random: () => { throw Error("regenerated"); } }), "existing");
  assert.equal(await readFile(path, "utf8"), original);
  await writeFile(path, "SEARXNG_SECRET=not-valid\n");
  await assert.rejects(ensureLocalSecret({ file: path }), /inspect it manually/);
});

test("local check distinguishes healthy SearXNG, wrong port listener, JSON disabled and correct API", async () => {
  const ok = await checkLocalSearch({ endpoint: SEARCH_URL + "/search", transport: async () => new Response("<title>SearXNG</title>") });
  assert.equal(ok.ok, true);
  const foreign = await checkLocalSearch({ endpoint: SEARCH_URL + "/search", transport: async () => new Response("<title>my other app</title>") });
  assert.match(foreign.reason, /different HTTP server/);
  const denied = await checkLocalSearch({ search: true, endpoint: SEARCH_URL + "/search", transport: async () => new Response("not allowed", { status: 403 }) });
  assert.match(denied.reason, /JSON disabled/);
  const json = await checkLocalSearch({ search: true, endpoint: SEARCH_URL + "/search", transport: async url => {
    assert.equal(new URL(url).host, "127.0.0.1:8080");
    assert.equal(new URL(url).searchParams.get("format"), "json");
    return new Response(JSON.stringify({ results: [{ title: "x" }] }), { status: 200 });
  } });
  assert.deepEqual(json, { ok: true, results: 1 });
});

test("missing Docker reports helpful error, without secret creation or image pull", async () => {
  let wrote = false;
  await assert.rejects(manageLocalSearch(["up"], {
    command: async () => { throw Error("ENOENT"); },
    secret: async () => { wrote = true; },
    check: async () => ({ ok: false, reason: "not running" }),
    log: () => {},
  }), /Docker Desktop and Docker Compose/);
  assert.equal(wrote, false);
});

test("first start without image consent neither pulls nor changes secrets", async () => {
  const { received, fn } = commands();
  let wrote = false;
  await assert.rejects(manageLocalSearch(["up"], {
    command: fn, confirm: async () => false,
    check: async () => ({ ok: false, reason: "ECONNREFUSED" }),
    secret: async () => { wrote = true; }, log: () => {},
  }), /download was not approved/);
  assert.equal(wrote, false);
  assert.equal(received.some(args => args[0] === "pull"), false);
  assert.equal(received.some(args => args.includes("up")), false);
});

test("approved first launch pulls official image and starts only its Compose project", async () => {
  const { received, fn } = commands();
  let started = false;
  const result = await manageLocalSearch(["up", "--allow-image-pull"], {
    command: async args => { const result = await fn(args); if (args.includes("up")) started = true; return result; },
    secret: async () => ({port:55021,endpoint:"http://127.0.0.1:55021/search"}),
    check: async () => started ? { ok: true } : { ok: false, reason: "ECONNREFUSED" },
    delay: async () => {}, log: () => {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.endpoint, "http://127.0.0.1:55021/search");
  assert.deepEqual(received.find(args => args[0] === "pull"), ["pull", SEARCH_IMAGE]);
  const start = received.find(args => args.includes("up"));
  assert.ok(start.includes(COMPOSE_FILE));
  assert.deepEqual(start.slice(-4), ["up", "-d", "--pull", "never"]);
});

test("existing image starts without pull; occupied port is refused", async () => {
  const { received } = commands();
  let started = false;
  const cmd = async args => {
    received.push(args);
    if (args.includes("up")) started = true;
    return "ok";
  };
  const result = await manageLocalSearch(["up"], {
    command: cmd, secret: async () => ({port:55021,endpoint:"http://127.0.0.1:55021/search"}),
    check: async () => started ? { ok: true } : { ok: false, reason: "ECONNREFUSED" },
    log: () => {},
  });
  assert.equal(result.ok, true);
  assert.equal(received.some(args => args[0] === "pull"), false);
  await assert.rejects(manageLocalSearch(["up"], {
    command: cmd, secret: async () => ({port:55021,endpoint:"http://127.0.0.1:55021/search"}), check: async () => ({ ok: false, reason: "Configured search port is occupied by a different HTTP server." }),
    log: () => {},
  }), /occupied/);
});

test("check never starts Docker, and down never deletes volumes or generated secrets", async () => {
  let calls = 0;
  const result = await manageLocalSearch(["check"], {
    command: async () => { calls++; throw Error("must not run"); },
    check: async ({ search }) => { assert.equal(search, true); return { ok: true, results: 2 }; },
    log: () => {},
  });
  assert.equal(result.ok, true);
  assert.equal(calls, 0);
  const stopped = await manageLocalSearch(["down"], {
    command: async args => {
      if (args[0] === "compose" && args.includes("down")) {
        assert.deepEqual(args.slice(-1), ["down"]);
        assert.ok(!args.includes("-v"));
      }
      return "ok";
    },
    log: () => {},
  });
  assert.equal(stopped.ok, true);
});
