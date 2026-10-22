/**
 * Information blocks: the content-bearing renderers that most infographic
 * templates are assembled from.
 *
 * These map 1:1 onto the docs/12 §A inventory — `hero-statistic`,
 * `metric-card`, `insight-callout`, `numbered-step`, `comparison-column` and the
 * plain prose block — and are deliberately **template-agnostic**: a template
 * decides *where* a block goes, never *how* the block reads. That split is what
 * lets the same source render as an editorial spread, a bento summary or a
 * carousel panel without the content code changing.
 *
 * Three invariants run through every block:
 * - **Meaning is never color-only.** A change carries an explicit sign and a
 *   direction word; an emphasis treatment carries a text marker; a state is
 *   stated in words as well as weight.
 * - **Unknown is not zero.** `null`/absent comparison values render as an
 *   explicit em dash and raise a diagnostic; they never become `0`.
 * - **Units are declared once.** A percentage-point change is never reported as
 *   a percent-of-percent (docs/12 §8 "mixed units").
 *
 * Everything here emits IR primitives only — no DOM, no strings of markup — so
 * the preview and the SVG exporter necessarily agree.
 */

import {
  chipPrimitives,
  evidenceNote,
  headingBlock,
  insetRect,
  layoutText,
  layoutTextForRole,
  labelCase,
  linePrimitive,
  rectBottom,
  rectPrimitive,
  rectRight,
  round,
  lineHeightForRole,
  typeStyle,
  surfacePrimitives,
  splitColumns,
  textBaseline,
  textLineWidth,
} from "./primitives";
import { baselineOffset, formatNumber, formatPercent, measureText } from "./measure";
import { mixHex } from "./color";
import type {
  ComparisonSection,
  InfographicPrimitive,
  QuoteSection,
  RectInfo,
  RenderResult,
  SectionKind,
  SectionRenderContext,
  SectionRenderer,
  StatisticSection,
  TextPrimitive,
  TextSection,
} from "./types";

/** Units that already *are* a proportion; a change in these is in points. */
const PERCENT_LIKE_UNITS = new Set(["%", "percent", "pct", "percentage", "pp"]);

export function isPercentLikeUnit(unit: string | undefined): boolean {
  return unit !== undefined && PERCENT_LIKE_UNITS.has(unit.trim().toLocaleLowerCase("en-US"));
}

interface SectionChrome {
  primitives: InfographicPrimitive[];
  /** Region left for the section body after heading and evidence footnote. */
  content: RectInfo;
  style: SectionRenderContext["style"];
}

/**
 * Reserve the shared chrome around a section body: an optional heading (with the
 * art direction's accent treatment) at the top and the evidence footnote pinned
 * to the bottom. Returns the remaining body region so blocks never have to guess
 * how much room the chrome took.
 */
export function sectionChrome(
  section: { id: string; heading?: string; evidenceRefs?: string[] },
  frame: RectInfo,
  context: SectionRenderContext,
  options?: { typeRole?: "h2" | "h3"; accent?: boolean; eyebrow?: string }
): SectionChrome {
  const style = context.style;
  const primitives: InfographicPrimitive[] = [];
  let cursor = frame.y;
  let bottom = rectBottom(frame);

  // The citation marker travels with the heading (right-aligned on its first
  // line) so it stays next to what it cites instead of floating at the frame's
  // foot; untitled sections get a small "Source [n]" line above the body.
  const note = evidenceNote({ x: frame.x, y: 0, width: frame.width, height: 0 }, section.evidenceRefs ?? [], style, context, {
    sourceLabel: section.heading ? undefined : "Source",
  });
  const noteWidth = note ? round(Math.min(frame.width * 0.3, textLineWidth(note, note.lines[0] ?? "") + 2)) : 0;

  // The marker shares the heading row only when the heading still sets on one
  // line beside it; otherwise it would cost the heading an extra line.
  const headingWidth = section.heading ? measureText(section.heading, typeStyle(style, options?.typeRole ?? "h3")) : 0;
  const inRow = Boolean(note && section.heading && headingWidth + noteWidth + style.spacing[1] <= frame.width);

  if (section.heading) {
    const reserve = inRow ? noteWidth + style.spacing[1] : 0;
    const heading = headingBlock(
      { x: frame.x, y: cursor, width: frame.width - reserve, height: frame.height },
      section.heading,
      style,
      context,
      {
        typeRole: options?.typeRole ?? "h3",
        accent: options?.accent ?? false,
        eyebrow: options?.eyebrow,
        role: "heading",
        semanticId: section.id,
      }
    );
    primitives.push(...heading.primitives);
    if (note && inRow) {
      const headingText = heading.primitives.find(
        (primitive): primitive is TextPrimitive => primitive.kind === "text" && primitive.role === "heading"
      );
      const lineTop = headingText ? headingText.y : cursor;
      const lineHeight = headingText ? round(headingText.fontSize * headingText.lineHeight) : note.height;
      note.x = round(frame.x + frame.width - noteWidth);
      note.width = noteWidth;
      note.align = "end";
      note.y = round(lineTop + (lineHeight - note.height) / 2);
      primitives.push(note);
    }
    cursor += heading.height + style.spacing[2];
    if (note && !inRow) {
      note.y = round(bottom - note.height);
      primitives.push(note);
      bottom -= note.height + style.spacing[1];
    }
  } else if (note) {
    note.y = round(cursor);
    primitives.push(note);
    cursor += note.height + style.spacing[1];
  }

  const content: RectInfo = {
    x: frame.x,
    y: round(cursor),
    width: frame.width,
    height: round(Math.max(0, bottom - cursor)),
  };
  return { primitives, content, style };
}

/** Report a body that exceeds its frame, with the px overflow the QA gates want. */
function reportOverflow(
  context: SectionRenderContext,
  sectionId: string,
  overflow: number,
  message: string
): void {
  context.report({
    code: "section-overflow",
    severity: "error",
    message,
    sectionId,
    overflow: round(overflow),
  });
}

// ---------------------------------------------------------------------------
// text
// ---------------------------------------------------------------------------

