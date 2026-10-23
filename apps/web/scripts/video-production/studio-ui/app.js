const token = document.querySelector('meta[name="studio-token"]').content;
const $ = (id) => document.getElementById(id);
const form = $("configuration");
let lastStatus = "idle";
let preflightReady = false;
let runningRequest = false;
let currentReview = null;
let clientError = "";
let currentDraftId = "";
let currentDraftSource = "";
let currentDraftIsPortrait = false;
let topicDirty = true;

function config() {
  const data = new FormData(form);
  const provider = data.get("provider");
  const common = {
    mode: data.get("mode"), provider, voiceId: String(data.get("voiceId") || "").trim(),
    providerRevision: String(data.get("providerRevision") || "").trim(),
  };
  if (["topic", "manual"].includes(common.mode)) common.draftId = topicDirty ? "" : currentDraftId;
  if (provider === "fish") return {
    ...common, apiKey: $("fish-key").value, voiceConsent: $("voice-consent").checked,
    transmitText: $("transmit-text").checked,
  };
  return { ...common, modelId: $("model-id").value.trim(), endpoint: $("local-endpoint").value.trim(),
    localVoiceAuthorized: $("local-authorized").checked };
}

function topicConfig() {
  return {
    topic: $("topic-text").value.trim(), viewerQuestion: $("topic-question").value.trim(),
    audience: $("topic-audience").value.trim(), notes: $("topic-notes").value.trim(),
    mode: $("topic-length").value, locale: $("topic-locale").value,
    endpoint: $("topic-model-endpoint").value.trim(), model: $("topic-model-id").value.trim(),
  };
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

function showMode() {
  const mode = form.elements.mode.value;
  const topic = mode === "topic";
  const manual = mode === "manual";
  $("topic-fields").hidden = !topic;
  $("manual-fields").hidden = !manual;
  $("topic-review").hidden = !(topic && currentDraftSource === "local-openai-compatible" ||
    manual && currentDraftSource === "human") || !currentDraftId;
  $("fixture-caption").textContent = manual
    ? `Human-authored general explainer · Kumiki attention-editing · ${$("manual-platform").value === "youtube" ? "1920 × 1080" : "1080 × 1920"} · 30 fps`
    : topic ? "Local topic generator · general explainer · 1920 × 1080 · 30 fps"
    : "Illustrative House Math scenario · YouTube landscape · 30 fps";
}

function showClaims(job) {
  const list = $("draft-claim-list");
  list.replaceChildren();
  const claims = Array.isArray(job.claims) ? job.claims : [];
  const evidence = new Map((Array.isArray(job.evidence) ? job.evidence : []).map((source) => [source.id, source]));
  $("draft-claim-count").textContent = `${claims.length} ${claims.length === 1 ? "claim" : "claims"}`;
  if (!claims.length) {
    const empty = document.createElement("p");
    empty.className = "draft-claims-empty";
    empty.textContent = "No claims declared. Review narration and diagrams for factual statements that still need sources.";
    list.append(empty);
    return;
  }
  const labels = { verified: "Verified (declared)", unverified: "Unverified", illustrative: "Illustrative", disputed: "Disputed" };
  for (const [index, claim] of claims.entries()) {
    const article = document.createElement("article");
    article.className = "draft-claim";
    article.dataset.status = Object.hasOwn(labels, claim.status) ? claim.status : "unknown";
    const header = document.createElement("div");
    header.className = "draft-claim-header";
    const badge = document.createElement("span");
    badge.className = "draft-claim-status";
    badge.textContent = labels[claim.status] || "Unknown status";
    const id = document.createElement("span");
    id.className = "draft-claim-id";
    id.textContent = claim.id || `Claim ${index + 1}`;
    header.append(badge, id);
    const statement = document.createElement("p");
    statement.className = "draft-claim-text";
    statement.textContent = claim.text || "No claim text provided.";
    article.append(header, statement);
    const refs = Array.isArray(claim.sourceRefs) ? claim.sourceRefs : [];
    if (!refs.length) {
      const warning = document.createElement("p");
      warning.className = "draft-claim-warning";
      warning.textContent = "No source linked — independently verify or mark this statement as illustrative.";
      article.append(warning);
    } else {
      const sources = document.createElement("ul");
      sources.className = "draft-claim-sources";
      for (const ref of refs) {
        const source = evidence.get(ref);
        const item = document.createElement("li");
        const reference = document.createElement("strong");
        reference.textContent = `Source ${ref}`;
        item.append(reference);
        if (source) {
          for (const [key, prefix] of [["title", "Title"], ["passageLocator", "Locator"], ["sourceUri", "URI"]]) {
            if (!source[key]) continue;
            const detail = document.createElement("span");
            detail.textContent = `${prefix}: ${source[key]}`;
            item.append(detail);
          }
        } else {
          const warning = document.createElement("span");
          warning.className = "draft-claim-warning";
          warning.textContent = "Missing source record — review this reference.";
          item.append(warning);
        }
        sources.append(item);
      }
      article.append(sources);
    }
    list.append(article);
  }
}

function showDraft(draft) {
  if (!draft?.job) return;
  currentDraftId = draft.job.id;
  currentDraftIsPortrait = draft.job.destination?.height > draft.job.destination?.width;
  currentDraftSource = draft.generator?.provider || "local-openai-compatible";
  topicDirty = false;
  const narrationLength = draft.narrationLength || { count: draft.words ?? "Unmeasured", unit: "words" };
  $("draft-summary").textContent = `${draft.job.topic.title} · ${draft.job.beats.length} narrated beats · ${narrationLength.count} ${narrationLength.unit}. Every factual statement needs human verification.`;
  const container = $("draft-packaging");
  container.replaceChildren();
  for (const option of draft.packaging || []) {
    const article = document.createElement("article");
    const strategy = document.createElement("strong");
    strategy.textContent = `${option.id || "Concept"} · ${option.strategy}`;
    const title = document.createElement("span");
    title.textContent = option.title;
    const description = document.createElement("small");
    description.textContent = `Thumbnail: ${option.thumbnail}. Hook: ${option.hook}`;
    article.append(strategy, title, description);
    container.append(article);
  }
  showClaims(draft.job);
  $("draft-json").value = JSON.stringify(draft.job, null, 2);
  showMode();
}

function invalidate() {
  clientError = "";
  if (lastStatus !== "rendering" && lastStatus !== "checking") {
    preflightReady = false;
    $("render-button").disabled = true;
  }
}

async function generate() {
  if (runningRequest) return;
  runningRequest = true;
  clientError = "";
  preflightReady = false;
  topicDirty = true;
  $("render-button").disabled = true;
  $("generate-button").disabled = true;
  try {
    const result = await api("/api/topic", "POST", topicConfig());
    showDraft(result.draft);
    $("activity-message").textContent = "Draft generated. Inspect or edit the script, then check readiness.";
  } catch (error) { clientError = error.message; }
  finally { runningRequest = false; $("generate-button").disabled = false; await refresh(); }
}

const manualScenes = $("manual-scenes");
function makeManualCard() {
  const article = document.createElement("article");
  article.className = "manual-scene";
  // This template contains no user-supplied HTML; all authored values use native form controls.
  article.innerHTML = `<div class="manual-scene-header"><strong class="manual-scene-number"></strong><div class="manual-scene-tools"><button type="button" class="manual-up-button button button-secondary" aria-label="Move scene earlier">↑</button><button type="button" class="manual-down-button button button-secondary" aria-label="Move scene later">↓</button><button type="button" class="manual-duplicate-button button button-secondary">Duplicate</button><button type="button" class="manual-remove-button button button-secondary">Remove</button></div></div>
    <div class="field-group"><label>Headline <input class="manual-headline" maxlength="68" placeholder="A clear on-screen idea" required></label></div>
    <div class="field-group"><label>Narration <textarea class="manual-narration" rows="3" maxlength="1600" placeholder="What the narrator says in this scene (at least 20 characters)" required></textarea></label></div>
    <div class="field-group"><label>Supporting copy <input class="manual-subhead" maxlength="115" placeholder="Optional one-line explanation"></label></div>
    <div class="field-group"><label>Diagram labels — one per line <textarea class="manual-items" rows="2" placeholder="First concept&#10;Second concept" required></textarea></label></div>
    <div class="field-group"><label>Scene treatment <select class="manual-intent"><option value="general-flow">Connected process</option><option value="general-comparison">Side-by-side comparison</option><option value="general-breakdown">Qualitative breakdown</option></select></label></div>`;
  article.querySelector(".manual-remove-button").addEventListener("click", () => {
    if (manualScenes.children.length <= 3) return;
    article.remove();
    refreshManualCardRoles();
    topicDirty = true;
    invalidate();
  });
  for (const [selector, delta] of [[".manual-up-button", -1], [".manual-down-button", 1]]) {
    article.querySelector(selector).addEventListener("click", () => {
      const cards = [...manualScenes.children], index = cards.indexOf(article), target = index + delta;
      if (index <= 0 || index >= cards.length - 1 || target <= 0 || target >= cards.length - 1) return;
      if (delta < 0) manualScenes.insertBefore(article, cards[target]);
      else manualScenes.insertBefore(cards[target], article);
      refreshManualCardRoles(); markManualDirty();
      article.querySelector(".manual-headline").focus();
    });
  }
  article.querySelector(".manual-duplicate-button").addEventListener("click", () => {
    const cards = [...manualScenes.children], index = cards.indexOf(article);
    if (index <= 0 || index >= cards.length - 1 || cards.length >= 40) return;
    const copy = makeManualCard();
    assignManualCard(copy, readManualCard(article));
    manualScenes.insertBefore(copy, article.nextSibling);
    refreshManualCardRoles(); markManualDirty();
    copy.querySelector(".manual-headline").focus();
  });
  return article;
}
function markManualDirty() {
  topicDirty = true;
  preflightReady = false;
  invalidate();
}
function readManualCard(card) {
  return {
    headline: card.querySelector(".manual-headline").value.trim(),
    narration: card.querySelector(".manual-narration").value.trim(),
    subhead: card.querySelector(".manual-subhead").value.trim(),
    intent: card.querySelector(".manual-intent").value,
    items: card.querySelector(".manual-items").value.split(/\r?\n/u).map(x => x.trim()).filter(Boolean),
  };
}
function assignManualCard(card, scene) {
  card.querySelector(".manual-headline").value = scene.headline;
  card.querySelector(".manual-narration").value = scene.narration;
  card.querySelector(".manual-subhead").value = scene.subhead || "";
  card.querySelector(".manual-intent").value = scene.intent || "general-flow";
  card.querySelector(".manual-items").value = scene.items.join("\n");
}
function refreshManualCardRoles() {
  const cards = [...manualScenes.children];
  for (const [index, card] of cards.entries()) {
    const first = index === 0, last = index === cards.length - 1;
    card.querySelector(".manual-scene-number").textContent = `Scene ${index + 1} · ${first ? "Opening hook" : last ? "Final answer" : "Explanation"}`;
    card.querySelector(".manual-intent").disabled = first || last;
    for (const selector of [".manual-up-button",".manual-down-button",".manual-duplicate-button",".manual-remove-button"]) {
      card.querySelector(selector).hidden = first || last;
    }
    card.querySelector(".manual-up-button").disabled = index <= 1;
    card.querySelector(".manual-down-button").disabled = index >= cards.length - 2;
    card.querySelector(".manual-duplicate-button").disabled = cards.length >= 40;
  }
}
function addManualScene() {
  if (manualScenes.children.length >= 40) return;
  const card = makeManualCard();
  const last = manualScenes.lastElementChild;
  if (last) manualScenes.insertBefore(card, last);
  else manualScenes.append(card);
  refreshManualCardRoles();
  topicDirty = true;
  invalidate();
}
function manualInput() {
  const cards = [...manualScenes.querySelectorAll(".manual-scene")];
  const scenes = cards.map(readManualCard);
  return {
    title: $("manual-title").value.trim(), viewerQuestion: $("manual-question").value.trim(),
    audience: $("manual-audience").value.trim(), locale: $("manual-locale").value,
    length: $("manual-length").value, platform: $("manual-platform").value, hookStrategy: $("manual-hook").value,
    typographyStyle: $("manual-typography").value, scenes,
  };
}
async function generateManual() {
  if (runningRequest) return;
  runningRequest = true;
  clientError = "";
  preflightReady = false;
  $("render-button").disabled = true;
  $("manual-generate-button").disabled = true;
  try {
    const result = await api("/api/manual", "POST", manualInput());
    showDraft(result.draft);
    $("activity-message").textContent = "Manual storyboard ready. Review scenes, then check readiness.";
  } catch (error) { clientError = error.message; }
  finally { runningRequest = false; $("manual-generate-button").disabled = false; await refresh(); }
}

async function saveDraft() {
  if (runningRequest) return;
  runningRequest = true;
  clientError = "";
  try {
    let job;
    try { job = JSON.parse($("draft-json").value); }
    catch { throw new Error("Storyboard must be valid JSON before saving."); }
    const result = await api("/api/draft", "POST", { job });
    showDraft(result.draft);
    invalidate();
  } catch (error) { clientError = error.message; }
  finally { runningRequest = false; await refresh(); }
}

function applySteps(state) {
  const phase = state.phase || "idle";
  const stages = ["build", "speech", "render", "review"];
  const stage = ["building", "preflight"].includes(phase) ? 0
    : ["generating", "draft"].includes(phase) ? -1
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
  $("film-preview").parentElement.dataset.aspect = currentDraftIsPortrait ? "portrait" : "landscape";
  $("stills").dataset.aspect = currentDraftIsPortrait ? "portrait" : "landscape";
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
    generating: "WRITING", rendering: "RENDERING", completed: "REVIEW NEEDED", failed: "FAILED", cancelled: "CANCELLED" })[state.status] || state.status.toUpperCase();
  $("activity-message").textContent = clientError || state.message || "No activity.";
  showFindings(state.findings?.length ? state.findings : state.qa?.findings);
  const fishDebug = $("fish-diagnostics");
  const events = Array.isArray(state.fishDiagnostics) ? state.fishDiagnostics : [];
  fishDebug.hidden = events.length === 0;
  if (events.length) {
    $("fish-diagnostics-text").textContent = JSON.stringify(events, null, 2);
    if (state.status === "failed") fishDebug.open = true;
  }
  applySteps(state);
  const isWorking = state.status === "rendering" || state.status === "checking" || state.status === "generating";
  $("manual-generate-button").disabled = isWorking || runningRequest;
  $("manual-add-button").disabled = isWorking || runningRequest || manualScenes.children.length >= 40;
  $("preflight-button").disabled = isWorking || runningRequest;
  $("render-button").disabled = isWorking || runningRequest || !preflightReady || (["topic", "manual"].includes(form.elements.mode.value) && topicDirty);
  $("generate-button").disabled = isWorking || runningRequest;
  $("save-draft-button").disabled = isWorking || runningRequest;
  $("cancel-button").hidden = !["rendering", "generating"].includes(state.status);
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
    if (["topic", "manual"].includes(form.elements.mode.value) && topicDirty) throw new Error("Create or save your edited storyboard before checking readiness.");
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
  if (!window.confirm("Stop the current operation? Completed cached beats and frame segments may be reusable for a future render.")) return;
  try { await api("/api/cancel", "POST", {}); }
  catch (error) { clientError = error.message; }
  await refresh();
}

