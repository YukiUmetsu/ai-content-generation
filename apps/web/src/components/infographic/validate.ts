/**
 * Runtime validation for {@link InfographicSource} plus content digests.
 *
 * The semantic document is the master copy (docs/11: "JSON is master, export is
 * derivative"), so it is validated at the boundary rather than trusted. Kumiki
 * deliberately does **not** add a schema library here: the shape is small, and a
 * hand-written validator can report *infographic-specific* findings
 * (dangling evidence references, orphaned annotations, criteria with no matching
 * value) that a generic JSON Schema would only express as "additional property".
 *
 * Findings are returned, never thrown, so a caller can render what is valid and
 * surface actionable diagnostics for the rest (docs/11 QA gate: errors must name
 * the offending id and the suggested repair).
 */

import { CHART_RECIPES } from "./chart";
import type {
  AnnotationSpec,
  ChartRecipe,
  ChartSection,
  HierarchyNode,
  InfographicDiagnostic,
  InfographicEvidence,
  InfographicSection,
  InfographicSource,
  SectionKind,
} from "./types";

/** The section kinds this version of the engine can render. */
export const SECTION_KINDS: readonly SectionKind[] = [
  "text",
  "statistic",
  "process",
  "comparison",
  "timeline",
  "hierarchy",
  "chart",
  "diagram",
  "quote",
];

/** Templates a source may declare; kept here to avoid a cyclic import. */
export const SOURCE_TEMPLATES = [
  "editorial-overview",
  "bento-summary",
  "process-journey",
  "data-story",
  "educational-carousel",
  "visual-cheat-sheet",
  "layered-architecture",
] as const;

export interface ValidationResult {
  ok: boolean;
  diagnostics: InfographicDiagnostic[];
  /** Present only when the payload is structurally usable. */
  source?: InfographicSource;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function diagnostic(
  code: string,
  severity: "error" | "warning",
  message: string,
  extra?: Partial<InfographicDiagnostic>
): InfographicDiagnostic {
  return { code, severity, message, ...extra };
}

/** Collect every id an annotation may legally target, at any nesting depth. */
function collectTargetIds(sections: readonly InfographicSection[]): Set<string> {
  const ids = new Set<string>();
  const walkHierarchy = (node: HierarchyNode): void => {
    ids.add(node.id);
    (node.children ?? []).forEach(walkHierarchy);
  };
  for (const section of sections) {
    ids.add(section.id);
    switch (section.kind) {
      case "process":
        section.steps.forEach((step) => ids.add(step.id));
        break;
      case "comparison":
        section.cases.forEach((item) => ids.add(item.id));
        break;
      case "timeline":
        section.milestones.forEach((milestone) => ids.add(milestone.id));
        break;
      case "hierarchy":
        walkHierarchy(section.root);
        break;
      case "diagram":
        section.diagram.nodes.forEach((node) => ids.add(node.id));
        section.diagram.edges.forEach((edge) => ids.add(edge.id));
        break;
      default:
        break;
    }
  }
  return ids;
}

function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

/**
 * Validate a semantic infographic source.
 *
 * Errors mean the document cannot be laid out as written. Warnings mean it can be
 * laid out but something about the content is questionable — those are exactly
 * the cases docs/12 §3 says must be exposed rather than repaired silently.
 */
export function validateSource(input: unknown): ValidationResult {
  const diagnostics: InfographicDiagnostic[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      diagnostics: [diagnostic("invalid-source", "error", "Source must be an object.")],
    };
  }

  if (input.kind !== "infographic-source") {
    diagnostics.push(
      diagnostic("invalid-source-kind", "error", 'Expected kind "infographic-source".', {
        path: "/kind",
      })
    );
  }
  if (input.version !== 1) {
    diagnostics.push(
      diagnostic("unsupported-version", "error", `Unsupported source version ${String(input.version)}; expected 1.`, {
        path: "/version",
      })
    );
  }
  if (!isNonEmptyString(input.id)) {
    diagnostics.push(diagnostic("missing-source-id", "error", "Source requires a non-empty id.", { path: "/id" }));
  }
  if (!isNonEmptyString(input.title)) {
    diagnostics.push(diagnostic("missing-title", "error", "Source requires a non-empty title.", { path: "/title" }));
  }
  if (!isNonEmptyString(input.language)) {
    diagnostics.push(
      diagnostic("missing-language", "error", "Source requires a BCP-47 language tag.", { path: "/language" })
    );
  }
  if (!Array.isArray(input.sections) || input.sections.length === 0) {
    diagnostics.push(
      diagnostic("missing-sections", "error", "Source requires at least one section.", { path: "/sections" })
    );
    return { ok: false, diagnostics };
  }

