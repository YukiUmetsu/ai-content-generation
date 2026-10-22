/** Headless video CLI. Task 1 provides a truthful dry-run; media workers follow. */
import { accessSync, constants, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, parse, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseVideoProductionJob } from "./job.mjs";

const readFlagValue = (argv, index) => {
  if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) throw new Error(`${argv[index]} requires a value.`);
  return argv[index + 1];
};

/** @param {string[]} argv */
export function parseCliArgs(argv) {
  const options = { job: "", provider: "", out: "", dryRun: false, allowNetwork: false, budgetUsd: 0, localEndpoint: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--" && index === 0) continue;
    if (flag === "--dry-run") { options.dryRun = true; continue; }
    if (flag === "--allow-network") { options.allowNetwork = true; continue; }
    if (["--job", "--provider", "--out", "--budget-usd", "--local-endpoint"].includes(flag)) {
      const value = readFlagValue(argv, index);
      const prop = ({ "--job": "job", "--provider": "provider", "--out": "out", "--budget-usd": "budgetUsd", "--local-endpoint": "localEndpoint" })[flag];
      options[prop] = flag === "--budget-usd" ? Number(value) : value;
      index += 1;
      continue;
    }
    throw new Error("Unknown argument or stray value.");
  }
  if (!options.job || !options.out) throw new Error("Both --job and --out are required.");
  if (options.provider && !["fish", "local"].includes(options.provider)) throw new Error("--provider must be fish or local.");
  if (!Number.isFinite(options.budgetUsd) || options.budgetUsd < 0) throw new Error("--budget-usd must be finite and non-negative.");
  validateOutputTarget(options.out);
  return options;
}

/** Refuse broad or ambiguous write targets even before the actual writer exists. */
export function validateOutputTarget(target) {
  if (typeof target !== "string" || !target.trim()) throw new Error("An explicit output directory is required.");
  const full = resolve(target);
  if ([parse(full).root, homedir(), process.cwd(), dirname(process.cwd()), "/tmp", "/workspace"].includes(full) || basename(full) === "." || basename(full) === "..") {
    throw new Error("Output directory must be a narrow, job-owned location, not a broad workspace or home directory.");
  }
  return full;
}

function defaultToolProbe(name, env) {
  if (name === "browser") {
    const executable = env.CONTENTGEN_CHROMIUM_EXECUTABLE;
    if (!executable) return { available: false, reason: "Set CONTENTGEN_CHROMIUM_EXECUTABLE to an existing browser." };
    try { accessSync(executable, constants.X_OK); return { available: true, version: "configured-local-browser" }; }
    catch { return { available: false, reason: "Configured browser is unavailable or not executable." }; }
  }
  const run = spawnSync(name, ["-version"], { encoding: "utf8", timeout: 4000, maxBuffer: 4096 });
  return run.status === 0
    ? { available: true, version: String(run.stdout).split("\n")[0].slice(0, 200) }
    : { available: false, reason: `${name} is not installed or failed its version probe.` };
}

/**
 * Honest, side-effect-free preflight: no provider fetch, rendering or file writes.
 * Tool version probes are allowed; inject probeTool in offline tests.
 * @param {unknown} candidate
 * @param {{provider?:string,allowNetwork?:boolean,budgetUsd?:number,out:string,dryRun?:boolean,env?:Record<string,string>,localEndpoint?:string,probeTool?:(name:string)=>Promise<object>}} options
 */
export async function inspectProduction(candidate, options) {
  const parsed = parseVideoProductionJob(candidate);
  const provider = options.provider || (parsed.ok ? parsed.job.voice.provider : "unknown");
  const env = options.env ?? process.env;
  const networkAllowed = provider === "fish" && options.allowNetwork === true;
  const findings = [...parsed.findings];
  const add = (code, message, severity = "error") => findings.push({ code, message, severity, path: "$" });
  if (!parsed.ok) return { ready: false, provider, networkAllowed: false, findings, tools: {} };

  try { validateOutputTarget(options.out); }
  catch { add("unsafe-output", "Use an explicit, narrow output directory."); }
  if (options.provider && options.provider !== parsed.job.voice.provider) {
    add("voice-substitution", "Provider override changes the approved voice and invalidates cached audio timing.", "warning");
  }
  if (provider === "fish") {
    if (!networkAllowed) add("network-not-approved", "Fish requests are disabled unless --allow-network is explicitly set.");
    if (!env.FISH_AUDIO_API_KEY) add("provider-key-missing", "FISH_AUDIO_API_KEY must be configured in the runtime environment.");
  } else if (provider === "local") {
    if (!options.localEndpoint && !parsed.job.voice.endpoint) add("local-endpoint-missing", "A configured loopback TTS bridge is required.");
  } else add("unknown-provider", "Choose the Fish or local speech provider explicitly.");

  if (options.budgetUsd > parsed.job.policy.maxCostUsd) add("budget-exceeded", "CLI cost budget exceeds the job's approved spending limit.");
  if (parsed.job.approval === "test-only") add("fixture-only", "This illustrative job cannot be marketed as commercial-ready.", "warning");
  if (parsed.job.destination.presetId !== "youtube") add("render-profile-unavailable", "The first renderer supports YouTube landscape only.");

  const tools = {};
  for (const name of ["ffmpeg", "ffprobe", "browser"]) {
    try { tools[name] = await (options.probeTool ?? ((tool) => defaultToolProbe(tool, env)))(name); }
    catch { tools[name] = { available: false, reason: `${name} could not be inspected.` }; }
    if (!tools[name]?.available) add("tool-unavailable", `${name} is not currently available.`);
  }
  return {
    ready: !findings.some((item) => item.severity === "error"),
    provider,
    networkAllowed,
    budgetUsd: options.budgetUsd ?? 0,
    mode: parsed.job.mode,
    destination: parsed.job.destination.presetId,
    findings,
    tools,
  };
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseCliArgs(argv);
    const candidate = JSON.parse(readFileSync(resolve(options.job), "utf8"));
    const report = await inspectProduction(candidate, options);
    if (options.dryRun) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      return report.ready ? 0 : 2;
    }
    process.stderr.write("Video production is not yet implemented. Use --dry-run until the synthesis/render slices are integrated.\n");
    return 2;
  } catch (error) {
    const reason = error instanceof SyntaxError ? "Invalid job JSON." : (error instanceof Error ? error.message : "Unknown CLI failure.");
    process.stderr.write(reason + "\n");
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
