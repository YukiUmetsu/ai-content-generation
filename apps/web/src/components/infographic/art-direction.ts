/**
 * Art-direction profiles and output profiles for the infographic system.
 *
 * An art direction is a **tokenized visual recipe** (docs/12 §6), independent of
 * the information template that chose the structure. Each profile declares a
 * type scale, typography roles, palette and contrast, spacing rhythm, strokes,
 * surface treatments, connector style and density — all overridable, none
 * implying a proprietary asset bundle. Swapping the art direction must change
 * only how the same facts look, never what they say.
 *
 * Color values are **literal** here on purpose: an infographic is its own canvas
 * with its own palette (overridable per consumer theme), not app chrome bound to
 * the surrounding `data-km-appearance`. That keeps a still export byte-stable
 * regardless of the embedding page.
 */

import type {
  ArtDirectionId,
  DashPattern,
  MarkerKind,
  OutputProfile,
  OutputProfileId,
  ResolvedStyle,
} from "./types";

/** Bumped when the layout algorithm changes in a way that invalidates caches. */
export const LAYOUT_VERSION = "infographic-1.0.0";

/**
 * Recursive partial used by {@link resolveStyle} for token overrides. Arrays are
 * replaced wholesale (a caller overriding `color.series` supplies the full ramp).
 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

function define<T extends ResolvedStyle>(style: T): T {
  return style;
}

/**
 * The six profiles from docs/12 §6. Each is deliberately, visibly different:
 * `editorial` and `scientific` are light and print-like, `cinematic` is dark and
 * depth-led, `minimal-technical` is precise and monospaced, `illustrated` is
 * warm and rounded, `sketch` is papery with dashed rules.
 */
