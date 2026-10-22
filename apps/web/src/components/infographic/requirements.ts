/**
 * Content requirements: how much room a section actually needs.
 *
 * The layout engines could pack purely by aesthetic weights, and that is exactly
 * how a beautiful template silently clips a paragraph. `docs/12` §5 requires the
 * opposite order: measure first, then choose a layout policy, then reject — never
 * shrink below a legibility floor and never crop essential copy.
 *
 * This module is the "measure" half of that contract. It answers, before any
 * renderer runs, "what is the smallest frame this section can live in, and what
 * would it prefer?" using the same deterministic text model as the renderers, so
 * a frame that satisfies a requirement is a frame that fits.
 *
 * The estimates are deliberately conservative: rounding up costs whitespace,
 * rounding down costs a broken panel.
 */
import { blockHeight, formatNumber, formatPercent, lineMetrics, measureText, wrapText } from "./measure";
import { labelCase, round } from "./primitives";
import { diagramLayers } from "./visualizers";
import type {
  ChartSection,
  ComparisonSection,
  DiagramSection,
  HierarchyNode,
  HierarchySection,
  InfographicSection,
  ProcessSection,
  QuoteSection,
  RectInfo,
  ResolvedStyle,
  StatisticSection,
  TextSection,
  TimelineSection,
} from "./types";

/** Two numbers per section: the floor and the comfortable size. */
export interface SectionRequirement {
  /** Below this the section cannot be rendered legibly. */
  minHeight: number;
  /** Size at which the section looks composed rather than merely fitting. */
  preferredHeight: number;
}

function step(fontSize: number, lineHeight: number): number {
  return lineMetrics(fontSize, lineHeight).lineStep;
}

/**
 * Chrome reserved around a section body: the heading block and the evidence
 * footnote. Mirrors `sectionChrome` in `blocks.ts`; if that changes, this must
 * change with it, which is why the constants live here rather than being inlined
 * at each call site.
 */
export function sectionChromeHeight(
  style: ResolvedStyle,
  options: { heading?: boolean; evidence?: boolean; headingText?: string; width?: number } = {}
): number {
  let height = 0;
  if (options.heading) {
    // A heading wraps at the frame width; in a narrow column a long heading is
    // several lines, so the chrome reservation must measure it, not assume one.
    const lines =
      options.headingText && options.width !== undefined
        ? wrapText(options.headingText, {
            maxWidth: Math.max(options.width, 1),
            fontSize: style.type.h3,
            family: style.font.heading,
          }).lines.length
        : 1;
    height += blockHeight(Math.max(1, lines), style.type.h3, style.lineHeight.heading) + style.spacing[2];
  }
  if (options.evidence) height += step(style.type.caption, style.lineHeight.body) + style.spacing[1];
  return height;
}

/** Lines a paragraph needs at a given measure, using the shared text model. */
function textLines(text: string, width: number, fontSize: number, family: string): number {
  if (text.trim().length === 0) return 0;
  return wrapText(text, {
    maxWidth: Math.max(width, 1),
    fontSize,
    family,
  }).lines.length;
}

/** Height of `text` wrapped to `maxWidth`, using the shared text model. */
function textHeight(
  text: string,
  family: string,
  fontSize: number,
  lineHeight: number,
  maxWidth: number
): number {
  if (text.trim().length === 0) return 0;
  const lines = wrapText(text, { maxWidth: Math.max(maxWidth, 1), fontSize, family }).lines.length;
  return blockHeight(lines, fontSize, lineHeight);
}

function measureOk(width: number, style: ResolvedStyle): number {
  const capped = style.measureMax > 0 ? Math.min(width, style.measureMax) : width;
  return Math.max(capped, 1);
}

