import type {
  BrandState,
  ExportDocument,
  FontFamily,
  ImportError,
  PaletteRole,
  PresetId,
  SpacingDensity,
  CornerRadius,
  ApprovedWeight,
} from "./types";
import { PALETTE_ROLES } from "./types";
import { APPROVED_FAMILIES, APPROVED_WEIGHTS } from "./types";
import { PRESETS } from "./presets";
import { isValidHex, normalizeHex } from "./palette";

export function exportBrandKitAppearance(brand: BrandState): ExportDocument {
  return {
    schemaVersion: 1,
    kind: "brand-kit-appearance",
    id: brand.id,
    revision: brand.revision,
    name: brand.name,
    artDirection: {
      presetId: brand.appearance.presetId,
      traits: [...PRESETS[brand.appearance.presetId].traits],
      materialLanguage: PRESETS[brand.appearance.presetId].materialLanguage.en,
    },
    visual: {
      tokenVersion: "dtcg-example-v1",
      palette: { ...brand.appearance.palette },
      typography: {
        display: { ...brand.appearance.typography.display },
        body: { ...brand.appearance.typography.body },
        numbers: { ...brand.appearance.typography.numbers },
      },
      texture: brand.appearance.texture,
      spacing: brand.appearance.spacing,
      cornerRadius: brand.appearance.cornerRadius,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function push(errors: ImportError[], path: string, message: string) {
  errors.push({ path, message });
}

const VALID_PRESETS = new Set<string>(Object.keys(PRESETS));
const VALID_SPACING = new Set<SpacingDensity>([
  "spacious",
  "comfortable",
  "compact",
]);
const VALID_RADIUS = new Set<CornerRadius>(["low", "medium", "high"]);
const VALID_WEIGHTS = new Set<number>(APPROVED_WEIGHTS);

export function importBrandKitAppearance(
  text: string,
  activeBrand: BrandState
):
  | { brand: BrandState; sourceName?: string; sourceId?: string }
  | { errors: ImportError[] } {
  const errors: ImportError[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { errors: [{ path: "", message: "Invalid JSON." }] };
  }

  if (!isRecord(parsed)) {
    return { errors: [{ path: "", message: "Document must be an object." }] };
  }

  const schemaVersion = parsed.schemaVersion;
  if (schemaVersion !== 1) {
    push(errors, "schemaVersion", `Expected 1, received ${schemaVersion}.`);
  }

  const kind = parsed.kind;
  if (kind !== "brand-kit" && kind !== "brand-kit-appearance") {
    push(
      errors,
      "kind",
      `Expected "brand-kit" or "brand-kit-appearance", received ${kind}.`
    );
  }

  const sourceName =
    typeof parsed.name === "string" ? parsed.name : undefined;
  const sourceId = typeof parsed.id === "string" ? parsed.id : undefined;

  const artDirection = isRecord(parsed.artDirection) ? parsed.artDirection : {};
  let presetId: PresetId = activeBrand.appearance.presetId;
  const rawPresetId = artDirection.presetId;
  if (typeof rawPresetId === "string") {
    if (VALID_PRESETS.has(rawPresetId)) {
      presetId = rawPresetId as PresetId;
    } else {
      push(errors, "artDirection.presetId", `Unsupported preset "${rawPresetId}".`);
    }
  } else if (rawPresetId !== undefined) {
    push(errors, "artDirection.presetId", "Expected a string.");
  }

  const visual = isRecord(parsed.visual) ? parsed.visual : {};

  const rawPalette = isRecord(visual.palette) ? visual.palette : {};
  const palette: Record<PaletteRole, string> = {
    canvas: "#808080",
    surface: "#808080",
    textPrimary: "#808080",
    textSecondary: "#808080",
    accent: "#808080",
    positive: "#808080",
    negative: "#808080",
  };
  for (const role of PALETTE_ROLES) {
    const value = rawPalette[role];
    if (typeof value !== "string") {
      push(errors, `visual.palette.${role}`, "Missing or invalid type.");
    } else if (!isValidHex(value)) {
      push(errors, `visual.palette.${role}`, `Invalid hex color "${value}".`);
    } else {
      palette[role] = normalizeHex(value) as string;
    }
  }

  const rawTypography = isRecord(visual.typography) ? visual.typography : {};
  const typography = { ...activeBrand.appearance.typography };
  for (const role of ["display", "body", "numbers"] as const) {
    const rawRole = isRecord(rawTypography[role]) ? rawTypography[role] : {};
    const family = rawRole.family;
    const weight = rawRole.weight;

    if (typeof family !== "string") {
      push(errors, `visual.typography.${role}.family`, "Missing or invalid type.");
    } else if (!APPROVED_FAMILIES.includes(family as FontFamily)) {
      push(
        errors,
        `visual.typography.${role}.family`,
        `Unapproved font family "${family}".`
      );
    }

    if (typeof weight !== "number") {
      push(errors, `visual.typography.${role}.weight`, "Missing or invalid type.");
    } else if (!VALID_WEIGHTS.has(weight)) {
      push(
        errors,
        `visual.typography.${role}.weight`,
        `Unsupported weight ${weight}.`
      );
    }

    if (
      typeof family === "string" &&
      APPROVED_FAMILIES.includes(family as FontFamily) &&
      typeof weight === "number" &&
      VALID_WEIGHTS.has(weight)
    ) {
      typography[role] = {
        family: family as FontFamily,
        weight: weight as ApprovedWeight,
      };
    }
  }

  const texture =
    typeof visual.texture === "string"
      ? visual.texture
      : activeBrand.appearance.texture;

  let spacing = activeBrand.appearance.spacing;
  if (
    typeof visual.spacing === "string" &&
    VALID_SPACING.has(visual.spacing as SpacingDensity)
  ) {
    spacing = visual.spacing as SpacingDensity;
  } else if (visual.spacing !== undefined) {
    push(errors, "visual.spacing", `Unsupported spacing "${visual.spacing}".`);
  }

  let cornerRadius = activeBrand.appearance.cornerRadius;
  if (
    typeof visual.cornerRadius === "string" &&
    VALID_RADIUS.has(visual.cornerRadius as CornerRadius)
  ) {
    cornerRadius = visual.cornerRadius as CornerRadius;
  } else if (visual.cornerRadius !== undefined) {
    push(
      errors,
      "visual.cornerRadius",
      `Unsupported corner radius "${visual.cornerRadius}".`
    );
  }

  if (errors.length > 0) {
    return { errors };
  }

  const appearance = {
    presetId,
    palette,
    typography,
    texture,
    spacing,
    cornerRadius,
    customized: false,
  };

  return {
    brand: {
      ...activeBrand,
      appearance,
      paletteInput: { ...palette },
      importSourceId: sourceId,
      importSourceName: sourceName,
    },
    sourceName,
    sourceId,
  };
}