/** Plain prose: paragraphs plus optional bullets, flowing at the body rhythm. */
export function renderTextSection(
  section: TextSection,
  frame: RectInfo,
  context: SectionRenderContext
): RenderResult {
  const { primitives, content } = sectionChrome(section, frame, context, { accent: true });
  const style = context.style;
  const gap = style.spacing[style.density === "dense" ? 1 : 2];
  let cursor = content.y;

  for (const paragraph of section.paragraphs) {
    const remaining = Math.max(0, content.height - (cursor - content.y));
    const block = layoutTextForRole(
      {
        text: paragraph,
        box: { x: content.x, y: cursor, width: Math.min(content.width, style.measureMax), height: 0 },
        typeRole: "body",
        color: style.color.ink,
        role: "paragraph",
        semanticId: `${section.id}:paragraph`,
        maxHeight: round(remaining),
      },
      context
    );
    primitives.push(block.primitive);
    cursor += block.height + gap;
  }

  if (section.bullets && section.bullets.length > 0) {
    const markerSize = style.stroke.strong * 2;
    const markerGap = style.spacing[1];
    const bulletWidth = Math.min(content.width, style.measureMax);
    for (const bullet of section.bullets) {
      const remaining = Math.max(0, content.height - (cursor - content.y));
      const text = layoutTextForRole(
        {
          text: bullet,
          box: {
            x: content.x + markerSize + markerGap,
            y: cursor,
            width: bulletWidth - markerSize - markerGap,
            height: 0,
          },
          typeRole: "body",
          color: style.color.ink,
          role: "bullet",
          semanticId: `${section.id}:bullet`,
          maxHeight: round(remaining),
        },
        context
      );
      primitives.push(
        rectPrimitive(
          {
            x: content.x,
            y: round(cursor + text.primitive.fontSize * 0.45),
            width: markerSize,
            height: markerSize,
          },
          { fill: style.color.accent, radius: style.radius.pill, role: "bullet-marker" },
          context
        )
      );
      primitives.push(text.primitive);
      cursor += text.height + style.spacing[1];
    }
  }

  const used = round(cursor - content.y - gap);
  if (used > content.height) {
    reportOverflow(
      context,
      section.id,
      used - content.height,
      `Text section "${section.id}" needs ${used}px but has ${round(content.height)}px.`
    );
  }

  return { primitives, anchors: { [section.id]: content } };
}

// ---------------------------------------------------------------------------
// statistic (hero-statistic)
// ---------------------------------------------------------------------------

/**
 * The hero statistic. Reading order is value → measure → context → change, so a
 * glance lands on the number and the following lines explain it.
 *
 * The change line is where data integrity is easiest to lose: a statistic
 * measured in percent changes in **percentage points**, never in
 * percent-of-percent. When the unit is percent-like, this renderer reports the
 * absolute difference in `pp`; otherwise it reports the relative change. Either
 * way the sentence names the baseline it is comparing against.
 */
export function renderStatisticSection(
  section: StatisticSection,
  frame: RectInfo,
  context: SectionRenderContext
): RenderResult {
  const style = context.style;
  const hero = (section.importance ?? "supporting") === "hero";
  const { primitives, content } = sectionChrome(section, frame, context, { accent: !hero, typeRole: "h3" });
  const language = context.language;

  const valueRole = hero ? "statHuge" : "statLarge";
  const valueText = formatNumber(section.value, {
    precision: section.precision ?? 0,
    language,
  });
  const value = layoutTextForRole(
    {
      text: valueText,
      box: { x: content.x, y: content.y, width: content.width, height: 0 },
      typeRole: valueRole,
      color: style.color.ink,
      role: "stat-value",
      semanticId: section.id,
      maxLines: 1,
      shrink: { floor: style.type.statLarge * 0.6 },
    },
    context
  );
  primitives.push(value.primitive);
  let cursor = content.y + value.height;

  // Unit: a smaller suffix beside the value when it fits, otherwise the next line.
  if (section.unit) {
    const unitStyle = typeStyle(style, "h2");
    const unitWidth = measureText(section.unit, unitStyle);
    const unit = layoutText(
      {
        text: section.unit,
        box: { x: content.x, y: 0, width: Math.max(unitWidth, 1), height: 0 },
        style: unitStyle,
        lineHeight: lineHeightForRole(style, "h2"),
        color: style.color.inkMuted,
        role: "stat-unit",
        semanticId: `${section.id}:unit`,
        maxLines: 1,
      },
      context
    );
    const gap = style.spacing[0];
    const valueWidth = measureText(valueText, {
      fontSize: value.primitive.fontSize,
      family: value.primitive.family,
      letterSpacing: value.primitive.letterSpacing,
    });
    const inline = valueWidth + gap + unitWidth <= content.width + 0.5;
    if (inline) {
      // The unit sits beside the value, so the value's box must stop at its own
      // glyphs or the two text boxes would overlap (docs/12 §5 containment).
      // Baselines align, not box bottoms: line boxes of different sizes carry
      // different descender space, which left the unit hanging below the digits.
      value.primitive.width = round(Math.min(content.width, valueWidth));
      unit.primitive.x = round(content.x + valueWidth + gap);
      unit.primitive.y = round(textBaseline(value.primitive, 0) - baselineOffset(0, unit.primitive.fontSize, unit.primitive.lineHeight));
    } else {
      unit.primitive.x = content.x;
      unit.primitive.y = round(cursor + style.spacing[0]);
      cursor += unit.height + style.spacing[1];
    }
    primitives.push(unit.primitive);
  }

  cursor += style.spacing[1];

  const measureLabel = layoutTextForRole(
    {
      text: labelCase(style, section.measureLabel),
      box: { x: content.x, y: round(cursor), width: Math.min(content.width, style.measureMax), height: 0 },
      typeRole: "label",
      color: style.color.accent,
      role: "stat-measure",
      semanticId: `${section.id}:measure`,
    },
    context
  );
  primitives.push(measureLabel.primitive);

  const contextParts: string[] = [];
  if (section.denominator !== undefined && Number.isFinite(section.denominator)) {
    contextParts.push(`of ${formatNumber(section.denominator, { language })}`);
  }
  if (section.period) contextParts.push(section.period);

  // The measure label and its context (denominator + period) are given separate
  // lines. Sharing one line relies on the per-character advance model to reserve
  // the gap, but that model underestimates a real uppercase serif run: the
  // measured width of "OF LOOKUPS SERVED FROM CACHE" is ~348px while the
  // rendered glyphs run ~20px wider, so a fixed spacing[2] gap left the two runs
  // touching. Distinct lines cannot collide regardless of the font.
  let afterMeasure = cursor + measureLabel.height + style.spacing[1];
  if (contextParts.length > 0) {
    const contextText = contextParts.join(" · ");
    const note = layoutText(
      {
        text: contextText,
        box: { x: content.x, y: round(afterMeasure), width: Math.min(content.width, style.measureMax), height: 0 },
        style: typeStyle(style, "caption"),
        lineHeight: lineHeightForRole(style, "caption"),
        color: style.color.inkMuted,
        role: "stat-context",
        semanticId: `${section.id}:context`,
      },
      context
    );
    primitives.push(note.primitive);
    afterMeasure = round(afterMeasure + note.height + style.spacing[1]);
  }
  cursor = afterMeasure;

  if (section.baseline !== undefined && Number.isFinite(section.baseline)) {
    const baseline = section.baseline;
    const delta = section.value - baseline;
    const percentLike = isPercentLikeUnit(section.unit);
    const direction = delta === 0 ? "no change" : delta > 0 ? "increase" : "decrease";
    const magnitude = percentLike
      ? `${formatNumber(Math.abs(delta), { precision: section.precision ?? 1, language })} pp`
      : Number.isFinite(baseline) && baseline !== 0
        ? formatPercent(Math.abs(delta / baseline), 1, language)
        : `${formatNumber(Math.abs(delta), { precision: section.precision ?? 0, language })}`;
    const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
    const baselineText = `${formatNumber(baseline, { precision: section.precision ?? 0, language })}${section.unit ?? ""}`;
    const tone = delta === 0 ? style.color.inkMuted : delta > 0 ? style.color.positive : style.color.negative;
    const change = deltaPill(
      { x: content.x, y: round(cursor), width: Math.min(content.width, style.measureMax), height: 0 },
      `${sign}${magnitude} ${direction} vs ${baselineText} baseline`,
      tone,
      `${section.id}:change:${percentLike ? "points" : "percent"}`,
      context
    );
    primitives.push(...change.primitives);
    cursor += change.height;

    // A proportional meter makes a share legible at a glance: the fill is the
    // value, the tick is the baseline. Only drawn for 0–100 percent-like units,
    // where the track length means something.
    // The meter is supplementary — the words above already carry the facts —
    // so it is drawn only when the frame has room for it, never at the cost
    // of the statistic itself.
    if (percentLike && inUnitRange(section.value) && inUnitRange(baseline)) {
      const meterTop = cursor + style.spacing[3];
      const meter = meterPrimitives(
        { x: content.x, y: round(meterTop), width: Math.min(content.width, style.measureMax), height: 0 },
        section.value / 100,
        baseline / 100,
        `${section.id}:meter`,
        context
      );
      if (meterTop + meter.height <= content.y + content.height) {
        primitives.push(...meter.primitives);
        cursor = meterTop + meter.height;
      }
    }
  }

  const used = round(cursor - content.y);
  if (used > content.height) {
    reportOverflow(
      context,
      section.id,
      used - content.height,
      `Statistic "${section.id}" needs ${used}px but has ${round(content.height)}px.`
    );
  }

  return {
    primitives,
    anchors: {
      [section.id]: { x: content.x, y: content.y, width: content.width, height: round(Math.max(value.height, used)) },
    },
  };
}

