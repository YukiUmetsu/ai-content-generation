import type { CharacterDefinition } from "@/components/character/definition";

/** Original, bundled, deterministic vector puppets. No downloads or external artwork rights. */
const provenance = { source: "Original ContentGen Pip and Quill vector artwork", license: "ContentGen project original artwork" };
const path = (d: string, fill: string, stroke?: string, strokeWidth?: number) =>
  ({ type: "path" as const, d, fill, ...(stroke ? { stroke, strokeWidth } : {}) });
const ellipse = (cx: number, cy: number, rx: number, ry: number, fill: string) =>
  ({ type: "ellipse" as const, cx, cy, rx, ry, fill });
const asset = (shapes: Array<ReturnType<typeof path> | ReturnType<typeof ellipse>>) =>
  ({ kind: "shapes" as const, width: 360, height: 420, shapes, provenance });

function makePuppet(id: "pip" | "quill"): CharacterDefinition {
  const pip = id === "pip";
  const colors = pip
    ? { body: "#6DD4BD", shadow: "#328B83", face: "#B8F0D8", light: "#F5D597", accent: "#E68F68", dark: "#263F48" }
    : { body: "#A7A2EA", shadow: "#625C9F", face: "#E9E6FB", light: "#FFD38F", accent: "#EFAC79", dark: "#323453" };
  const body = pip
    ? [ellipse(180, 318, 104, 91, "$shadow"), ellipse(180, 299, 89, 86, "$body"),
      path("M96 273 Q181 333 262 273 Q238 355 180 373 Q121 353 96 273Z", "$face"),
      path("M111 266 Q177 294 248 263 L267 283 Q180 325 93 285Z", "$accent"),
      ellipse(180, 318, 22, 17, "$light")]
    : [ellipse(180, 308, 104, 93, "$shadow"), ellipse(180, 292, 92, 92, "$body"),
      path("M111 268 Q181 311 251 268 L249 323 Q180 383 111 323Z", "$face"),
      path("M154 275 L181 296 L205 275 L181 337Z", "$light")];
  const head = pip
    ? [path("M89 136 L73 46 L143 85 Q184 58 224 85 L286 43 L273 146 Q295 180 272 227 Q238 279 180 278 Q120 280 89 228 Q64 188 89 136Z", "$body"),
      path("M88 76 L113 98 L93 133Z M272 76 L246 97 L267 133Z", "$accent"),
      ellipse(180, 213, 88, 58, "$face"), ellipse(180, 222, 18, 12, "$dark"),
      ellipse(158, 217, 13, 8, "$light"), ellipse(202, 217, 13, 8, "$light")]
    : [path("M88 150 L66 60 L123 95 L163 65 L180 86 L208 63 L249 97 L293 60 L274 152 Q289 186 274 229 Q240 281 180 281 Q118 279 86 228 Q71 185 88 150Z", "$body"),
      ellipse(143, 171, 61, 70, "$face"), ellipse(218, 171, 61, 70, "$face"),
      path("M166 199 L180 239 L195 199 Q180 182 166 199Z", "$light"),
      path("M121 111 Q143 96 164 115 M194 115 Q216 94 239 112", "none", "$dark", 6)];
  const armLeft = pip
    ? [path("M117 290 Q67 271 42 314 Q24 347 55 356 Q87 360 132 317Z", "$body", "$shadow", 5), ellipse(52, 339, 24, 20, "$face")]
    : [path("M108 268 Q53 238 38 311 Q29 355 67 364 Q104 342 129 301Z", "$body", "$shadow", 5),
      path("M58 297 L55 334 L96 314Z", "$face")];
  const armRight = pip
    ? [path("M245 290 Q298 271 320 313 Q334 349 302 355 Q273 359 230 316Z", "$body", "$shadow", 5), ellipse(309, 335, 23, 20, "$face")]
    : [path("M249 268 Q311 241 322 309 Q330 349 296 362 Q263 341 233 302Z", "$body", "$shadow", 5),
      path("M301 296 L304 337 L264 315Z", "$face")];
  const eyes = pip
    ? [ellipse(145, 177, 12, 16, "$dark"), ellipse(217, 177, 12, 16, "$dark"),
      ellipse(150, 172, 4, 6, "#FFFFFF"), ellipse(222, 172, 4, 6, "#FFFFFF")]
    : [ellipse(143, 170, 11, 17, "$dark"), ellipse(218, 170, 11, 17, "$dark"),
      ellipse(146, 164, 4, 6, "#FFFFFF"), ellipse(221, 164, 4, 6, "#FFFFFF")];
  const eyesClosed = pip
    ? [path("M129 178 Q146 191 162 177 M200 177 Q218 192 234 177", "none", "$dark", 6)]
    : [path("M126 172 Q143 184 159 172 M202 172 Q218 186 235 172", "none", "$dark", 6)];
  const mouthY = pip ? 239 : 249;
  const mouthRest = [path(`M160 ${mouthY} Q180 ${mouthY + 11} 199 ${mouthY}`, "none", "$dark", 5)];
  const mouthOpen = [ellipse(180, mouthY + 5, 14, 18, "$dark"), ellipse(180, mouthY + 15, 7, 4, "$accent")];
  const mouthWide = [ellipse(180, mouthY + 5, 21, 15, "$dark"), ellipse(180, mouthY + 13, 11, 5, "$accent")];
  const prefix = (name: string) => `${id}-${name}`;
  return {
    schemaVersion: 1, characterId: id, revision: "bundled-vector-1", mode: "puppet-2.5d",
    design: { width: 360, height: 420 }, channels: ["torso", "head", "eyes", "mouth", "arms"], palette: colors,
    assets: { torso: asset(body), head: asset(head), eyeOpen: asset(eyes), eyeClosed: asset(eyesClosed),
      mouthRest: asset(mouthRest), mouthOpen: asset(mouthOpen), mouthWide: asset(mouthWide),
      armLeft: asset(armLeft), armRight: asset(armRight) },
    parts: [
      { id: "torso", channel: "torso", asset: "torso", pivot: { x: 180, y: 313 }, z: 0 },
      { id: "left-arm", channel: "arms", asset: "armLeft", pivot: { x: 113, y: 291 }, z: -1,
        limits: { rotation: { min: -48, max: 40 } } },
      { id: "right-arm", channel: "arms", asset: "armRight", pivot: { x: 247, y: 291 }, z: -1,
        limits: { rotation: { min: -40, max: 48 } } },
      { id: "head", channel: "head", asset: "head", pivot: { x: 180, y: 191 }, z: 2,
        limits: { rotation: { min: -14, max: 14 } } },
      { id: "eyes", parent: "head", channel: "eyes", asset: "eyeOpen", variants: { closed: "eyeClosed" },
        pivot: { x: 180, y: 174 }, z: 3 },
      { id: "mouth", parent: "head", channel: "mouth", asset: "mouthRest",
        variants: { open: "mouthOpen", wide: "mouthWide" }, pivot: { x: 180, y: mouthY }, z: 4 },
    ],
    poses: { neutral: {} }, basePose: "neutral",
    actions: {
      [prefix("explain")]: { channel: "arms", blend: "override", priority: 1, takeover: "cut", phases: [
        { name: "prepare", frames: 6, pose: { "right-arm": { rotation: -30 }, "left-arm": { rotation: 12 } } },
        { name: "act", frames: 12, pose: { "right-arm": { rotation: -35 }, "left-arm": { rotation: 18 } } },
        { name: "recover", frames: 9, pose: {} },
      ] },
    },
    expressions: { default: "calm", sets: { calm: {}, interested: { pose: { head: { rotation: pip ? 4 : -4 } } } } },
    speech: { mouthPart: "mouth", rest: "rest", visemes: { A: "open", O: "wide" },
      approximateCycle: ["open", "wide", "open", "rest"], approximateStepFrames: 4, transitionFrames: 1 },
    blink: { parts: ["eyes"], variant: "closed", intervalFrames: { min: 64, max: 113 }, durationFrames: 4 },
    idle: { parts: { head: { property: "rotation", amplitude: 1.6, periodFrames: 101 },
      torso: { property: "rotation", amplitude: 0.7, periodFrames: 74 } } },
    capabilities: ["blink", "approximate-speech", "arm-gesture", "idle", "expression"],
  };
}

export const PIP_RIG = makePuppet("pip");
export const QUILL_RIG = makePuppet("quill");