export const ART_DIRECTIONS: Record<ArtDirectionId, ResolvedStyle> = {
  editorial: define({
    id: "editorial",
    name: "Editorial",
    color: {
      canvas: "#F6F3F1",
      ink: "#1A1A1A",
      inkMuted: "#4E4D4D",
      inkSubtle: "#797776",
      accent: "#B02418",
      accentStrong: "#7A170F",
      onAccent: "#FFFDFB",
      surface: "#FFFFFF",
      surfaceAlt: "#EDE8E5",
      rule: "#1A1A1A",
      grid: "#DAD4D0",
      connector: "#1A1A1A",
      connectorMuted: "#797776",
      positive: "#0B7A52",
      negative: "#B02418",
      shadow: "#3B2A20",
      series: ["#B02418", "#2B59D1", "#0B7A52", "#E0992C", "#6B4EA8", "#797776"],
    },
    font: {
      display: "Newsreader Variable, Georgia, serif",
      heading: "Newsreader Variable, Georgia, serif",
      body: "Geist Variable, system-ui, sans-serif",
      mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
    },
    type: {
      display: 108,
      title: 72,
      h2: 44,
      h3: 30,
      label: 19,
      body: 24,
      caption: 18,
      annotation: 18,
      statHuge: 168,
      statLarge: 96,
    },
    lineHeight: { display: 1.02, heading: 1.08, body: 1.42, annotation: 1.3 },
    weight: { display: 600, heading: 600, body: 400, label: 600, strong: 700 },
    letterSpacing: { display: -1.5, label: 0.6, annotation: 0 },
    radius: { sm: 0, md: 0, lg: 0, pill: 999 },
    spacing: [8, 16, 24, 32, 48, 64, 96, 128, 176],
    stroke: { hairline: 1, rule: 2, strong: 3, connector: 2 },
    dash: { rule: "solid", guide: "dashed" },
    connector: { route: "orthogonal", arrow: "arrow", markerSize: 12 },
    surface: { fill: false, border: false, shadow: false },
    accentUsage: "underline",
    density: "airy",
    uppercaseLabels: true,
    measureMax: 620,
    grouping: "rules",
  }),
  "minimal-technical": define({
    id: "minimal-technical",
    name: "Minimal technical",
    color: {
      canvas: "#FBFBFD",
      ink: "#141418",
      inkMuted: "#4A4A52",
      inkSubtle: "#8A8A93",
      accent: "#2B59D1",
      accentStrong: "#1B3E9E",
      onAccent: "#FFFFFF",
      surface: "#FFFFFF",
      surfaceAlt: "#F1F2F6",
      rule: "#D5D7DF",
      grid: "#E4E6EC",
      connector: "#2B59D1",
      connectorMuted: "#8A8A93",
      positive: "#0B7A52",
      negative: "#C0392B",
      shadow: "#1B2440",
      series: ["#2B59D1", "#0B7A52", "#E0992C", "#6B4EA8", "#00A3A3", "#C0392B"],
    },
    font: {
      display: "Geist Variable, system-ui, sans-serif",
      heading: "Geist Variable, system-ui, sans-serif",
      body: "Geist Variable, system-ui, sans-serif",
      mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
    },
    type: {
      display: 92,
      title: 60,
      h2: 38,
      h3: 26,
      label: 17,
      body: 22,
      caption: 16,
      annotation: 16,
      statHuge: 148,
      statLarge: 84,
    },
    lineHeight: { display: 1.02, heading: 1.1, body: 1.45, annotation: 1.28 },
    weight: { display: 600, heading: 600, body: 400, label: 500, strong: 600 },
    letterSpacing: { display: -1, label: 0.2, annotation: 0 },
    radius: { sm: 4, md: 8, lg: 12, pill: 999 },
    spacing: [8, 16, 24, 32, 40, 56, 72, 96, 128],
    stroke: { hairline: 1, rule: 1, strong: 2, connector: 2 },
    dash: { rule: "solid", guide: "dotted" },
    connector: { route: "orthogonal", arrow: "arrow", markerSize: 10 },
    surface: { fill: true, border: true, shadow: true },
    accentUsage: "bar",
    density: "balanced",
    uppercaseLabels: true,
    measureMax: 560,
    grouping: "panels",
  }),
  cinematic: define({
    id: "cinematic",
    name: "Cinematic",
    color: {
      canvas: "#101014",
      ink: "#F5F3EF",
      inkMuted: "#B9B6B0",
      inkSubtle: "#7C7A76",
      accent: "#FF7A6B",
      accentStrong: "#FF9C8F",
      onAccent: "#1A0F0C",
      surface: "#1C1C22",
      surfaceAlt: "#26262E",
      rule: "#3A3A44",
      grid: "#2A2A32",
      connector: "#FF7A6B",
      connectorMuted: "#6B6B74",
      positive: "#3ECF8E",
      negative: "#FF7A6B",
      shadow: "#000000",
      series: ["#FF7A6B", "#6FA1FF", "#3ECF8E", "#E0B25C", "#A98BFF", "#8FB7C7"],
    },
    font: {
      display: "Newsreader Variable, Georgia, serif",
      heading: "Geist Variable, system-ui, sans-serif",
      body: "Geist Variable, system-ui, sans-serif",
      mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
    },
    type: {
      display: 116,
      title: 76,
      h2: 46,
      h3: 30,
      label: 18,
      body: 24,
      caption: 18,
      annotation: 18,
      statHuge: 180,
      statLarge: 100,
    },
    lineHeight: { display: 1.0, heading: 1.06, body: 1.45, annotation: 1.3 },
    weight: { display: 600, heading: 600, body: 400, label: 500, strong: 700 },
    letterSpacing: { display: -2, label: 1.2, annotation: 0 },
    radius: { sm: 6, md: 12, lg: 20, pill: 999 },
    spacing: [8, 16, 24, 40, 56, 80, 112, 144, 192],
    stroke: { hairline: 1, rule: 1, strong: 3, connector: 2 },
    dash: { rule: "solid", guide: "dashed" },
    connector: { route: "curve", arrow: "arrow", markerSize: 14 },
    surface: { fill: true, border: false, shadow: true },
    accentUsage: "dot",
    density: "airy",
    uppercaseLabels: true,
    measureMax: 600,
    grouping: "panels",
  }),
  scientific: define({
    id: "scientific",
    name: "Scientific",
    color: {
      canvas: "#FFFFFF",
      ink: "#111418",
      inkMuted: "#4A5158",
      inkSubtle: "#848B93",
      accent: "#0B5FA5",
      accentStrong: "#083F6E",
      onAccent: "#FFFFFF",
      surface: "#F5F8FB",
      surfaceAlt: "#E8EEF5",
      rule: "#C7D0DA",
      grid: "#DDE5EE",
      connector: "#4A5158",
      connectorMuted: "#848B93",
      positive: "#0B7A52",
      negative: "#B02418",
      shadow: "#1A2433",
      series: ["#0B5FA5", "#B02418", "#0B7A52", "#8A6D1F", "#5B3E8E", "#4A5158"],
    },
    font: {
      display: "Geist Variable, system-ui, sans-serif",
      heading: "Geist Variable, system-ui, sans-serif",
      body: "Geist Variable, system-ui, sans-serif",
      mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
    },
    type: {
      display: 84,
      title: 56,
      h2: 36,
      h3: 24,
      label: 16,
      body: 21,
      caption: 15,
      annotation: 15,
      statHuge: 132,
      statLarge: 76,
    },
    lineHeight: { display: 1.05, heading: 1.12, body: 1.46, annotation: 1.28 },
    weight: { display: 600, heading: 600, body: 400, label: 600, strong: 600 },
    letterSpacing: { display: -0.5, label: 0.3, annotation: 0 },
    radius: { sm: 2, md: 4, lg: 6, pill: 999 },
    spacing: [8, 16, 24, 32, 44, 60, 80, 104, 136],
    stroke: { hairline: 1, rule: 1, strong: 2, connector: 2 },
    dash: { rule: "solid", guide: "dotted" },
    connector: { route: "straight", arrow: "bar", markerSize: 10 },
    surface: { fill: true, border: true, shadow: false },
    accentUsage: "underline",
    density: "balanced",
    uppercaseLabels: false,
    measureMax: 520,
    grouping: "rules",
  }),
  illustrated: define({
    id: "illustrated",
    name: "Illustrated",
    color: {
      canvas: "#FFF8F0",
      ink: "#22303A",
      inkMuted: "#4C5C68",
      inkSubtle: "#8794A0",
      accent: "#0B7A52",
      accentStrong: "#07573A",
      onAccent: "#FFFFFF",
      surface: "#FFFFFF",
      surfaceAlt: "#FCEFE0",
      rule: "#E6D8C6",
      grid: "#F0E4D4",
      connector: "#0B7A52",
      connectorMuted: "#8794A0",
      positive: "#0B7A52",
      negative: "#E0613C",
      shadow: "#4A3A28",
      series: ["#0B7A52", "#E0992C", "#3E7CB1", "#C0508A", "#7B5EA7", "#E0613C"],
    },
    font: {
      display: "Geist Variable, system-ui, sans-serif",
      heading: "Geist Variable, system-ui, sans-serif",
      body: "Geist Variable, system-ui, sans-serif",
      mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
    },
    type: {
      display: 96,
      title: 64,
      h2: 40,
      h3: 27,
      label: 18,
      body: 23,
      caption: 17,
      annotation: 17,
      statHuge: 152,
      statLarge: 88,
    },
    lineHeight: { display: 1.04, heading: 1.1, body: 1.45, annotation: 1.3 },
    weight: { display: 700, heading: 700, body: 400, label: 600, strong: 700 },
    letterSpacing: { display: -1.2, label: 0.4, annotation: 0 },
    radius: { sm: 8, md: 14, lg: 22, pill: 999 },
    spacing: [8, 16, 24, 36, 48, 64, 88, 112, 152],
    stroke: { hairline: 1, rule: 2, strong: 3, connector: 3 },
    dash: { rule: "solid", guide: "dashed" },
    connector: { route: "curve", arrow: "arrow", markerSize: 14 },
    surface: { fill: true, border: false, shadow: true },
    accentUsage: "fill",
    density: "balanced",
    uppercaseLabels: false,
    measureMax: 600,
    grouping: "panels",
  }),
  sketch: define({
    id: "sketch",
    name: "Sketch",
    color: {
      canvas: "#FBF9F4",
      ink: "#2A2A2A",
      inkMuted: "#5A5750",
      inkSubtle: "#8C877C",
      accent: "#C0392B",
      accentStrong: "#8E2A20",
      onAccent: "#FFFFFF",
      surface: "#FFFFFF",
      surfaceAlt: "#F3EDE0",
      rule: "#C9C2B2",
      grid: "#E3DCCB",
      connector: "#2A2A2A",
      connectorMuted: "#8C877C",
      positive: "#3F7A4B",
      negative: "#C0392B",
      shadow: "#3A3530",
      series: ["#C0392B", "#3E6FB1", "#3F7A4B", "#B07A22", "#6B4EA8", "#5A5750"],
    },
    font: {
      display: "Geist Variable, system-ui, sans-serif",
      heading: "Geist Variable, system-ui, sans-serif",
      body: "Geist Variable, system-ui, sans-serif",
      mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
    },
    type: {
      display: 100,
      title: 66,
      h2: 42,
      h3: 28,
      label: 18,
      body: 23,
      caption: 17,
      annotation: 18,
      statHuge: 156,
      statLarge: 90,
    },
    lineHeight: { display: 1.04, heading: 1.1, body: 1.46, annotation: 1.3 },
    weight: { display: 600, heading: 600, body: 400, label: 600, strong: 600 },
    letterSpacing: { display: -0.8, label: 0.4, annotation: 0 },
    radius: { sm: 6, md: 10, lg: 16, pill: 999 },
    spacing: [8, 16, 24, 34, 46, 62, 84, 108, 144],
    stroke: { hairline: 1, rule: 2, strong: 2, connector: 2 },
    dash: { rule: "dashed", guide: "dotted" },
    connector: { route: "curve", arrow: "arrow", markerSize: 12 },
    surface: { fill: true, border: true, shadow: false },
    accentUsage: "underline",
    density: "balanced",
    uppercaseLabels: false,
    measureMax: 560,
    grouping: "panels",
  }),
};