function inUnitRange(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

/**
 * A change statement set in a tinted pill so it reads as a status, not body
 * copy. The words still carry sign, size, direction and baseline; colour only
 * reinforces them.
 */
export function deltaPill(
  box: RectInfo,
  text: string,
  tone: string,
  semanticId: string,
  context: SectionRenderContext
): { primitives: InfographicPrimitive[]; height: number } {
  const style = context.style;
  const textStyle = typeStyle(style, "body", { weight: style.weight.label });
  const padX = style.spacing[1];
  const padY = round(style.spacing[0] * 0.35);
  const label = layoutText(
    {
      text,
      box: { x: box.x + padX, y: box.y + padY, width: Math.max(0, box.width - padX * 2), height: 0 },
      style: textStyle,
      lineHeight: style.lineHeight.annotation,
      color: tone,
      role: "stat-change",
      semanticId,
      tabular: true,
    },
    context
  );
  const width = round(Math.min(box.width, label.wrap.width + padX * 2));
  const height = round(label.height + padY * 2);
  label.primitive.width = round(width - padX * 2);
  return {
    primitives: [
      rectPrimitive(
        { x: box.x, y: box.y, width, height },
        { fill: mixHex(tone, style.color.canvas, 0.88), radius: label.wrap.lines.length > 1 ? style.radius.md : style.radius.pill, role: "stat-change-pill" },
        context
      ),
      label.primitive,
    ],
    height,
  };
}

/**
 * Horizontal meter: track, value fill and a labelled baseline tick. `value`
 * and `baseline` are fractions of the track (0–1).
 */
export function meterPrimitives(
  box: RectInfo,
  value: number,
  baseline: number | undefined,
  semanticId: string,
  context: SectionRenderContext
): { primitives: InfographicPrimitive[]; height: number } {
  const style = context.style;
  const trackHeight = round(Math.max(8, style.spacing[1] * 0.75));
  const tickOverhang = round(trackHeight * 0.6);
  const top = round(box.y + tickOverhang);
  const fillWidth = round(box.width * Math.min(1, Math.max(0, value)));
  const primitives: InfographicPrimitive[] = [
    rectPrimitive(
      { x: box.x, y: top, width: box.width, height: trackHeight },
      { fill: style.color.surfaceAlt, radius: style.radius.pill, role: "meter-track", semanticId },
      context
    ),
  ];
  if (fillWidth > 0) {
    primitives.push(
      rectPrimitive(
        { x: box.x, y: top, width: Math.max(trackHeight, fillWidth), height: trackHeight },
        {
          fill: style.color.accent,
          gradient: { to: style.color.accentStrong, direction: "right" },
          radius: style.radius.pill,
          role: "meter-fill",
          semanticId: `${semanticId}:value`,
        },
        context
      )
    );
  }
  let height = trackHeight + tickOverhang * 2;
  if (baseline !== undefined) {
    const x = round(box.x + box.width * Math.min(1, Math.max(0, baseline)));
    primitives.push(
      linePrimitive(
        { x, y: round(top - tickOverhang) },
        { x, y: round(top + trackHeight + tickOverhang) },
        { stroke: style.color.ink, strokeWidth: style.stroke.rule, role: "meter-baseline", semanticId: `${semanticId}:baseline` }
        ,
        context
      )
    );
    const tagStyle = typeStyle(style, "caption", { family: style.font.body, weight: style.weight.body });
    const tagWidth = round(measureText("baseline", tagStyle) + 2);
    const tag = layoutText(
      {
        text: "baseline",
        // Centred under the tick, but never past the track's ends.
        box: {
          x: round(Math.min(Math.max(x - tagWidth / 2, box.x), box.x + box.width - tagWidth)),
          y: round(top + trackHeight + tickOverhang + style.spacing[0] * 0.5),
          width: tagWidth,
          height: 0,
        },
        style: tagStyle,
        lineHeight: style.lineHeight.annotation,
        color: style.color.inkSubtle,
        role: "meter-baseline-label",
        align: "center",
        maxLines: 1,
      },
      context
    );
    primitives.push(tag.primitive);
    height = round(tag.primitive.y + tag.height - box.y);
  }
  return { primitives, height };
}

// ---------------------------------------------------------------------------
// comparison (comparison-column)
// ---------------------------------------------------------------------------

const UNKNOWN_GLYPH = "—";

/** Format one comparison cell. `null`/absent is unknown and stays unknown. */
function comparisonCellText(value: string | number | null | undefined, language: string): string {
  if (value === null || value === undefined) return UNKNOWN_GLYPH;
  if (typeof value === "number") {
    return Number.isFinite(value) ? formatNumber(value, { language }) : UNKNOWN_GLYPH;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? UNKNOWN_GLYPH : trimmed;
}

function isUnknown(value: string | number | null | undefined): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim().length === 0);
}

/**
 * Side-by-side comparison with **synchronized row alignment**: every criterion
 * gets one row whose height is the tallest cell in that row, so a reader can
 * scan horizontally and compare like with like. Without that, differing value
 * lengths would silently break the comparison the block exists to enable.
 *
 * Unknown values are rendered as an explicit {@link UNKNOWN_GLYPH} and reported,
 * because a blank cell reads as "zero" to most audiences.
 */
