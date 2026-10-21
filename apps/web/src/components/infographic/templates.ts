/**
 * Template catalog — where content shape decides composition.
 *
 * A template is a *layout policy*, not a skin: it reads the semantic source,
 * decides which section plays which role, and hands the engine frames with page
 * numbers attached. Three rules keep them honest (docs/12 §3):
 *
 * 1. **Selection is explainable.** {@link scoreTemplate} returns a score *and*
 *    the violations behind it, so the UI can show why `data-story` lost to
 *    `editorial-overview` instead of silently picking one.
 * 2. **Nothing is silently dropped.** Sections beyond a page's capacity either
 *    continue on the next page (when the output profile paginates) or are
 *    reported in `unplaced`.
 * 3. **Slots are semantic.** A frame is labelled `lead`, `focal`, `supporting-2`
 *    or `takeaway`, which is what keeps a reflow auditable: the same content
 *    lands in the same slot on every page size.
 */

import { getOutputProfile } from "./art-direction";
import { bentoGrid, editorialGrid } from "./grids";
import { clamp, round, splitColumns, splitRows } from "./primitives";
import { allocateFrameRows, estimateSectionHeight } from "./requirements";
import { diagramLayers, hierarchyLayout } from "./visualizers";
import type {
  ChartSection,
  DiagramSection,
  HierarchySection,
  Importance,
  InfographicCanvasSpec,
  InfographicSection,
  ProcessSection,
  ResolvedStyle,
  RectInfo,
  TemplateId,
  TimelineSection,
} from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TemplateContext {
  /** Style resolved from the art direction; templates read spacing/type from it. */
  style: ResolvedStyle;
  canvas: InfographicCanvasSpec;
  /** Safe region (canvas minus the profile's safe inset). */
  safe: RectInfo;
  sections: readonly InfographicSection[];
  /**
   * Preferred column count for multi-column templates (e.g. `visual-cheat-sheet`);
   * clamped by the template. @default 3 for `visual-cheat-sheet`, otherwise ignored
   */
  columns?: number;
  /**
   * Vertical/horizontal rhythm override; `dense` packs entries closer together.
   * @default the art direction's density
   */
  density?: "airy" | "balanced" | "dense";
  /**
   * Which region wins structural dominance: a larger header, a larger focal
   * slot, or evenly weighted slots. @default `"even"` for `visual-cheat-sheet`, `"focal"` otherwise
   */
  emphasis?: "header" | "focal" | "even";
  /**
   * Stacking direction for `layered-architecture` — `vertical` stacks layers top
   * to bottom, `horizontal` left to right. @default "vertical"
   */
  orientation?: "vertical" | "horizontal";
}

export interface TemplateFrame {
  sectionId: string;
  frame: RectInfo;
  page: number;
  /** Semantic slot name, e.g. `lead`, `focal`, `supporting-1`, `takeaway`. */
  slot: string;
  importance: Importance;
}

export interface TemplateViolation {
  code: string;
  message: string;
  sectionId?: string;
}

export interface TemplateScore {
  template: TemplateId;
  /** 0–1; higher is a better fit for this content. */
  score: number;
  /** False when a hard requirement is missing (the template would misrepresent). */
  feasible: boolean;
  violations: TemplateViolation[];
}

export interface TemplatePlan {
  template: TemplateId;
  pages: number;
  frames: TemplateFrame[];
  /** Region reserved for the source title/thesis — page 1 only. */
  header: RectInfo | null;
  /** Sections the template could not place. */
  unplaced: string[];
  /**
   * Sections rejected because they could not fit at their measured minimum on a
   * non-paginating profile. Each carries an actionable `section-overflow`.
   */
  rejected: TemplateRejection[];
  /** Human-readable planning notes, surfaced in layout metadata. */
  notes: string[];
}

/** A section dropped for measurement reasons, with the shortfall behind it. */
export interface TemplateRejection {
  sectionId: string;
  kind: string;
  /** Measured shortfall in design px (minimum minus the room the page could give). */
  overflow: number;
  message: string;
}