/** Every art-direction id, in a stable order. */
export const ART_DIRECTION_IDS = Object.keys(ART_DIRECTIONS) as ArtDirectionId[];

/** Resolve an art direction, or throw for an unknown id. */
export function getArtDirection(id: ArtDirectionId): ResolvedStyle {
  const style = ART_DIRECTIONS[id];
  if (!style) throw new Error(`unknown-art-direction: ${String(id)}`);
  return style;
}

function mergeStyle(base: ResolvedStyle, override: DeepPartial<ResolvedStyle>): ResolvedStyle {
  const next: ResolvedStyle = {
    ...base,
    color: { ...base.color, ...(override.color ?? {}) },
    font: { ...base.font, ...(override.font ?? {}) },
    type: { ...base.type, ...(override.type ?? {}) },
    lineHeight: { ...base.lineHeight, ...(override.lineHeight ?? {}) },
    weight: { ...base.weight, ...(override.weight ?? {}) },
    letterSpacing: { ...base.letterSpacing, ...(override.letterSpacing ?? {}) },
    radius: { ...base.radius, ...(override.radius ?? {}) },
    stroke: { ...base.stroke, ...(override.stroke ?? {}) },
    dash: { ...base.dash, ...(override.dash ?? {}) },
    connector: { ...base.connector, ...(override.connector ?? {}) },
    surface: { ...base.surface, ...(override.surface ?? {}) },
  };
  // Array/leaf overrides are taken wholesale when present.
  if (override.spacing) (next as { spacing: readonly number[] }).spacing = override.spacing;
  if (override.accentUsage) next.accentUsage = override.accentUsage;
  if (override.density) next.density = override.density;
  if (override.uppercaseLabels !== undefined) next.uppercaseLabels = override.uppercaseLabels;
  if (override.measureMax !== undefined) next.measureMax = override.measureMax;
  if (override.grouping) next.grouping = override.grouping;
  if (override.name) next.name = override.name;
  return next;
}