export function renderComparisonSection(
  section: ComparisonSection,
  frame: RectInfo,
  context: SectionRenderContext
): RenderResult {
  const style = context.style;
  const { primitives, content } = sectionChrome(section, frame, context, { accent: true });
  const anchors: Record<string, RectInfo> = {};
  const labelColumnWeight = 1.1;
  const weights = [labelColumnWeight, ...section.cases.map(() => 1)];

  // Fit step: if the longest word in any column will not fit that column at
  // the reading size, drop to the compact size and tighter gutters before the
  // wrapper is ever forced to break inside a word.
  const longestWord = (texts: readonly string[], ref: { fontSize: number; family: string; weight?: number; letterSpacing?: number }) =>
    Math.max(0, ...texts.flatMap((text) => text.split(/\s+/)).map((word) => measureText(word, ref)));
  const words = [
    ...section.criteria,
    ...section.cases.flatMap((item) => [item.label, ...section.criteria.map((criterion) => comparisonCellText(item.values[criterion], context.language))]),
  ];
  const roomyGap = style.spacing[3];
  const roomyColumns = splitColumns(content, weights, roomyGap);
  const narrowest = Math.min(...roomyColumns.map((column) => column.width));
  // Height fit: measure the roomy table (header + every row at the reading
  // size) and use the compact rhythm when it would not fit the frame.
  const silent: SectionRenderContext = { ...context, id: () => "measure", report: () => undefined };
  const roomyHeight = (() => {
    const bodyRef = typeStyle(style, "body", { weight: style.weight.strong });
    const measureCell = (text: string, width: number) =>
      layoutText({ text, box: { x: 0, y: 0, width, height: 0 }, style: bodyRef, lineHeight: style.lineHeight.body, color: style.color.ink }, silent).height;
    const header = typeStyle(style, "caption").fontSize * style.lineHeight.annotation * 2;
    const rows = section.criteria.reduce((sum, criterion) => {
      const heights = [
        measureCell(criterion, roomyColumns[0].width),
        ...section.cases.map((item, index) => measureCell(comparisonCellText(item.values[criterion], context.language), roomyColumns[index + 1]?.width ?? 0)),
      ];
      return sum + Math.max(...heights) + style.spacing[2];
    }, 0);
    return header + style.spacing[2] + rows + style.spacing[4];
  })();
  const compact = longestWord(words, typeStyle(style, "body", { weight: style.weight.strong })) > narrowest || roomyHeight > content.height;
  const rowGap = compact ? style.spacing[1] : style.spacing[2];
  const columnGap = compact ? style.spacing[1] : roomyGap;
  const gridColumns = compact ? splitColumns(content, weights, columnGap) : roomyColumns;
  const labelColumn = gridColumns[0];
  const caseColumns = gridColumns.slice(1);

  if (section.cases.length === 0) {
    context.report({
      code: "comparison-empty",
      severity: "error",
      message: `Comparison "${section.id}" has no cases to compare.`,
      sectionId: section.id,
    });
    return { primitives, anchors };
  }

  // One reading size for labels and values; hierarchy comes from weight and
  // colour, so the criterion never reads smaller than the value beside it.
  const readingRole = compact ? "caption" : "body";
  const headerStyle = typeStyle(style, "caption", {
    family: style.font.body,
    weight: style.weight.strong,
    letterSpacing: compact ? 0 : style.letterSpacing.label,
    fontSize: compact ? round(style.type.caption * 0.85) : style.type.caption,
  });
  const criterionStyle = typeStyle(style, readingRole, { family: style.font.body, weight: style.weight.strong, letterSpacing: 0 });
  const cellStyle = typeStyle(style, readingRole, { family: style.font.body, weight: style.weight.body, letterSpacing: 0 });
  const unitSuffix = section.unit ? ` (${section.unit})` : "";

  // Header row: case labels, measured first so rows can start beneath them.
  let headerHeight = 0;
  const headerPrimitives: InfographicPrimitive[] = [];
  for (const [index, item] of section.cases.entries()) {
    const box = caseColumns[index];
    const label = layoutText(
      {
        text: compact ? `${item.label}${unitSuffix}` : labelCase(style, `${item.label}${unitSuffix}`),
        box: { x: box.x, y: content.y, width: box.width, height: 0 },
        style: headerStyle,
        color: item.emphasis ? style.color.accent : style.color.ink,
        role: "comparison-case-label",
        semanticId: item.id,
        lineHeight: style.lineHeight.annotation,
      },
      context
    );
    headerPrimitives.push(label.primitive);
    headerHeight = Math.max(headerHeight, label.height);
  }

  const markHeader = layoutText(
    {
      text: compact ? "Dimension" : labelCase(style, "Dimension"),
      box: { x: labelColumn.x, y: content.y, width: labelColumn.width, height: 0 },
      style: headerStyle,
      color: style.color.inkSubtle,
      role: "comparison-corner-label",
      lineHeight: style.lineHeight.annotation,
    },
    context
  );
  headerPrimitives.push(markHeader.primitive);
  headerHeight = Math.max(headerHeight, markHeader.height);

  // Emphasis panels are drawn behind the header and all rows, so compute the
  // full column extent first by measuring every row.
  const rowLayouts = section.criteria.map((criterion) => {
    const cells = section.cases.map((item) => {
      const raw = item.values[criterion];
      const text = comparisonCellText(raw, context.language);
      const unknown = isUnknown(raw);
      if (unknown) {
        context.report({
          code: "comparison-unknown",
          severity: "warning",
          message: `Comparison "${section.id}" has no value for "${item.label}" / "${criterion}"; rendered as unknown rather than zero.`,
          sectionId: section.id,
          targetId: item.id,
          path: `/sections/${section.id}/cases/${item.id}/values/${criterion}`,
        });
      }
      return { item, text, unknown };
    });
    return { criterion, cells };
  });

  // A gap between the header band and the first row, matching the inter-row
  // rhythm, so the first criterion is not jammed under the column headers.
  let cursor = content.y + headerHeight + rowGap;

  for (const row of rowLayouts) {
    let rowHeight = 0;
    const measured = row.cells.map((cell, index) => {
      const box = caseColumns[index];
      const text = layoutText(
        {
          text: cell.text,
          box: { x: box.x, y: cursor, width: box.width, height: 0 },
            style: cell.item.emphasis ? { ...cellStyle, weight: style.weight.label } : cellStyle,
          color: cell.unknown ? style.color.inkSubtle : style.color.ink,
          role: "comparison-value",
          semanticId: `${cell.item.id}:${row.criterion}`,
          lineHeight: compact ? style.lineHeight.annotation : style.lineHeight.body,
        },
        context
      );
      rowHeight = Math.max(rowHeight, text.height);
      return { ...cell, text: text.primitive, index };
    });

    const label = layoutText(
      {
        text: row.criterion,
        box: { x: labelColumn.x, y: cursor, width: labelColumn.width, height: 0 },
        style: criterionStyle,
        color: style.color.ink,
        role: "comparison-criterion-label",
        semanticId: row.criterion,
        lineHeight: compact ? style.lineHeight.annotation : style.lineHeight.body,
      },
      context
    );
    rowHeight = Math.max(rowHeight, label.height);

    primitives.push(label.primitive);
    measured.forEach((cell) => primitives.push(cell.text));
    primitives.push(
      linePrimitive(
        { x: content.x, y: round(cursor + rowHeight + rowGap / 2) },
        { x: rectRight(content), y: round(cursor + rowHeight + rowGap / 2) },
        { stroke: style.color.grid, strokeWidth: style.stroke.hairline, role: "comparison-row-rule" },
        context
      )
    );
    cursor += rowHeight + rowGap;
  }

  // Emphasis: a panel per emphasised case plus an explicit textual marker, so
  // the emphasis is not communicated by fill alone.
  const emphasised = section.cases.filter((item) => item.emphasis);
  const panels: InfographicPrimitive[] = [];
  section.cases.forEach((item, index) => {
    const box = caseColumns[index];
    const columnBox: RectInfo = {
      x: round(box.x - columnGap / 2),
      y: round(content.y - style.spacing[2]),
      width: round(box.width + columnGap),
      height: round(cursor - content.y + style.spacing[2] - rowGap / 2),
    };
    anchors[item.id] = columnBox;
    if (item.emphasis) {
      panels.push(
        rectPrimitive(
          { ...columnBox },
          { fill: mixHex(style.color.accent, style.color.canvas, 0.92), radius: style.radius.md, role: "comparison-emphasis-panel" },
          context
        )
      );
      panels.push(
        linePrimitive(
          { x: columnBox.x, y: columnBox.y },
          { x: rectRight(columnBox), y: columnBox.y },
          { stroke: style.color.accent, strokeWidth: style.stroke.strong, role: "comparison-emphasis-rule" },
          context
        )
      );
    }
  });

  // Paint order matters: the emphasis panel (a filled rect) must sit behind both
  // the column headers and the rows, or it covers the header text of the very
  // case it highlights (docs/12 §5). Panels first, then headers, then rows.
  const output = [...panels, ...headerPrimitives, ...primitives];

  if (emphasised.length > 0) {
    const marker = layoutText(
      {
        text: `Highlighted: ${emphasised.map((item) => item.label).join(", ")}`,
        box: { x: content.x, y: round(cursor + style.spacing[1]), width: content.width, height: 0 },
        style: typeStyle(style, "caption"),
        color: style.color.inkMuted,
        role: "comparison-emphasis-note",
        lineHeight: style.lineHeight.annotation,
      },
      context
    );
    output.push(marker.primitive);
  }

  const used = round(cursor - content.y);
  if (used > content.height) {
    reportOverflow(
      context,
      section.id,
      used - content.height,
      `Comparison "${section.id}" needs ${used}px but has ${round(content.height)}px; reduce rows or paginate.`
    );
  }

  return { primitives: output, anchors };
}