  // ---- evidence -----------------------------------------------------------
  const evidenceList: InfographicEvidence[] = [];
  if (input.evidence !== undefined && !Array.isArray(input.evidence)) {
    diagnostics.push(
      diagnostic("invalid-evidence", "error", "`evidence` must be an array.", { path: "/evidence" })
    );
  } else if (Array.isArray(input.evidence)) {
    for (const [index, entry] of input.evidence.entries()) {
      if (!isRecord(entry) || !isNonEmptyString(entry.id) || !isNonEmptyString(entry.label)) {
        diagnostics.push(
          diagnostic("invalid-evidence-entry", "error", `evidence[${index}] requires id and label.`, {
            path: `/evidence/${index}`,
          })
        );
        continue;
      }
      evidenceList.push(entry as unknown as InfographicEvidence);
    }
  }
  const evidenceIds = new Set(evidenceList.map((entry) => entry.id));
  for (const duplicate of findDuplicates(evidenceList.map((entry) => entry.id))) {
    diagnostics.push(
      diagnostic("duplicate-evidence-id", "error", `Duplicate evidence id "${duplicate}".`, { path: "/evidence" })
    );
  }

  // ---- sections -----------------------------------------------------------
  const sections: InfographicSection[] = [];
  const sectionIds: string[] = [];

  for (const [index, raw] of (input.sections as unknown[]).entries()) {
    const path = `/sections/${index}`;
    if (!isRecord(raw)) {
      diagnostics.push(diagnostic("invalid-section", "error", `sections[${index}] must be an object.`, { path }));
      continue;
    }
    if (!isNonEmptyString(raw.id)) {
      diagnostics.push(diagnostic("missing-section-id", "error", `sections[${index}] requires an id.`, { path }));
      continue;
    }
    const id = raw.id;
    sectionIds.push(id);
    if (!isNonEmptyString(raw.kind) || !SECTION_KINDS.includes(raw.kind as SectionKind)) {
      diagnostics.push(
        diagnostic("unknown-section-kind", "error", `Section "${id}" has unsupported kind "${String(raw.kind)}".`, {
          path: `${path}/kind`,
          sectionId: id,
        })
      );
      continue;
    }
    if (!isNonEmptyString(raw.summary)) {
      diagnostics.push(
        diagnostic("missing-section-summary", "error", `Section "${id}" requires an accessible summary.`, {
          path: `${path}/summary`,
          sectionId: id,
        })
      );
    }
    if (raw.importance !== undefined && !["hero", "supporting", "detail"].includes(String(raw.importance))) {
      diagnostics.push(
        diagnostic("invalid-importance", "warning", `Section "${id}" has unknown importance "${String(raw.importance)}".`, {
          path: `${path}/importance`,
          sectionId: id,
        })
      );
    }
    if (Array.isArray(raw.evidenceRefs)) {
      for (const ref of raw.evidenceRefs) {
        if (typeof ref !== "string" || !evidenceIds.has(ref)) {
          diagnostics.push(
            diagnostic(
              "unknown-evidence-ref",
              "error",
              `Section "${id}" references unknown evidence "${String(ref)}". Register it in \`evidence\` or remove the reference.`,
              { path: `${path}/evidenceRefs`, sectionId: id, targetId: String(ref) }
            )
          );
        }
      }
    }

    validateSectionBody(raw as unknown as InfographicSection, path, diagnostics);
    sections.push(raw as unknown as InfographicSection);
  }

  for (const duplicate of findDuplicates(sectionIds)) {
    diagnostics.push(
      diagnostic("duplicate-section-id", "error", `Duplicate section id "${duplicate}".`, { path: "/sections" })
    );
  }

