/** ContentGen's opt-in research collector. Never publishes or declares facts verified. */
import { access, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, parse, resolve } from "node:path";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { researchVideoTopic, localSearxngEndpoint } from "./research-agent.mjs";
import { localChatEndpoint } from "./topic-generator.mjs";

export function parseResearchArgs(argv, env = process.env) {
  const { values } = parseArgs({ args: argv, strict: true, allowPositionals: false, options: {
    help: { type: "boolean", default: false },
    topic: { type: "string" }, question: { type: "string" }, audience: { type: "string" },
    locale: { type: "string", default: "en-US" },
    model: { type: "string" }, endpoint: { type: "string", default: "http://127.0.0.1:11434/v1/chat/completions" },
    "search-provider": { type: "string", default: "searxng" },
    "search-endpoint": { type: "string", default: "http://127.0.0.1:8080/search" },
    "max-sources": { type: "string", default: "4" },
    "allow-network": { type: "boolean", default: false },
    "approve-search-charges": { type: "boolean", default: false },
    "out-dir": { type: "string" },
  } });
  if (values.help) return { help: true };
  for (const key of ["topic", "audience", "model", "out-dir"])
    if (!values[key]?.trim()) throw Error("Missing required --" + key + ".");
  if (!["en-US", "ja-JP"].includes(values.locale)) throw Error("--locale must be en-US or ja-JP.");
  if (!values["allow-network"]) throw Error("Research requires explicit --allow-network for public web page retrieval.");
  const searchProvider = values["search-provider"];
  if (!["searxng", "brave"].includes(searchProvider)) throw Error("--search-provider must be searxng or brave.");
  if (searchProvider === "searxng") localSearxngEndpoint(values["search-endpoint"]);
  if (searchProvider === "brave" && !values["approve-search-charges"])
    throw Error("Brave may incur charges; explicitly opt in with --approve-search-charges or use local SearXNG.");
  if (searchProvider === "brave" && !env.BRAVE_SEARCH_API_KEY?.trim())
    throw Error("Set BRAVE_SEARCH_API_KEY for opt-in Brave discovery.");
  localChatEndpoint(values.endpoint);
  if (values.model.length > 120 || /[\u0000-\u001f]/u.test(values.model))
    throw Error("Installed model identifier is invalid.");
  const maxSources = Number(values["max-sources"]);
  if (!Number.isInteger(maxSources) || maxSources < 1 || maxSources > 6)
    throw Error("--max-sources must be 1–6.");
  const outDir = resolve(values["out-dir"]);
  if ([parse(outDir).root, homedir(), process.cwd(), dirname(process.cwd())].includes(outDir) ||
    basename(outDir) === "." || basename(outDir) === "..")
    throw Error("--out-dir must name a narrow new output directory.");
  return {
    brief: { title: values.topic, viewerQuestion: values.question || values.topic,
      audience: values.audience, locale: values.locale },
    options: { provider: searchProvider, searchEndpoint: values["search-endpoint"],
      braveApiKey: searchProvider === "brave" ? env.BRAVE_SEARCH_API_KEY : undefined,
      model: values.model, endpoint: values.endpoint, allowNetwork: true, maxSources },
    outDir,
  };
}
export async function runResearchCli(argv, { research = researchVideoTopic, log = console.log, env = process.env } = {}) {
  const args = parseResearchArgs(argv, env);
  if (args.help) {
    log("Usage: pnpm video:research --topic TEXT --question TEXT --audience TEXT --model INSTALLED_MODEL --allow-network --out-dir NEW_DIR");
    log("Defaults: --search-provider searxng --search-endpoint http://127.0.0.1:8080/search --endpoint http://127.0.0.1:11434/v1/chat/completions");
    log("Optional Brave: --search-provider brave --approve-search-charges with BRAVE_SEARCH_API_KEY set.");
    log("Explicit network permission required; model stays on loopback. No media, provider voice, verification, or publishing.");
    return null;
  }
  const output = await research(args.brief, args.options);
  // Check output uniqueness before writing. mkdir (without recursive) also rejects a race.
  try { await access(args.outDir); throw Error("Output directory exists; never overwrite prior research."); }
  catch (e) { if (e.code !== "ENOENT") throw e; }
  await mkdir(args.outDir, { mode: 0o700 });
  await mkdir(resolve(args.outDir, "captures"), { mode: 0o700 });
  for (const capture of output.captures)
    await writeFile(resolve(args.outDir, "captures", capture.id + ".txt"), capture.text,
      { flag: "wx", mode: 0o600 });
  await writeFile(resolve(args.outDir, "research-dossier.json"),
    JSON.stringify(output.dossier, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  await writeFile(resolve(args.outDir, "run-manifest.json"),
    JSON.stringify({ kind: "research-run", schemaVersion: 1,
      provider: output.provider, localModel: output.model,
      count: output.captures.length, status: "unverified-draft",
      warnings: output.warnings, noPublication: true,
    }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  log("Captured " + output.captures.length + " sources under " + args.outDir + ".");
  log("Dossier is DRAFT; captured excerpts and LLM-derived claims require human verification.");
  log("Next: pnpm video:plan --research " + resolve(args.outDir, "research-dossier.json") + " --model INSTALLED_MODEL --out NEW_BUNDLE.json");
  return output;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
  runResearchCli(process.argv.slice(2)).catch(e => { console.error(String(e.message ?? e)); process.exitCode = 2; });