// ---------------------------------------------------------------------------
// quote
// ---------------------------------------------------------------------------

/** Pull quote with attribution placement options. */
export function renderQuoteSection(
  section: QuoteSection,
  frame: RectInfo,
  context: SectionRenderContext
): RenderResult {
  const style = context.style;
  const { primitives, content } = sectionChrome(section, frame, context, { accent: false });
  const placement = section.data.attributionPlacement ?? "below";
  const attributionStyle = typeStyle(style, "label");

  const attributionWidth = Math.min(
    content.width,
    measureText(section.data.attribution, attributionStyle) + style.spacing[2]
  );
  const quoteBox: RectInfo =
    placement === "right"
      ? {
          x: content.x,
          y: content.y,
          width: Math.max(0, content.width - attributionWidth - style.spacing[2]),
          height: content.height,
        }
      : content;

  // An oversized opening mark in the accent signals "quotation" before a word
  // is read; the quote itself sets in the display face at a lighter weight.
  const markSize = round(style.type.h2 * 2.4);
  const mark = layoutText(
    {
      text: "\u201C",
      box: { x: quoteBox.x, y: quoteBox.y, width: round(markSize * 0.6), height: 0 },
      style: { fontSize: markSize, family: style.font.display, weight: style.weight.display },
      lineHeight: 0.62,
      color: style.color.accent,
      role: "quote-mark",
      semanticId: `${section.id}:mark`,
      maxLines: 1,
    },
    context
  );
  // A quotation mark only inks the top third of its line box; trim the box to
  // the inked band so the quote can sit close beneath it without the two text
  // boxes overlapping (renderers place the glyph from `lineHeight`, not height).
  mark.primitive.height = round(markSize * 0.36);
  // The mark is ornament: keep it only when the quote and attribution still fit.
  const quoteMeasure = layoutTextForRole(
    {
      text: section.data.quote,
      box: { x: 0, y: 0, width: Math.min(quoteBox.width, style.measureMax * 1.15), height: 0 },
      typeRole: "h2",
      overrides: { family: style.font.display, weight: Math.max(400, style.weight.display - 100) },
      color: style.color.ink,
    },
    { ...context, id: () => "measure", report: () => undefined }
  );
  const attributionReserve = placement === "below" ? attributionStyle.fontSize * style.lineHeight.annotation * 2 + style.spacing[2] : 0;
  const withMark = mark.primitive.height + style.spacing[1] + quoteMeasure.height + attributionReserve <= quoteBox.height;
  if (withMark) primitives.push(mark.primitive);
  const quoteTop = withMark ? round(quoteBox.y + mark.primitive.height + style.spacing[1]) : quoteBox.y;
  const quote = layoutTextForRole(
    {
      text: section.data.quote,
      box: { x: quoteBox.x, y: quoteTop, width: Math.min(quoteBox.width, style.measureMax * 1.15), height: 0 },
      typeRole: "h2",
      overrides: { family: style.font.display, weight: Math.max(400, style.weight.display - 100) },
      color: style.color.ink,
      role: "quote-text",
      semanticId: section.id,
    },
    context
  );
  primitives.push(quote.primitive);
  const quoteBottom = quoteTop + quote.height;

  if (placement === "inline") {
    const lastLine = quote.wrap.lines[quote.wrap.lines.length - 1] ?? "";
    const lastLineWidth = measureText(lastLine, {
      fontSize: quote.primitive.fontSize,
      family: quote.primitive.family,
      letterSpacing: quote.primitive.letterSpacing,
    });
    const attributionText = `— ${section.data.attribution}`;
    const attributionWidth = measureText(attributionText, attributionStyle);
    const fitsInline = lastLineWidth + style.spacing[1] + attributionWidth <= quoteBox.width;
    const attribution = layoutText(
      {
        text: attributionText,
        box: {
          x: fitsInline ? round(quoteBox.x + lastLineWidth + style.spacing[1]) : quoteBox.x,
          y: fitsInline
            ? round(quoteBottom - style.type.label * style.lineHeight.annotation)
            : round(quoteBottom + style.spacing[0]),
          width: quoteBox.width,
          height: 0,
        },
        style: attributionStyle,
        color: style.color.inkMuted,
        role: "quote-attribution",
        semanticId: `${section.id}:attribution`,
        lineHeight: style.lineHeight.annotation,
      },
      context
    );
    primitives.push(attribution.primitive);
  } else if (placement === "right") {
    const attribution = layoutText(
      {
        text: section.data.attribution,
        box: { x: round(rectRight(quoteBox) + style.spacing[2]), y: content.y, width: attributionWidth, height: 0 },
        style: attributionStyle,
        color: style.color.inkMuted,
        role: "quote-attribution",
        semanticId: `${section.id}:attribution`,
        lineHeight: style.lineHeight.annotation,
      },
      context
    );
    primitives.push(attribution.primitive);
  } else {
    // A short accent rule leads into the attribution instead of a typed dash.
    const ruleWidth = style.spacing[3];
    const attributionTop = round(quoteBottom + style.spacing[2]);
    const attribution = layoutText(
      {
        text: labelCase(style, section.data.attribution),
        box: { x: round(quoteBox.x + ruleWidth + style.spacing[1]), y: attributionTop, width: Math.max(0, quoteBox.width - ruleWidth - style.spacing[1]), height: 0 },
        style: { ...attributionStyle, family: style.font.body, weight: style.weight.label },
        color: style.color.inkMuted,
        role: "quote-attribution",
        semanticId: `${section.id}:attribution`,
        lineHeight: style.lineHeight.annotation,
      },
      context
    );
    const ruleY = round(attributionTop + attribution.primitive.fontSize * style.lineHeight.annotation * 0.5);
    primitives.push(
      linePrimitive({ x: quoteBox.x, y: ruleY }, { x: round(quoteBox.x + ruleWidth), y: ruleY }, { stroke: style.color.accent, strokeWidth: style.stroke.strong, role: "quote-attribution-rule" }, context),
      attribution.primitive
    );
  }

  return { primitives, anchors: { [section.id]: { x: content.x, y: content.y, width: content.width, height: Math.min(content.height, quote.height) } } };
}