/**
 * Resolve an art direction with consumer overrides applied. Overrides are deep
 * per token group but wholesale per array (`series`, `spacing`), so a theme can
 * replace a palette without inheriting the profile's colors.
 */
export function resolveStyle(
  id: ArtDirectionId,
  override?: DeepPartial<ResolvedStyle>
): ResolvedStyle {
  const base = getArtDirection(id);
  return override ? mergeStyle(base, override) : base;
}

// ---------------------------------------------------------------------------
// Output profiles (docs/12 §5)
// ---------------------------------------------------------------------------

/**
 * Editable output presets. Sizes are the conventional canvas for each surface;
 * aspect ratio is **not** a scale operation — each profile reflows independently.
 */
export const OUTPUT_PROFILES: Record<OutputProfileId, OutputProfile> = {
  "youtube-landscape": {
    id: "youtube-landscape",
    label: "YouTube / landscape",
    width: 1920,
    height: 1080,
    safeInset: 0.05,
    pagination: "single",
  },
  "short-portrait": {
    id: "short-portrait",
    label: "Short / portrait",
    width: 1080,
    height: 1920,
    safeInset: 0.08,
    pagination: "paginate",
  },
  "social-square": {
    id: "social-square",
    label: "Social square",
    width: 1080,
    height: 1080,
    safeInset: 0.06,
    pagination: "paginate",
  },
  "social-portrait": {
    id: "social-portrait",
    label: "Social portrait",
    width: 1080,
    height: 1350,
    safeInset: 0.06,
    pagination: "paginate",
  },
  "pinterest-vertical": {
    id: "pinterest-vertical",
    label: "Pinterest vertical",
    width: 1000,
    height: 1500,
    safeInset: 0.06,
    pagination: "paginate",
  },
  "article-inline": {
    id: "article-inline",
    label: "Article inline",
    width: 1200,
    height: 900,
    safeInset: 0.04,
    pagination: "paginate",
  },
};

/** Every output profile id, in a stable order. */
export const OUTPUT_PROFILE_IDS = Object.keys(OUTPUT_PROFILES) as OutputProfileId[];

/** Resolve an output profile, optionally overriding the canvas size. */
export function getOutputProfile(
  id: OutputProfileId,
  size?: { width: number; height: number }
): OutputProfile {
  const profile = OUTPUT_PROFILES[id];
  if (!profile) throw new Error(`unknown-output-profile: ${String(id)}`);
  return size ? { ...profile, width: size.width, height: size.height } : profile;
}

/** Safe-region inset in design px for a canvas. */
export function safeInset(profile: OutputProfile): number {
  return Math.round(Math.min(profile.width, profile.height) * profile.safeInset);
}

export type { DashPattern, MarkerKind };
