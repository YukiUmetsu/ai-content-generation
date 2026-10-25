/** Project-owned creative palette. It does not change ContentGen's application UI theme. */
import { PRESETS } from "@/features/brand-appearance/model/presets";
import { contrastRatio, normalizeHex } from "@/features/brand-appearance/model/palette";
import type { BrandPalette, PresetId } from "@/features/brand-appearance/model/types";
import type { ThumbnailPalette } from "@/features/thumbnail-composer/model/types";
import { THUMBNAIL_PALETTES } from "@/features/thumbnail-composer/model/palettes";

export const PROJECT_COLOR_ROLES = ["primary", "secondary", "accent", "background", "text"] as const;
export type ProjectColorRole = (typeof PROJECT_COLOR_ROLES)[number];
export type ProjectTypographyPreset = PresetId;
export interface ProjectCustomColor { name: string; hex: string }
export type ProjectPalette = Record<ProjectColorRole, string> & { custom: ProjectCustomColor[] };
export interface ProjectAppearanceDraft { palette: ProjectPalette; typographyPreset: ProjectTypographyPreset }
export interface ProjectAppearance extends ProjectAppearanceDraft { revision: number; updatedAt: string }

/** Deliberately generic, legible defaults until the Project chooses an appearance. */
export const DEFAULT_PROJECT_PALETTE: ProjectPalette = {
  primary: "#152A45", secondary: "#2D6C83", accent: "#EEAA45",
  background: "#F6F3EC", text: "#18243A", custom: [],
};
export const PROJECT_APPEARANCE_HISTORY_LIMIT = 12;

function object(value: unknown, required: readonly string[], optional: readonly string[], context: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(context + " must be an object.");
  const record = value as Record<string, unknown>;
  for (const field of Object.keys(record)) if (!required.includes(field) && !optional.includes(field)) {
    throw new Error("Unexpected " + context + " field: " + field);
  }
  for (const field of required) if (!(field in record)) throw new Error("Missing " + context + "." + field);
  return record;
}

function hex(value: unknown, context: string): string {
  const normalized = typeof value === "string" ? normalizeHex(value) : null;
  if (!normalized) throw new Error(context + " requires a #RGB or #RRGGBB hex color.");
  return normalized;
}

export function validateProjectPalette(value: unknown): ProjectPalette {
  const source = object(value, [...PROJECT_COLOR_ROLES, "custom"], [], "palette");
  const base = Object.fromEntries(PROJECT_COLOR_ROLES.map(role => [role, hex(source[role], "palette." + role)])) as Record<ProjectColorRole,string>;
  if (!Array.isArray(source.custom) || source.custom.length > 8) throw new Error("Palette allows up to eight custom colors.");
  const names = new Set(PROJECT_COLOR_ROLES.map(role => role.toLowerCase()));
  const custom = source.custom.map((raw, index) => {
    const item = object(raw, ["name", "hex"], [], "custom color " + index);
    if (typeof item.name !== "string" || !/^[\p{L}\p{N}][\p{L}\p{N} ._\-]{0,31}$/u.test(item.name.trim())) {
      throw new Error("Custom color name must be 1–32 plain characters.");
    }
    const name = item.name.trim();
    const key = name.toLocaleLowerCase();
    if (PROJECT_COLOR_ROLES.some(role => role.toLowerCase() === key)) throw new Error("Custom color uses a reserved role name.");
    if (names.has(key)) throw new Error("Duplicate custom color name: " + name);
    names.add(key);
    return { name, hex: hex(item.hex, "custom color " + name) };
  });
  return { ...base, custom };
}

export function validateProjectAppearanceDraft(value: unknown): ProjectAppearanceDraft {
  const source = object(value, ["palette", "typographyPreset"], [], "brand appearance draft");
  if (typeof source.typographyPreset !== "string" || !(source.typographyPreset in PRESETS)) {
    throw new Error("Unsupported typography preset.");
  }
  return { palette: validateProjectPalette(source.palette), typographyPreset: source.typographyPreset as PresetId };
}

export function validateProjectAppearance(value: unknown): ProjectAppearance {
  const source = object(value, ["revision", "updatedAt", "palette", "typographyPreset"], [], "brand appearance");
  if (typeof source.revision !== "number" || !Number.isInteger(source.revision) || source.revision < 1 || source.revision > 999999) {
    throw new Error("Invalid appearance revision.");
  }
  if (typeof source.updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(source.updatedAt) ||
      !Number.isFinite(Date.parse(source.updatedAt))) {
    throw new Error("Invalid appearance update time.");
  }
  const draft = validateProjectAppearanceDraft({ palette: source.palette, typographyPreset: source.typographyPreset });
  return { ...draft, revision: source.revision as number, updatedAt: source.updatedAt };
}

export function resolveProjectAppearance(project: {brandAppearance?: ProjectAppearance}): ProjectAppearance {
  return project.brandAppearance ?? {
    revision: 0, updatedAt: "", typographyPreset: "modern-analytical", palette: {
      ...DEFAULT_PROJECT_PALETTE, custom: [],
    },
  };
}

/** Capture an independent revision snapshot for downstream, immutable output manifests. */
export function snapshotProjectAppearance(project: {brandAppearance?: ProjectAppearance}): ProjectAppearance {
  const current = resolveProjectAppearance(project);
  return {
    ...current,
    palette: { ...current.palette,custom:current.palette.custom.map(color=>({...color})) },
  };
}

/** Compatibility adapter for existing BrandAppearance preview and Kumiki semantic scenes. */
export function toBrandPalette(palette: ProjectPalette): BrandPalette {
  return {
    canvas: palette.background,
    surface: palette.primary,
    textPrimary: palette.text,
    textSecondary: palette.secondary,
    accent: palette.accent,
    positive: palette.secondary,
    negative: palette.accent,
  };
}

/** Four semantic roles accepted by the pinned Kumiki still/thumbnail composition layer. */
export function toKumikiPalette(palette: ProjectPalette): {
  background: string; foreground: string; accent: string; surface: string;
} {
  return {background:palette.background,foreground:palette.text,accent:palette.accent,surface:palette.primary};
}

/** The same saved project swatches are the initial choices in thumbnail editing.
 * The legacy ThumbnailPalette ID union has only presets: consumers MUST snapshot
 * `roles`, never persist this adapter's fallback `blueprint` ID as a brand choice.
 */
export function toThumbnailPalette(palette: ProjectPalette): ThumbnailPalette {
  const onPrimary = (contrastRatio(palette.text,palette.primary)??0) >= (contrastRatio(palette.background,palette.primary)??0)
    ? palette.text : palette.background;
  return {
    ...THUMBNAIL_PALETTES.blueprint,
    id: "blueprint",
    name: "Project brand",
    roles: {
      background: palette.primary,
      surface: palette.secondary,
      text: onPrimary,
      muted: onPrimary,
      accent: palette.accent,
      positive: palette.secondary,
      danger: THUMBNAIL_PALETTES.blueprint.roles.danger,
      evidence: palette.secondary,
    },
  };
}