// ---------------------------------------------------------------------------
// Reusable blocks (used by templates and by consumers directly)
// ---------------------------------------------------------------------------

export interface MetricCardSpec {
  id: string;
  label: string;
  value: number;
  unit?: string;
  change?: number;
  /** How `change` should be read. `"points"` prints percentage points. */
  changeKind?: "absolute" | "percent" | "points";
  period?: string;
  baseline?: number;
  precision?: number;
  /** Optional raw series for a trend sparkline; needs ≥ 2 finite points. */
  sparkline?: number[];
  evidenceRefs?: string[];
  semanticId?: string;
}

/** Deterministic sparkline polyline across a small box. */
function sparklinePrimitives(
  box: RectInfo,
  values: readonly number[],
  context: SectionRenderContext
): InfographicPrimitive[] {
  const style = context.style;
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length < 2) return [];
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const step = box.width / (finite.length - 1);
  const points: Array<[number, number]> = finite.map((value, index) => [
    box.x + index * step,
    box.y + box.height - ((value - min) / span) * box.height,
  ]);
  // The polyline carries the trend shape; the dots mark the actual observations,
  // so a reader can tell a measured point from the line drawn between them.
  const primitives: InfographicPrimitive[] = [
    {
      kind: "polyline",
      id: context.id("sparkline"),
      role: "sparkline",
      points: points.map(([x, y]) => [round(x), round(y)] as [number, number]),
      fill: "none",
      stroke: style.color.accent,
      strokeWidth: style.stroke.rule,
    },
  ];
  points.forEach(([x, y]) => {
    primitives.push(
      rectPrimitive(
        {
          x: round(x - style.stroke.hairline),
          y: round(y - style.stroke.hairline),
          width: style.stroke.strong,
          height: style.stroke.strong,
        },
        { fill: style.color.accent, radius: style.radius.pill, role: "sparkline-point" },
        context
      )
    );
  });
  return primitives;
}

/**
 * A metric card: one measurement, its change, its reference period and an
 * optional trend. Card-level chrome (fill/border/shadow) follows the art
 * direction's `surface` flags, so the same block reads flat under `editorial`
 * and panelised under `minimal-technical`.
 */
export function metricCardBlock(
  context: SectionRenderContext,
  frame: RectInfo,
  spec: MetricCardSpec
): RenderResult {
  const style = context.style;
  const padding = style.spacing[2];
  const inner = insetRect(frame, padding);
  const primitives: InfographicPrimitive[] = [
    ...surfacePrimitives(frame, style, context, { role: "metric-card-surface", semanticId: spec.semanticId ?? spec.id }),
  ];

  const label = layoutTextForRole(
    {
      text: labelCase(style, spec.label),
      box: { x: inner.x, y: inner.y, width: inner.width, height: 0 },
      typeRole: "label",
      color: style.color.inkMuted,
      role: "metric-label",
      semanticId: `${spec.id}:label`,
    },
    context
  );
  primitives.push(label.primitive);

  const valueText = formatNumber(spec.value, { precision: spec.precision ?? 0, language: context.language });
  const value = layoutTextForRole(
    {
      text: spec.unit ? `${valueText}${isPercentLikeUnit(spec.unit) ? spec.unit : ` ${spec.unit}`}` : valueText,
      box: { x: inner.x, y: round(inner.y + label.height + style.spacing[0]), width: inner.width, height: 0 },
      typeRole: "statLarge",
      color: style.color.ink,
      role: "metric-value",
      semanticId: spec.id,
      maxLines: 1,
      shrink: { floor: style.type.h3 },
    },
    context
  );
  primitives.push(value.primitive);
  let cursor = value.primitive.y + value.height + style.spacing[1];

  if (spec.change !== undefined && Number.isFinite(spec.change)) {
    const kind = spec.changeKind ?? (isPercentLikeUnit(spec.unit) ? "points" : "absolute");
    const magnitude =
      kind === "percent"
        ? formatPercent(Math.abs(spec.change), 1, context.language)
        : `${formatNumber(Math.abs(spec.change), { precision: spec.precision ?? 1, language: context.language })}${kind === "points" ? " pp" : ""}`;
    const sign = spec.change > 0 ? "+" : spec.change < 0 ? "−" : "±";
    const direction = spec.change === 0 ? "no change" : spec.change > 0 ? "up" : "down";
    const change = layoutTextForRole(
      {
        text: `${sign}${magnitude} ${direction}`,
        box: { x: inner.x, y: round(cursor), width: inner.width, height: 0 },
        typeRole: "body",
        color: spec.change === 0 ? style.color.inkMuted : spec.change > 0 ? style.color.positive : style.color.negative,
        role: "metric-change",
        semanticId: `${spec.id}:change:${kind}`,
        maxLines: 1,
      },
      context
    );
    primitives.push(change.primitive);
    cursor += change.height + style.spacing[0];
  }

  if (spec.period) {
    const period = layoutText(
      {
        text: spec.period,
        box: { x: inner.x, y: round(cursor), width: inner.width, height: 0 },
        style: typeStyle(style, "caption"),
        color: style.color.inkSubtle,
        role: "metric-period",
        semanticId: `${spec.id}:period`,
        lineHeight: style.lineHeight.annotation,
      },
      context
    );
    primitives.push(period.primitive);
    cursor += period.height + style.spacing[0];
  }

  if (spec.sparkline && spec.sparkline.length > 0) {
    const finiteCount = spec.sparkline.filter((value) => Number.isFinite(value)).length;
    if (finiteCount < 2) {
      context.report({
        code: "sparkline-insufficient-data",
        severity: "warning",
        message: `Metric "${spec.id}" has ${finiteCount} usable sparkline point(s); a trend needs at least 2. The value is still shown.`,
        targetId: spec.id,
      });
    } else {
      const chartHeight = Math.min(style.spacing[5], Math.max(style.spacing[3], inner.height - (cursor - inner.y) - style.spacing[1]));
      if (chartHeight > style.spacing[2]) {
        const chartBox: RectInfo = { x: inner.x, y: round(cursor), width: inner.width, height: round(chartHeight) };
        primitives.push(...sparklinePrimitives(chartBox, spec.sparkline, context));
      }
    }
  }

  const note = evidenceNote(
    { x: inner.x, y: round(rectBottom(inner) - style.type.caption * style.lineHeight.annotation), width: inner.width, height: 0 },
    spec.evidenceRefs ?? [],
    style,
    context
  );
  if (note) primitives.push(note);

  return {
    primitives,
    anchors: { [spec.id]: { x: inner.x, y: value.primitive.y, width: inner.width, height: value.height } },
  };
}

