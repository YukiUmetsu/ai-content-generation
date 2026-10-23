/**
 * One-command, explicit Docker lifecycle for ContentGen's loopback SearXNG.
 * Never starts on application boot; never downloads an image without consent.
 * Docker and configuration management stay outside the research data model.
 */
import { execFile } from "node:child_process";

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";

export const SEARCH_IMAGE = "ghcr.io/searxng/searxng:latest";
import { COMPOSE_FILE, SECRET_FILE, ensureLocalSearchConfig, configuredSearchEndpoint, localSearchUrl, portIsAvailable } from "./local-search-config.mjs";
export const SEARCH_URL = "http://127.0.0.1:8080"; // legacy constant retained for existing callers; runtime uses persisted port

const exec = promisify(execFile);

function cliError(error) {
  return String(error?.stderr || error?.message || error).replace(/\s+/gu, " ").slice(0, 360);
}
/** Never use shells or string interpolation for Docker arguments. */
export async function dockerCommand(args) {
  try {
    const { stdout } = await exec("docker", args, {
      encoding: "utf8", timeout: args[0] === "pull" ? 300000 : 60000,
      maxBuffer: 64 * 1024, windowsHide: true,
    });
    return stdout.trim();
  } catch (error) {
    throw Error("Docker command failed: " + cliError(error));
  }
}
export function composeArgs(args, envFile = SECRET_FILE) {
  return ["compose", "--project-directory", dirname(COMPOSE_FILE),
    "--env-file", envFile, "-f", COMPOSE_FILE, ...args];
}
export function parseSearchManagerArgs(argv) {
  // pnpm forwards an optional "--" separator; don't interpret it as a positional.
  const normalizedArgs = argv.filter(argument => argument !== "--");
  const { values, positionals } = parseArgs({ args: normalizedArgs, strict: true, allowPositionals: true,
    options: {
      help: { type: "boolean", default: false },
      "allow-image-pull": { type: "boolean", default: false },
    } });
  if (values.help) return { help: true };
  if (positionals.length !== 1 || !["up", "down", "status", "check"].includes(positionals[0]))
    throw Error("Use up, down, status or check; run --help for setup.");
  if (values["allow-image-pull"] && positionals[0] !== "up")
    throw Error("--allow-image-pull applies to up only.");
  return { operation: positionals[0], allowImagePull: values["allow-image-pull"] };
}

/** Legacy exported helper; now provisions the full secret + random port config. */
export async function ensureLocalSecret(options = {}) {
  const config = await ensureLocalSearchConfig(options);
  return options.returnConfig ? config : config.created ? "created" : "existing";
}
export async function confirmImageDownload() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await reader.question(
      "First setup downloads the official SearXNG image (may exceed 250 MB). Continue? [y/N] ");
    return /^y(?:es)?$/iu.test(answer.trim());
  } finally {
    reader.close();
  }
}