  // ---- annotations --------------------------------------------------------
  const targetIds = collectTargetIds(sections);
  const annotations: AnnotationSpec[] = [];
  if (input.annotations !== undefined) {
    if (!Array.isArray(input.annotations)) {
      diagnostics.push(
        diagnostic("invalid-annotations", "error", "`annotations` must be an array.", { path: "/annotations" })
      );
    } else {
      for (const [index, entry] of input.annotations.entries()) {
        const path = `/annotations/${index}`;
        if (!isRecord(entry) || !isNonEmptyString(entry.id) || !isNonEmptyString(entry.targetId)) {
          diagnostics.push(
            diagnostic("invalid-annotation", "error", `annotations[${index}] requires id and targetId.`, { path })
          );
          continue;
        }
        if (!isNonEmptyString(entry.label)) {
          diagnostics.push(
            diagnostic("annotation-missing-label", "error", `Annotation "${String(entry.id)}" requires a label.`, {
              path: `${path}/label`,
              targetId: String(entry.targetId),
            })
          );
        }
        if (!targetIds.has(entry.targetId)) {
          diagnostics.push(
            diagnostic(
              "annotation-orphan",
              "error",
              `Annotation "${String(entry.id)}" targets "${String(entry.targetId)}", which does not exist. Annotations must fail loudly rather than point at nothing.`,
              { path: `${path}/targetId`, targetId: String(entry.targetId) }
            )
          );
        }
        annotations.push(entry as unknown as AnnotationSpec);
      }
      for (const duplicate of findDuplicates(annotations.map((entry) => entry.id))) {
        diagnostics.push(
          diagnostic("duplicate-annotation-id", "error", `Duplicate annotation id "${duplicate}".`, {
            path: "/annotations",
          })
        );
      }
    }
  }

  const hasErrors = diagnostics.some((entry) => entry.severity === "error");
  if (hasErrors) return { ok: false, diagnostics };

  const source: InfographicSource = {
    ...(input as unknown as InfographicSource),
    sections,
    evidence: evidenceList,
    annotations,
  };
  return { ok: true, diagnostics, source };
}

/** Per-kind structural checks. Kept separate so `validateSource` stays readable. */
function validateSectionBody(
  section: InfographicSection,
  path: string,
  diagnostics: InfographicDiagnostic[]
): void {
  const fail = (code: string, message: string, sub?: string, severity: "error" | "warning" = "error"): void => {
    diagnostics.push(diagnostic(code, severity, message, { path: `${path}${sub ?? ""}`, sectionId: section.id }));
  };
  const warn = (code: string, message: string, sub?: string): void =>
    fail(code, message, sub, "warning");

  switch (section.kind) {
    case "text": {
      if (!Array.isArray(section.paragraphs) || section.paragraphs.length === 0) {
        fail("text-missing-paragraphs", `Text section "${section.id}" requires paragraphs.`, "/paragraphs");
      }
      break;
    }
    case "statistic": {
      if (!isFiniteNumber(section.value)) {
        fail("statistic-missing-value", `Statistic "${section.id}" requires a finite value.`, "/value");
      }
      if (!isNonEmptyString(section.measureLabel)) {
        fail("statistic-missing-measure", `Statistic "${section.id}" requires a measureLabel.`, "/measureLabel");
      }
      if (section.baseline !== undefined && !isFiniteNumber(section.baseline)) {
        fail("invalid-baseline", `Statistic "${section.id}" has a non-finite baseline.`, "/baseline");
      }
      break;
    }
    case "process": {
      if (!Array.isArray(section.steps) || section.steps.length === 0) {
        fail("process-empty", `Process "${section.id}" requires at least one step.`, "/steps");
        break;
      }
      for (const [index, step] of section.steps.entries()) {
        if (!isNonEmptyString(step.id) || !isNonEmptyString(step.title)) {
          fail("invalid-step", `steps[${index}] requires id and title.`, `/steps/${index}`);
        }
      }
      const stepIds = new Set(section.steps.map((step) => step.id));
      for (const duplicate of findDuplicates(section.steps.map((step) => step.id))) {
        fail("duplicate-step-id", `Duplicate step id "${duplicate}".`, "/steps");
      }
      for (const step of section.steps) {
        for (const next of step.nextIds ?? []) {
          if (!stepIds.has(next)) {
            fail("unknown-next-step", `Step "${step.id}" points at unknown step "${next}".`, "/steps");
          }
        }
      }
      if (!section.steps.some((step) => (step.nextIds ?? []).length === 0)) {
        warn(
          "process-cycle",
          `Process "${section.id}" has no terminal step; every step declares successors.`,
          "/steps"
        );
      }
      break;
    }
    case "comparison": {
      if (!Array.isArray(section.criteria) || section.criteria.length === 0) {
        fail("comparison-missing-criteria", `Comparison "${section.id}" requires criteria.`, "/criteria");
      }
      if (!Array.isArray(section.cases) || section.cases.length === 0) {
        fail("comparison-missing-cases", `Comparison "${section.id}" requires at least one case.`, "/cases");
        break;
      }
      const criteria = new Set(section.criteria ?? []);
      for (const [index, item] of section.cases.entries()) {
        if (!isNonEmptyString(item.id) || !isNonEmptyString(item.label) || !isRecord(item.values)) {
          fail("invalid-comparison-case", `cases[${index}] requires id, label and values.`, `/cases/${index}`);
          continue;
        }
        for (const key of Object.keys(item.values)) {
          if (!criteria.has(key)) {
            warn(
              "comparison-unknown-criterion",
              `Case "${item.id}" reports "${key}", which is not listed in criteria.`,
              `/cases/${index}/values`
            );
          }
        }
      }
      break;
    }
    case "timeline": {
      if (!Array.isArray(section.milestones) || section.milestones.length === 0) {
        fail("timeline-empty", `Timeline "${section.id}" requires milestones.`, "/milestones");
        break;
      }
      for (const [index, milestone] of section.milestones.entries()) {
        if (!isNonEmptyString(milestone.id) || !isNonEmptyString(milestone.at)) {
          fail("invalid-milestone", `milestones[${index}] requires id and at.`, `/milestones/${index}`);
        }
      }
      for (const duplicate of findDuplicates(section.milestones.map((milestone) => milestone.id))) {
        fail("duplicate-milestone-id", `Duplicate milestone id "${duplicate}".`, "/milestones");
      }
      break;
    }
    case "hierarchy": {
      if (!isRecord(section.root) || !isNonEmptyString(section.root.id) || !isNonEmptyString(section.root.label)) {
        fail("hierarchy-empty", `Hierarchy "${section.id}" requires a root node with id and label.`, "/root");
      }
      break;
    }
    case "chart": {
      validateChartSpec(section, path, diagnostics);
      break;
    }
    case "diagram": {
      if (!isRecord(section.diagram) || !Array.isArray(section.diagram.nodes) || section.diagram.nodes.length === 0) {
        fail("diagram-empty", `Diagram "${section.id}" requires nodes.`, "/diagram/nodes");
        break;
      }
      const nodeIds = new Set(section.diagram.nodes.map((node) => node.id));
      for (const edge of section.diagram.edges ?? []) {
        if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
          fail(
            "unknown-diagram-node",
            `Edge "${edge.id}" references a node that does not exist ("${edge.from}" → "${edge.to}").`,
            "/diagram/edges"
          );
        }
      }
      break;
    }
    case "quote": {
      if (!isRecord(section.data) || !isNonEmptyString(section.data.quote) || !isNonEmptyString(section.data.attribution)) {
        fail("quote-incomplete", `Quote "${section.id}" requires data.quote and data.attribution.`, "/data");
      }
      break;
    }
    default:
      break;
  }
}

