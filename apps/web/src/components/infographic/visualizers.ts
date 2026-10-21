/**
 * Structure visualizers: process flow, timeline, hierarchy and general diagram.
 *
 * These are the P0 "B" items from docs/12 §B. They share one idea: a visualizer
 * owns the *geometry* of a relationship graph, and the art direction owns how
 * that geometry is painted. Nothing here decides colors or type sizes directly —
 * it asks {@link ResolvedStyle} — which is why the same process flow reads as a
 * print diagram under `editorial` and as a dark stage under `cinematic`.
 *
 * Accessibility contract for every visualizer in this file: **structure must be
 * recoverable from text alone.** A dashed connector means nothing to a screen
 * reader, so each semantic distinction (optional step, parallel branch, repeated
 * loop, interval milestone, tree depth, edge direction) is also stated in an
 * emitted text primitive. A diagram that only *looks* like a diagram is not done.
 */

import { mixHex } from "./color";
import {
  clamp,
  connectorPrimitives,
  elevationFor,
  layoutText,
  labelCase,
  linePrimitive,
  rectBottom,
  rectCenter,
  rectPrimitive,
  rectRight,
  round,
  typeStyle,
  lineHeightForRole,
} from "./primitives";
import { numberedStepBlock, sectionChrome } from "./blocks";
import { formatMilestoneLabel, hasTemporalScale, measureText, milestoneSortKey } from "./measure";
import type {
  DiagramEdge,
  DiagramNode,
  DiagramSection,
  HierarchyNode,
  HierarchySection,
  InfographicPrimitive,
  ProcessSection,
  ProcessStep,
  ProcessStepMode,
  RectInfo,
  RenderResult,
  SectionKind,
  SectionRenderContext,
  SectionRenderer,
  TextPrimitive,
  TimelineMilestone,
  TimelineScale,
  TimelineSection,
} from "./types";

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

/** Points at the middle of a rect's four edges; the connector-port vocabulary. */
export function edgePorts(box: RectInfo): {
  top: { x: number; y: number };
  right: { x: number; y: number };
  bottom: { x: number; y: number };
  left: { x: number; y: number };
} {
  const center = rectCenter(box);
  return {
    top: { x: round(center.x), y: round(box.y) },
    right: { x: round(rectRight(box)), y: round(center.y) },
    bottom: { x: round(center.x), y: round(rectBottom(box)) },
    left: { x: round(box.x), y: round(center.y) },
  };
}