function textRequirement(section: TextSection, width: number, style: ResolvedStyle): SectionRequirement {
  const body = style.type.body;
  const bodyStep = step(body, style.lineHeight.body);
  const measure = measureOk(width, style);
  const gap = style.density === "dense" ? style.spacing[1] : style.spacing[2];
  let lines = 0;
  let blocks = 0;
  for (const paragraph of section.paragraphs) {
    const count = textLines(paragraph, measure, body, style.font.body);
    if (count === 0) continue;
    lines += count;
    blocks += 1;
  }
  if (section.bullets?.length) {
    // Bullets hang under an accent marker, so they get a slightly narrower
    // measure than the paragraph they follow.
    for (const bullet of section.bullets) {
      lines += textLines(bullet, measure - style.spacing[3], body, style.font.body);
      blocks += 1;
    }
  }
  if (blocks === 0) return { minHeight: bodyStep, preferredHeight: bodyStep * 2 };
  const height = lines * bodyStep + (blocks - 1) * gap;
  return { minHeight: Math.round(height), preferredHeight: Math.round(height * 1.18 + gap) };
}

const PERCENT_UNITS = new Set(["%", "percent", "pct", "percentage", "pp"]);

function statisticRequirement(section: StatisticSection, width: number, style: ResolvedStyle): SectionRequirement {
  // Mirrors `renderStatisticSection`'s own cursor arithmetic so the reserved
  // height equals what the block will actually consume: value, an optional
  // unit line, the wrapped measure label, an optional context line and the
  // change line. Guessing a single meta line under-sized narrow portraits.
  const hero = (section.importance ?? "supporting") === "hero";
  const valueRole = hero ? "statHuge" : "statLarge";
  const valueSize = style.type[valueRole];
  const valueStep = blockHeight(1, valueSize, style.lineHeight.display);
  const valueText = formatNumber(section.value, { precision: section.precision ?? 0 });
  const gap = style.spacing[0];

  let used = valueStep;
  if (section.unit) {
    const unitSize = style.type.h2;
    const unitStep = blockHeight(1, unitSize, style.lineHeight.heading);
    const valueWidth = measureText(valueText, { fontSize: valueSize, family: style.font.display });
    const unitWidth = measureText(section.unit, { fontSize: unitSize, family: style.font.heading });
    const inline = valueWidth + gap + unitWidth <= width + 0.5;
    if (!inline) used += unitStep + style.spacing[1];
  }
  used += style.spacing[1];

  const measureText_ = labelCase(style, section.measureLabel);
  used += textHeight(measureText_, style.font.heading, style.type.label, style.lineHeight.annotation, width);

  const contextParts: string[] = [];
  if (section.denominator !== undefined && Number.isFinite(section.denominator)) {
    contextParts.push(`of ${formatNumber(section.denominator)}`);
  }
  if (section.period) contextParts.push(section.period);
  if (contextParts.length > 0) {
    const contextText = contextParts.join(" · ");
    const measureWidth = measureText(measureText_, { fontSize: style.type.label, family: style.font.heading });
    const contextWidth = measureText(contextText, { fontSize: style.type.caption, family: style.font.body });
    const inline = measureWidth + style.spacing[2] + contextWidth <= width + 0.5;
    if (!inline) {
      used += blockHeight(1, style.type.caption, style.lineHeight.annotation) + style.spacing[1];
    }
  }

  if (section.baseline !== undefined && Number.isFinite(section.baseline)) {
    const percentLike = section.unit !== undefined && PERCENT_UNITS.has(section.unit.trim().toLocaleLowerCase("en-US"));
    const delta = section.value - section.baseline;
    const direction = delta === 0 ? "no change" : delta > 0 ? "increase" : "decrease";
    const magnitude = percentLike
      ? `${formatNumber(Math.abs(delta), { precision: section.precision ?? 1 })} pp`
      : section.baseline !== 0
        ? formatPercent(Math.abs(delta / section.baseline), 1)
        : `${formatNumber(Math.abs(delta), { precision: section.precision ?? 0 })}`;
    const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
    const baselineText = `${formatNumber(section.baseline, { precision: section.precision ?? 0 })}${section.unit ?? ""}`;
    const changeText = `${sign}${magnitude} ${direction} vs ${baselineText} baseline`;
    used += textHeight(changeText, style.font.body, style.type.body, style.lineHeight.body, measureOk(width, style));
  }

  const min = Math.round(used + style.spacing[1] * 2 + style.spacing[3] + style.spacing[0]);
  return { minHeight: min, preferredHeight: Math.round(min * 1.15 + style.spacing[2]) };
}

