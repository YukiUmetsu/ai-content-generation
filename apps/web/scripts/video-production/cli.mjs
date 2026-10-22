/** Headless video CLI: explicit authorization, offline preflight and gated output. */
import { accessSync, constants, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, parse, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseVideoProductionJob } from "./job.mjs";
import { produceVideo } from "./produce.mjs";
import { localSpeechEndpoint } from "./local.mjs";

const readFlagValue = (argv, index) => {
  if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) throw new Error(`${argv[index]} requires a value.`);
  return argv[index + 1];
};

/** @param {string[]} argv */
export function parseCliArgs(argv) {
  const options = {
    job: "", provider: "", out: "", dryRun: false, allowNetwork: false, budgetUsd: 0, localEndpoint: "",
    voiceReferenceConsent: false, textTransmissionApproved: false, localVoiceAuthorized: false,
    paidUsageApproved: false, allowTestAssets: false, providerRevision: "", browserExecutable: "", distRoot: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--" && index === 0) continue;
    if (flag === "--dry-run") { options.dryRun = true; continue; }
    if (flag === "--allow-network") { options.allowNetwork = true; continue; }
    if (flag === "--voice-consent") { options.voiceReferenceConsent = true; continue; }
    if (flag === "--transmit-text") { options.textTransmissionApproved = true; continue; }
    if (flag === "--local-voice-authorized") { options.localVoiceAuthorized = true; continue; }
    if (flag === "--paid-usage-approved") { options.paidUsageApproved = true; continue; }
    if (flag === "--allow-test-assets") { options.allowTestAssets = true; continue; }
    if (["--job", "--provider", "--out", "--budget-usd", "--local-endpoint", "--provider-revision", "--browser-executable", "--dist-root"].includes(flag)) {
      const value = readFlagValue(argv, index);
      const prop = ({ "--job": "job", "--provider": "provider", "--out": "out", "--budget-usd": "budgetUsd", "--local-endpoint": "localEndpoint", "--provider-revision": "providerRevision", "--browser-executable": "browserExecutable", "--dist-root": "distRoot" })[flag];
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

function defaultToolProbe(name, env, browserExecutable) {
  if (name === "browser") {
    const executable = browserExecutable || env.CONTENTGEN_CHROMIUM_EXECUTABLE;
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
 * @param {{provider?:string,providerRevision?:string,allowNetwork?:boolean,budgetUsd?:number,out:string,dryRun?:boolean,env?:Record<string,string>,localEndpoint?:string,browserExecutable?:string,voiceReferenceConsent?:boolean,textTransmissionApproved?:boolean,localVoiceAuthorized?:boolean,allowTestAssets?:boolean,probeTool?:(name:string)=>Promise<object>}} options
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
    add("voice-substitution", "Provider override changes the job voice and is forbidden; edit the voice configuration and revalidate.");
  }
  if (provider === "fish") {
    if (parsed.job.voice.modelId !== "s2.1-pro-free") add("paid-fish-model-unmetered", "The video pipeline cannot meter paid Fish requests; only the free-model ID is supported.");
    if (!parsed.job.voice.voiceId || parsed.job.voice.voiceId === "configure-a-licensed-reference") add("fish-voice-missing", "Configure an authorized Fish voice reference.");
    if (!networkAllowed) add("network-not-approved", "Fish requests are disabled unless --allow-network is explicitly set.");
    if (!env.FISH_AUDIO_API_KEY) add("provider-key-missing", "FISH_AUDIO_API_KEY must be configured in the runtime environment.");
    if (!options.voiceReferenceConsent || !options.textTransmissionApproved) add("consent-required", "Fish narration requires --voice-consent and --transmit-text.");
  } else if (provider === "local") {
    if (!options.localVoiceAuthorized) add("consent-required", "Local TTS requires --local-voice-authorized.");
    try { localSpeechEndpoint(options.localEndpoint || parsed.job.voice.endpoint); }
    catch { add("local-endpoint-invalid", "Configure a bare HTTP loopback TTS origin with a port."); }
  } else add("unknown-provider", "Choose the Fish or local speech provider explicitly.");

  if (options.budgetUsd > parsed.job.policy.maxCostUsd) add("budget-exceeded", "CLI cost budget exceeds the job's approved spending limit.");
  if (parsed.job.sounds.some((effect) => effect.licenseStatus === "test-only") && !options.allowTestAssets) add("test-asset-permission-required", "Use --allow-test-assets only for fictional fixture runs.");
  if (!options.providerRevision) add("provider-revision-missing", "Pin --provider-revision to the actual TTS provider/engine revision before caching.");
  if (parsed.job.approval === "test-only") add("fixture-only", "This illustrative job cannot be marketed as commercial-ready.", "warning");
  if (parsed.job.destination.presetId !== "youtube") add("render-profile-unavailable", "The first renderer supports YouTube landscape only.");

  const tools = {};
  for (const name of ["ffmpeg", "ffprobe", "browser"]) {
    try { tools[name] = await (options.probeTool ?? ((tool) => defaultToolProbe(tool, env, options.browserExecutable)))(name); }
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

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  try {
    const options = parseCliArgs(argv);
    const candidate = JSON.parse(readFileSync(resolve(options.job), "utf8"));
    const report = await inspectProduction(candidate, { ...options, env: dependencies.env ?? process.env, probeTool: dependencies.probeTool });
    if (options.dryRun) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      return report.ready ? 0 : 2;
    }
    if (!report.ready) {
      process.stderr.write(JSON.stringify({ ready: false, findings: report.findings }, null, 2) + "\n");
      return 2;
    }
    const env = dependencies.env ?? process.env;
    const result = await (dependencies.produceVideo ?? produceVideo)(candidate, {
      ...options,
      provider: options.provider || candidate.voice.provider,
      apiKey: env.FISH_AUDIO_API_KEY,
      browserExecutable: options.browserExecutable || env.CONTENTGEN_CHROMIUM_EXECUTABLE,
    });
    process.stdout.write(JSON.stringify({ videoPath: result.videoPath, releaseDir: result.releaseDir, releaseStatus: result.qa.releaseStatus, technicalPass: result.qa.technicalPass, commercialReady: result.qa.commercialReady }, null, 2) + "\n");
    return 0;
  } catch (error) {
    const reason = error instanceof SyntaxError ? "Invalid job JSON." : (error instanceof Error ? error.message : "Unknown CLI failure.");
    process.stderr.write(reason + "\n");
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