/** Human-readable phrase for a step's relationship to its neighbours. */
function modeNote(mode: ProcessStepMode, branchCount: number): string | null {
  const parts: string[] = [];
  if (mode === "optional") parts.push("optional");
  if (mode === "parallel") parts.push("runs in parallel");
  if (mode === "repeated") parts.push("repeats");
  if (branchCount > 1) parts.push(`branches to ${branchCount} paths`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

// ---------------------------------------------------------------------------
// process-flow
// ---------------------------------------------------------------------------

export interface ProcessFlowSpec {
  id: string;
  direction: "horizontal" | "vertical";
  steps: readonly ProcessStep[];
}

interface PlacedStep {
  step: ProcessStep;
  index: number;
  /** Row-normalised card box (every card in a row shares the tallest height). */
  box: RectInfo;
  /** The step's number badge — the port connectors attach to. */
  badge: RectInfo;
  row: number;
  /** Flow direction at this position (false on serpentine return rows). */
  forward: boolean;
}

/** A context that measures without consuming ids or reporting diagnostics. */
function measuringContext(context: SectionRenderContext): SectionRenderContext {
  return { ...context, id: () => "measure", report: () => undefined };
}

/**
 * Lay out an ordered process as a stepper. Horizontal processes wrap into
 * extra rows and continue in **boustrophedon** order (left-to-right, then
 * right-to-left), so the reading order never jumps back across the canvas.
 *
 * Rows are sized to their content (the tallest step in the row), never
 * stretched to the frame, and connectors run badge-to-badge like a track: in
 * flat art directions the line spans the column, in panelled ones it bridges
 * the gutter between cards.
 */
export function processFlowBlock(
  context: SectionRenderContext,
  frame: RectInfo,
  spec: ProcessFlowSpec
): RenderResult {
  const style = context.style;
  const primitives: InfographicPrimitive[] = [];
  const anchors: Record<string, RectInfo> = {};
  const steps = spec.steps;

  if (steps.length === 0) {
    context.report({
      code: "process-empty",
      severity: "error",
      message: `Process "${spec.id}" has no steps to render.`,
      sectionId: spec.id,
    });
    return { primitives, anchors };
  }

  const vertical = spec.direction === "vertical";
  const panelled = style.surface.fill;
  const gap = vertical ? style.spacing[2] : style.spacing[panelled ? 3 : 4];
  const rowGap = style.spacing[4];
  const minStepWidth = round(Math.max(style.spacing[6] * 1.6, style.type.h3 * 6.5));

  type StepLayout = "stacked" | "inline";
  const stepSpec = (step: ProcessStep, index: number, layout: StepLayout) => {
    const branchCount = (step.nextIds ?? []).length;
    const mode = step.mode ?? "sequential";
    return {
      id: step.id,
      index: index + 1,
      total: steps.length,
      title: step.title,
      description: step.description,
      state: mode === "optional" ? ("optional" as const) : ("default" as const),
      note: modeNote(mode === "optional" ? "sequential" : mode, branchCount) ?? undefined,
      layout,
      surface: true,
      semanticId: step.id,
    };
  };

  // Pass 1: plan the grid by measuring natural heights without side effects.
  // Preference order: the roomy default (stacked badges, generous row gap);
  // then a tighter row gap; then inline badges; then more columns per row
  // (down to a readable minimum width), so a wrapped flow that would
  // overflow is re-flowed before anything is reported.
  const measure = measuringContext(context);
  const planFor = (columns: number, layout: StepLayout, rowSpacing: number) => {
    const rowCount = Math.ceil(steps.length / columns);
    const stepWidth = vertical ? frame.width : round((frame.width - gap * (columns - 1)) / columns);
    const natural = steps.map((step, index) => {
      const probe = numberedStepBlock(measure, { x: 0, y: 0, width: stepWidth, height: frame.height }, stepSpec(step, index, layout));
      return probe.anchors?.[`${step.id}:natural`]?.height ?? frame.height;
    });
    const rowHeights = Array.from({ length: rowCount }, (_, row) =>
      Math.max(...steps.map((_, index) => index).filter((index) => Math.floor(index / columns) === row).map((index) => natural[index]))
    );
    const total = round(rowHeights.reduce((sum, height) => sum + height, 0) + rowSpacing * (rowCount - 1));
    return { columns, layout, rowSpacing, rowCount, stepWidth, rowHeights, total };
  };
  const candidates: Array<ReturnType<typeof planFor>> = [];
  if (vertical) {
    candidates.push(planFor(1, "inline", gap));
  } else {
    const byWidth = Math.max(1, Math.floor((frame.width + gap) / (minStepWidth + gap)));
    const base = clamp(Math.min(byWidth, steps.length), 1, steps.length);
    candidates.push(planFor(base, "stacked", rowGap), planFor(base, "stacked", gap), planFor(base, "inline", gap));
    const readable = style.type.h3 * 4;
    for (let columns = base + 1; columns <= steps.length; columns += 1) {
      if ((frame.width - gap * (columns - 1)) / columns < readable) break;
      candidates.push(planFor(columns, "stacked", gap));
    }
  }
  const plan = candidates.find((candidate) => candidate.total <= frame.height + 0.5)
    ?? candidates.reduce((best, candidate) => (candidate.total < best.total ? candidate : best));
  const { columns: columnsPerRow, layout, rowSpacing, rowCount, stepWidth, rowHeights } = plan;
  const totalHeight = plan.total;
  if (totalHeight > frame.height + 0.5) {
    reportOverflow(
      context,
      spec.id,
      totalHeight - frame.height,
      `Process "${spec.id}" needs ${round(totalHeight)}px for ${rowCount} row(s) but has ${round(frame.height)}px.`
    );
  }

  // Pass 2: place and draw.
  const rowTops: number[] = [];
  rowHeights.reduce((y, height, row) => {
    rowTops[row] = round(y);
    return y + height + rowSpacing;
  }, frame.y);

  const placed: PlacedStep[] = [];
  steps.forEach((step, index) => {
    const row = vertical ? index : Math.floor(index / columnsPerRow);
    const indexInRow = vertical ? 0 : index % columnsPerRow;
    const serpentine = !vertical && row % 2 === 1;
    const column = serpentine ? columnsPerRow - 1 - indexInRow : indexInRow;
    const box: RectInfo = {
      x: round(frame.x + column * (stepWidth + gap)),
      y: rowTops[row],
      width: stepWidth,
      height: round(rowHeights[row]),
    };
    const result = numberedStepBlock(context, box, stepSpec(step, index, layout));
    primitives.push(...result.primitives);
    Object.assign(anchors, result.anchors);
    anchors[step.id] = box;
    const badge = result.anchors?.[`${step.id}:badge`] ?? { x: box.x, y: box.y, width: 0, height: 0 };
    placed.push({ step, index, box, badge, row, forward: !serpentine });
  });

  // Connectors: consecutive steps plus every explicit branch edge.
  const byId = new Map(placed.map((entry) => [entry.step.id, entry]));
  const edges: Array<{ from: PlacedStep; to: PlacedStep; mode: ProcessStepMode }> = [];
  placed.forEach((entry, index) => {
    const nextIds = entry.step.nextIds ?? [];
    if (nextIds.length > 0) {
      for (const nextId of nextIds) {
        const target = byId.get(nextId);
        if (target) edges.push({ from: entry, to: target, mode: entry.step.mode ?? "sequential" });
      }
    } else if (index + 1 < placed.length) {
      edges.push({ from: entry, to: placed[index + 1], mode: entry.step.mode ?? "sequential" });
    }
  });

  const portGap = style.spacing[0];
  for (const edge of edges) {
    const from = edge.from;
    const to = edge.to;
    const fromCenter = rectCenter(from.badge);
    const toCenter = rectCenter(to.badge);
    let start: { x: number; y: number };
    let end: { x: number; y: number };
    if (!vertical && from.row === to.row) {
      // Same row: a track at badge height. Flat directions span from badge to
      // badge; panelled ones bridge the gutter between the two cards.
      const rightward = to.box.x > from.box.x;
      const fromEdge = panelled ? (rightward ? rectRight(from.box) : from.box.x) : rightward ? rectRight(from.badge) : from.badge.x;
      const toEdge = panelled ? (rightward ? to.box.x : rectRight(to.box)) : rightward ? to.badge.x : rectRight(to.badge);
      start = { x: round(fromEdge + (rightward ? portGap : -portGap)), y: round(fromCenter.y) };
      end = { x: round(toEdge - (rightward ? portGap : -portGap)), y: round(toCenter.y) };
    } else {
      // Next row / vertical stack: drop from below the source to the target's top.
      const downward = to.box.y >= from.box.y;
      const fromY = vertical && !panelled ? rectBottom(from.badge) : downward ? rectBottom(from.box) : from.box.y;
      const toY = vertical && !panelled ? to.badge.y : downward ? to.box.y : rectBottom(to.box);
      start = { x: round(fromCenter.x), y: round(fromY + (downward ? portGap : -portGap)) };
      end = { x: round(toCenter.x), y: round(toY - (downward ? portGap : -portGap)) };
    }

    const dashed = edge.mode === "optional" || edge.mode === "repeated";
    const route = edge.mode === "repeated" ? "curve" : "orthogonal";
    const baseOptions = {
      style,
      route: route as "orthogonal" | "curve",
      color: dashed ? style.color.connectorMuted : style.color.connector,
      dash: dashed ? ("dashed" as const) : undefined,
      arrow: "arrow" as const,
      clearance: 0,
      role: "process-connector",
      semanticId: `${edge.from.step.id}->${edge.to.step.id}`,
    };

    if (edge.mode === "parallel") {
      // Two offset lines: a visual cue that the two steps run concurrently.
      const offset = style.stroke.connector * 2.5;
      const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
      const normal = horizontal ? { x: 0, y: offset } : { x: offset, y: 0 };
      for (const [sign, suffix] of [[-1, "a"], [1, "b"]] as const) {
        primitives.push(
          ...connectorPrimitives(
            { x: start.x + (normal.x / 2) * sign, y: start.y + (normal.y / 2) * sign },
            { x: end.x + (normal.x / 2) * sign, y: end.y + (normal.y / 2) * sign },
            { ...baseOptions, arrow: "none", semanticId: `${edge.from.step.id}->${edge.to.step.id}:${suffix}` },
            context
          )
        );
      }
      continue;
    }

    primitives.push(...connectorPrimitives(start, end, baseOptions, context));
  }

  if (!steps.some((step) => (step.nextIds ?? []).length === 0)) {
    context.report({
      code: "process-cycle",
      severity: "warning",
      message: `Process "${spec.id}" declares a successor for every step, so it has no terminal step.`,
      sectionId: spec.id,
    });
  }

  return { primitives, anchors };
}

/** Section-level process renderer: heading, evidence footnote, wrapped flow. */
export function renderProcessSection(
  section: ProcessSection,
  frame: RectInfo,
  context: SectionRenderContext
): RenderResult {
  const { primitives, content } = sectionChrome(section, frame, context, { accent: true });
  const direction = section.layout === "vertical" ? "vertical" : "horizontal";
  const result = processFlowBlock(context, content, {
    id: section.id,
    direction,
    steps: section.steps,
  });
  return { primitives: [...primitives, ...result.primitives], anchors: result.anchors };
}

// ---------------------------------------------------------------------------
// timeline-layout
// ---------------------------------------------------------------------------

export type TimelineOrientation = "horizontal" | "vertical";

export interface TimelineSpec {
  id: string;
  milestones: readonly TimelineMilestone[];
  scale?: TimelineScale;
  orientation: TimelineOrientation;
}

/**
 * Resolve the positioning policy for a timeline.
 *
 * The policy is a *disclosure*, not just an implementation detail: a timeline
 * whose points are evenly spaced is making a weaker claim than one positioned
 * proportionally to time, and docs/12 §8 requires the difference to be visible.
 * `policyFor` is therefore pure, exported and rendered as a caption.
 */
export function timelinePolicy(
  milestones: readonly TimelineMilestone[],
  scale?: TimelineScale
): { policy: "proportional" | "even" | "logarithmic"; caption: string } {
  const dated = hasTemporalScale(milestones.map((milestone) => milestone.at));
  if (scale === "ordinal" || !dated) {
    return { policy: "even", caption: "Positions evenly spaced · not to scale" };
  }
  if (scale === "log") {
    return { policy: "logarithmic", caption: "Positions scaled logarithmically" };
  }
  return { policy: "proportional", caption: "Positions proportional to time" };
}

function timelinePositions(
  milestones: readonly TimelineMilestone[],
  policy: "proportional" | "even" | "logarithmic"
): number[] {
  const count = milestones.length;
  if (count === 0) return [];
  if (count === 1) return [0.5];
  if (policy === "even") {
    return milestones.map((_, index) => index / (count - 1));
  }
  const keys = milestones.map((milestone, index) => {
    const value = milestoneSortKey(milestone.at, index);
    return policy === "logarithmic" ? Math.log(Math.max(value, 1)) : value;
  });
  const min = Math.min(...keys);
  const max = Math.max(...keys);
  const span = max - min;
  if (span <= 0) return milestones.map((_, index) => index / (count - 1));
  return keys.map((key) => (key - min) / span);
}

/**
 * Render a timeline along a rule, with alternating labels to avoid collisions.
 *
 * Sorting is deterministic: dated milestones sort by time, everything else keeps
 * source order (an ordinal scale must not silently reorder the author's list).
 * Labels alternate sides of the axis; when a label still cannot sit beside its
 * neighbour it moves to a second tier and raises `timeline-label-collision`
 * rather than being dropped.
 */
export function timelineBlock(
  context: SectionRenderContext,
  frame: RectInfo,
  spec: TimelineSpec
): RenderResult {
  const style = context.style;
  const primitives: InfographicPrimitive[] = [];
  const anchors: Record<string, RectInfo> = {};
  void spec.id;

  if (spec.milestones.length === 0) {
    context.report({
      code: "timeline-empty",
      severity: "error",
      message: `Timeline "${spec.id}" has no milestones to render.`,
      sectionId: spec.id,
    });
    return { primitives, anchors };
  }

  const datedFlags = spec.milestones.map((milestone) => !Number.isNaN(new Date(milestone.at).getTime()));
  if (datedFlags.some(Boolean) && !datedFlags.every(Boolean)) {
    context.report({
      code: "timeline-mixed-scale",
      severity: "warning",
      message: `Timeline "${spec.id}" mixes dated and undated milestones; positions were computed on the ${
        timelinePolicy(spec.milestones, spec.scale).policy
      } policy.`,
      sectionId: spec.id,
    });
  }

  const sorted = spec.milestones
    .map((milestone, index) => ({ milestone, index }))
    .sort((a, b) => {
      if (spec.scale === "ordinal") return a.index - b.index;
      const keyA = milestoneSortKey(a.milestone.at, a.index);
      const keyB = milestoneSortKey(b.milestone.at, b.index);
      return keyA === keyB ? a.index - b.index : keyA - keyB;
    })
    .map((entry) => entry.milestone);

  const { policy, caption: policyLabelText } = timelinePolicy(sorted, spec.scale);
  const ratios = timelinePositions(sorted, policy);
  const endRatios = sorted.map((milestone) =>
    milestone.kind === "interval" && milestone.endAt !== undefined
      ? timelinePositions([...sorted, { ...milestone, at: milestone.endAt as string }], policy)[sorted.length]
      : undefined
  );

  const titleStyle = typeStyle(style, "label", { family: style.font.heading, weight: style.weight.heading, letterSpacing: 0, fontSize: round(style.type.label * 1.1) });
  const dateStyle = typeStyle(style, "caption", { family: style.font.body, weight: style.weight.label });
  const descriptionStyle = typeStyle(style, "caption", { family: style.font.body, weight: style.weight.body });
  const markerSize = round(Math.max(style.spacing[1] * 1.25, style.stroke.strong * 5));
  const ring = Math.max(2, round(style.stroke.strong * 0.9));
  const stem = style.spacing[3];
  const blockGap = round(style.spacing[0] * 0.5);

  /** Title + date (+ description) stacked; measured first, positioned later. */
  const labelBlock = (milestone: TimelineMilestone, endAt: string | undefined, width: number, align: "start" | "center") => {
    const date = formatMilestoneLabel(milestone.at, context.language);
    const dateText = endAt ? `${date} – ${formatMilestoneLabel(endAt, context.language)}` : date;
    const parts = [
      layoutText({ text: milestone.label, box: { x: 0, y: 0, width, height: 0 }, style: titleStyle, lineHeight: style.lineHeight.heading, color: style.color.ink, role: "timeline-label", semanticId: milestone.id, align, maxLines: 2 }, context).primitive,
      layoutText({ text: dateText, box: { x: 0, y: 0, width, height: 0 }, style: dateStyle, lineHeight: style.lineHeight.annotation, color: style.color.accentStrong, role: "timeline-date", semanticId: `${milestone.id}:date`, align, maxLines: 1, tabular: true }, context).primitive,
    ];
    if (milestone.description) {
      parts.push(
        layoutText({ text: milestone.description, box: { x: 0, y: 0, width, height: 0 }, style: descriptionStyle, lineHeight: style.lineHeight.annotation, color: style.color.inkMuted, role: "timeline-description", semanticId: `${milestone.id}:description`, align, maxLines: 2 }, context).primitive
      );
    }
    const height = round(parts.reduce((sum, part) => sum + part.height, 0) + blockGap * (parts.length - 1));
    const place = (x: number, y: number) => {
      let cursor = y;
      for (const part of parts) {
        part.x = round(x);
        part.y = round(cursor);
        cursor += part.height + blockGap;
      }
      return parts;
    };
    return { height, place };
  };

  const marker = (cx: number, cy: number, milestoneId: string, endPoint?: { x: number; y: number }) => {
    if (endPoint) {
      const thickness = round(markerSize * 0.7);
      const box: RectInfo = endPoint.x !== cx
        ? { x: round(Math.min(cx, endPoint.x)), y: round(cy - thickness / 2), width: round(Math.abs(endPoint.x - cx) || markerSize), height: thickness }
        : { x: round(cx - thickness / 2), y: round(Math.min(cy, endPoint.y)), width: thickness, height: round(Math.abs(endPoint.y - cy) || markerSize) };
      primitives.push(rectPrimitive(box, { fill: style.color.accent, gradient: { to: style.color.accentStrong, direction: endPoint.x !== cx ? "right" : "down" }, radius: style.radius.pill, role: "timeline-interval-bar", semanticId: milestoneId }, context));
      anchors[milestoneId] = box;
      return;
    }
    const box: RectInfo = { x: round(cx - markerSize / 2), y: round(cy - markerSize / 2), width: markerSize, height: markerSize };
    primitives.push(rectPrimitive(box, { fill: style.color.canvas, stroke: style.color.accent, strokeWidth: ring, radius: style.radius.pill, role: "timeline-marker", semanticId: milestoneId }, context));
    anchors[milestoneId] = box;
  };

  const captionStyle = typeStyle(style, "caption", { family: style.font.body, weight: style.weight.body });
  const captionHeight = round(captionStyle.fontSize * style.lineHeight.annotation);
  let contentBottom = frame.y;

  if (spec.orientation === "vertical") {
    // Axis on the left, every label on the right. Positions stay proportional;
    // the span is only as long as the labels need, so three milestones do not
    // stretch down a whole poster.
    const labelX = round(frame.x + markerSize + style.spacing[3]);
    const labelWidth = Math.max(0, Math.min(rectRight(frame) - labelX, style.measureMax));
    const blocks = sorted.map((milestone, index) => labelBlock(milestone, endRatios[index] !== undefined ? milestone.endAt : undefined, labelWidth, "start"));
    const needed = blocks.reduce((sum, block) => sum + block.height, 0) + style.spacing[3] * blocks.length;
    const available = Math.max(0, frame.height - captionHeight - style.spacing[3]);
    const span = round(Math.min(available, Math.max(needed * 1.35, style.spacing[7])));
    const axisX = round(frame.x + markerSize / 2);
    const top = round(frame.y + markerSize / 2);
    primitives.push(linePrimitive({ x: axisX, y: top }, { x: axisX, y: round(top + span) }, { stroke: style.color.rule, strokeWidth: style.stroke.rule, role: "timeline-axis" }, context));

    let lastBottom = -Infinity;
    sorted.forEach((milestone, index) => {
      const y = round(top + ratios[index] * span);
      const end = endRatios[index] !== undefined ? { x: axisX, y: round(top + (endRatios[index] as number) * span) } : undefined;
      const titleHalf = round(titleStyle.fontSize * style.lineHeight.heading * 0.5);
      let labelY = round(y - titleHalf);
      if (labelY < lastBottom + style.spacing[2]) {
        labelY = round(lastBottom + style.spacing[2]);
        context.report({
          code: "timeline-label-collision",
          severity: "warning",
          message: `Timeline "${spec.id}" label for "${milestone.id}" was pushed below the previous label to keep both readable.`,
          sectionId: spec.id,
          targetId: milestone.id,
        });
      }
      primitives.push(
        ...connectorPrimitives(
          { x: round(axisX + markerSize / 2 + style.spacing[0] * 0.5), y },
          { x: round(labelX - style.spacing[1]), y: round(labelY + titleHalf) },
          { style, route: "orthogonal", arrow: "none", color: style.color.connectorMuted, width: style.stroke.hairline, clearance: 0, role: "timeline-tick", semanticId: `${milestone.id}:stem` },
          context
        )
      );
      marker(axisX, y, milestone.id, end);
      primitives.push(...blocks[index].place(labelX, labelY));
      lastBottom = labelY + blocks[index].height;
      contentBottom = Math.max(contentBottom, lastBottom, top + span);
    });
  } else {
    // Labels alternate above and below a centred axis; each sits on a stem so
    // its milestone is unambiguous even when neighbours crowd.
    const marginX = style.spacing[3];
    const span = Math.max(0, frame.width - marginX * 2);
    const left = frame.x + marginX;
    const columnWidth = Math.max(style.spacing[6] * 1.4, Math.min(style.type.label * 13, span / Math.max(2, Math.ceil(sorted.length / 2))));
    const blocks = sorted.map((milestone, index) => labelBlock(milestone, endRatios[index] !== undefined ? milestone.endAt : undefined, columnWidth, "center"));
    const tallest = Math.max(...blocks.map((block) => block.height));
    const lastRight: Record<"above" | "below", number> = { above: -Infinity, below: -Infinity };
    const tierOf: number[] = [];
    const sides: Array<"above" | "below"> = [];
    const xs = sorted.map((_, index) => round(left + ratios[index] * span));
    let maxTier = 0;
    sorted.forEach((milestone, index) => {
      const side: "above" | "below" = index % 2 === 0 ? "above" : "below";
      const labelLeft = clamp(xs[index] - columnWidth / 2, frame.x, rectRight(frame) - columnWidth);
      let tier = 0;
      if (labelLeft < lastRight[side] + style.spacing[1]) {
        tier = 1;
        context.report({
          code: "timeline-label-collision",
          severity: "warning",
          message: `Timeline "${spec.id}" label for "${milestone.id}" overlapped the previous label on the ${side} side; moved to tier 2.`,
          sectionId: spec.id,
          targetId: milestone.id,
        });
      }
      lastRight[side] = labelLeft + columnWidth;
      tierOf.push(tier);
      sides.push(side);
      maxTier = Math.max(maxTier, tier);
    });
    const band = tallest + stem + maxTier * (tallest + style.spacing[1]);
    const axisY = round(frame.y + band + markerSize / 2);
    primitives.push(linePrimitive({ x: left, y: axisY }, { x: round(left + span), y: axisY }, { stroke: style.color.rule, strokeWidth: style.stroke.rule, role: "timeline-axis" }, context));

    sorted.forEach((milestone, index) => {
      const x = xs[index];
      const side = sides[index];
      const reach = stem + tierOf[index] * (tallest + style.spacing[1]);
      const block = blocks[index];
      const labelX = round(clamp(x - columnWidth / 2, frame.x, rectRight(frame) - columnWidth));
      const labelY = side === "above" ? round(axisY - markerSize / 2 - reach - block.height) : round(axisY + markerSize / 2 + reach);
      primitives.push(
        linePrimitive(
          { x, y: side === "above" ? round(labelY + block.height + style.spacing[0] * 0.5) : round(axisY + markerSize / 2) },
          { x, y: side === "above" ? round(axisY - markerSize / 2) : round(labelY - style.spacing[0] * 0.5) },
          { stroke: style.color.connectorMuted, strokeWidth: style.stroke.hairline, role: "timeline-tick", semanticId: `${milestone.id}:stem` },
          context
        )
      );
      const end = endRatios[index] !== undefined ? { x: round(left + (endRatios[index] as number) * span), y: axisY } : undefined;
      marker(x, axisY, milestone.id, end);
      primitives.push(...block.place(labelX, labelY));
      contentBottom = Math.max(contentBottom, labelY + block.height, axisY + markerSize / 2);
    });
  }

  const policyCaption = layoutText(
    {
      text: policyLabelText,
      box: { x: frame.x, y: round(contentBottom + style.spacing[3]), width: frame.width, height: 0 },
      style: captionStyle,
      color: style.color.inkSubtle,
      role: "timeline-policy-caption",
      semanticId: `${spec.id}:policy`,
      lineHeight: style.lineHeight.annotation,
      maxLines: 1,
    },
    context
  );
  primitives.push(policyCaption.primitive);

  return { primitives, anchors };
}

/** Section-level timeline renderer. */
export function renderTimelineSection(
  section: TimelineSection,
  frame: RectInfo,
  context: SectionRenderContext
): RenderResult {
  const { primitives, content } = sectionChrome(section, frame, context, { accent: true });
  const direction: TimelineOrientation = content.width >= content.height ? "horizontal" : "vertical";
  const result = timelineBlock(context, content, {
    id: section.id,
    milestones: section.milestones,
    scale: section.scale,
    orientation: direction,
  });
  return { primitives: [...primitives, ...result.primitives], anchors: result.anchors };
}

// ---------------------------------------------------------------------------
// hierarchy-layout
// ---------------------------------------------------------------------------

export interface HierarchyLayoutOptions {
  nodeHeight: number;
  nodeGap: number;
  rowGap: number;
  /** Total width the tree should span; leaf slots subdivide it. */
  width: number;
  /** Cap on a node card's width; wide slots centre a narrower card. @default slot − nodeGap */
  maxNodeWidth?: number;
  origin?: { x: number; y: number };
}

export interface HierarchyLayoutResult {
  nodes: Array<{ id: string; node: HierarchyNode; box: RectInfo; depth: number }>;
  edges: Array<{ from: string; to: string }>;
  width: number;
  height: number;
  depth: number;
  leafCount: number;
}

/**
 * Pure tree geometry: allocate horizontal extent by **leaf count**, then centre
 * each parent over the span of its children (midpoint of its first and last
 * child centres).
 *
 * Leaf-count allocation is what guarantees no two nodes overlap regardless of
 * tree shape — a uniform grid cannot promise that, because a subtree with eight
 * leaves needs eight times the room of a leaf. Every card shares one width
 * (≤ one leaf slot), so a centred parent never reaches past its subtree. The
 * function is exported separately from rendering so the invariant can be
 * tested without a context.
 */
export function hierarchyLayout(
  root: HierarchyNode,
  options: HierarchyLayoutOptions
): HierarchyLayoutResult {
  const origin = options.origin ?? { x: 0, y: 0 };
  const nodeHeight = options.nodeHeight;
  const rowGap = options.rowGap;
  const nodeGap = options.nodeGap;

  let leafCursor = 0;
  let maxDepth = 0;
  const nodes: HierarchyLayoutResult["nodes"] = [];
  const edges: HierarchyLayoutResult["edges"] = [];

  const leafCountOf = (node: HierarchyNode): number => {
    const children = node.children ?? [];
    if (children.length === 0) return 1;
    return children.reduce((sum, child) => sum + leafCountOf(child), 0);
  };
  const totalLeaves = Math.max(1, leafCountOf(root));
  const slot = options.width / totalLeaves;
  const cardWidth = round(Math.max(0, Math.min(slot - nodeGap, options.maxNodeWidth ?? Infinity)));

  const place = (node: HierarchyNode, depth: number, centerX: number) => {
    const box: RectInfo = {
      x: round(centerX - cardWidth / 2),
      y: round(origin.y + depth * (nodeHeight + rowGap)),
      width: cardWidth,
      height: round(nodeHeight),
    };
    nodes.push({ id: node.id, node, box, depth });
    return centerX;
  };

  const walk = (node: HierarchyNode, depth: number): number => {
    maxDepth = Math.max(maxDepth, depth);
    const children = node.children ?? [];
    if (children.length === 0) {
      const index = leafCursor;
      leafCursor += 1;
      return place(node, depth, origin.x + (index + 0.5) * slot);
    }
    const centers = children.map((child) => {
      edges.push({ from: node.id, to: child.id });
      return walk(child, depth + 1);
    });
    return place(node, depth, (centers[0] + centers[centers.length - 1]) / 2);
  };

  walk(root, 0);
  return {
    nodes,
    edges,
    width: round(totalLeaves * slot),
    height: round((maxDepth + 1) * nodeHeight + maxDepth * rowGap),
    depth: maxDepth,
    leafCount: totalLeaves,
  };
}

// ---------------------------------------------------------------------------
// node-card (shared by hierarchy and diagram)
// ---------------------------------------------------------------------------

export type NodeCardEmphasis = "root" | "hero" | "normal";

export interface NodeCardContent {
  id: string;
  title: string;
  /** Small structural line stated in words (e.g. "Level 2", "Layer 1"). */
  meta?: string;
  description?: string;
  emphasis?: NodeCardEmphasis;
}

/**
 * Card type scales with the card: a roomy card earns an h3 title and more
 * padding, a narrow one stays at label size. One rule for every node-based
 * visualizer, so a tree and a graph at the same width read identically.
 */
function nodeCardStyles(style: SectionRenderContext["style"], width: number) {
  const roomy = width >= style.type.h3 * 8;
  return {
    title: typeStyle(style, "label", {
      family: style.font.heading,
      weight: style.weight.heading,
      letterSpacing: 0,
      fontSize: round(roomy ? style.type.h3 * 0.9 : style.type.label * 1.15),
    }),
    meta: typeStyle(style, "caption", { family: style.font.body, weight: style.weight.label, letterSpacing: style.letterSpacing.label, fontSize: round(style.type.caption * 0.85) }),
    description: typeStyle(style, "caption", { family: style.font.body, weight: style.weight.body }),
    padX: roomy ? style.spacing[3] : style.spacing[2],
    padY: roomy ? style.spacing[3] : round(style.spacing[1] * 1.25),
    gap: round(style.spacing[0] * (roomy ? 0.75 : 0.5)),
  };
}

/** Height a node card needs at `width` for `content`, without drawing it. */
export function nodeCardHeight(context: SectionRenderContext, width: number, content: NodeCardContent, maxLines = 2, minHeight = 0): number {
  return nodeCard(measuringContext(context), { x: 0, y: 0, width, height: minHeight }, content, { maxLines, measureOnly: true }).height;
}

/**
 * A labelled node card: title, optional structural meta line and optional
 * description, centred in a surface. `root` fills with the accent, `hero`
 * gets an accent keyline, `normal` is a quiet card (elevated when the art
 * direction allows depth, hairline-bordered otherwise).
 */
export function nodeCard(
  context: SectionRenderContext,
  box: RectInfo,
  content: NodeCardContent,
  options: {
    maxLines?: number;
    measureOnly?: boolean;
    /** Role of the card surface; text roles derive from it unless `roles` overrides them. */
    role?: string;
    roles?: Partial<Record<"label" | "meta" | "description", string>>;
  } = {}
): { primitives: InfographicPrimitive[]; height: number; titleTruncated: boolean } {
  const style = context.style;
  const s = nodeCardStyles(style, box.width);
  const emphasis = content.emphasis ?? "normal";
  const role = options.role ?? "node";
  const innerWidth = Math.max(0, box.width - s.padX * 2);
  const ink = emphasis === "root" ? style.color.onAccent : style.color.ink;
  const muted = emphasis === "root" ? mixHex(style.color.onAccent, style.color.accent, 0.3) : style.color.inkSubtle;

  const texts: TextPrimitive[] = [];
  const title = layoutText(
    {
      text: content.title,
      box: { x: box.x + s.padX, y: 0, width: innerWidth, height: 0 },
      style: s.title,
      lineHeight: style.lineHeight.heading,
      color: ink,
      role: options.roles?.label ?? `${role}-label`,
      semanticId: content.id,
      align: "center",
      maxLines: options.maxLines ?? 2,
    },
    context
  );
  texts.push(title.primitive);
  if (content.meta) {
    texts.push(
      layoutText(
        {
          text: labelCase(style, content.meta),
          box: { x: box.x + s.padX, y: 0, width: innerWidth, height: 0 },
          style: s.meta,
          lineHeight: style.lineHeight.annotation,
          color: muted,
          role: options.roles?.meta ?? `${role}-meta`,
          semanticId: `${content.id}:meta`,
          align: "center",
          maxLines: 1,
        },
        context
      ).primitive
    );
  }
  if (content.description) {
    texts.push(
      layoutText(
        {
          text: content.description,
          box: { x: box.x + s.padX, y: 0, width: innerWidth, height: 0 },
          style: s.description,
          lineHeight: style.lineHeight.annotation,
          color: emphasis === "root" ? ink : style.color.inkMuted,
          role: options.roles?.description ?? `${role}-description`,
          semanticId: `${content.id}:description`,
          align: "center",
          maxLines: 3,
        },
        context
      ).primitive
    );
  }
  const textHeight = texts.reduce((sum, text) => sum + text.height, 0) + s.gap * (texts.length - 1);
  const height = round(Math.max(box.height, textHeight + s.padY * 2));
  if (options.measureOnly) return { primitives: [], height, titleTruncated: title.wrap.truncated };

  // Centre the text stack vertically inside the card.
  let y = box.y + (height - textHeight) / 2;
  for (const text of texts) {
    text.y = round(y);
    y += text.height + s.gap;
  }
  const card: RectInfo = { x: box.x, y: box.y, width: box.width, height };
  const surface = rectPrimitive(
    card,
    {
      fill: emphasis === "root" ? style.color.accent : style.color.surface,
      gradient: emphasis === "root" ? { to: style.color.accentStrong, direction: "down" } : undefined,
      stroke: emphasis === "hero" ? style.color.accent : emphasis === "root" ? undefined : style.surface.shadow ? undefined : style.color.rule,
      strokeWidth: emphasis === "hero" ? style.stroke.strong : emphasis === "root" ? undefined : style.stroke.hairline,
      elevation: emphasis === "root" ? elevationFor(style, 2) : elevationFor(style, 1),
      radius: style.radius.lg,
      role,
      semanticId: content.id,
    },
    context
  );
  return { primitives: [surface, ...texts], height, titleTruncated: title.wrap.truncated };
}

export interface HierarchySpec {
  id: string;
  root: HierarchyNode;
}

/** Render a rooted tree of node cards joined by bus-style rounded elbows. */
export function hierarchyBlock(
  context: SectionRenderContext,
  frame: RectInfo,
  spec: HierarchySpec
): RenderResult {
  const style = context.style;
  const primitives: InfographicPrimitive[] = [];
  const anchors: Record<string, RectInfo> = {};

  const rowGap = style.spacing[4];
  const nodeGap = style.spacing[2];
  const maxNodeWidth = round(style.type.label * 16);

  // Measure every card at the shared width; one row height for the whole tree
  // keeps levels on clean horizontal lines.
  const all: Array<{ node: HierarchyNode; depth: number }> = [];
  const collect = (node: HierarchyNode, depth: number) => {
    all.push({ node, depth });
    (node.children ?? []).forEach((child) => collect(child, depth + 1));
  };
  collect(spec.root, 0);
  const probe = hierarchyLayout(spec.root, { nodeHeight: 1, nodeGap, rowGap, width: frame.width, maxNodeWidth });
  const cardWidth = probe.nodes[0]?.box.width ?? frame.width;
  const nodeHeight = Math.max(
    ...all.map(({ node, depth }) => nodeCardHeight(context, cardWidth, { id: node.id, title: node.label, meta: `Level ${depth + 1}`, description: node.description }))
  );

  const layout = hierarchyLayout(spec.root, {
    nodeHeight,
    nodeGap,
    rowGap,
    width: frame.width,
    maxNodeWidth,
    origin: { x: frame.x, y: frame.y },
  });

  if (layout.height > frame.height + 0.5) {
    context.report({
      code: "hierarchy-depth-overflow",
      severity: "error",
      message: `Hierarchy "${spec.id}" is ${layout.depth + 1} levels deep and needs ${round(layout.height)}px but has ${round(frame.height)}px.`,
      sectionId: spec.id,
      overflow: round(layout.height - frame.height),
    });
  }

  const byId = new Map(layout.nodes.map((entry) => [entry.id, entry]));

  // Edges first so cards paint over the line ends.
  for (const edge of layout.edges) {
    const parent = byId.get(edge.from);
    const child = byId.get(edge.to);
    if (!parent || !child) continue;
    primitives.push(
      ...connectorPrimitives(
        edgePorts(parent.box).bottom,
        edgePorts(child.box).top,
        {
          style,
          route: "orthogonal",
          arrow: "none",
          color: style.color.connectorMuted,
          width: style.stroke.rule,
          clearance: 0,
          role: "hierarchy-edge",
          semanticId: `${edge.from}->${edge.to}`,
        },
        context
      )
    );
  }

  for (const entry of layout.nodes) {
    const emphasis: NodeCardEmphasis = entry.depth === 0 ? "root" : (entry.node.importance ?? "supporting") === "hero" ? "hero" : "normal";
    // Depth is stated in words so the tree's structure survives without the visual.
    const card = nodeCard(context, entry.box, {
      id: entry.id,
      title: entry.node.label,
      meta: `Level ${entry.depth + 1}`,
      description: entry.node.description,
      emphasis,
    }, { role: "hierarchy-node", roles: { label: "hierarchy-label", meta: "hierarchy-depth", description: "hierarchy-description" } });
    primitives.push(...card.primitives);
    if (card.titleTruncated) {
      context.report({
        code: "hierarchy-label-truncated",
        severity: "warning",
        message: `Hierarchy node "${entry.id}" label did not fit in 2 lines; it was ellipsised. Shorten the label or widen the frame.`,
        sectionId: spec.id,
        targetId: entry.id,
      });
    }
    anchors[entry.id] = entry.box;
  }

  return { primitives, anchors };
}

/** Section-level hierarchy renderer. */
export function renderHierarchySection(
  section: HierarchySection,
  frame: RectInfo,
  context: SectionRenderContext
): RenderResult {
  const { primitives, content } = sectionChrome(section, frame, context, { accent: true });
  const result = hierarchyBlock(context, content, { id: section.id, root: section.root });
  return { primitives: [...primitives, ...result.primitives], anchors: result.anchors };
}

// ---------------------------------------------------------------------------
// diagram (generic layered graph)
// ---------------------------------------------------------------------------

export interface DiagramSpecInput {
  id: string;
  direction: "horizontal" | "vertical";
  nodes: readonly DiagramNode[];
  edges: readonly DiagramEdge[];
}

/**
 * Assign each node to a layer: sources at layer 0, every other node one past its
 * deepest predecessor. Nodes unreachable from a source (e.g. inside a cycle) fall
 * back to their declared index, which keeps the layout total instead of throwing.
 */
export function diagramLayers(
  nodes: readonly DiagramNode[],
  edges: readonly DiagramEdge[]
): { layerOf: Map<string, number>; maxLayer: number } {
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  nodes.forEach((node) => {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  });
  edges.forEach((edge) => {
    if (!incoming.has(edge.to) || !outgoing.has(edge.from)) return;
    incoming.get(edge.to)?.push(edge.from);
    outgoing.get(edge.from)?.push(edge.to);
  });

  const layerOf = new Map<string, number>();
  const visiting = new Set<string>();
  const resolve = (id: string): number => {
    if (layerOf.has(id)) return layerOf.get(id) as number;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const parents = incoming.get(id) ?? [];
    const layer = parents.length === 0 ? 0 : Math.max(...parents.map((parent) => resolve(parent) + 1));
    visiting.delete(id);
    layerOf.set(id, layer);
    return layer;
  };
  nodes.forEach((node) => resolve(node.id));
  const maxLayer = nodes.reduce((max, node) => Math.max(max, layerOf.get(node.id) ?? 0), 0);
  return { layerOf, maxLayer };
}

/** Render a directed graph as layers of node cards with labelled connectors. */
export function diagramBlock(
  context: SectionRenderContext,
  frame: RectInfo,
  spec: DiagramSpecInput
): RenderResult {
  const style = context.style;
  const primitives: InfographicPrimitive[] = [];
  const anchors: Record<string, RectInfo> = {};

  if (spec.nodes.length === 0) {
    context.report({
      code: "diagram-empty",
      severity: "error",
      message: `Diagram "${spec.id}" has no nodes.`,
      sectionId: spec.id,
    });
    return { primitives, anchors };
  }

  const { layerOf, maxLayer } = diagramLayers(spec.nodes, spec.edges);
  const layers: DiagramNode[][] = Array.from({ length: maxLayer + 1 }, () => []);
  spec.nodes.forEach((node) => layers[layerOf.get(node.id) ?? 0].push(node));

  const gap = style.spacing[2];
  const vertical = spec.direction === "vertical";
  // An edge label sits on a pill in the gap between layers. If the gap is
  // narrower than the widest label, a centred label would reach into a node
  // column and collide with a node label, so the gap grows to hold it
  // (containment, docs/12 §5).
  const edgeLabelStyle = typeStyle(style, "caption", { family: style.font.body, weight: style.weight.label });
  const edgePadX = style.spacing[0];
  let widestEdgeLabel = 0;
  for (const edge of spec.edges) {
    if (edge.label) widestEdgeLabel = Math.max(widestEdgeLabel, measureText(edge.label, edgeLabelStyle) + edgePadX * 2);
  }
  // The gap between layers is also the connector channel: room for a shaft,
  // an arrowhead and (when present) the label pill.
  const connectorChannel = round(style.connector.markerSize * 3 + style.spacing[2]);
  const roomyGap = Math.max(style.spacing[4], round(widestEdgeLabel) + style.spacing[2], connectorChannel);
  // The minimal channel still holds a shaft, a head and any label.
  const tightGap = Math.max(gap, round(widestEdgeLabel) + style.spacing[1], round(style.connector.markerSize * 2 + style.spacing[1]));

  // Layers become columns (horizontal) or rows (vertical). Cards are sized to
  // their content and centred on the layer's cross axis, so a sparse layer
  // reads as deliberate rather than stretched.
  const layerCount = layers.length;
  let layerGap = roomyGap;
  const extentFor = (layerGapValue: number) =>
    vertical
      ? (frame.height - layerGapValue * (layerCount - 1)) / layerCount
      : (frame.width - layerGapValue * (layerCount - 1)) / layerCount;
  let layerExtent = extentFor(layerGap);
  const maxCardWidth = round(style.type.h3 * 11);
  const cardWidthFor = (count: number) =>
    vertical
      ? round(Math.min(maxCardWidth, (frame.width - gap * (count - 1)) / Math.max(1, count)))
      : round(Math.min(maxCardWidth, layerExtent));
  const cardContent = (node: DiagramNode): NodeCardContent => ({
    id: node.id,
    title: node.label,
    description: node.description,
    emphasis: (node.importance ?? "supporting") === "hero" ? "hero" : "normal",
  });

  // One card height across the whole diagram keeps ports on shared lines.
  // Cards keep a calm landscape proportion even with one-word labels — unless
  // the frame is short, in which case they fall back to their content height
  // and the channel tightens before anything is allowed to overflow.
  const heightFor = (proportion: number) =>
    Math.max(
      ...layers.flatMap((layerNodes) => {
        const width = cardWidthFor(layerNodes.length);
        return layerNodes.map((node) => nodeCardHeight(context, width, cardContent(node), 3, round(width * proportion)));
      })
    );
  const fits = (height: number, layerGapValue: number) => {
    if (vertical) return height * layerCount + layerGapValue * (layerCount - 1) <= frame.height + 0.5;
    const tallest = Math.max(...layers.map((layerNodes) => layerNodes.length));
    return height * tallest + gap * (tallest - 1) <= frame.height + 0.5;
  };
  let cardHeight = heightFor(0.42);
  if (!fits(cardHeight, layerGap)) cardHeight = heightFor(0);
  if (!fits(cardHeight, layerGap)) {
    layerGap = tightGap;
    layerExtent = extentFor(layerGap);
  }

  const placed = new Map<string, RectInfo>();
  layers.forEach((layerNodes, layerIndex) => {
    const width = cardWidthFor(layerNodes.length);
    const count = layerNodes.length;
    const stack = vertical ? width * count + gap * (count - 1) : cardHeight * count + gap * (count - 1);
    layerNodes.forEach((node, nodeIndex) => {
      const box: RectInfo = vertical
        ? {
            x: round(frame.x + (frame.width - stack) / 2 + nodeIndex * (width + gap)),
            y: round(frame.y + layerIndex * (Math.min(layerExtent, cardHeight) + layerGap)),
            width,
            height: cardHeight,
          }
        : {
            x: round(frame.x + layerIndex * (layerExtent + layerGap) + (layerExtent - width) / 2),
            y: round(frame.y + Math.max(0, (Math.min(frame.height, stack + style.spacing[4] * 2) - stack) / 2) + nodeIndex * (cardHeight + gap)),
            width,
            height: cardHeight,
          };
      placed.set(node.id, box);
      anchors[node.id] = box;
      const card = nodeCard(context, box, cardContent(node), { maxLines: 3, role: "diagram-node" });
      primitives.push(...card.primitives);
    });
  });

  const edgePrimitives: InfographicPrimitive[] = [];
  const labelPrimitives: InfographicPrimitive[] = [];
  for (const edge of spec.edges) {
    const fromBox = placed.get(edge.from);
    const toBox = placed.get(edge.to);
    if (!fromBox || !toBox) continue;
    const directed = edge.directed ?? true;
    const fromLayer = layerOf.get(edge.from) ?? 0;
    const toLayer = layerOf.get(edge.to) ?? 0;
    const backwards = toLayer <= fromLayer;
    const portGap = style.spacing[0];
    const fromPort = vertical ? edgePorts(fromBox).bottom : edgePorts(fromBox).right;
    const toPort = vertical ? edgePorts(toBox).top : edgePorts(toBox).left;
    const from = vertical ? { x: fromPort.x, y: fromPort.y + portGap } : { x: fromPort.x + portGap, y: fromPort.y };
    const to = vertical ? { x: toPort.x, y: toPort.y - portGap } : { x: toPort.x - portGap, y: toPort.y };
    edgePrimitives.push(
      ...connectorPrimitives(
        from,
        to,
        {
          style,
          route: backwards ? "curve" : "orthogonal",
          // A directed edge must show direction with an arrowhead. The art
          // direction's `connector.arrow` token is a general marker (a bar under
          // `scientific`, a dot elsewhere) and reads as a tick in a narrow gap, so
          // the diagram states semantic direction explicitly.
          arrow: directed ? "arrow" : "none",
          color: backwards ? style.color.connectorMuted : style.color.connector,
          dash: backwards ? "dashed" : undefined,
          clearance: 0,
          role: "diagram-edge",
          semanticId: edge.id,
        },
        context
      )
    );

    if (edge.label) {
      const midpoint = { x: round((from.x + to.x) / 2), y: round((from.y + to.y) / 2) };
      // The pill is measured, not a fixed fraction of the frame, so it never
      // reaches into a node column (containment, docs/12 §5).
      const textWidth = round(Math.max(1, measureText(edge.label, edgeLabelStyle)));
      const pillHeight = round(edgeLabelStyle.fontSize * 1.6);
      const pill: RectInfo = {
        x: round(midpoint.x - textWidth / 2 - edgePadX),
        y: round(midpoint.y - pillHeight / 2),
        width: round(textWidth + edgePadX * 2),
        height: pillHeight,
      };
      labelPrimitives.push(
        rectPrimitive(pill, { fill: style.color.canvas, stroke: style.color.grid, strokeWidth: style.stroke.hairline, radius: style.radius.pill, role: "diagram-edge-label-pill" }, context),
        layoutText(
          {
            text: edge.label,
            box: { x: round(pill.x + edgePadX), y: pill.y, width: textWidth + 1, height: pill.height },
            style: edgeLabelStyle,
            color: style.color.inkMuted,
            role: "diagram-edge-label",
            semanticId: `${edge.id}:label`,
            align: "center",
            valign: "middle",
            lineHeight: 1.2,
            maxLines: 1,
          },
          context
        ).primitive
      );
    }
  }

  // Edges under cards, labels over edges.
  return { primitives: [...edgePrimitives, ...primitives, ...labelPrimitives], anchors };
}

/** Section-level diagram renderer. */
export function renderDiagramSection(
  section: DiagramSection,
  frame: RectInfo,
  context: SectionRenderContext
): RenderResult {
  const { primitives, content } = sectionChrome(section, frame, context, { accent: true });
  const result = diagramBlock(context, content, {
    id: section.id,
    direction: section.diagram.direction ?? "vertical",
    nodes: section.diagram.nodes,
    edges: section.diagram.edges,
  });
  return { primitives: [...primitives, ...result.primitives], anchors: result.anchors };
}

/** Section renderers owned by this module. */
export const VISUALIZER_RENDERERS: Partial<Record<SectionKind, SectionRenderer>> = {
  process: renderProcessSection as SectionRenderer,
  timeline: renderTimelineSection as SectionRenderer,
  hierarchy: renderHierarchySection as SectionRenderer,
  diagram: renderDiagramSection as SectionRenderer,
};

/** The section kinds handled by {@link VISUALIZER_RENDERERS}. */
export const VISUALIZER_SECTION_KINDS: readonly SectionKind[] = [
  "process",
  "timeline",
  "hierarchy",
  "diagram",
];

export { labelCase, lineHeightForRole };
