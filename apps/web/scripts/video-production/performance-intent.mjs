/** PerformanceIntent v1: what happens in a scene and why. It holds no keyframes or poses.
 * Models may propose one. This validator decides whether it is usable, and code does all frame math.
 */
export const PERFORMANCE_VERBS = Object.freeze(["enter", "look-at", "grasp", "carry", "place", "release", "examine", "point-at", "react", "speak"]);
export const SHOT_KINDS = Object.freeze(["establish", "follow", "push-in", "rack-focus", "insert", "reveal-hold"]);
export const TIMING_PRESETS = Object.freeze(["restrained", "natural", "expressive"]);
const HOLDING = new Set(["carry", "place", "examine"]);
const EFFECTOR_VERBS = new Set(["grasp", "carry", "place", "release", "examine"]);
const DEFAULT_FRAMES = Object.freeze({ enter: 45, "look-at": 30, grasp: 18, carry: 24, place: 20, release: 18, examine: 24, "point-at": 30, react: 24, speak: 0 });

const safeFrames = (value) => Number.isSafeInteger(value) ? value : null;

/** Start and end frames for every action. Anchors resolve through spoken lines and earlier actions. */
export function resolveActionFrames(intent, context) {
  const actions = new Map((intent?.actions ?? []).map(action => [action.id, action]));
  const resolved = {};
  const visiting = new Set();
  const windows = context?.speechWindows ?? {};
  const resolve = (id) => {
    if (resolved[id]) return resolved[id];
    if (visiting.has(id)) throw Object.assign(Error(`Anchor cycle at ${id}`), { code: "anchor-cycle" });
    const action = actions.get(id);
    visiting.add(id);
    const at = action.at ?? { frame: 0 };
    const offset = at.offsetFrames ?? 0;
    let start;
    if ("frame" in at) start = at.frame;
    else if ("speech" in at) {
      const window = windows[at.speech];
      if (!window) throw Object.assign(Error(`No spoken line ${at.speech}`), { code: "unknown-anchor" });
      start = (at.edge === "end" ? window.endFrame : window.startFrame) + offset;
    } else if ("after" in at) {
      if (!actions.has(at.after)) throw Object.assign(Error(`No action ${at.after}`), { code: "unknown-anchor" });
      start = resolve(at.after).endFrame + offset;
    } else throw Object.assign(Error(`Action ${id} has no anchor`), { code: "unknown-anchor" });
    const duration = safeFrames(action.durationFrames) ?? DEFAULT_FRAMES[action.verb] ?? 24;
    visiting.delete(id);
    return (resolved[id] = { startFrame: start, endFrame: start + duration });
  };
  for (const id of actions.keys()) resolve(id);
  return resolved;
}

export function validatePerformanceIntent(intent, context = {}) {
  if (intent === undefined) return { ok: true, findings: [] };
  const findings = [];
  const fail = (code, path, message) => findings.push({ severity: "error", code, path, message });
  if (!intent || typeof intent !== "object" || intent.version !== 1) {
    fail("version", "version", "Only PerformanceIntent version 1 is supported.");
    return { ok: false, findings };
  }
  for (const id of intent.claimIds ?? [])
    if (context.knownClaimIds && !context.knownClaimIds.has(id)) fail("unknown-claim", "claimIds", `Unknown claim ${id}.`);
  const allowed = new Set(context.allowedNumbers ?? []);
  for (const field of ["objective", "visualChange"])
    for (const number of String(intent[field] ?? "").match(/\d+(?:[.,]\d+)*/gu) ?? [])
      if (!allowed.has(number)) fail("invented-number", field, `${field} uses ${number}, which is not in the source.`);
  if (intent.timing !== undefined && !TIMING_PRESETS.includes(intent.timing)) fail("unknown-timing", "timing", `Unknown timing ${intent.timing}.`);
  const castIds = new Set((intent.cast ?? []).map(actor => actor.id));
  const objectIds = new Set((intent.objects ?? []).map(object => object.id));
  const cast = context.cast ?? {}, objects = context.objects ?? {};
  for (const id of castIds) if (!cast[id]) fail("unknown-actor", "cast", `Cast has no saved rig for ${id}.`);
  for (const id of objectIds) if (!objects[id]) fail("unknown-object", "objects", `Set has no object ${id}.`);
  let frames = {};
  try { frames = resolveActionFrames(intent, context); }
  catch (error) {
    fail(error.code ?? "unknown-anchor", "actions", error.message);
    return { ok: false, findings };
  }
  const actions = intent.actions ?? [];
  const held = new Map();
  const order = [...actions].sort((a, b) => frames[a.id].startFrame - frames[b.id].startFrame);
  for (const action of order) {
    const path = `actions.${action.id}`;
    const { startFrame, endFrame } = frames[action.id];
    if (!PERFORMANCE_VERBS.includes(action.verb)) { fail("unknown-verb", path, `Unknown verb ${action.verb}.`); continue; }
    if (startFrame < 0 || endFrame >= intent.durationFrames) fail("frame-range", path, `${action.id} runs outside frames 0 to ${intent.durationFrames - 1}.`);
    const actor = cast[action.actor];
    if (!castIds.has(action.actor) || !actor) { fail("unknown-actor", path, `Unknown actor ${action.actor}.`); continue; }
    if (EFFECTOR_VERBS.has(action.verb) && !(actor.effectors ?? []).includes(action.effector))
      { fail("unknown-effector", path, `${action.actor} has no effector ${action.effector}.`); continue; }
    if (action.verb === "react") {
      if (action.expression && !(actor.expressions ?? []).includes(action.expression)) fail("unknown-expression", path, `${action.actor} has no expression ${action.expression}.`);
      if (action.gesture && !(actor.actions ?? []).includes(action.gesture)) fail("unknown-gesture", path, `${action.actor} has no gesture ${action.gesture}.`);
    }
    if (action.verb === "release") continue;
    if (action.object === undefined) continue;
    if (!objectIds.has(action.object) || !objects[action.object]) { fail("unknown-object", path, `Unknown object ${action.object}.`); continue; }
    const key = `${action.actor}.${action.effector}`;
    if (action.verb === "grasp") {
      if (!(objects[action.object].grips ?? []).includes(action.grip)) { fail("unknown-grip", path, `${action.object} has no grip ${action.grip}.`); continue; }
      if (held.has(action.object)) { fail("already-held", path, `${action.object} is already held by ${held.get(action.object)}.`); continue; }
      held.set(action.object, key);
    } else if (HOLDING.has(action.verb)) {
      if (held.get(action.object) !== key) { fail("not-held", path, `${key} is not holding ${action.object}.`); continue; }
      if (action.verb === "place") held.delete(action.object);
    }
  }
  const subjects = new Set([...castIds, ...objectIds, ...(intent.subjects ?? []).map(subject => subject.id)]);
  for (const shot of intent.shots ?? []) {
    const path = `shots.${shot.id}`;
    if (!SHOT_KINDS.includes(shot.kind)) fail("unknown-shot", path, `Unknown shot kind ${shot.kind}.`);
    for (const subject of shot.subjects ?? []) if (!subjects.has(subject)) fail("unknown-subject", path, `Unknown subject ${subject}.`);
  }
  return { ok: findings.length === 0, findings };
}
