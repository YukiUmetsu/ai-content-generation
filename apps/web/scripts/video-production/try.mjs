/** Interactive, consent-gated smoke-video runner. The production CLI remains scriptable. */
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { constants, readFileSync } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspectProduction } from "./cli.mjs";
import { produceVideo } from "./produce.mjs";

const webRoot = fileURLToPath(new URL("../..", import.meta.url));
const fixturePath = fileURLToPath(new URL("../../../../examples/video-production-house-math-smoke.json", import.meta.url));
const command = promisify(execFile);
const defaultOutput = (home, now, random) => join(home, "Movies", "ContentGen",
  `smoke-${now.toISOString().replace(/[-:]/g, "").slice(0, 15).replace("T", "-")}-${random}`);

function parseTryArgs(args) {
  let provider = "fish", dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--" && i === 0) continue;
    if (arg === "--dry-run") { dryRun = true; continue; }
    if (arg === "--provider" && ["fish", "local"].includes(args[i + 1])) { provider = args[++i]; continue; }
    throw new Error(`Unknown or unsupported video:try argument: ${arg}`);
  }
  return { provider, dryRun };
}

export async function findChromium(env = process.env, isExecutable = async (path) =>
  access(path, constants.X_OK).then(() => true, () => false), platform = process.platform) {
  const configured = env.CONTENTGEN_CHROMIUM_EXECUTABLE;
  if (configured) {
    if (await isExecutable(configured)) return configured;
    throw new Error("CONTENTGEN_CHROMIUM_EXECUTABLE points to a missing/non-executable browser.");
  }
  const candidates = platform === "darwin" ? [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ] : platform === "win32" ? [
    join(env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    join(env.LOCALAPPDATA || "C:\\Users\\Public", "Google", "Chrome", "Application", "chrome.exe"),
  ] : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  for (const path of candidates) if (await isExecutable(path)) return path;
  throw new Error("No existing Chromium-compatible browser found. Install Chrome or set CONTENTGEN_CHROMIUM_EXECUTABLE.");
}

function terminalPrompts(input = process.stdin, output = process.stdout) {
  const ask = async (question) => {
    if (!input.isTTY) throw new Error(`Interactive terminal required to answer: ${question}`);
    const rl = createInterface({ input, output });
    try { return (await rl.question(`${question}: `)).trim(); }
    finally { rl.close(); }
  };
  return {
    ask,
    confirm: async (question) => /^(y|yes)$/i.test(await ask(`${question} [y/N]`)),
    secret: async (question) => {
      if (!input.isTTY || !input.setRawMode) throw new Error("Interactive terminal required to enter a hidden API key; alternatively set FISH_AUDIO_API_KEY.");
      output.write(`${question} (hidden): `);
      const wasRaw = input.isRaw === true;
      let answer = "";
      input.setRawMode(true);
      input.resume();
      try {
        return await new Promise((resolveSecret, rejectSecret) => {
          const onData = (chunk) => {
            const characters = chunk.toString("utf8");
            for (const c of characters) {
              if (c === "\r" || c === "\n") { input.off("data", onData); resolveSecret(answer.trim()); return; }
              if (c === "\u0003") { input.off("data", onData); rejectSecret(new Error("Cancelled API key entry")); return; }
              if (c === "\u007f" || c === "\b") answer = answer.slice(0, -1);
              else if (c >= " " && c !== "\u007f") answer += c;
            }
          };
          input.on("data", onData);
        });
      } finally { input.setRawMode(wasRaw); input.pause(); output.write("\n"); }
    },
  };
}

async function defaultBuild() {
  try { await command("pnpm", ["build"], { cwd: webRoot, timeout: 300000, maxBuffer: 2 * 1024 * 1024 }); }
  catch (error) { throw new Error(`Could not build the export page. Run 'cd apps/web && pnpm install --frozen-lockfile && pnpm build' first. (${error.code ?? "build failed"})`); }
}

async function defaultSaveJob(path, job) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(job, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}

/** Default run is preview + an explicit consent/render confirmation, never silent TTS. */
export async function runGuidedTrial(args = [], deps = {}) {
  const { provider, dryRun } = parseTryArgs(args);
  const env = deps.env ?? process.env;
  const prompt = deps.prompt ?? terminalPrompts();
  const output = deps.output ?? ((message) => process.stdout.write(message + "\n"));
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const job = structuredClone(fixture);
  let providerRevision, apiKey = undefined, networkApproved = false;

  if (provider === "fish") {
    const voiceId = env.CONTENTGEN_FISH_VOICE_ID || await prompt.ask("Authorized Fish Audio voice ID");
    if (!voiceId?.trim() || voiceId === "configure-a-licensed-reference") throw new Error("An authorized Fish Audio voice ID is required.");
    apiKey = env.FISH_AUDIO_API_KEY || await prompt.secret("Fish Audio API key");
    if (!apiKey?.trim()) throw new Error("Fish API key missing; set FISH_AUDIO_API_KEY or enter it at the hidden prompt.");
    networkApproved = await prompt.confirm("Do you authorize this Fish voice and transmitting narration text to Fish Audio?");
    if (!networkApproved) { output("Cancelled before any build, API request or render."); return { status: "cancelled" }; }
    job.voice = { ...job.voice, provider: "fish", modelId: "s2.1-pro-free", voiceId: voiceId.trim(), licenseStatus: "unknown" };
    providerRevision = "fish-api-v1";
  } else {
    const voiceId = env.CONTENTGEN_LOCAL_VOICE_ID || await prompt.ask("Authorized local voice ID");
    const modelId = env.CONTENTGEN_LOCAL_MODEL_ID || await prompt.ask("Installed local TTS model ID");
    providerRevision = env.CONTENTGEN_LOCAL_ENGINE_VERSION || await prompt.ask("Installed local TTS engine revision");
    const endpoint = env.CONTENTGEN_LOCAL_ENDPOINT || "http://127.0.0.1:8765";
    if (![voiceId, modelId, providerRevision].every((v) => typeof v === "string" && v.trim())) throw new Error("Local voice, model and engine revision are required.");
    const authorized = await prompt.confirm("Are you authorized to use this local voice for the test?");
    if (!authorized) { output("Cancelled before any build or render."); return { status: "cancelled" }; }
    job.voice = { ...job.voice, provider: "local", modelId: modelId.trim(), voiceId: voiceId.trim(), endpoint, licenseStatus: "unknown" };
  }

  const browserExecutable = await (deps.findBrowser ?? (() => findChromium(env)))();
  const out = defaultOutput(deps.home ?? homedir(), (deps.now ?? (() => new Date()))(), (deps.random ?? (() => randomBytes(4).toString("hex")))());
  const options = {
    out, provider, providerRevision, apiKey, browserExecutable,
    allowNetwork: networkApproved, voiceReferenceConsent: networkApproved,
    textTransmissionApproved: networkApproved, localVoiceAuthorized: provider === "local",
    allowTestAssets: true, budgetUsd: 0,
  };
  output("Building the video export page and checking local prerequisites...");
  await (deps.build ?? defaultBuild)();
  const report = await (deps.inspect ?? inspectProduction)(job, {
    ...options, dryRun: true,
    env: provider === "fish" ? { ...env, FISH_AUDIO_API_KEY: apiKey } : env,
  });
  if (!report.ready) {
    output("Preflight blocked. Fix these prerequisites before rendering:");
    for (const item of report.findings) if (item.severity === "error") output(`- ${item.message}`);
    return { status: "blocked", report };
  }
  output(`Preflight ready. ${provider === "fish" ? "A render will transmit your narration text to Fish Audio." : "A render will call your configured loopback TTS engine."}`);
  if (dryRun) { output("Dry-run finished without calling a TTS provider or creating a video."); return { status: "preflight-only", report }; }
  if (!await prompt.confirm("Render the smoke video now? This may consume API quota")) {
    output("No narration was generated and no video was rendered.");
    return { status: "preview-only", report };
  }
  await (deps.saveJob ?? defaultSaveJob)(join(out, "job.json"), job);
  output("Generating narration, sound, captions and bounded video segments...");
  const result = await (deps.produce ?? produceVideo)(job, options);
  output(`Video: ${result.videoPath}`);
  output(`QA: ${join(result.releaseDir, "qa-report.json")}`);
  output("Draft only: watch and listen before publishing; commercial rights are not verified.");
  return { status: "rendered", result, report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const outcome = await runGuidedTrial(process.argv.slice(2));
    process.exitCode = ["blocked"].includes(outcome.status) ? 2 : 0;
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : "Unknown guided video test failure") + "\n");
    process.exitCode = 2;
  }
}