form.addEventListener("input", (event) => { if (event.target.closest?.("#topic-fields") || event.target.closest?.("#manual-fields")) topicDirty = true; invalidate(); });
form.addEventListener("change", (event) => { if (event.target.name === "provider") showProvider(); if (event.target.name === "mode") { topicDirty = true; showMode(); } if (event.target.closest?.("#manual-fields")) topicDirty = true; invalidate(); });
$("generate-button").addEventListener("click", generate);
$("manual-add-button").addEventListener("click", addManualScene);
$("manual-generate-button").addEventListener("click", generateManual);
$("manual-platform").addEventListener("change", () => {
  if ($("manual-platform").value !== "youtube") $("manual-length").value = "smoke";
  $("manual-length").querySelector('option[value="youtube-long"]').disabled = $("manual-platform").value !== "youtube";
  showMode();
  topicDirty = true; invalidate();
});
for (let n = 0; n < 3; n++) manualScenes.append(makeManualCard());
refreshManualCardRoles();
$("save-draft-button").addEventListener("click", saveDraft);
$("preflight-button").addEventListener("click", preflight);
$("render-button").addEventListener("click", render);
$("cancel-button").addEventListener("click", cancel);
showProvider();
showMode();
api("/api/draft").then((result) => { if (result.draft) showDraft(result.draft); }).catch(() => {});
refresh();
setInterval(refresh, 1500);