export interface TemplateInfo {
  id: TemplateId;
  label: string;
  description: string;
  /** Section kinds this template is designed around. */
  prefers: readonly string[];
  /** Hard requirement, surfaced when missing. */
  requires?: string;
  /** Sections per page before pagination or overflow. */
  capacity: number;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const TEMPLATE_INFO: Record<TemplateId, TemplateInfo> = {
  "editorial-overview": {
    id: "editorial-overview",
    label: "Editorial overview",
    description:
      "A claim, one hero visual and two to six supporting blocks on an asymmetric grid with evidence notes.",
    prefers: ["chart", "diagram", "process", "timeline", "hierarchy"],
    capacity: 6,
  },
  "bento-summary": {
    id: "bento-summary",
    label: "Bento summary",
    description:
      "One primary insight plus grouped secondary metrics and illustrations, packed by salience.",
    prefers: ["statistic", "chart"],
    capacity: 6,
  },
  "process-journey": {
    id: "process-journey",
    label: "Process journey",
    description: "A dominant ordered process with optional branches, plus supporting context blocks.",
    prefers: ["process", "chart", "diagram"],
    requires: "at least one process section with two or more steps",
    capacity: 5,
  },
  "data-story": {
    id: "data-story",
    label: "Data story",
    description: "A question, its source data as a chart, annotations on the marks and a takeaway.",
    prefers: ["chart", "statistic", "comparison"],
    requires: "exactly one chart section",
    capacity: 4,
  },
  "educational-carousel": {
    id: "educational-carousel",
    label: "Educational carousel",
    description:
      "Cover, then concept and evidence panels, then a recap — one idea per panel across pages.",
    prefers: ["text", "chart", "diagram", "quote"],
    capacity: 2,
  },
  "visual-cheat-sheet": {
    id: "visual-cheat-sheet",
    label: "Visual cheat sheet",
    description:
      "Dense, short entries poured into importance-weighted columns and a deliberately quiet header, built for scanning.",
    prefers: ["text", "statistic", "comparison"],
    capacity: 8,
  },
  "layered-architecture": {
    id: "layered-architecture",
    label: "Layered architecture",
    description:
      "A focal layered diagram or hierarchy that dominates a stack of supporting notes and annotations.",
    prefers: ["diagram", "hierarchy", "text"],
    requires: "at least one diagram or hierarchy section",
    capacity: 5,
  },
};

export const TEMPLATE_IDS: readonly TemplateId[] = Object.keys(TEMPLATE_INFO) as TemplateId[];

const VISUAL_KINDS = new Set(["chart", "diagram", "process", "timeline", "hierarchy"]);
const METRIC_KINDS = new Set(["statistic", "chart", "comparison"]);

function isVisual(section: InfographicSection): boolean {
  return VISUAL_KINDS.has(section.kind);
}

function isMetric(section: InfographicSection): boolean {
  return METRIC_KINDS.has(section.kind);
}

function countOf(sections: readonly InfographicSection[], kind: string): number {
  return sections.filter((section) => section.kind === kind).length;
}

function importanceOf(section: InfographicSection, fallback: Importance): Importance {
  return section.importance ?? fallback;
}

/** Section kinds a cheat sheet is assembled from: short, scannable entries. */
const DENSE_KINDS = new Set(["text", "statistic", "comparison"]);

/** Numeric salience of an importance tier, used to weight columns and bands. */
function importanceWeight(importance: Importance): number {
  return importance === "hero" ? 3 : importance === "supporting" ? 2 : 1;
}

/** The section that supplies the layers: a diagram, else a hierarchy. */
function layeredSection(sections: readonly InfographicSection[]): InfographicSection | undefined {
  return (
    sections.find((section) => section.kind === "diagram") ??
    sections.find((section) => section.kind === "hierarchy")
  );
}

/**
 * How many layers/levels a layered focal section declares. Reuses the
 * visualizers' own geometry so the template and the renderer agree on depth.
 */
function layerCountOf(section: InfographicSection | undefined): number {
  if (!section) return 0;
  if (section.kind === "diagram") {
    return diagramLayers(section.diagram.nodes, section.diagram.edges).maxLayer + 1;
  }
  if (section.kind === "hierarchy") {
    const layout = hierarchyLayout(section.root, { nodeHeight: 1, nodeGap: 0, rowGap: 0, width: 1 });
    return layout.depth + 1;
  }
  return 0;
}

/** Column widths for a cheat sheet: wider columns carry more salient entries. */
function columnWeights(
  columns: number,
  sections: readonly InfographicSection[],
  emphasis: "header" | "focal" | "even"
): number[] {
  if (emphasis === "even") return Array.from({ length: columns }, () => 1);
  const weights = Array.from({ length: columns }, () => 1);
  sections.forEach((section, index) => {
    weights[index % columns] += importanceWeight(importanceOf(section, "supporting")) - 1;
  });
  return weights.some((weight) => weight > 1)
    ? weights
    : Array.from({ length: columns }, () => 1);
}

/** Gap between cells, modulated by the requested (or art-direction) density. */
function densityGap(context: TemplateContext): number {
  const density = context.density ?? (context.style.density === "dense" ? "dense" : "balanced");
  if (density === "dense") return context.style.spacing[1];
  if (density === "airy") return context.style.spacing[3];
  return context.style.spacing[2];
}

// ---------------------------------------------------------------------------
// Scoring and selection
// ---------------------------------------------------------------------------

/**
 * Score a template against the content. Scores are heuristic on purpose — the
 * point is a defensible ordering plus named violations, not a single truth.
 */
export function scoreTemplate(template: TemplateId, context: TemplateContext): TemplateScore {
  const sections = context.sections;
  const violations: TemplateViolation[] = [];
  const info = TEMPLATE_INFO[template];
  let score = 0.4;

  const visualCount = sections.filter(isVisual).length;
  const metricCount = sections.filter(isMetric).length;
  const textCount = countOf(sections, "text");

  switch (template) {
    case "editorial-overview": {
      score += 0.2;
      if (visualCount > 0) score += 0.2;
      score += Math.min(0.2, visualCount * 0.1);
      if (sections.length > info.capacity) {
        violations.push({
          code: "template-capacity",
          message: `${sections.length} sections exceed the ${info.capacity} slots of an editorial overview; the extras continue on another page.`,
        });
      }
      break;
    }
    case "bento-summary": {
      if (metricCount >= 2) score += 0.25;
      else
        violations.push({
          code: "template-few-metrics",
          message: "A bento summary reads best with at least two metric-bearing sections.",
        });
      score += Math.min(0.25, metricCount * 0.08);
      if (sections.length >= 4) score += 0.15;
      else
        violations.push({
          code: "template-few-sections",
          message: "Fewer than four sections leaves a bento grid looking empty.",
        });
      break;
    }
    case "process-journey": {
      const process = sections.find(
        (section): section is ProcessSection => section.kind === "process"
      );
      if (!process) {
        violations.push({
          code: "template-requires-process",
          message: `process-journey ${info.requires}.`,
        });
        return { template, score: 0.1, feasible: false, violations };
      }
      if (process.steps.length < 2) {
        violations.push({
          code: "template-requires-process",
          message: "A process journey needs at least two steps to show a journey.",
          sectionId: process.id,
        });
        return { template, score: 0.15, feasible: false, violations };
      }
      score += 0.35;
      score += Math.min(0.25, process.steps.length * 0.03);
      if (process.steps.some((step) => (step.nextIds?.length ?? 0) > 1)) score += 0.05;
      break;
    }
    case "data-story": {
      const charts = sections.filter((section) => section.kind === "chart");
      if (charts.length !== 1) {
        violations.push({
          code: "template-requires-chart",
          message: `data-story ${info.requires}; this source has ${charts.length}.`,
        });
        return { template, score: charts.length === 0 ? 0.05 : 0.2, feasible: false, violations };
      }
      score += 0.35;
      if (sections.some((section) => section.kind === "statistic")) score += 0.1;
      if (textCount >= 2) score += 0.1;
      break;
    }
    case "educational-carousel": {
      if (sections.length >= 4) score += 0.3;
      else
        violations.push({
          code: "template-few-sections",
          message: "A carousel needs at least four sections to be worth paginating.",
        });
      score += Math.min(0.2, sections.length * 0.04);
      score += Math.min(0.1, visualCount * 0.05);
      break;
    }
    case "visual-cheat-sheet": {
      const denseCount = sections.filter((section) => DENSE_KINDS.has(section.kind)).length;
      if (sections.length >= 6) score += 0.32;
      else if (sections.length >= 3) score += 0.14;
      else
        violations.push({
          code: "template-few-sections",
          message: "A cheat sheet needs several short entries to be worth scanning.",
        });
      score += Math.min(0.28, denseCount * 0.07);
      if (sections.length > info.capacity) {
        violations.push({
          code: "template-capacity",
          message: `${sections.length} sections exceed the ${info.capacity} slots of a cheat sheet; the extras continue on another page.`,
        });
      }
      break;
    }
    case "layered-architecture": {
      const focal = layeredSection(sections);
      if (!focal) {
        violations.push({
          code: "template-requires-layers",
          message: `layered-architecture ${info.requires}.`,
        });
        return { template, score: 0.08, feasible: false, violations };
      }
      score += 0.32;
      score += Math.min(0.2, layerCountOf(focal) * 0.05);
      if (sections.some((section) => section.kind === "text" || section.kind === "quote")) score += 0.1;
      if (sections.length > info.capacity) {
        violations.push({
          code: "template-capacity",
          message: `${sections.length} sections exceed the ${info.capacity} slots of a layered architecture; the extras continue on another page.`,
        });
      }
      break;
    }
  }

  return {
    template,
    score: round(Math.max(0, Math.min(1, score)), 3),
    feasible: true,
    violations,
  };
}

export interface TemplateSelection {
  template: TemplateId;
  /** Total pages the chosen template needs. */
  pages: number;
  score: number;
  /** All candidates, best first, so a UI can show the ranking. */
  candidates: TemplateScore[];
}

/**
 * Rank every template (or the caller's shortlist) and return the highest-scoring
 * feasible one. Ties break on the catalog order, so selection is reproducible.
 */
export function selectTemplate(
  context: TemplateContext,
  options?: { candidates?: readonly TemplateId[] }
): TemplateSelection {
  const candidates = (options?.candidates ?? TEMPLATE_IDS).map((template) =>
    scoreTemplate(template, context)
  );
  const ranked = [...candidates].sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return TEMPLATE_IDS.indexOf(a.template) - TEMPLATE_IDS.indexOf(b.template);
  });
  const best = ranked[0];
  const plan = planTemplate(best.template, context);
  return { template: best.template, pages: plan.pages, score: best.score, candidates: ranked };
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function profilerPaginates(canvas: InfographicCanvasSpec): boolean {
  return getOutputProfile(canvas.profile).pagination === "paginate";
}