function comparisonRequirement(section: ComparisonSection, width: number, style: ResolvedStyle): SectionRequirement {
  // Mirror the renderer's own geometry (splitColumns with a heavier label column
  // and per-cell wrapping) so a frame that satisfies this requirement is a frame
  // the comparison actually fits; guessing 1–2 lines per cell under-sized narrow
  // columns badly.
  const cases = section.cases;
  const gap = style.spacing[2];
  const weights = [1.1, ...cases.map(() => 1)];
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const available = Math.max(1, width - gap * (weights.length - 1));
  const columnWidth = (index: number): number => Math.max(1, (available * weights[index]) / totalWeight);

  const labelFamily = style.font.heading;
  const labelSize = style.type.label;
  const labelLineHeight = style.lineHeight.annotation;
  const cellFamily = style.font.body;
  const cellSize = style.type.body;
  const cellLineHeight = style.lineHeight.body;
  const unitSuffix = section.unit ? ` (${section.unit})` : "";

  let headerHeight = 0;
  cases.forEach((item, index) => {
    headerHeight = Math.max(
      headerHeight,
      textHeight(labelCase(style, `${item.label}${unitSuffix}`), labelFamily, labelSize, labelLineHeight, columnWidth(index + 1))
    );
  });
  headerHeight = Math.max(headerHeight, textHeight(labelCase(style, "Dimension"), labelFamily, labelSize, labelLineHeight, columnWidth(0)));

  const rowGap = style.spacing[1];
  let rowsHeight = 0;
  const criteria = section.criteria.length > 0 ? section.criteria : [""];
  for (const criterion of criteria) {
    let rowHeight = textHeight(criterion, labelFamily, labelSize, labelLineHeight, columnWidth(0));
    cases.forEach((item, index) => {
      const value = item.values[criterion];
      const text = value === null || value === undefined ? "—" : typeof value === "number" ? String(value) : value;
      rowHeight = Math.max(rowHeight, textHeight(text, cellFamily, cellSize, cellLineHeight, columnWidth(index + 1)));
    });
    rowsHeight += rowHeight + rowGap;
  }

  const emphasisNote = cases.some((entry) => entry.emphasis)
    ? blockHeight(1, style.type.caption, style.lineHeight.annotation) + style.spacing[1]
    : 0;
  const height = Math.round(headerHeight + rowsHeight + emphasisNote + style.spacing[2]);
  return { minHeight: height, preferredHeight: Math.round(height * 1.2) };
}

function chartRequirement(section: ChartSection, style: ResolvedStyle): SectionRequirement {
  const captionStep = step(style.type.caption, style.lineHeight.body);
  const captions = 1 + (section.chart.sourceNote ? 1 : 0) + (section.chart.missingPolicy && section.chart.missingPolicy !== "gap" ? 1 : 0);
  const legend = section.chart.series.length > 1 ? step(style.type.caption, style.lineHeight.body) + style.spacing[2] : 0;
  const axis = step(style.type.caption, style.lineHeight.body) + style.spacing[2];
  const plot = 140;
  const min = Math.round(plot + axis + legend + captions * captionStep + style.spacing[2]);
  return { minHeight: min, preferredHeight: Math.round(min + 120) };
}