export interface InsightCalloutSpec {
  id: string;
  claim: string;
  evidenceRefs?: string[];
  emphasis?: "primary" | "secondary";
  /** Explicit citation line when the caller does not use evidence refs. */
  evidenceNoteText?: string;
  semanticId?: string;
}

/**
 * A key claim with its evidence reference. docs/12 is explicit that a callout
 * must never float unlabeled over a data series, so a callout without evidence
 * is rendered *and* reported — the author sees the problem instead of shipping it.
 */
export function insightCalloutBlock(
  context: SectionRenderContext,
  frame: RectInfo,
  spec: InsightCalloutSpec
): RenderResult {
  const style = context.style;
  const emphasis = spec.emphasis ?? "primary";
  const padding = style.spacing[2];
  const inner = insetRect(frame, padding);
  const primitives: InfographicPrimitive[] = [
    ...surfacePrimitives(frame, style, context, {
      role: "callout-surface",
      fill: emphasis === "primary" ? style.color.surfaceAlt : style.color.surface,
      semanticId: spec.semanticId ?? spec.id,
    }),
    rectPrimitive(
      { x: frame.x, y: frame.y, width: style.stroke.strong, height: frame.height },
      { fill: style.color.accent, role: "callout-accent-bar" },
      context
    ),
  ];

  const headline = layoutTextForRole(
    {
      text: labelCase(style, emphasis === "primary" ? "Key insight" : "Note"),
      box: { x: inner.x, y: inner.y, width: inner.width, height: 0 },
      typeRole: "label",
      color: style.color.accent,
      role: "callout-eyebrow",
      semanticId: `${spec.id}:eyebrow`,
    },
    context
  );
  primitives.push(headline.primitive);

  const claim = layoutTextForRole(
    {
      text: spec.claim,
      box: {
        x: inner.x,
        y: round(inner.y + headline.height + style.spacing[1]),
        width: Math.min(inner.width, style.measureMax),
        height: 0,
      },
      typeRole: emphasis === "primary" ? "h3" : "body",
      color: style.color.ink,
      role: "callout-claim",
      semanticId: spec.id,
    },
    context
  );
  primitives.push(claim.primitive);

  const refs = spec.evidenceRefs ?? [];
  const note = refs.length > 0
    ? evidenceNote(
        { x: inner.x, y: round(inner.y + headline.height + claim.height + style.spacing[1] * 2), width: inner.width, height: 0 },
        refs,
        style,
        context
      )
    : spec.evidenceNoteText
      ? layoutText(
          {
            text: spec.evidenceNoteText,
            box: { x: inner.x, y: round(inner.y + headline.height + claim.height + style.spacing[1] * 2), width: inner.width, height: 0 },
            style: typeStyle(style, "caption", { family: style.font.mono }),
            color: style.color.inkSubtle,
            role: "callout-evidence",
            semanticId: `${spec.id}:evidence`,
            lineHeight: style.lineHeight.annotation,
          },
          context
        ).primitive
      : null;

  if (note) primitives.push(note);

  if (refs.length === 0 && !spec.evidenceNoteText) {
    context.report({
      code: "callout-without-evidence",
      severity: "warning",
      message: `Callout "${spec.id}" states a claim with no evidence reference. Add evidenceRefs or evidenceNoteText.`,
      targetId: spec.id,
    });
  }

  return {
    primitives,
    anchors: { [spec.id]: { x: inner.x, y: claim.primitive.y, width: inner.width, height: claim.height } },
  };
}

export type StepState = "default" | "active" | "done" | "optional";

export interface NumberedStepSpec {
  id: string;
  /** 1-based position. Kept explicit so numbering survives reflow and reorder. */
  index: number;
  total: number;
  title: string;
  description?: string;
  state?: StepState;
  /** Draw a card surface behind the step (when the art direction has surfaces). @default false */
  surface?: boolean;
  /** Extra relationship words for the meta line, e.g. "branches to 2 paths". */
  note?: string;
  /**
   * `stacked` puts the badge above the text (columns, horizontal flows);
   * `inline` puts it in a left gutter beside the text (vertical flows, lists),
   * which keeps each step as short as its words. @default "stacked"
   */
  layout?: "stacked" | "inline";
  semanticId?: string;
}

const STEP_STATE_WORDS: Record<StepState, string | null> = {
  default: null,
  active: "current",
  done: "complete",
  optional: "optional",
};

/** Badge diameter for numbered steps; shared so flows can align tracks to it. */
export function stepBadgeSize(style: SectionRenderContext["style"]): number {
  return round(Math.max(style.type.label * 2.2, style.spacing[3] + style.spacing[0]));
}

/** Inner padding of a step, zero when the art direction draws no card. */
export function stepPadding(style: SectionRenderContext["style"], surface: boolean | undefined): number {
  return surface && style.surface.fill ? style.spacing[2] : 0;
}

/**
 * A numbered step: badge, title, a quiet meta line and the description,
 * stacked so narrow columns keep their full measure for the words.
 *
 * The number is an explicit `index`, never an array position, so numbering
 * stays correct when a template reflows or the author reorders steps
 * (docs/12: "consistent numbering through reflow"). State is carried by the
 * badge (tint = upcoming, solid = current/complete, dashed = optional) *and*
 * stated in words on the meta line.
 *
 * Anchors: `<id>` (content), `<id>:badge`, `<id>:start`/`<id>:end` (mid-edge
 * ports) and `<id>:natural` — the frame-relative box the content actually
 * needs, which flows use to size rows to their content instead of stretching.
 */
