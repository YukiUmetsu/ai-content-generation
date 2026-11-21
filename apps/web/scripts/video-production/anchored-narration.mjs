/** Anchored narration: a video's voice-over as data. A script lists steps; each step is a line (or
 * one line per item of a list) with text templates over the video's data, placed on a named anchor
 * of the picture (a moment the renderer reports, such as "the brush lands") or after the line
 * before it. Placement uses measured speech, so the voice follows the picture. Video-neutral.
 *
 * Script (JSON):
 *   { schemaVersion: 1, kind: "anchored-narration-script", locale, highlightTail?, steps: [
 *     { id, say, caption?, locale?, when?, forEach?, at, offset?, gap?, highlight?, emphasize? } ] }
 * - `say` / `caption`: templates with `{path}` fields from the data (`{name.kana}`); in a `forEach`
 *   step also `{item.…}`, `{n}` (1-based) and `{index}`. `caption` defaults to `say`.
 * - `when`: a data path; the step is left out when it is empty.
 * - `forEach`: a data path to a list; one line per item. `id` must then contain `{n}` or `{index}`.
 * - `at`: an anchor name, or "after". An anchor whose value is a list gives item i its i-th time.
 *   A line starts at its anchor + `offset`, or `gap` after the previous line ends, whichever is later.
 * - `highlight`: the line's item is highlighted from just before it is spoken until the next
 *   highlighted line (or `highlightTail` after it ends).
 * - `emphasize`: a template whose value appears in `say`; its share of the text gives the moment
 *   it is spoken (an `emphasis` event), for example to pulse a picture of a name as it is said.
 */

const fail = (message) => { throw new Error(`Narration script: ${message}`); };
const STEP_KEYS = new Set(["id", "say", "caption", "locale", "when", "forEach", "at", "offset", "gap", "highlight", "emphasize"]);
const PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/u;
const text = (value, max) => typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const number = (value, min, max) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

/** The script, checked; every problem names its step. Unknown keys are refused. */
export function readNarrationScript(json) {
  if (json?.schemaVersion !== 1 || json.kind !== "anchored-narration-script") fail("schemaVersion 1 and kind anchored-narration-script are required");
  if (!text(json.locale, 16)) fail("a default locale (BCP 47, for example ja) is required");
  if (json.highlightTail !== undefined && !number(json.highlightTail, 0, 10)) fail("highlightTail must be 0 to 10 seconds");
  if (!Array.isArray(json.steps) || !json.steps.length || json.steps.length > 40) fail("one to 40 steps are required");
  const steps = json.steps.map((step, i) => {
    const at = `steps[${i}]${typeof step?.id === "string" ? ` (${step.id})` : ""}`;
    if (!step || typeof step !== "object" || Array.isArray(step)) fail(`${at} must be an object`);
    for (const key of Object.keys(step)) if (!STEP_KEYS.has(key)) fail(`${at}.${key} is not a step setting`);
    if (!text(step.id, 60) || !/^[A-Za-z0-9_{}-]+$/u.test(step.id)) fail(`${at}.id must be letters, digits, - and _ (and {n} or {index})`);
    if (!text(step.say, 400)) fail(`${at}.say is required`);
    if (step.caption !== undefined && !text(step.caption, 400)) fail(`${at}.caption must be a text`);
    if (step.locale !== undefined && !text(step.locale, 16)) fail(`${at}.locale must be a BCP 47 tag`);
    for (const key of ["when", "forEach"]) if (step[key] !== undefined && !PATH.test(step[key] ?? "")) fail(`${at}.${key} must be a data path such as words`);
    if (step.forEach !== undefined && !/\{(?:n|index)\}/u.test(step.id)) fail(`${at}.id must contain {n} or {index}, so each item has its own id`);
    if (step.forEach === undefined && /\{(?:n|index)\}/u.test(step.id)) fail(`${at}.id uses {n} without forEach`);
    if (!text(step.at, 60) || !(step.at === "after" || PATH.test(step.at))) fail(`${at}.at must be an anchor name or "after"`);
    if (step.offset !== undefined && !number(step.offset, -10, 60)) fail(`${at}.offset must be -10 to 60 seconds`);
    if (step.gap !== undefined && !number(step.gap, 0, 10)) fail(`${at}.gap must be 0 to 10 seconds`);
    if (step.highlight !== undefined && typeof step.highlight !== "boolean") fail(`${at}.highlight must be true or false`);
    if (step.highlight && step.forEach === undefined) fail(`${at}.highlight needs forEach: it highlights the line's item`);
    if (step.emphasize !== undefined && !text(step.emphasize, 100)) fail(`${at}.emphasize must be a template`);
    for (const key of ["say", "caption", "emphasize"]) for (const [, path] of (step[key] ?? "").matchAll(/\{([^}]*)\}/gu))
      if (!PATH.test(path)) fail(`${at}.${key} has a field {${path}} that is not a data path`);
    return { gap: .45, offset: 0, ...step };
  });
  return { locale: json.locale, highlightTail: json.highlightTail ?? 1, steps };
}