function processRequirement(section: ProcessSection, width: number, style: ResolvedStyle): SectionRequirement {
  const badge = style.spacing[5];
  const titleStep = step(style.type.h3, style.lineHeight.body);
  const bodyStep = step(style.type.body, style.lineHeight.body);
  const metaStep = step(style.type.caption, style.lineHeight.body);
  const descriptions = section.steps.filter((entry) => entry.description).length;
  const stepHeight = Math.round(
    badge + style.spacing[2] + titleStep + (descriptions > 0 ? bodyStep * 2 : 0) + metaStep + style.spacing[2]
  );
  const vertical = section.layout === "vertical" || width < style.spacing[6] * 6;
  if (vertical) {
    const height = section.steps.length * stepHeight + Math.max(0, section.steps.length - 1) * style.spacing[3];
    return { minHeight: Math.round(height), preferredHeight: Math.round(height * 1.25) };
  }
  // Horizontal wraps: assume two rows are needed for anything above three steps
  // at a comfortable step width.
  const minStepWidth = Math.max(style.spacing[6], style.type.h3 * 8);
  const perRow = Math.max(1, Math.floor((width + style.spacing[3]) / (minStepWidth + style.spacing[3])));
  const rows = Math.ceil(section.steps.length / perRow);
  const height = rows * stepHeight + Math.max(0, rows - 1) * style.spacing[4];
  return { minHeight: Math.round(height), preferredHeight: Math.round(height * 1.2) };
}

function timelineRequirement(section: TimelineSection, style: ResolvedStyle, width: number): SectionRequirement {
  const labelStep = step(style.type.label, style.lineHeight.body);
  const captionStep = step(style.type.caption, style.lineHeight.body);
  const horizontal = width >= style.spacing[7] * 4;
  const labelTiers = section.milestones.length > 3 ? 2 : 1;
  if (horizontal) {
    const min = Math.round(style.spacing[5] + labelTiers * labelStep + captionStep + style.spacing[4]);
    return { minHeight: min, preferredHeight: Math.round(min + style.spacing[5]) };
  }
  const perMilestone = labelStep + captionStep + style.spacing[3];
  const min = Math.round(section.milestones.length * perMilestone + captionStep + style.spacing[3]);
  return { minHeight: min, preferredHeight: Math.round(min * 1.15) };
}

function hierarchyDepth(node: HierarchyNode): number {
  if (!node.children || node.children.length === 0) return 0;
  return 1 + Math.max(...node.children.map(hierarchyDepth));
}

function hierarchyRequirement(section: HierarchySection, style: ResolvedStyle): SectionRequirement {
  const nodeHeight = style.spacing[6];
  const rowGap = style.spacing[3];
  const levels = hierarchyDepth(section.root) + 1;
  const min = Math.round(levels * nodeHeight + (levels - 1) * rowGap);
  return { minHeight: min, preferredHeight: Math.round(min * 1.15) };
}

function diagramRequirement(section: DiagramSection, style: ResolvedStyle): SectionRequirement {
  const { maxLayer } = diagramLayers(section.diagram.nodes, section.diagram.edges);
  const nodeHeight = style.spacing[6];
  const gap = style.spacing[3];
  const levels = maxLayer + 1;
  const min = Math.round(levels * nodeHeight + (levels - 1) * gap);
  return { minHeight: min, preferredHeight: Math.round(min * 1.2) };
}

function quoteRequirement(section: QuoteSection, width: number, style: ResolvedStyle): SectionRequirement {
  const quoteStep = step(style.type.h2, style.lineHeight.heading);
  const lines = Math.max(2, textLines(section.data.quote, measureOk(width, style), style.type.h2, style.font.heading));
  const attribution = step(style.type.body, style.lineHeight.body);
  const min = Math.round(lines * quoteStep + attribution + style.spacing[2]);
  return { minHeight: min, preferredHeight: Math.round(min * 1.15) };
}

/**
 * Minimum and preferred height for a section at a given frame width.
 *
 * Width matters because wrapping does: the same paragraph needs more height in a
 * narrow column than in a wide one, and that is the whole reason a template
 * cannot pick its own frame sizes from a fixed table.
 */