/**
 * Semantic validation for a `chart` section — deeper than the structural checks
 * in {@link validateSectionBody}. It enforces the data-integrity contract from
 * docs/12 §8: series align to categories, recipes and scales are known, ids are
 * unique and values are finite. `null` means *missing* and is deliberately never
 * an error, so a chart with gaps still validates.
 *
 * Codes reuse the render-time vocabulary in `chart.ts` where the meaning matches
 * (`chart-series-length-mismatch`, `chart-invalid-scale`, `chart-empty`) so the
 * same fault reads identically whether it is caught before or during a render.
 */
function validateChartSpec(
  section: ChartSection,
  path: string,
  diagnostics: InfographicDiagnostic[]
): void {
  const fail = (code: string, message: string, sub?: string): void => {
    diagnostics.push(diagnostic(code, "error", message, { path: `${path}${sub ?? ""}`, sectionId: section.id }));
  };
  const warn = (code: string, message: string, sub?: string): void => {
    diagnostics.push(diagnostic(code, "warning", message, { path: `${path}${sub ?? ""}`, sectionId: section.id }));
  };

  const spec = section.chart;
  if (!isRecord(spec)) {
    fail("chart-missing-spec", `Chart "${section.id}" requires a chart spec.`, "/chart");
    return;
  }

  if (!isNonEmptyString(spec.recipe) || !CHART_RECIPES.includes(spec.recipe as ChartRecipe)) {
    fail(
      "chart-invalid-recipe",
      `Chart "${section.id}" uses recipe "${String(spec.recipe)}"; expected one of ${CHART_RECIPES.join(", ")}.`,
      "/chart/recipe"
    );
  }

  const categories = Array.isArray(spec.categories) ? spec.categories : null;
  if (!categories || categories.length === 0) {
    fail("chart-empty", `Chart "${section.id}" requires categories.`, "/chart/categories");
  } else {
    if (!categories.every((category) => isNonEmptyString(category))) {
      fail("chart-invalid-category", `Chart "${section.id}" categories must be non-empty strings.`, "/chart/categories");
    }
    for (const duplicate of findDuplicates(categories as string[])) {
      fail("chart-duplicate-category", `Chart "${section.id}" repeats the category "${duplicate}".`, "/chart/categories");
    }
  }

  const series = Array.isArray(spec.series) ? spec.series : null;
  if (!series || series.length === 0) {
    fail("chart-empty", `Chart "${section.id}" requires at least one series.`, "/chart/series");
  } else {
    const categoryCount = categories?.length ?? 0;
    for (const [index, entry] of series.entries()) {
      if (
        !isRecord(entry) ||
        !isNonEmptyString(entry.id) ||
        !isNonEmptyString(entry.label) ||
        !Array.isArray(entry.values)
      ) {
        fail("chart-invalid-series", `series[${index}] requires id, label and a values array.`, `/chart/series/${index}`);
        continue;
      }
      if (categories && entry.values.length !== categoryCount) {
        fail(
          "chart-series-length-mismatch",
          `Series "${entry.label}" has ${entry.values.length} values for ${categoryCount} categories.`,
          `/chart/series/${index}/values`
        );
      }
      for (const [valueIndex, value] of entry.values.entries()) {
        if (value === null) continue; // null is missing, not zero — never an error.
        if (typeof value !== "number" || !Number.isFinite(value)) {
          fail(
            "chart-non-finite-value",
            `Series "${String(entry.id)}" value ${valueIndex} is not a finite number; use null for missing data.`,
            `/chart/series/${index}/values/${valueIndex}`
          );
        }
      }
    }
    for (const duplicate of findDuplicates(series.map((entry) => (isRecord(entry) ? String(entry.id) : "")))) {
      if (duplicate === "") continue;
      fail("chart-duplicate-series", `Chart "${section.id}" repeats the series id "${duplicate}".`, "/chart/series");
    }
  }

  const scale = spec.scale;
  if (scale !== undefined) {
    if (!isRecord(scale) || (scale.kind !== "linear" && scale.kind !== "log")) {
      fail("chart-invalid-scale", `Chart "${section.id}" scale.kind must be "linear" or "log".`, "/chart/scale/kind");
    } else if (scale.domain !== undefined) {
      const domain = scale.domain;
      const valid =
        Array.isArray(domain) &&
        domain.length === 2 &&
        domain.every(isFiniteNumber) &&
        (domain as number[])[0] < (domain as number[])[1];
      if (!valid) {
        fail(
          "chart-invalid-scale",
          `Chart "${section.id}" scale.domain must be an ascending pair of finite numbers.`,
          "/chart/scale/domain"
        );
      }
    }
  }

  if (spec.recipe === "donut") {
    if (series && series.length !== 1) {
      fail(
        "chart-donut-series",
        `A donut chart encodes one part-to-whole series; "${section.id}" declares ${series.length}.`,
        "/chart/series"
      );
    }
    for (const entry of series ?? []) {
      if (isRecord(entry) && Array.isArray(entry.values) && entry.values.some((value) => typeof value === "number" && value < 0)) {
        fail("chart-invalid-scale", `A donut chart cannot encode negative values ("${String(entry.id)}").`, "/chart/series");
      }
    }
  }
  if (spec.recipe === "heatmap") {
    const rows = series?.length ?? 0;
    const columns = categories?.length ?? 0;
    if (rows < 2 || columns < 2) {
      warn(
        "chart-heatmap-degenerate",
        `A heatmap reads as a matrix; "${section.id}" has ${rows} series and ${columns} categories.`,
        "/chart"
      );
    }
  }
}

/**
 * Canonical JSON: object keys sorted, no insignificant whitespace. Two sources
 * that differ only in key order produce the same string, which is what makes
 * {@link sourceDigest} usable for cache keys and golden-test assertions.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

/**
 * FNV-1a (32-bit) over the canonical JSON. Deliberately not cryptographic: the
 * digest is a change-detection and provenance key, and it must be cheap enough
 * to recompute on every layout.
 */
export function sourceDigest(source: InfographicSource): string {
  const text = canonicalJson(source);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Throw for an unusable source; useful in tests and server-side pipelines. */
export function assertSource(input: unknown): InfographicSource {
  const result = validateSource(input);
  if (!result.ok || !result.source) {
    const summary = result.diagnostics
      .filter((entry) => entry.severity === "error")
      .map((entry) => `${entry.code}: ${entry.message}`)
      .join("\n");
    throw new Error(`invalid-infographic-source\n${summary}`);
  }
  return result.source;
}
