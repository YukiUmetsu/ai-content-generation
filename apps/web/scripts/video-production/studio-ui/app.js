const token = document.querySelector('meta[name="studio-token"]').content;
const $ = (id) => document.getElementById(id);
const form = $("configuration");
let lastStatus = "idle";
let preflightReady = false;
let runningRequest = false;
let currentReview = null;
let clientError = "";

function config() {
  const data = new FormData(form);
  const provider = data.get("provider");
  const common = {
    mode: data.get("mode"), provider, voiceId: String(data.get("voiceId") || "").trim(),
    providerRevision: String(data.get("providerRevision") || "").trim(),
  };
  if (provider === "fish") return {
    ...common, apiKey: $("fish-key").value, voiceConsent: $("voice-consent").checked,
    transmitText: $("transmit-text").checked,
  };
  return { ...common, modelId: $("model-id").value.trim(), endpoint: $("local-endpoint").value.trim(),
    localVoiceAuthorized: $("local-authorized").checked };
}

async function api(path, method = "GET", payload = undefined) {
  let response;
  try {
    response = await fetch(path, { method, cache: "no-store",
      headers: method === "POST" ? { "Content-Type": "application/json", "X-ContentGen-Studio-Token": token } : {},
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
  } catch { throw new Error("Cannot reach the local studio. Is the terminal command still running?"); }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function showProvider() {
  const fish = form.elements.provider.value === "fish";
  $("fish-fields").hidden = !fish;
  $("local-fields").hidden = fish;
  $("fish-permissions").hidden = !fish;
  $("local-permissions").hidden = fish;
  if (fish && !$("provider-revision").value.startsWith("fish")) $("provider-revision").value = "fish-api-v1";
  if (!fish && $("provider-revision").value === "fish-api-v1") $("provider-revision").value = "";
}

function invalidate() {
  clientError = "";
  if (lastStatus !== "rendering" && lastStatus !== "checking") {
    preflightReady = false;
    $("render-button").disabled = true;
  }
}

function applySteps(state) {
  const phase = state.phase || "idle";
  const stages = ["build", "speech", "render", "review"];
  const stage = ["building", "preflight"].includes(phase) ? 0
    : ["starting", "browser-preflight", "narration", "timeline"].includes(phase) ? 1
      : ["audio", "rendering", "capture", "mux", "qa", "stills"].includes(phase) ? 2
        : phase === "review" ? 3 : -1;
  for (const [index, name] of stages.entries()) {
    const element = document.querySelector(`[data-step="${name}"]`);
    element.dataset.state = stage < 0 ? "idle" : index < stage ? "done" : index === stage ? "active" : "idle";
  }
}

function showFindings(findings) {
  const useful = Array.isArray(findings) ? findings.filter((item) => item && item.severity !== "info") : [];
  $("findings").hidden = useful.length === 0;
  const list = $("findings-list");
  list.replaceChildren();
  for (const finding of useful.slice(0, 18)) {
    const item = document.createElement("li");
    item.textContent = `${finding.severity === "warning" ? "Note: " : ""}${finding.message || finding.code || "Unknown finding"}`;
    list.append(item);
  }
}

function addMetric(text) {
  const chip = document.createElement("span");
  chip.textContent = text;
  $("review-metrics").append(chip);
}

function link(id, src) { $(id).href = src; }
function showReview(state) {
  if (!state.artifacts || state.status !== "completed") return;
  if (currentReview === state.artifacts.video) return;
  currentReview = state.artifacts.video;
  $("empty-preview").hidden = true;
  $("review-content").hidden = false;
  $("film-preview").src = state.artifacts.video;
  $("voice-audio").src = state.artifacts.voice;
  $("master-audio").src = state.artifacts.master;
  link("download-video", state.artifacts.video);
  link("download-captions", state.artifacts.captions);
  link("download-qa", state.artifacts.qa);
  link("download-manifest", state.artifacts.manifest);
  $("output-folder").textContent = state.outputDir || "";
  $("review-metrics").replaceChildren();
  if (Number.isFinite(state.qa?.durationSeconds)) addMetric(`${Math.round(state.qa.durationSeconds)} sec measured`);
  if (Number.isInteger(state.qa?.frameCount)) addMetric(`${state.qa.frameCount.toLocaleString()} frames`);
  addMetric(state.qa?.technicalPass ? "Technical QA passed" : "Technical QA not confirmed");
  addMetric("Not commercially approved");
  const stills = $("stills");
  stills.replaceChildren();
  for (const src of state.artifacts.stills || []) {
    const a = document.createElement("a");
    a.href = src;
    a.target = "_blank";
    a.rel = "noopener";
    const img = document.createElement("img");
    img.src = src;
    img.loading = "lazy";
    img.alt = `Selected rendered frame ${src.match(/frame-(\d+)\.png/)?.[1] || ""}`;
    const caption = document.createElement("small");
    caption.textContent = `Frame ${src.match(/frame-(\d+)\.png/)?.[1] || ""}`;
    a.append(img, caption);
    stills.append(a);
  }
}

function showStatus(state) {
  lastStatus = state.status;
  const badge = $("status-badge");
  badge.dataset.state = state.status;
  badge.textContent = ({ idle: "NOT STARTED", checking: "CHECKING", ready: "READY", blocked: "BLOCKED",
    rendering: "RENDERING", completed: "REVIEW NEEDED", failed: "FAILED", cancelled: "CANCELLED" })[state.status] || state.status.toUpperCase();
  $("activity-message").textContent = clientError || state.message || "No activity.";
  showFindings(state.findings?.length ? state.findings : state.qa?.findings);
  applySteps(state);
  const isWorking = state.status === "rendering" || state.status === "checking";
  $("preflight-button").disabled = isWorking || runningRequest;
  $("render-button").disabled = isWorking || runningRequest || !preflightReady;
  $("cancel-button").hidden = state.status !== "rendering";
  const progress = state.progress;
  const counts = Number.isInteger(progress?.completedFrames) && Number.isInteger(progress?.totalFrames) && progress.totalFrames > 0;
  $("frame-progress").hidden = !counts;
  if (counts) {
    $("frame-count").textContent = `${progress.completedFrames.toLocaleString()} / ${progress.totalFrames.toLocaleString()}`;
    $("frame-meter").style.width = `${Math.max(0, Math.min(100, progress.completedFrames / progress.totalFrames * 100))}%`;
  }
  if (state.status === "rendering" && currentReview) {
    currentReview = null;
    $("review-content").hidden = true;
    $("empty-preview").hidden = false;
    $("film-preview").removeAttribute("src");
    $("film-preview").load();
    $("voice-audio").removeAttribute("src");
    $("master-audio").removeAttribute("src");
  }
  showReview(state);
}

async function refresh() {
  try {
    const state = await api("/api/status");
    if (state.status === "ready" && !preflightReady && !runningRequest) {
      // Refreshes never implicitly authorize rendering a previous session's settings.
      $("render-button").disabled = true;
    }
    showStatus(state);
  } catch (error) { $("activity-message").textContent = error.message; }
}

async function preflight() {
  if (runningRequest) return;
  runningRequest = true;
  clientError = "";
  preflightReady = false;
  $("render-button").disabled = true;
  $("activity-message").textContent = "Building the scene and checking prerequisites…";
  $("preflight-button").disabled = true;
  try {
    const result = await api("/api/preflight", "POST", config());
    preflightReady = result.ready;
    showFindings(result.report?.findings);
  } catch (error) {
    clientError = error.message;
  } finally { runningRequest = false; await refresh(); }
}

async function render() {
  if (runningRequest || !preflightReady) return;
  if (!window.confirm("Render this one test video now? Fish Audio may consume free API quota and narration text will be transmitted if selected.")) return;
  runningRequest = true;
  clientError = "";
  try {
    await api("/api/render", "POST", { ...config(), confirmRender: true });
    preflightReady = false;
    $("render-button").disabled = true;
    // Clear secret from the visible input as soon as the worker accepted the job.
    $("fish-key").value = "";
  } catch (error) {
    clientError = error.message;
  } finally { runningRequest = false; await refresh(); }
}

async function cancel() {
  if (!window.confirm("Stop the current render? Completed cached beats and verified segments may be reusable on a future run.")) return;
  try { await api("/api/cancel", "POST", {}); }
  catch (error) { clientError = error.message; }
  await refresh();
}

form.addEventListener("input", invalidate);
form.addEventListener("change", (event) => { if (event.target.name === "provider") showProvider(); invalidate(); });
$("preflight-button").addEventListener("click", preflight);
$("render-button").addEventListener("click", render);
$("cancel-button").addEventListener("click", cancel);
showProvider();
refresh();
setInterval(refresh, 1500);