export function estimateSectionHeight(
  section: InfographicSection,
  width: number,
  style: ResolvedStyle
): SectionRequirement {
  const safeWidth = Math.max(width, style.spacing[4]);
  let body: SectionRequirement;
  switch (section.kind) {
    case "text":
      body = textRequirement(section, safeWidth, style);
      break;
    case "statistic":
      body = statisticRequirement(section, safeWidth, style);
      break;
    case "comparison":
      body = comparisonRequirement(section, safeWidth, style);
      break;
    case "chart":
      body = chartRequirement(section, style);
      break;
    case "process":
      body = processRequirement(section, safeWidth, style);
      break;
    case "timeline":
      body = timelineRequirement(section, style, safeWidth);
      break;
    case "hierarchy":
      body = hierarchyRequirement(section, style);
      break;
    case "diagram":
      body = diagramRequirement(section, style);
      break;
    case "quote":
      body = quoteRequirement(section, safeWidth, style);
      break;
    default:
      body = { minHeight: style.spacing[6], preferredHeight: style.spacing[7] };
  }
  const chrome = sectionChromeHeight(style, {
    heading: Boolean(section.heading),
    evidence: (section.evidenceRefs?.length ?? 0) > 0,
    headingText: section.heading,
    width: safeWidth,
  });
  return {
    minHeight: Math.round(body.minHeight + chrome),
    preferredHeight: Math.round(body.preferredHeight + chrome),
  };
}

/**
 * Split a region into bands sized from what the sections actually need.
 *
 * A plain proportional split ignores floors: a 600px paragraph next to a 100px
 * caption can still hand the paragraph 30% of a short column and crack the copy.
 * This allocator gives every band its minimum first, then shares the leftover
 * space by preference, so generous space goes where it is useful and tight space
 * is tight *everywhere* rather than only where the math happened to fall.
 *
 * When even the minimums do not fit, the bands are scaled down proportionally
 * (never clipped silently) and the renderers report the overflow with px
 * attached — which is what `docs/12` §5 asks for: fail with an actionable
 * diagnostic instead of shrinking text below the legibility floor.
 */
export function allocateBands(
  rect: RectInfo,
  requirements: readonly SectionRequirement[],
  gap: number
): RectInfo[] {
  const count = requirements.length;
  if (count === 0) return [];
  const available = Math.max(0, rect.height - gap * (count - 1));
  const minSum = requirements.reduce((sum, entry) => sum + entry.minHeight, 0);
  const preferredSum = requirements.reduce((sum, entry) => sum + Math.max(entry.preferredHeight, entry.minHeight), 0);

  let heights: number[];
  if (minSum <= available) {
    const slack = available - minSum;
    const weightSum = preferredSum - minSum;
    heights = requirements.map((entry) => {
      const share = weightSum > 0 ? ((entry.preferredHeight - entry.minHeight) / weightSum) * slack : slack / count;
      return entry.minHeight + share;
    });
  } else {
    const factor = minSum > 0 ? available / minSum : 0;
    heights = requirements.map((entry) => entry.minHeight * factor);
  }

  // Integer rounding without drift: the last band absorbs the remainder so the
  // bands always tile the region exactly.
  const bands: RectInfo[] = [];
  let cursor = rect.y;
  let consumed = 0;
  heights.forEach((height, index) => {
    const rounded = index === count - 1 ? Math.max(0, available - consumed) : Math.round(height);
    consumed += rounded;
    bands.push({ x: rect.x, y: round(cursor), width: rect.width, height: rounded });
    cursor += rounded + gap;
  });
  return bands;
}

/** A placed frame that can be re-sized vertically from its section's needs. */
export interface AllocatableFrame {
  sectionId: string;
  frame: RectInfo;
}

export interface FrameAllocationResult {
  /** True when every frame received at least its measured minimum height. */
  fits: boolean;
  /** Minimum-minus-allocated height per section id (positive = shortfall, px). */
  shortfall: Record<string, number>;
}

/**
 * Re-allocate the vertical geometry of a page's frames from what the content
 * actually needs (docs/12 §5: measure → allocate → reject, never squeeze).
 *
 * Rows are derived from the frames' own top edges, so the template's row
 * alignment and column structure survive untouched — only `y`/`height` move,
 * `x`/`width` are never re-derived. A frame that spans several rows (a bento
 * hero, say) contributes its requirement to each row it covers and gets the
 * combined band back, so multi-row tiles stay coherent.
 *
 * `container` is the page region the frames may tile (safe area minus header);
 * when omitted the frames' own bounding box is used, which cannot grow a lone
 * frame — so callers that know the band should pass it.
 *
 * `fits` is false when even the measured minimums cannot be met; the caller
 * then paginates or rejects, rather than rendering a compressed band.
 */