interface PageBuild {
  frames: TemplateFrame[];
  fits: boolean;
  shortfall: Record<string, number>;
}

/**
 * The page region a template's frames may tile: the safe area minus the header
 * band for regular pages, the reserved cover band on a carousel cover, and the
 * whole safe area for carousel middle/recap panels.
 */
function containerFor(
  template: TemplateId,
  context: TemplateContext,
  page: number,
  pages: number
): RectInfo {
  if (template === "educational-carousel") {
    if (page === 1) return headerBand(context, HEADER_RATIO["educational-carousel"]).rest;
    void pages;
    return context.safe;
  }
  return headerBand(context, HEADER_RATIO[template]).rest;
}

/**
 * Build one page's frames and re-allocate their vertical geometry from the
 * content's measured minimums. `fits` is false when even those minimums do not
 * fit, which is what lets the planner paginate or reject instead of squeezing.
 */
function buildPage(
  template: TemplateId,
  context: TemplateContext,
  sections: readonly InfographicSection[],
  page: number,
  pages: number
): PageBuild {
  const frames = BUILDERS[template]({ context, sections, page, pages, slotOffset: 0 });
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const allocation = allocateFrameRows(
    frames,
    sectionById,
    context.style,
    densityGap(context),
    containerFor(template, context, page, pages)
  );
  return { frames, fits: allocation.fits, shortfall: allocation.shortfall };
}