export function numberedStepBlock(
  context: SectionRenderContext,
  frame: RectInfo,
  spec: NumberedStepSpec
): RenderResult {
  const style = context.style;
  const state = spec.state ?? "default";
  const padding = stepPadding(style, spec.surface);
  const primitives: InfographicPrimitive[] = [];

  if (spec.surface) {
    primitives.push(
      ...surfacePrimitives(frame, style, context, { role: "step-surface", semanticId: spec.semanticId ?? spec.id, radius: style.radius.lg })
    );
  }

  const inner = insetRect(frame, padding);
  const badgeSize = stepBadgeSize(style);
  const solid = state === "active" || state === "done";
  const base = style.surface.fill && spec.surface ? style.color.surface : style.color.canvas;
  const badgeBox: RectInfo = { x: inner.x, y: inner.y, width: badgeSize, height: badgeSize };

  primitives.push(
    rectPrimitive(
      badgeBox,
      {
        fill: solid ? style.color.accent : state === "optional" ? base : mixHex(style.color.accent, base, 0.86),
        gradient: solid ? { to: style.color.accentStrong, direction: "down" } : undefined,
        stroke: state === "optional" ? style.color.accent : undefined,
        strokeWidth: state === "optional" ? style.stroke.rule : undefined,
        dash: state === "optional" ? "dashed" : undefined,
        radius: style.radius.pill,
        role: "step-badge",
        semanticId: spec.id,
      },
      context
    )
  );

  const badgeLabel = layoutText(
    {
      text: String(spec.index),
      box: badgeBox,
      style: typeStyle(style, "label", { family: style.font.display, weight: style.weight.strong, letterSpacing: 0 }),
      color: solid ? style.color.onAccent : style.color.accentStrong,
      role: "step-number",
      semanticId: `${spec.id}:number`,
      align: "center",
      valign: "middle",
      maxLines: 1,
      lineHeight: 1.1,
      tabular: true,
    },
    context
  );
  primitives.push(badgeLabel.primitive);

  const inline = spec.layout === "inline";
  const textX = inline ? round(rectRight(badgeBox) + style.spacing[1]) : inner.x;
  const textWidth = Math.max(0, rectRight(inner) - textX);
  // Inline: the title's first line is centred on the badge.
  const titleLine = style.type.h3 * style.lineHeight.heading;
  let cursor = inline ? inner.y + Math.max(0, (badgeSize - titleLine) / 2) : rectBottom(badgeBox) + style.spacing[1];
  const title = layoutTextForRole(
    {
      text: spec.title,
      box: { x: textX, y: round(cursor), width: textWidth, height: 0 },
      typeRole: "h3",
      color: style.color.ink,
      role: "step-title",
      semanticId: `${spec.id}:title`,
    },
    context
  );
  primitives.push(title.primitive);
  cursor += title.height + style.spacing[0] * 0.5;

  const stateWord = STEP_STATE_WORDS[state];
  const metaText = [`Step ${spec.index} of ${spec.total}`, stateWord, spec.note].filter(Boolean).join(" · ");
  const meta = layoutText(
    {
      // Sentence case in the IR: all-caps strings can be spelled out letter by
      // letter by assistive tech, so emphasis comes from weight and tracking.
      text: metaText,
      box: { x: textX, y: round(cursor), width: textWidth, height: 0 },
      style: typeStyle(style, "caption", { family: style.font.body, weight: style.weight.label, letterSpacing: style.letterSpacing.label }),
      color: style.color.inkSubtle,
      role: "step-meta",
      semanticId: `${spec.id}:meta`,
      lineHeight: style.lineHeight.annotation,
    },
    context
  );
  primitives.push(meta.primitive);
  cursor += meta.height;

  if (spec.description) {
    cursor += style.spacing[1];
    const description = layoutTextForRole(
      {
        text: spec.description,
        box: { x: textX, y: round(cursor), width: textWidth, height: 0 },
        typeRole: "body",
        color: style.color.inkMuted,
        role: "step-description",
        semanticId: `${spec.id}:description`,
      },
      context
    );
    primitives.push(description.primitive);
    cursor += description.height;
  }

  const bodyHeight = round(Math.max(cursor - inner.y, badgeSize));
  return {
    primitives,
    anchors: {
      [spec.id]: { x: inner.x, y: inner.y, width: inner.width, height: bodyHeight },
      [`${spec.id}:badge`]: badgeBox,
      [`${spec.id}:natural`]: { x: frame.x, y: frame.y, width: frame.width, height: round(bodyHeight + padding * 2) },
      [`${spec.id}:start`]: { x: frame.x, y: round(frame.y + frame.height / 2), width: style.stroke.hairline, height: style.stroke.hairline },
      [`${spec.id}:end`]: { x: round(rectRight(frame) - style.stroke.hairline), y: round(frame.y + frame.height / 2), width: style.stroke.hairline, height: style.stroke.hairline },
    },
  };
}

/** A vertical stack of metric cards, used by the bento and summary templates. */
export function metricStackBlock(
  context: SectionRenderContext,
  frame: RectInfo,
  cards: readonly MetricCardSpec[],
  options?: { gap?: number }
): RenderResult {
  const gap = options?.gap ?? context.style.spacing[2];
  const primitives: InfographicPrimitive[] = [];
  const anchors: Record<string, RectInfo> = {};
  if (cards.length === 0) return { primitives, anchors };
  const height = (frame.height - gap * (cards.length - 1)) / cards.length;
  cards.forEach((card, index) => {
    const box: RectInfo = { x: frame.x, y: round(frame.y + index * (height + gap)), width: frame.width, height: round(height) };
    const result = metricCardBlock(context, box, card);
    primitives.push(...result.primitives);
    Object.assign(anchors, result.anchors);
  });
  return { primitives, anchors };
}

/** A row of chips summarizing tags/units; used by headers and footers. */
export function chipRowBlock(
  context: SectionRenderContext,
  frame: RectInfo,
  labels: readonly string[],
  options?: { gap?: number }
): RenderResult {
  const gap = options?.gap ?? context.style.spacing[1];
  const primitives: InfographicPrimitive[] = [];
  let x = frame.x;
  for (const label of labels) {
    if (x >= rectRight(frame)) break;
    const chip = chipPrimitives({ x, y: frame.y, width: rectRight(frame) - x, height: frame.height }, label, context.style, context);
    primitives.push(...chip.primitives);
    x += chip.width + gap;
  }
  return { primitives };
}

/** Everything this module can render as a section. */
export const BLOCK_RENDERERS: Partial<Record<SectionKind, SectionRenderer>> = {
  text: renderTextSection as SectionRenderer,
  statistic: renderStatisticSection as SectionRenderer,
  comparison: renderComparisonSection as SectionRenderer,
  quote: renderQuoteSection as SectionRenderer,
};

/** The section kinds handled by {@link BLOCK_RENDERERS}. */
export const BLOCK_SECTION_KINDS: readonly SectionKind[] = ["text", "statistic", "comparison", "quote"];