/** Root route is local-only; JSON smoke-check is separate and calls search engines. */
export async function checkLocalSearch({ transport = fetch, search = false, endpoint = configuredSearchEndpoint() } = {}) {
  if (!endpoint) return { ok: false, reason: "No local search configuration. Run pnpm research:up." };
  const origin = new URL(endpoint).origin;
  const url = search ? endpoint + "?q=contentgen+local+search+check&format=json" : origin + "/";
  try {
    const response = await transport(url, {
      redirect: "error", signal: AbortSignal.timeout(search ? 15000 : 4000),
    });
    if (!response.ok) {
      const suffix = response.status === 403 ? " (JSON disabled; check settings.yml search.formats)" : "";
      return { ok: false, reason: "HTTP " + response.status + suffix };
    }
    if (search) {
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.results))
        return { ok: false, reason: "Search returned no SearXNG JSON results array." };
      return { ok: true, results: payload.results.length };
    }
    const content = await response.text();
    if (!/searxng/iu.test(content.slice(0, 100000)))
      return { ok: false, reason: "Configured search port is occupied by a different HTTP server." };
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: cliError(error) };
  }
}
const defaultDelay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function manageLocalSearch(argv, {
  command = dockerCommand, confirm = confirmImageDownload, check = checkLocalSearch,
  secret = ensureLocalSecret, delay = defaultDelay, log = console.log,
} = {}) {
  const options = parseSearchManagerArgs(argv);
  if (options.help) {
    log("ContentGen local SearXNG search (Docker Desktop required; no external/paid search API).");
    log("pnpm research:up     # starts local search; prompts before first image download");
    log("pnpm research:down   # stops only this Compose project; keeps local cache and secret");
    log("pnpm research:status # shows Compose status and local endpoint health");
    log("pnpm research:check  # explicitly tests real JSON search through configured engines");
    log("For headless first setup only: pnpm research:up -- --allow-image-pull");
    return { help: true };
  }
  const { operation, allowImagePull } = options;
  if (operation === "status") {
    const health = await check();
    try {
      await command(["compose", "version"]);
      // Don't invoke Compose without an initialized secret: missing secret is not failure.
      const existing = await readFile(SECRET_FILE, "utf8").catch(() => "");
      const state = existing ? await command(composeArgs(["ps"])) : "Not yet initialized.";
      log(state);
    } catch (error) {
      log("Docker status unavailable: " + cliError(error));
    }
    log(health.ok ? "SearXNG responds on " + (configuredSearchEndpoint() ?? "") : "SearXNG not ready: " + health.reason);
    return { ...health, operation };
  }
  if (operation === "check") {
    const health = await check({ search: true });
    log(health.ok
      ? "SearXNG JSON search works at " + configuredSearchEndpoint() + " (results: " + health.results + ")"
      : "SearXNG JSON check failed: " + health.reason);
    return { ...health, operation };
  }
  try {
    await command(["--version"]);
    await command(["compose", "version"]);
    await command(["info", "--format", "{{.ServerVersion}}"]);
  } catch (error) {
    throw Error("Docker Desktop and Docker Compose must be installed and running. " + cliError(error));
  }
  if (operation === "down") {
    const existing = await readFile(SECRET_FILE, "utf8").catch(() => "");
    if (!existing) {
      log("No ContentGen SearXNG instance has been initialized.");
      return { ok: true, operation, skipped: true };
    }
    await command(composeArgs(["down"]));
    log("Stopped ContentGen SearXNG. Cache and generated secret were preserved.");
    return { ok: true, operation };
  }
  // Creating the config is non-network local work; it does not pull or start a container.
  // Image permission is checked first to avoid filesystem changes on refusal.
  let imagePresent = false;
  try { await command(["image", "inspect", SEARCH_IMAGE]); imagePresent = true; }
  catch { /* image is missing; Docker daemon was already checked above */ }
  if (!imagePresent) {
    if (!allowImagePull && !await confirm()) {
      throw Error("Official image download was not approved. Run interactively or use pnpm research:up -- --allow-image-pull.");
    }
    await command(["pull", SEARCH_IMAGE]);
  }
  const config = await secret({ returnConfig: true });
  const portFree = await portIsAvailable(config.port);
  // A previously running container may own its persisted port; do not move it.
  if (!portFree) {
    const health = await check({ endpoint: config.endpoint });
    if (!health.ok) throw Error("Configured search port " + config.port + " is occupied. Stop the conflicting service, then rerun.");
  }
  await command(composeArgs(["up", "-d", "--pull", "never"]));
  for (let attempt = 0; attempt < 20; attempt++) {
    const health = await check({ endpoint: config.endpoint });
    if (health.ok) {
      log("ContentGen SearXNG is ready: " + localSearchUrl(config));
      log("Research CLI uses " + config.endpoint + " automatically.");
      return { ok: true, operation, endpoint: config.endpoint };
    }
    if (health.reason?.includes("different HTTP server"))
      throw Error(health.reason);
    if (attempt < 19) await delay(800);
  }
  throw Error("SearXNG was started but is not yet responding. Try pnpm research:status and docker compose -f tools/searxng/compose.yaml logs.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
  manageLocalSearch(process.argv.slice(2)).then(out => {
    if (out.ok === false) process.exitCode = 2;
  }).catch(error => { console.error(String(error.message || error)); process.exitCode = 2; });