export function allocateFrameRows(
  frames: readonly AllocatableFrame[],
  sectionById: ReadonlyMap<string, InfographicSection>,
  style: ResolvedStyle,
  gap: number,
  container?: RectInfo
): FrameAllocationResult {
  const shortfall: Record<string, number> = {};
  if (frames.length === 0) return { fits: true, shortfall };

  // Rows are the distinct top edges, in order. Frames sharing a top (a grid row
  // or a pair of bento tiles) share a row.
  const rowTops: number[] = [];
  for (const entry of frames) {
    const top = round(entry.frame.y);
    if (!rowTops.includes(top)) rowTops.push(top);
  }
  rowTops.sort((a, b) => a - b);

  const requirementAt = (entry: AllocatableFrame): SectionRequirement | null => {
    const section = sectionById.get(entry.sectionId);
    if (!section) return null;
    return estimateSectionHeight(section, Math.max(entry.frame.width, 1), style);
  };

  const rows: SectionRequirement[] = rowTops.map(() => ({ minHeight: 0, preferredHeight: 0 }));
  const covered: number[][] = frames.map((entry) => {
    const top = round(entry.frame.y);
    const bottom = round(entry.frame.y + entry.frame.height);
    const indices: number[] = [];
    rowTops.forEach((rowTop, index) => {
      if (rowTop >= top - 0.5 && rowTop <= bottom + 0.5) indices.push(index);
    });
    if (indices.length === 0) {
      const nearest = rowTops.reduce(
        (best, rowTop, index) => (Math.abs(rowTop - top) < Math.abs(rowTops[best] - top) ? index : best),
        0
      );
      indices.push(nearest);
    }
    return indices;
  });

  frames.forEach((entry, index) => {
    const requirement = requirementAt(entry);
    if (!requirement) return;
    const span = Math.max(1, covered[index].length);
    const min = Math.max(1, (requirement.minHeight - (span - 1) * gap) / span);
    const preferred = Math.max(min, (requirement.preferredHeight - (span - 1) * gap) / span);
    for (const row of covered[index]) {
      rows[row].minHeight = Math.max(rows[row].minHeight, min);
      rows[row].preferredHeight = Math.max(rows[row].preferredHeight, preferred);
    }
  });

  const left = Math.min(...frames.map((entry) => entry.frame.x));
  const right = Math.max(...frames.map((entry) => entry.frame.x + entry.frame.width));
  const bottom = Math.max(...frames.map((entry) => entry.frame.y + entry.frame.height));
  const band: RectInfo = container
    ? {
        x: container.x,
        y: Math.min(container.y, rowTops[0]),
        width: container.width,
        height: Math.max(1, container.y + container.height - Math.min(container.y, rowTops[0])),
      }
    : {
        x: left,
        y: rowTops[0],
        width: Math.max(1, right - left),
        height: Math.max(0, bottom - rowTops[0]),
      };
  const bands = allocateBands(band, rows, gap);

  frames.forEach((entry, index) => {
    const indices = covered[index];
    const first = bands[indices[0]];
    const last = bands[indices[indices.length - 1]];
    if (!first || !last) return;
    entry.frame.y = first.y;
    entry.frame.height = round(last.y + last.height - first.y);
  });

  let fits = true;
  frames.forEach((entry) => {
    const requirement = requirementAt(entry);
    if (!requirement) return;
    const deficit = round(requirement.minHeight - entry.frame.height);
    if (deficit > 0.5) {
      fits = false;
      shortfall[entry.sectionId] = Math.max(shortfall[entry.sectionId] ?? 0, deficit);
    }
  });

  return { fits, shortfall };
}
