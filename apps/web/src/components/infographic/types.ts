/**
 * Infographic semantic source and render intermediate representation (IR).
 *
 * This module owns the **contract** for the Kumiki infographic system described
 * in `docs/12-infographic-system.md`: a validated, versioned semantic document
 * (`InfographicSource`) that is resolved by the layout engine into a
 * renderer-neutral primitive tree (`InfographicLayout`). Both the DOM preview
 * (`./react`) and the static SVG exporter (`./svg`) consume that same IR, so the
 * two cannot drift — this is the docs/11 "one document, many backends"
 * invariant applied to infographics.
 *
 * Boundaries that the rest of the subsystem relies on:
 * - **Information first.** The source captures meaning, evidence and intended
 *   emphasis — never pixel positions.
 * - **No executable content.** The source is JSON data. There is no expression
 *   evaluation, template execution or implicit asset fetch.
 * - **Deterministic output.** Ids are derived from stable source ids plus a
 *   monotonic counter, geometry is rounded, and nothing reads a clock or `Math.random`.
 * - **Explicit failure.** Unsupported or unsatisfiable content produces typed
 *   diagnostics rather than silently dropping evidence.
 */

// ---------------------------------------------------------------------------
// Semantic source (docs/12 §4)
// ---------------------------------------------------------------------------

/** Intended visual emphasis, declared by the author (never inferred from size). */
export type Importance = "hero" | "supporting" | "detail";

/** A citation/measurement source that one or more sections can reference. */
export interface InfographicEvidence {
  id: string;
  label: string;
  sourceUri?: string;
  retrievedAt?: string;
  licenseNote?: string;
}

/** Fields every section carries, regardless of kind. */
export interface SectionBase {
  id: string;
  heading?: string;
  /** @default "supporting" */
  importance?: Importance;
  /** References {@link InfographicEvidence.id}. */
  evidenceRefs?: string[];
  /** Plain-language accessible statement; required, never derived from the title. */
  summary: string;
}

/** How a process step relates to the ones around it. */
export type ProcessStepMode = "sequential" | "parallel" | "optional" | "repeated";

export interface ProcessStep {
  id: string;
  title: string;
  description?: string;
  /** Ids of the steps that may follow this one; branching and joins are explicit. */
  nextIds?: string[];
  /** @default "sequential" */
  mode?: ProcessStepMode;
}

/** A comparable cell: a string, a number, or `null` for "missing / not reported". */
export type ComparisonValue = string | number | null;

export interface ComparisonCase {
  id: string;
  label: string;
  /** Keyed by {@link ComparisonSectionData.criteria}. Missing key means unknown. */
  values: Record<string, ComparisonValue>;
  /** Draw attention to this case without changing its data. @default false */
  emphasis?: boolean;
}

/** How a timeline distributes milestones along its axis. */
export type TimelineScale = "time" | "ordinal" | "linear" | "log";

export interface TimelineMilestone {
  id: string;
  label: string;
  /** ISO date-time or a relative label (`"T+2"`, `"Phase 1"`). */
  at: string;
  /** End of an interval milestone; absent means an instant. */
  endAt?: string;
  description?: string;
  /** @default "instant" */
  kind?: "instant" | "interval";
  importance?: Importance;
}

export interface HierarchyNode {
  id: string;
  label: string;
  description?: string;
  importance?: Importance;
  children?: HierarchyNode[];
}

/** Chart recipe: a parameterised mark/scale combination, never a separate engine. */
export type ChartRecipe = "bar" | "line" | "area" | "donut" | "scatter" | "heatmap";

/** A chart value; `null` is "missing" and is never coerced to zero. */
export type ChartValue = number | null;

export interface ChartSeries {
  id: string;
  label: string;
  /** One value per category, aligned by index. */
  values: ChartValue[];
  /** Optional explicit color; otherwise the art-direction series ramp is used. */
  color?: string;
}

export interface ChartScale {
  kind: "linear" | "log";
  /** Whether the value axis includes zero. Bars are normally zero-based (docs/12 §8). */
  zero: boolean;
  /** Explicit domain; required when the data alone cannot imply a safe baseline. */
  domain?: [number, number];
}

export type MissingPolicy = "gap" | "zero" | "interpolate" | "suppress";

export interface ChartSpec {
  recipe: ChartRecipe;
  categories: string[];
  series: ChartSeries[];
  unit?: string;
  /** Numeric baseline/scale declaration; deviations from zero must be visible. */
  scale?: ChartScale;
  /** @default "gap" */
  missingPolicy?: MissingPolicy;
  sourceNote?: string;
  axisLabels?: { x?: string; y?: string };
}