/** The anchor names a script uses (besides "after"), to check them against a renderer before any work. */
export const scriptAnchors = (script) => [...new Set(script.steps.map(step => step.at).filter(at => at !== "after"))];

function lookup(data, path) {
  let value = data;
  for (const key of path.split(".")) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}

/** A template with its `{path}` fields filled from the data. A missing field, or a list or object, throws. */
export function renderTemplate(template, data) {
  return template.replace(/\{([^}]*)\}/gu, (_, path) => {
    const value = lookup(data, path);
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value !== "string") fail(`the field {${path}} is ${value === undefined ? "missing" : "not a text or a number"}`);
    return value;
  });
}
const empty = (value) => value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length);

/**
 * The lines of a script for one video's data, in spoken order: `{ id, say, caption, locale, at,
 * offset, gap, index?, highlight?, emphasizeAt? }` (`emphasizeAt` as a share 0..1 of the line's text).
 */
export function expandNarrationScript(script, data) {
  const lines = [];
  for (const step of script.steps) {
    if (step.when !== undefined && empty(lookup(data, step.when))) continue;
    const items = step.forEach === undefined ? [null] : lookup(data, step.forEach);
    if (!Array.isArray(items)) fail(`${step.id}: forEach ${step.forEach} is not a list`);
    items.forEach((item, index) => {
      const scope = step.forEach === undefined ? data : { ...data, item, n: index + 1, index };
      const say = renderTemplate(step.say, scope);
      const line = {
        id: renderTemplate(step.id, scope), say, caption: renderTemplate(step.caption ?? step.say, scope), locale: step.locale ?? script.locale,
        at: step.at, offset: step.offset, gap: step.gap, ...(step.forEach === undefined ? {} : { index }), ...(step.highlight ? { highlight: true } : {}),
      };
      if (step.emphasize !== undefined) {
        const value = renderTemplate(step.emphasize, scope), position = say.indexOf(value);
        if (position < 0) fail(`${line.id}: the emphasized text "${value}" is not in what the line says`);
        line.emphasizeAt = position / say.length;
      }
      lines.push(line);
    });
  }
  const ids = lines.map(line => line.id);
  if (new Set(ids).size !== ids.length) fail(`two lines share an id (${ids.find((id, i) => ids.indexOf(id) !== i)})`);
  return lines;
}

const round3 = (v) => Math.round(v * 1000) / 1000;

/**
 * Times for the lines, in order, from the anchors (seconds; a list gives item i its i-th time) and
 * the measured speech of each line (seconds). A line starts at its anchor + offset, or `gap` after
 * the previous line ends, whichever is later ("after": only the latter).
 * - With `partial`, placement stops at the first line whose anchor is not known yet, so a host can
 *   place the lines that come before a phase whose length depends on them.
 * - `drift` is how late each anchored line starts after its anchor, for a pacing check.
 */
export function placeOnAnchors({ lines, anchors, speech, partial = false, highlightTail = 1, highlightLead = .08 }) {
  const onsets = {}, ends = {}, drift = {}, placed = [];
  let previousEnd = -Infinity;
  for (const line of lines) {
    const duration = speech[line.id];
    if (!(duration > 0)) fail(`line ${line.id} has no measured speech`);
    let at;
    if (line.at === "after") {
      if (!placed.length) fail(`line ${line.id} is placed after a previous line, but it is the first`);
      at = previousEnd + line.gap;
    } else {
      let anchor = anchors[line.at];
      if (Array.isArray(anchor)) anchor = anchor[line.index ?? 0];
      if (!Number.isFinite(anchor)) {
        if (partial) break;
        fail(`line ${line.id} needs the anchor ${line.at}${Array.isArray(anchors[line.at]) ? ` for item ${(line.index ?? 0) + 1}` : ""}, which the picture does not have`);
      }
      at = Math.max(anchor + line.offset, previousEnd + line.gap);
      drift[line.id] = round3(at - (anchor + line.offset));
    }
    if (at < 0) fail(`line ${line.id} would start before the video`);
    onsets[line.id] = round3(at);
    ends[line.id] = round3(at + duration);
    previousEnd = at + duration;
    placed.push(line);
  }
  const lit = placed.filter(line => line.highlight);
  const highlights = lit.map((line, i) => {
    const at = round3(onsets[line.id] - highlightLead);
    const next = lit[i + 1];
    return { item: line.index, at, hold: round3(next ? onsets[next.id] - highlightLead - at : speech[line.id] + highlightLead + highlightTail) };
  });
  const emphasis = placed.filter(line => line.emphasizeAt !== undefined).map(line => ({ id: line.id, at: round3(onsets[line.id] + speech[line.id] * line.emphasizeAt) }));
  return { placed: placed.map(line => line.id), onsets, ends, drift, highlights, emphasis, end: placed.length ? round3(previousEnd) : 0 };
}
