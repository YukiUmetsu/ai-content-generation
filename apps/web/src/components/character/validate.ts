/**
 * Definition validator — run once when a revision is approved or loaded, not per frame.
 *
 * Returns precise diagnostics for every broken reference, range or unsafe value. Nothing is
 * repaired silently: a definition with errors should not be performed. The checks cover the
 * "Reject unsupported required features with a precise diagnostic" rule of the brief.
 */

import type { CharacterDefinition, CharacterDiagnostic, CharacterPart, CharacterShape } from "./definition";
import { CHARACTER_SCHEMA_VERSION } from "./definition";

/** Path data may only use SVG path commands and number syntax. Anything else is rejected, never parsed as markup. */
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]*$/;
/** `none` draws no fill or stroke; hex and `$palette` references are the only other forms. */
const COLOR = /^(none|#[0-9a-fA-F]{3,8}|\$[A-Za-z][\w-]*)$/;
/** Image `uri` is a logical reference the host resolves; schemes and traversal are rejected. */
const LOGICAL_URI = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function validateCharacterDefinition(definition: CharacterDefinition): CharacterDiagnostic[] {
  const out: CharacterDiagnostic[] = [];
  const error = (code: string, message: string, extra: Partial<CharacterDiagnostic> = {}) => out.push({ code, severity: "error", message, ...extra });
  const warn = (code: string, message: string, extra: Partial<CharacterDiagnostic> = {}) => out.push({ code, severity: "warning", message, ...extra });

  if (definition.schemaVersion !== CHARACTER_SCHEMA_VERSION) error("schema-version", `Unsupported schemaVersion ${String(definition.schemaVersion)}.`);
  if (!definition.characterId || !definition.revision) error("identity", "characterId and revision are required.");
  if (definition.mode !== "sprite-2d" && definition.mode !== "puppet-2.5d") error("mode", `Unsupported mode "${String(definition.mode)}".`);
  if (!(isNumber(definition.design?.width) && isNumber(definition.design?.height)) || definition.design.width <= 0 || definition.design.height <= 0) {
    error("design", "design width and height must be positive finite numbers.");
  }

  const channels = new Set(definition.channels);
  if (channels.size !== definition.channels.length) error("channels", "Channel names must be unique.");

  for (const [name, color] of Object.entries(definition.palette ?? {})) {
    if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) error("palette", `Palette "${name}" must be a hex color.`);
  }

  // Assets.
  const assets = definition.assets ?? {};
  for (const [key, asset] of Object.entries(assets)) {
    if (!asset.provenance?.license || !asset.provenance?.source) error("provenance", `Asset "${key}" needs license and source provenance.`);
    if (!(isNumber(asset.width) && isNumber(asset.height)) || asset.width <= 0 || asset.height <= 0) {
      error("asset-size", `Asset "${key}" needs positive finite width and height.`);
    }
    if (asset.kind === "image") {
      if (!LOGICAL_URI.test(asset.uri) || asset.uri.includes("..")) error("asset-uri", `Image "${key}" must use a logical reference, not a URL or path traversal.`);
      if (asset.mediaType !== "image/png" && asset.mediaType !== "image/webp") error("asset-media", `Image "${key}" has unsupported media type.`);
      continue;
    }
    if (asset.kind !== "shapes") {
      error("asset-kind", `Asset "${key}" has unsupported kind.`);
      continue;
    }
    asset.shapes.forEach((shape: CharacterShape, index: number) => {
      if (shape.type === "path") {
        if (!PATH_DATA.test(shape.d)) error("path-data", `Asset "${key}" shape ${index} contains characters outside SVG path syntax.`);
      } else if (shape.type !== "ellipse" && shape.type !== "rect") {
        error("shape-type", `Asset "${key}" shape ${index} has unsupported type.`);
      }
      for (const color of [shape.fill, shape.stroke]) {
        if (color !== undefined && !COLOR.test(color)) error("color", `Asset "${key}" shape ${index} uses an invalid color "${color}".`);
        if (color?.startsWith("$") && definition.palette?.[color.slice(1)] === undefined) error("palette-ref", `Asset "${key}" shape ${index} uses undefined palette "${color}".`);
      }
    });
  }

  // Parts: identity, hierarchy, channels and asset references.
  const parts = definition.parts ?? [];
  const partById = new Map<string, CharacterPart>();
  for (const part of parts) {
    if (partById.has(part.id)) error("duplicate-part", `Part id "${part.id}" is used twice.`, { partId: part.id });
    partById.set(part.id, part);
  }
  for (const part of parts) {
    if (!channels.has(part.channel)) error("unknown-channel", `Part "${part.id}" uses undeclared channel "${part.channel}".`, { partId: part.id });
    if (!assets[part.asset]) error("missing-asset", `Part "${part.id}" references missing asset "${part.asset}".`, { partId: part.id });
    for (const [variant, key] of Object.entries(part.variants ?? {})) {
      if (!assets[key]) error("missing-asset", `Part "${part.id}" variant "${variant}" references missing asset "${key}".`, { partId: part.id });
    }
    if (!isNumber(part.pivot?.x) || !isNumber(part.pivot?.y)) error("pivot", `Part "${part.id}" needs a finite pivot.`, { partId: part.id });
    if (part.parent !== undefined) {
      if (!partById.has(part.parent) && !parts.some(p => p.id === part.parent)) error("missing-parent", `Part "${part.id}" has missing parent "${part.parent}".`, { partId: part.id });
      if (definition.mode === "sprite-2d") warn("parent-in-sprite", `Part "${part.id}" nests under a parent in sprite-2d mode; nested pivots are a 2.5D feature.`, { partId: part.id });
    }
    if (part.limits?.translate && (part.limits.translate.min.x > part.limits.translate.max.x || part.limits.translate.min.y > part.limits.translate.max.y)) {
      error("limits", `Part "${part.id}" translate limits are inverted.`, { partId: part.id });
    }
    if (part.limits?.rotation && part.limits.rotation.min > part.limits.rotation.max) error("limits", `Part "${part.id}" rotation limits are inverted.`, { partId: part.id });
    if (part.limits?.scale && (part.limits.scale.min <= 0 || part.limits.scale.min > part.limits.scale.max)) error("limits", `Part "${part.id}" scale limits must be positive and ordered.`, { partId: part.id });
  }
  // Cycles in the parent chain.
  for (const part of parts) {
    const seen = new Set<string>();
    let current: CharacterPart | undefined = part;
    while (current?.parent !== undefined) {
      if (seen.has(current.id)) {
        error("parent-cycle", `Part "${part.id}" is inside a parent cycle.`, { partId: part.id });
        break;
      }
      seen.add(current.id);
      current = partById.get(current.parent);
    }
  }

  // Poses and actions.
  const poseEntries = Object.entries(definition.poses ?? {});
  for (const [name, pose] of poseEntries) {
    for (const id of Object.keys(pose)) if (!partById.has(id)) error("unknown-part", `Pose "${name}" references unknown part "${id}".`, { partId: id });
  }
  if (!definition.poses?.[definition.basePose]) error("base-pose", `Base pose "${definition.basePose}" is not defined.`);
  for (const [name, action] of Object.entries(definition.actions ?? {})) {
    if (!channels.has(action.channel)) error("unknown-channel", `Action "${name}" uses undeclared channel "${action.channel}".`);
    if (!["finish", "blend-out", "cut"].includes(action.takeover)) error("takeover", `Action "${name}" must declare takeover finish, blend-out or cut.`);
    if (!action.phases?.length) error("phases", `Action "${name}" needs at least one phase.`);
    for (const phase of action.phases ?? []) {
      if (!Number.isInteger(phase.frames) || phase.frames < 1) error("phase-frames", `Action "${name}" phase "${phase.name}" needs a whole number of frames ≥ 1.`);
      for (const [id, variant] of Object.entries(phase.variants ?? {})) {
        const part = partById.get(id);
        if (!part?.variants?.[variant]) error("unknown-variant", `Action "${name}" phase "${phase.name}" shows undefined variant "${variant}" on "${id}".`, { partId: id });
        else if (action.blend === "override" && part.channel !== action.channel) error("channel-mismatch", `Action "${name}" phase "${phase.name}" swaps "${id}" from channel "${part.channel}".`, { partId: id });
      }
      for (const [id, delta] of Object.entries(phase.pose ?? {})) {
        const part = partById.get(id);
        if (!part) error("unknown-part", `Action "${name}" references unknown part "${id}".`, { partId: id });
        else if (action.blend === "override" && part.channel !== action.channel) {
          error("channel-mismatch", `Action "${name}" (channel "${action.channel}") writes "${id}" from channel "${part.channel}".`, { partId: id });
        }
        if (delta && Object.values(delta).some(v => v !== undefined && !isNumber(v))) error("pose-value", `Action "${name}" has a non-finite value for "${id}".`, { partId: id });
      }
    }
  }

  // Expressions.
  if (!definition.expressions?.sets?.[definition.expressions?.default]) error("expression-default", "The default expression is not defined.");
  for (const [name, set] of Object.entries(definition.expressions?.sets ?? {})) {
    for (const [id, variant] of Object.entries(set.variants ?? {})) {
      if (!partById.get(id)?.variants?.[variant]) error("unknown-variant", `Expression "${name}" uses undefined variant "${variant}" on "${id}".`, { partId: id });
    }
  }

  // Speech, gaze, blink, idle, params, skins.
  if (definition.speech) {
    const speech = definition.speech;
    const mouth = partById.get(speech.mouthPart);
    if (!mouth) error("speech-part", `Speech mouth part "${speech.mouthPart}" is not defined.`);
    // `rest` may be the part's default drawing (no variant entry); every other shape must be a variant.
    const needed = [...Object.values(speech.visemes), ...speech.approximateCycle].filter(variant => variant !== speech.rest);
    for (const variant of needed) {
      if (!mouth?.variants?.[variant]) error("speech-variant", `Mouth variant "${variant}" is not defined on "${speech.mouthPart}".`, { partId: speech.mouthPart });
    }
    if (speech.approximateStepFrames < 1) error("speech-timing", "approximateStepFrames must be ≥ 1.");
  }
  if (definition.gaze) {
    for (const id of definition.gaze.parts) if (!partById.has(id)) error("unknown-part", `Gaze references unknown part "${id}".`, { partId: id });
    if (definition.gaze.maxOffset < 0 || !isNumber(definition.gaze.maxOffset)) error("gaze-range", "Gaze maxOffset must be a finite number ≥ 0.");
  }
  if (definition.blink) {
    const blink = definition.blink;
    const { min, max } = blink.intervalFrames;
    if (!(Number.isInteger(min) && Number.isInteger(max) && min >= 1 && max >= min)) error("blink-interval", "Blink intervals need whole frame counts with 1 ≤ min ≤ max.");
    if (blink.durationFrames < 1) error("blink-duration", "Blink durationFrames must be ≥ 1.");
    for (const id of blink.parts) {
      if (!partById.get(id)?.variants?.[blink.variant]) error("unknown-variant", `Blink variant "${blink.variant}" is not defined on "${id}".`, { partId: id });
    }
  }
  for (const [id, spec] of Object.entries(definition.idle?.parts ?? {})) {
    if (!partById.has(id)) error("unknown-part", `Idle references unknown part "${id}".`, { partId: id });
    if (spec.periodFrames < 1) error("idle-period", `Idle period for "${id}" must be ≥ 1 frame.`, { partId: id });
    if (Math.abs(spec.amplitude) > 0.1 && spec.property !== "rotation") warn("idle-amplitude", `Idle amplitude ${spec.amplitude} for "${id}" is large for subtle idle motion.`, { partId: id });
  }
  for (const [name, spec] of Object.entries(definition.params ?? {})) {
    if (!(spec.min <= spec.default && spec.default <= spec.max)) error("param-range", `Parameter "${name}" default must lie within its bounds.`);
    for (const target of spec.targets) if (!partById.has(target.part)) error("unknown-part", `Parameter "${name}" targets unknown part "${target.part}".`, { partId: target.part });
  }
  for (const [name, skin] of Object.entries(definition.skins ?? {})) {
    for (const key of Object.keys(skin.palette ?? {})) {
      if (definition.palette?.[key] === undefined) error("skin-palette", `Skin "${name}" overrides undefined palette "${key}".`);
    }
    for (const [key, replacement] of Object.entries(skin.assets ?? {})) {
      if (!assets[key] || !assets[replacement]) error("skin-asset", `Skin "${name}" swaps "${key}" for "${replacement}", and one is missing.`);
    }
  }

  // Anchors and capabilities.
  for (const [id, anchor] of Object.entries(definition.anchors ?? {})) {
    if (anchor.part !== undefined && !partById.has(anchor.part)) error("unknown-part", `Anchor "${id}" follows unknown part "${anchor.part}".`, { partId: anchor.part });
    if (!isNumber(anchor.at?.x) || !isNumber(anchor.at?.y)) error("anchor-value", `Anchor "${id}" needs finite coordinates.`);
  }
  for (const capability of definition.capabilities ?? []) {
    if (!capability) error("capability", "Capabilities must be non-empty strings.");
  }
  return out;
}

/** Errors only: the check a consumer runs before refusing to publish a revision. */
export function assertCharacterDefinitionValid(definition: CharacterDefinition): CharacterDefinition {
  const errors = validateCharacterDefinition(definition).filter(d => d.severity === "error");
  if (errors.length) throw Error(`Character "${definition.characterId}" is invalid:\n  - ${errors.map(e => `${e.code}: ${e.message}`).join("\n  - ")}`);
  return definition;
}