export interface DiagramNode {
  id: string;
  label: string;
  description?: string;
  importance?: Importance;
  /** Optional grouping key; nodes sharing a group are emphasised together. */
  group?: string;
}

export interface DiagramEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  /** Weighted directed link; only drawn proportional when a scale is declared. */
  weight?: number;
  /** @default true */
  directed?: boolean;
}

export interface DiagramSpec {
  /** @default "vertical" */
  direction?: "horizontal" | "vertical";
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface QuoteSectionData {
  quote: string;
  attribution: string;
  /** @default "below" */
  attributionPlacement?: "inline" | "below" | "right";
}

// ---- Section discriminated union -----------------------------------------

export interface TextSection extends SectionBase {
  kind: "text";
  paragraphs: string[];
  bullets?: string[];
}

export interface StatisticSection extends SectionBase {
  kind: "statistic";
  value: number;
  unit: string;
  measureLabel: string;
  /** The population the value is out of, when the value is a count. */
  denominator?: number;
  /** Reporting period, e.g. `"Q3 2025"`. */
  period?: string;
  /** Reference value the change is measured against. */
  baseline?: number;
  /** Fixed presentation precision; never changes the underlying value. @default 0 */
  precision?: number;
}

export interface ProcessSection extends SectionBase {
  kind: "process";
  steps: ProcessStep[];
  /** @default "linear" */
  layout?: "linear" | "vertical" | "path";
}

export interface ComparisonSection extends SectionBase {
  kind: "comparison";
  criteria: string[];
  cases: ComparisonCase[];
  unit?: string;
}

export interface TimelineSection extends SectionBase {
  kind: "timeline";
  milestones: TimelineMilestone[];
  /** @default "time" for dated milestones, "ordinal" otherwise */
  scale?: TimelineScale;
}

export interface HierarchySection extends SectionBase {
  kind: "hierarchy";
  root: HierarchyNode;
}

export interface ChartSection extends SectionBase {
  kind: "chart";
  /** Key into {@link InfographicSource.charts} for a registered, validated chart. */
  chartRef?: string;
  chart: ChartSpec;
}

export interface DiagramSection extends SectionBase {
  kind: "diagram";
  diagramRef?: string;
  diagram: DiagramSpec;
}

export interface QuoteSection extends SectionBase {
  kind: "quote";
  data: QuoteSectionData;
}

/** Every section the P0 engine understands. */
export type InfographicSection =
  | TextSection
  | StatisticSection
  | ProcessSection
  | ComparisonSection
  | TimelineSection
  | HierarchySection
  | ChartSection
  | DiagramSection
  | QuoteSection;

export type SectionKind = InfographicSection["kind"];

/**
 * An anchored callout. The layout engine renders annotations *after* every
 * section so it can attach the label to real, resolved geometry.
 */
export interface AnnotationSpec {
  id: string;
  /** Section/step/node id the annotation points at. */
  targetId: string;
  label: string;
  detail?: string;
  /** @default "auto" */
  side?: "top" | "right" | "bottom" | "left" | "auto";
  /** @default "leader" */
  shape?: "leader" | "bracket" | "arrow";
  /** Lower values are placed first when space is contested. @default 0 */
  priority?: number;
  /** Anchors the label must not overlap. */
  avoidIds?: string[];
}

export interface InfographicSource {
  kind: "infographic-source";
  version: 1;
  id: string;
  title: string;
  thesis?: string;
  subtitle?: string;
  /** BCP-47 language tag used for locale-aware formatting and segmentation. */
  language: string;
  sections: InfographicSection[];
  evidence: InfographicEvidence[];
  annotations?: AnnotationSpec[];
  /** Keys to validated chart registry entries. */
  charts?: Record<string, string>;
  /** Keys to validated diagram registry entries. */
  diagrams?: Record<string, string>;
  assetRefs?: string[];
  metadata?: { author?: string; createdAt?: string };
}

// ---------------------------------------------------------------------------
// Render IR
// ---------------------------------------------------------------------------

export interface RectInfo {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Line/marker decoration. `none` draws nothing. */
export type MarkerKind = "none" | "arrow" | "dot" | "bar";

export type DashPattern = "solid" | "dashed" | "dotted";

export type TextAlign = "start" | "center" | "end";

/**
 * Soft elevation beneath a filled surface. Renderers draw it as a two-layer
 * ambient + key shadow so cards read as lifted without a hard outline.
 * `color` comes from the art direction's `color.shadow` token.
 */
export interface ElevationPaint {
  /** 1 = resting card, 2 = raised/focal card, 3 = floating callout. */
  level: 1 | 2 | 3;
  color: string;
}

/**
 * Two-stop linear gradient that runs from the primitive's `fill` to `to`.
 * Used for lit surfaces (subtle) and data marks fading toward the baseline.
 */
export interface GradientPaint {
  to: string;
  /** Direction the gradient travels from `fill` to `to`. @default "down" */
  direction?: "down" | "up" | "right" | "left";
  /** Opacity at the `to` end; the `fill` end is opaque. @default 1 */
  toOpacity?: number;
}

interface PrimitiveBase {
  /** Stable, unique within a single layout. */
  id: string;
  /** Identity that survives across variants/pages (docs/11 §1). */
  semanticId?: string;
  /** Free-form role tag, e.g. `"stat-value"`, used by tests and diagnostics. */
  role?: string;
  /** @default 1 */
  opacity?: number;
}

export interface RectPrimitive extends PrimitiveBase, RectInfo {
  kind: "rect";
  /** Corner radius in design px. @default 0 */
  radius?: number;
  fill?: string;
  gradient?: GradientPaint;
  elevation?: ElevationPaint;
  stroke?: string;
  strokeWidth?: number;
  /** @default "solid" */
  dash?: DashPattern;
}

export interface EllipsePrimitive extends PrimitiveBase, RectInfo {
  kind: "ellipse";
  fill?: string;
  gradient?: GradientPaint;
  elevation?: ElevationPaint;
  stroke?: string;
  strokeWidth?: number;
}

export interface LinePrimitive extends PrimitiveBase {
  kind: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
  /** @default "solid" */
  dash?: DashPattern;
  /** @default "none" */
  markerStart?: MarkerKind;
  /** @default "none" */
  markerEnd?: MarkerKind;
}

export interface PolylinePrimitive extends PrimitiveBase {
  kind: "polyline";
  points: Array<[number, number]>;
  /** @default false */
  closed?: boolean;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  /** @default "solid" */
  dash?: DashPattern;
  /** @default "none" */
  markerEnd?: MarkerKind;
}

export interface PathPrimitive extends PrimitiveBase {
  kind: "path";
  /** SVG path data in design px. */
  d: string;
  fill?: string;
  gradient?: GradientPaint;
  elevation?: ElevationPaint;
  stroke?: string;
  strokeWidth?: number;
  /** @default "solid" */
  dash?: DashPattern;
  /** @default "none" */
  markerEnd?: MarkerKind;
}

/**
 * Laid-out text. The engine wraps text into `lines` before the IR is emitted,
 * so the preview and the exporter place identical glyph runs.
 */
export interface TextPrimitive extends PrimitiveBase {
  kind: "text";
  x: number;
  y: number;
  width: number;
  height: number;
  lines: string[];
  fontSize: number;
  /** Unitless line-height multiplier. */
  lineHeight: number;
  family: string;
  /** @default 400 */
  weight?: number;
  italic?: boolean;
  color: string;
  /** @default "start" */
  align?: TextAlign;
  letterSpacing?: number;
  /** `true` boosts legibility over busy backgrounds in the preview. */
  strong?: boolean;
  /** Fixed-width figures so stacked numbers align (`font-variant-numeric`). */
  tabular?: boolean;
}

export type InfographicPrimitive =
  | RectPrimitive
  | EllipsePrimitive
  | LinePrimitive
  | PolylinePrimitive
  | PathPrimitive
  | TextPrimitive;

export type PrimitiveKind = InfographicPrimitive["kind"];

// ---------------------------------------------------------------------------
// Art direction (docs/12 §6)
// ---------------------------------------------------------------------------

export type ArtDirectionId =
  | "editorial"
  | "minimal-technical"
  | "cinematic"
  | "scientific"
  | "illustrated"
  | "sketch";

/**
 * A fully resolved, tokenized visual style. Every field is overridable by a
 * consumer theme; none of them implies a proprietary asset bundle.
 */
export interface ResolvedStyle {
  id: ArtDirectionId;
  name: string;
  color: {
    canvas: string;
    ink: string;
    inkMuted: string;
    inkSubtle: string;
    accent: string;
    accentStrong: string;
    onAccent: string;
    surface: string;
    surfaceAlt: string;
    rule: string;
    grid: string;
    connector: string;
    connectorMuted: string;
    positive: string;
    negative: string;
    /** Elevation shadow tint; alpha comes from the elevation level. */
    shadow: string;
    /** Ordered categorical palette for series/cases/levels. */
    series: readonly string[];
  };
  font: { display: string; heading: string; body: string; mono: string };
  /** Design-px type ramp. */
  type: {
    display: number;
    title: number;
    h2: number;
    h3: number;
    label: number;
    body: number;
    caption: number;
    annotation: number;
    statHuge: number;
    statLarge: number;
  };
  lineHeight: { display: number; heading: number; body: number; annotation: number };
  weight: { display: number; heading: number; body: number; label: number; strong: number };
  letterSpacing: { display: number; label: number; annotation: number };
  radius: { sm: number; md: number; lg: number; pill: number };
  spacing: readonly number[];
  stroke: { hairline: number; rule: number; strong: number; connector: number };
  dash: { rule: DashPattern; guide: DashPattern };
  connector: {
    route: "straight" | "orthogonal" | "curve";
    arrow: MarkerKind;
    markerSize: number;
  };
  surface: {
    /** Draw a card background behind blocks. */
    fill: boolean;
    border: boolean;
    shadow: boolean;
  };
  /** How the accent is applied to headings/metrics. */
  accentUsage: "underline" | "bar" | "fill" | "dot" | "none";
  /** Density of the vertical rhythm. */
  density: "airy" | "balanced" | "dense";
  uppercaseLabels: boolean;
  /** Cap on body text measure, in design px, before wrapping. */
  measureMax: number;
  /** Whether illustrations are grouped into friendly rounded panels. */
  grouping: "rules" | "panels" | "none";
}

// ---------------------------------------------------------------------------
// Output profiles and templates (docs/12 §5, §3)
// ---------------------------------------------------------------------------

export type OutputProfileId =
  | "youtube-landscape"
  | "short-portrait"
  | "social-square"
  | "social-portrait"
  | "pinterest-vertical"
  | "article-inline";

export interface OutputProfile {
  id: OutputProfileId;
  label: string;
  width: number;
  height: number;
  /** Safe-region inset as a fraction of the shorter edge. */
  safeInset: number;
  /** Sections that a portrait/carousel profile should paginate rather than compress. */
  pagination: "single" | "paginate";
}

export type TemplateId =
  | "editorial-overview"
  | "bento-summary"
  | "process-journey"
  | "data-story"
  | "educational-carousel"
  | "visual-cheat-sheet"
  | "layered-architecture";

// ---------------------------------------------------------------------------
// Diagnostics, layout and renderer contract
// ---------------------------------------------------------------------------

export interface InfographicDiagnostic {
  /** Stable machine code, e.g. `section-overflow`, `impossible-constraint`. */
  code: string;
  severity: "error" | "warning";
  message: string;
  sectionId?: string;
  targetId?: string;
  primitiveId?: string;
  /** Approximate overflow in design px, when the finding is a fit failure. */
  overflow?: number;
  /** JSON-pointer-ish path to the offending value. */
  path?: string;
}

/** A section's resolved frame on a page; used by diagnostics and inspection. */
export interface SectionFrame extends RectInfo {
  id: string;
  kind: SectionKind;
  title: string;
  page: number;
}

export interface InfographicCanvasSpec {
  width: number;
  height: number;
  profile: OutputProfileId;
  background: string;
  /** Safe inset in design px, at `docs/07`'s configurable ~5% heuristic. */
  safeRegion: number;
}

export interface InfographicLayout {
  schemaVersion: 1;
  id: string;
  sourceId: string;
  template: TemplateId;
  artDirection: ArtDirectionId;
  profile: OutputProfileId;
  canvas: InfographicCanvasSpec;
  primitives: InfographicPrimitive[];
  /** Accessible, one-paragraph summary of the whole panel. */
  summary: string;
  sections: SectionFrame[];
  diagnostics: InfographicDiagnostic[];
  provenance: {
    sourceDigest: string;
    template: TemplateId;
    artDirection: ArtDirectionId;
    profile: OutputProfileId;
    /** Version of the layout algorithm, so cached layouts invalidate on change. */
    layoutVersion: string;
  };
  /** Total pages; > 1 when a paginating profile split the content. */
  pages: number;
  metadata?: { title?: string; language?: string };
}

// ---------------------------------------------------------------------------
// Section renderer contract
// ---------------------------------------------------------------------------

/** Where a section placed the anchors annotations attach to. */
export interface RenderResult {
  primitives: InfographicPrimitive[];
  /** Anchor id → resolved box, for annotation attachment and diagnostics. */
  anchors?: Record<string, RectInfo>;
}

/** Everything a section renderer may read or report into. */
export interface SectionRenderContext {
  style: ResolvedStyle;
  language: string;
  evidence: ReadonlyMap<string, InfographicEvidence>;
  /** Short, deterministic citation label for an evidence id (e.g. `"1"`). */
  evidenceLabel: (evidenceId: string) => string | undefined;
  /** Deterministic id factory; ids are stable across runs for the same source. */
  id: (hint: string) => string;
  report: (diagnostic: InfographicDiagnostic) => void;
}

/** Renders one section inside a resolved frame. */
export type SectionRenderer<S extends InfographicSection = InfographicSection> = (
  section: S,
  frame: RectInfo,
  context: SectionRenderContext
) => RenderResult;