/**
 * The largest leading run of `sections` that fits a page at its measured
 * minimums (at least one section, even when that section alone overflows).
 */
function fitPrefix(
  template: TemplateId,
  context: TemplateContext,
  sections: readonly InfographicSection[],
  page: number,
  pages: number
): { take: number; attempt: PageBuild } {
  if (sections.length <= 1) {
    return { take: sections.length, attempt: buildPage(template, context, sections, page, pages) };
  }
  for (let candidate = sections.length; candidate >= 1; candidate -= 1) {
    const attempt = buildPage(template, context, sections.slice(0, candidate), page, pages);
    if (attempt.fits || candidate === 1) return { take: candidate, attempt };
  }
  return { take: 1, attempt: buildPage(template, context, sections.slice(0, 1), page, pages) };
}

/**
 * Build the frame plan for a template: which section sits where, on which page.
 * Deterministic for a given context — the same source always produces the same
 * frames, which is what makes golden-frame tests possible.
 *
 * Planning is *measurement-driven* (docs/12 §5): every page is allocated from
 * `estimateSectionHeight`, a paginating profile carries the sections that did
 * not fit to the next page, and a non-paginating profile rejects them with an
 * actionable diagnostic instead of drawing a compressed band.
 */
export function planTemplate(template: TemplateId, context: TemplateContext): TemplatePlan {
  const sections = context.sections;
  const paginate = profilerPaginates(context.canvas);
  const unplaced: string[] = [];
  const rejected: TemplateRejection[] = [];
  const notes: string[] = [];
  const frames: TemplateFrame[] = [];

  const reject = (section: InfographicSection, width: number, deficit: number | undefined) => {
    const short =
      deficit ?? estimateSectionHeight(section, Math.max(width, 1), context.style).minHeight;
    unplaced.push(section.id);
    rejected.push({
      sectionId: section.id,
      kind: section.kind,
      overflow: round(short),
      message: `Section "${section.id}" (${section.kind}) cannot fit the ${context.canvas.profile} page at its measured minimum (short by ${round(short)}px); shorten the section or use a paginating profile.`,
    });
  };

  const rejectTail = (attempt: PageBuild, kept: number, subset: readonly InfographicSection[]) => {
    const excess = subset.slice(kept);
    if (excess.length === 0) return;
    for (const section of excess) {
      const frame = attempt.frames.find((entry) => entry.sectionId === section.id);
      reject(section, frame?.frame.width ?? context.safe.width, attempt.shortfall[section.id]);
    }
    notes.push(
      `${excess.length} section(s) did not fit at their measured minimum and were not shown (the ${context.canvas.profile} profile does not paginate).`
    );
  };

  if (template === "educational-carousel") {
    const cover = sections[0];
    const recap = sections.length > 2 ? sections[sections.length - 1] : undefined;
    const middle = sections.slice(1, recap ? sections.length - 1 : sections.length);
    const middlePages: InfographicSection[][] = [];

    if (paginate) {
      let remaining = [...middle];
      while (remaining.length > 0) {
        const fit = fitPrefix(template, context, remaining, 2, 4);
        middlePages.push(remaining.slice(0, fit.take));
        remaining = remaining.slice(fit.take);
      }
      if (middlePages.length === 0) middlePages.push([]);
    } else {
      const fit = fitPrefix(template, context, middle, 2, 4);
      middlePages.push(middle.slice(0, fit.take));
      rejectTail(fit.attempt, fit.take, middle);
    }

    const total = (cover ? 1 : 0) + middlePages.length + (recap ? 1 : 0);
    if (cover) frames.push(...buildPage(template, context, [cover], 1, total).frames);
    middlePages.forEach((pageSections, index) => {
      frames.push(...buildPage(template, context, pageSections, index + 2, total).frames);
    });
    if (recap) frames.push(...buildPage(template, context, [recap], total, total).frames);

    // `educationalCarousel` reserves the top half of the cover panel for the
    // source title/thesis, so the header must be returned for that page — the
    // cover is a cover, not a title-less panel.
    const header = cover ? HEADER_OF[template](context) ?? null : null;
    if (total > 3) {
      notes.push(
        `Content continues across ${total} pages; each page keeps the sections that fit at their measured minimum height.`
      );
    }
    return { template, pages: total, frames, header, unplaced, rejected, notes };
  }

  const pageSectionsList: InfographicSection[][] = [];
  if (paginate) {
    let remaining = [...sections];
    while (remaining.length > 0) {
      const fit = fitPrefix(template, context, remaining, 1, 1);
      pageSectionsList.push(remaining.slice(0, fit.take));
      remaining = remaining.slice(fit.take);
    }
    if (pageSectionsList.length === 0) pageSectionsList.push([]);
  } else {
    const full = buildPage(template, context, sections, 1, 1);
    let take = sections.length;
    if (!full.fits && sections.length > 1) {
      for (let candidate = sections.length - 1; candidate >= 1; candidate -= 1) {
        if (candidate === 1 || buildPage(template, context, sections.slice(0, candidate), 1, 1).fits) {
          take = candidate;
          break;
        }
      }
    }
    pageSectionsList.push(sections.slice(0, take));
    rejectTail(full, take, sections);
  }

  let header: RectInfo | null = null;
  pageSectionsList.forEach((pageSections, index) => {
    const built = buildPage(template, context, pageSections, index + 1, pageSectionsList.length);
    if (built.frames.length > 0 && index === 0) {
      header = HEADER_OF[template](context) ?? null;
    }
    frames.push(...built.frames);
  });

  if (pageSectionsList.length > 1) {
    notes.push(
      `Content continues across ${pageSectionsList.length} pages; each page keeps the sections that fit at their measured minimum height.`
    );
  }

  return { template, pages: pageSectionsList.length, frames, header, unplaced, rejected, notes };
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

interface BuildInput {
  context: TemplateContext;
  sections: readonly InfographicSection[];
  page: number;
  pages: number;
  slotOffset: number;
}

type TemplateBuilder = (input: BuildInput) => TemplateFrame[];

function headerBand(context: TemplateContext, ratio: number): { header: RectInfo; rest: RectInfo } {
  const style = context.style;
  const safe = context.safe;
  const headerHeight = round(safe.height * ratio);
  const gap = style.spacing[4];
  return {
    header: { x: safe.x, y: safe.y, width: safe.width, height: headerHeight },
    rest: {
      x: safe.x,
      y: round(safe.y + headerHeight + gap),
      width: safe.width,
      height: round(Math.max(0, safe.height - headerHeight - gap)),
    },
  };
}

function headerRect(context: TemplateContext, ratio: number): RectInfo {
  return headerBand(context, ratio).header;
}

/** Header band height as a fraction of the safe region, per template. */
const HEADER_RATIO: Record<TemplateId, number> = {
  "editorial-overview": 0.2,
  "bento-summary": 0.18,
  "process-journey": 0.18,
  "data-story": 0.16,
  "educational-carousel": 0.5,
  "visual-cheat-sheet": 0.12,
  "layered-architecture": 0.16,
};

const HEADER_OF: Record<TemplateId, (context: TemplateContext) => RectInfo | null> = {
  "editorial-overview": (context) => headerRect(context, HEADER_RATIO["editorial-overview"]),
  "bento-summary": (context) => headerRect(context, HEADER_RATIO["bento-summary"]),
  "process-journey": (context) => headerRect(context, HEADER_RATIO["process-journey"]),
  "data-story": (context) => headerRect(context, HEADER_RATIO["data-story"]),
  "educational-carousel": (context) => headerRect(context, HEADER_RATIO["educational-carousel"]),
  "visual-cheat-sheet": (context) => headerRect(context, HEADER_RATIO["visual-cheat-sheet"]),
  "layered-architecture": (context) => headerRect(context, HEADER_RATIO["layered-architecture"]),
};

/**
 * Editorial overview: a lead claim across the top, a hero visual pinned into an
 * asymmetric grid, and supporting blocks reading around it.
 */
const editorialOverview: TemplateBuilder = ({ context, sections, page }) => {
  const { rest } = headerBand(context, 0.2);
  const frames: TemplateFrame[] = [];
  const [lead, ...others] = sections;

  if (lead) {
    const leadHeight = round(rest.height * 0.26);
    frames.push({
      sectionId: lead.id,
      frame: { x: rest.x, y: rest.y, width: rest.width, height: leadHeight },
      page,
      slot: "lead",
      importance: importanceOf(lead, "hero"),
    });
    const body: RectInfo = {
      x: rest.x,
      y: round(rest.y + leadHeight + context.style.spacing[3]),
      width: rest.width,
      height: round(rest.height - leadHeight - context.style.spacing[3]),
    };

    const heroIndex = others.findIndex(isVisual);
    const hero = heroIndex >= 0 ? others[heroIndex] : undefined;
    const supporting = others.filter((section) => section !== hero);

    const grid = editorialGrid(
      body,
      { id: "editorial-overview", columns: [2, 2, 3], rows: [1, 1], gap: context.style.spacing[3] },
      renderContextStub(context)
    );

    // The hero owns the pinned focal cell; supporting blocks take the rest.
    if (hero && grid.focal) {
      frames.push({
        sectionId: hero.id,
        frame: grid.focal.box,
        page,
        slot: "focal",
        importance: importanceOf(hero, "hero"),
      });
    }

    const cells = grid.cells.filter((cell) => !cell.focal);
    const queue = hero ? supporting : others;
    queue.forEach((section, index) => {
      const cell = cells[index];
      if (!cell) return;
      frames.push({
        sectionId: section.id,
        frame: cell.box,
        page,
        slot: `supporting-${index + 1}`,
        importance: importanceOf(section, "supporting"),
      });
    });
  }

  return frames;
};

/**
 * Bento summary: a lead insight, then tiles packed by salience. Hero tiles claim
 * two columns and two rows, so the primary insight is structurally dominant.
 */
const bentoSummary: TemplateBuilder = ({ context, sections, page }) => {
  const { rest } = headerBand(context, 0.18);
  const frames: TemplateFrame[] = [];
  const [lead, ...others] = sections;

  if (lead) {
    const leadHeight = round(rest.height * 0.22);
    frames.push({
      sectionId: lead.id,
      frame: { x: rest.x, y: rest.y, width: rest.width, height: leadHeight },
      page,
      slot: "lead",
      importance: importanceOf(lead, "hero"),
    });

    const body: RectInfo = {
      x: rest.x,
      y: round(rest.y + leadHeight + context.style.spacing[3]),
      width: rest.width,
      height: round(rest.height - leadHeight - context.style.spacing[3]),
    };

    const grid = bentoGrid(
      body,
      {
        id: "bento-summary",
        columns: 4,
        gap: context.style.spacing[2],
        tiles: others.map((section, index) => ({
          id: section.id,
          importance: importanceOf(section, isMetric(section) ? "supporting" : "detail"),
          aspect: section.kind === "chart" ? 1.35 : section.kind === "statistic" ? 1.7 : 1.5,
          span: section.kind === "chart" ? { columns: 2, rows: 2 } : undefined,
          priority: Math.max(0, 10 - index),
        })),
      },
      renderContextStub(context)
    );

    for (const placement of grid.placements) {
      const section = others.find((entry) => entry.id === placement.id);
      if (!section) continue;
      frames.push({
        sectionId: section.id,
        frame: placement.box,
        page,
        slot: placement.importance === "hero" ? "focal" : `tile-${placement.column}:${placement.row}`,
        importance: placement.importance,
      });
    }
  }

  return frames;
};

/**
 * Process journey: the process takes the dominant band, context blocks sit above
 * and below it so the sequence is never interrupted by a paragraph.
 */
const processJourney: TemplateBuilder = ({ context, sections, page }) => {
  const { rest } = headerBand(context, 0.18);
  const frames: TemplateFrame[] = [];
  const processIndex = sections.findIndex((section) => section.kind === "process");
  const process = processIndex >= 0 ? sections[processIndex] : undefined;
  const surrounding = sections.filter((section) => section !== process);
  const above = process ? surrounding.slice(0, Math.ceil(surrounding.length / 2)) : surrounding;
  const below = process ? surrounding.slice(Math.ceil(surrounding.length / 2)) : [];

  const weights = [...above.map(() => 1), process ? 3.2 : 1, ...below.map(() => 1)];
  const rects = splitRows(rest, weights.length > 0 ? weights : [1], context.style.spacing[3]);

  let cursor = 0;
  above.forEach((section, index) => {
    frames.push({
      sectionId: section.id,
      frame: rects[cursor],
      page,
      slot: `context-above-${index + 1}`,
      importance: importanceOf(section, "detail"),
    });
    cursor += 1;
  });
  if (process) {
    frames.push({
      sectionId: process.id,
      frame: rects[cursor],
      page,
      slot: "focal",
      importance: importanceOf(process, "hero"),
    });
    cursor += 1;
  }
  below.forEach((section, index) => {
    frames.push({
      sectionId: section.id,
      frame: rects[cursor],
      page,
      slot: `context-below-${index + 1}`,
      importance: importanceOf(section, "detail"),
    });
    cursor += 1;
  });

  return frames;
};

/**
 * Data story: question at the top, the chart given the most room, the takeaway
 * closing the page. Annotations target the chart's marks, so the chart frame is
 * deliberately the largest region on the page.
 */
const dataStory: TemplateBuilder = ({ context, sections, page }) => {
  const { rest } = headerBand(context, 0.16);
  const frames: TemplateFrame[] = [];
  const chart = sections.find((section): section is ChartSection => section.kind === "chart");
  const question = sections.find((section) => section !== chart && section.kind === "text");
  const takeaway =
    [...sections].reverse().find((section) => section !== chart && section !== question) ?? undefined;
  const middle = sections.filter(
    (section) => section !== chart && section !== question && section !== takeaway
  );

  const weights = [
    question ? 1 : 0,
    chart ? 3.4 : 0,
    ...middle.map(() => 1),
    takeaway ? 1.2 : 0,
  ].filter((weight) => weight > 0);

  const rects = splitRows(rest, weights.length > 0 ? weights : [1], context.style.spacing[3]);
  let cursor = 0;

  if (question) {
    frames.push({
      sectionId: question.id,
      frame: rects[cursor],
      page,
      slot: "question",
      importance: importanceOf(question, "supporting"),
    });
    cursor += 1;
  }
  if (chart) {
    frames.push({
      sectionId: chart.id,
      frame: rects[cursor],
      page,
      slot: "focal",
      importance: importanceOf(chart, "hero"),
    });
    cursor += 1;
  }
  middle.forEach((section, index) => {
    frames.push({
      sectionId: section.id,
      frame: rects[cursor],
      page,
      slot: `evidence-${index + 1}`,
      importance: importanceOf(section, "supporting"),
    });
    cursor += 1;
  });
  if (takeaway) {
    frames.push({
      sectionId: takeaway.id,
      frame: rects[cursor],
      page,
      slot: "takeaway",
      importance: importanceOf(takeaway, "supporting"),
    });
  }

  return frames;
};

/**
 * Educational carousel: one idea per panel. The cover and recap pages reserve a
 * header for the source title/thesis because those pages are read as covers.
 */
const educationalCarousel: TemplateBuilder = ({ context, sections, page, pages }) => {
  const frames: TemplateFrame[] = [];
  const isCover = page === 1;
  const isRecap = page === pages && pages > 1;

  if (isCover) {
    const { rest } = headerBand(context, 0.5);
    const section = sections[0];
    if (section) {
      frames.push({
        sectionId: section.id,
        frame: rest,
        page,
        slot: "cover",
        importance: importanceOf(section, "hero"),
      });
    }
    return frames;
  }

  if (isRecap) {
    const section = sections[0];
    if (section) {
      frames.push({
        sectionId: section.id,
        frame: context.safe,
        page,
        slot: "recap",
        importance: importanceOf(section, "supporting"),
      });
    }
    return frames;
  }

  const rects = splitRows(
    context.safe,
    sections.map(() => 1),
    context.style.spacing[3]
  );
  sections.forEach((section, index) => {
    frames.push({
      sectionId: section.id,
      frame: rects[index],
      page,
      slot: `concept-${index + 1}`,
      importance: importanceOf(section, "supporting"),
    });
  });

  return frames;
};

/**
 * Visual cheat sheet: many short entries poured into importance-weighted
 * columns under a deliberately quiet header, so the eye scans column by column.
 * A multi-column `editorialGrid` supplies the cells; pagination and overflow are
 * handled by the shared planner, not here.
 */
const visualCheatSheet: TemplateBuilder = ({ context, sections, page }) => {
  const frames: TemplateFrame[] = [];
  if (sections.length === 0) return frames;

  const { rest } = headerBand(context, 0.12);
  const gap = densityGap(context);
  const columns = clamp(Math.floor(context.columns ?? 3), 1, 4);
  const rows = Math.max(1, Math.ceil(sections.length / columns));
  const emphasis = context.emphasis ?? "even";

  const grid = editorialGrid(
    rest,
    {
      id: "visual-cheat-sheet",
      columns: columnWeights(columns, sections, emphasis),
      rows: Array.from({ length: rows }, () => 1),
      gap,
      rowGap: gap,
    },
    renderContextStub(context)
  );

  const cells = grid.cells.filter((cell) => !cell.focal);
  sections.forEach((section, index) => {
    const cell = cells[index];
    if (!cell) return;
    frames.push({
      sectionId: section.id,
      frame: cell.box,
      page,
      slot: `entry-${index + 1}`,
      importance: importanceOf(section, "detail"),
    });
  });

  return frames;
};

/**
 * Layered architecture: a focal diagram/hierarchy owns the dominant band while
 * supporting notes stack before and after it (above/below when vertical, left/
 * right when horizontal). The focal band grows with the measured layer count, so
 * a deep stack is given the room it needs instead of being compressed.
 */
const layeredArchitecture: TemplateBuilder = ({ context, sections, page }) => {
  const frames: TemplateFrame[] = [];
  if (sections.length === 0) return frames;

  const { rest } = headerBand(context, 0.16);
  const gap = densityGap(context);
  const orientation = context.orientation ?? "vertical";
  const emphasis = context.emphasis ?? "focal";

  const focal = layeredSection(sections);
  const supporting = sections.filter((section) => section !== focal);
  const above = supporting.slice(0, Math.ceil(supporting.length / 2));
  const below = supporting.slice(Math.ceil(supporting.length / 2));

  const focalWeight = emphasis === "even" ? 1.4 : 2 + Math.min(2, Math.max(1, layerCountOf(focal)) * 0.4);
  const weights = [
    ...above.map(() => 1),
    focal ? focalWeight : 0,
    ...below.map(() => 1),
  ].filter((weight) => weight > 0);
  const rects =
    orientation === "horizontal"
      ? splitColumns(rest, weights.length > 0 ? weights : [1], gap)
      : splitRows(rest, weights.length > 0 ? weights : [1], gap);

  let cursor = 0;
  above.forEach((section, index) => {
    frames.push({
      sectionId: section.id,
      frame: rects[cursor],
      page,
      slot: `note-before-${index + 1}`,
      importance: importanceOf(section, "detail"),
    });
    cursor += 1;
  });
  if (focal) {
    frames.push({
      sectionId: focal.id,
      frame: rects[cursor],
      page,
      slot: "focal",
      importance: importanceOf(focal, "hero"),
    });
    cursor += 1;
  }
  below.forEach((section, index) => {
    frames.push({
      sectionId: section.id,
      frame: rects[cursor],
      page,
      slot: `note-after-${index + 1}`,
      importance: importanceOf(section, "detail"),
    });
    cursor += 1;
  });

  return frames;
};

const BUILDERS: Record<TemplateId, TemplateBuilder> = {
  "editorial-overview": editorialOverview,
  "bento-summary": bentoSummary,
  "process-journey": processJourney,
  "data-story": dataStory,
  "educational-carousel": educationalCarousel,
  "visual-cheat-sheet": visualCheatSheet,
  "layered-architecture": layeredArchitecture,
};

/**
 * Templates need a `SectionRenderContext` for the grid engines, which report
 * their own diagnostics. Planning happens before the engine's context exists, so
 * the plan gets a quiet stub: grid problems surface again when the engine
 * renders, where the diagnostics carry section ids.
 */
function renderContextStub(context: TemplateContext): Parameters<typeof editorialGrid>[2] {
  return {
    style: context.style,
    language: "en",
    evidence: new Map(),
    evidenceLabel: () => undefined,
    id: () => "plan",
    report: () => {},
  };
}

/** Sections a template will actually render on a given page. */
export function frameFor(
  plan: TemplatePlan,
  sectionId: string,
  page?: number
): TemplateFrame | undefined {
  return plan.frames.find(
    (frame) => frame.sectionId === sectionId && (page === undefined || frame.page === page)
  );
}

export type { DiagramSection, HierarchySection, TimelineSection };
