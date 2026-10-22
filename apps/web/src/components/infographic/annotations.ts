/**
 * `annotation` — labels attached to content, never floating over it.
 *
 * An annotation is a *reference*, so the renderer treats it as one:
 *
 * 1. **Targets are resolved, not assumed.** Every annotation names a `targetId`
 *    (a section, step, case, milestone, node or edge). If that target is not in
 *    the anchor map the annotation is dropped with an `annotation-orphan` error
 *    instead of pointing at nothing (docs/12 §A: "fail if target disappears").
 * 2. **A label always says what it labels.** The resolved target label is
 *    appended to the annotation copy, so a "27%" bubble over a chart can never
 *    be mistaken for an unlabelled series.
 * 3. **Placement is deterministic and reported.** Candidates are tried in a
 *    fixed order — authored side first, then right → top → bottom → left — and
 *    the first collision-free candidate wins. When every candidate collides the
 *    annotation is still placed (dropping it would hide information) at the
 *    least-occupied position, with an `annotation-overlap` warning naming the
 *    annotation and the px it overlaps by.
 */

import { measureText } from "./measure";
import {
  clampRect,
  connectorPrimitives,
  elevationFor,
  ellipsePrimitive,
  insetRect,
  layoutText,
  linePrimitive,
  overlapArea,
  rectBottom,
  rectCenter,
  rectPrimitive,
  rectRight,
  rectsOverlap,
  round,
  typeStyle,
} from "./primitives";
import type {
  AnnotationSpec,
  InfographicDiagnostic,
  InfographicPrimitive,
  RectInfo,
  SectionRenderContext,
} from "./types";

export type AnnotationSide = "top" | "right" | "bottom" | "left";

/** Fixed search order for automatic placement. */
const AUTO_ORDER: readonly AnnotationSide[] = ["right", "top", "bottom", "left"];

export interface AnnotationOptions {
  /** Region annotations must stay inside (usually the canvas safe region). */
  bounds: RectInfo;
  /**
   * Resolve a target id to its human label. When provided, the label is appended
   * to the annotation copy so the annotation is never a bare label over data.
   */
  targetLabel?: (targetId: string) => string | undefined;
  /** Cap on label width. @default 34% of `bounds.width` */
  maxLabelWidth?: number;
  /** Clearance between the label box and its target. @default style.spacing[2] */
  minGap?: number;
  /**
   * Boxes the annotation must avoid beyond its own targets — typically the text
   * boxes the section pass already drew, so a label is never placed on top of
   * another section's copy (docs/12 §5 containment).
   */
  avoid?: readonly RectInfo[];
}

export interface AnnotationRenderResult {
  primitives: InfographicPrimitive[];
  diagnostics: InfographicDiagnostic[];
  /** Ids dropped because their target was missing. */
  missing: string[];
  /** Ids that were drawn. */
  placed: string[];
}

export interface AnnotationMeasurement {
  /** Composed label text (annotation copy plus resolved target label). */
  text: string;
  width: number;
  height: number;
}

/**
 * Measure the label box for one annotation. The composed text is
 * `"<label> — <target label>"` when the target resolves to a different string.
 */
export function measureAnnotationBox(
  annotation: AnnotationSpec,
  context: SectionRenderContext,
  maxLabelWidth: number,
  targetLabel?: (targetId: string) => string | undefined
): AnnotationMeasurement {
  const style = context.style;
  const resolved = targetLabel?.(annotation.targetId);
  const suffix = resolved && resolved !== annotation.label ? ` — ${resolved}` : "";
  const text = `${annotation.label}${suffix}`;
  const labelStyle = typeStyle(style, "annotation");
  const detailStyle = typeStyle(style, "caption");

  const padding = style.spacing[1];
  const available = Math.max(0, maxLabelWidth - padding * 2);
  const single = measureText(text, labelStyle);
  // A couple of px of slack so rounding never forces a wrap the height
  // calculation below did not plan for.
  const width = round(Math.min(maxLabelWidth, single + padding * 2 + 2));

  const lines = single > available ? Math.max(1, Math.ceil(single / Math.max(1, available))) : 1;
  const lineHeight = round(labelStyle.fontSize * style.lineHeight.annotation);
  let height = round(lines * lineHeight + padding * 2);

  if (annotation.detail) {
    const detailWidth = measureText(annotation.detail, detailStyle);
    const detailLines =
      detailWidth > available ? Math.max(1, Math.ceil(detailWidth / Math.max(1, available))) : 1;
    height = round(height + detailLines * detailStyle.fontSize * style.lineHeight.annotation + style.spacing[0]);
  }

  return { text, width, height };
}

interface Candidate {
  side: AnnotationSide;
  box: RectInfo;
}

/** Candidate label boxes around a target rect, at `gap` clearance. */
function candidates(anchor: RectInfo, size: { width: number; height: number }, gap: number): Candidate[] {
  const center = rectCenter(anchor);
  return [
    {
      side: "right",
      box: {
        x: round(rectRight(anchor) + gap),
        y: round(center.y - size.height / 2),
        width: size.width,
        height: size.height,
      },
    },
    {
      side: "top",
      box: {
        x: round(center.x - size.width / 2),
        y: round(anchor.y - gap - size.height),
        width: size.width,
        height: size.height,
      },
    },
    {
      side: "bottom",
      box: {
        x: round(center.x - size.width / 2),
        y: round(rectBottom(anchor) + gap),
        width: size.width,
        height: size.height,
      },
    },
    {
      side: "left",
      box: {
        x: round(anchor.x - gap - size.width),
        y: round(center.y - size.height / 2),
        width: size.width,
        height: size.height,
      },
    },
  ];
}

interface PlacedBox {
  id: string;
  box: RectInfo;
}

function occupiedArea(box: RectInfo, blockers: readonly RectInfo[]): number {
  return blockers.reduce((total, blocker) => total + overlapArea(box, blocker), 0);
}

/**
 * Render every annotation against the anchors the layout pass collected.
 *
 * `anchors` is the union of block/visualizer/chart ports and target rects — the
 * same map templates use for connector routing, which is what keeps an
 * annotation attached after a reflow re-runs the layout.
 */
export function renderAnnotations(
  annotations: readonly AnnotationSpec[],
  anchors: ReadonlyMap<string, RectInfo>,
  context: SectionRenderContext,
  options: AnnotationOptions
): AnnotationRenderResult {
  const primitives: InfographicPrimitive[] = [];
  const diagnostics: InfographicDiagnostic[] = [];
  const missing: string[] = [];
  const placed: string[] = [];
  const style = context.style;

  if (annotations.length === 0) {
    return { primitives, diagnostics, missing, placed };
  }

  const bounds = options.bounds;
  const maxLabelWidth = round(options.maxLabelWidth ?? bounds.width * 0.34);
  const gap = options.minGap ?? style.spacing[2];

  // High priority first; ties keep authoring order so layouts stay stable.
  const ordered = annotations
    .map((annotation, index) => ({ annotation, index }))
    .sort((a, b) => {
      const priority = (b.annotation.priority ?? 0) - (a.annotation.priority ?? 0);
      return priority !== 0 ? priority : a.index - b.index;
    });

  const placedBoxes: PlacedBox[] = [];
  const targetRects: RectInfo[] = [];

  for (const { annotation } of ordered) {
    const anchor = anchors.get(annotation.targetId);
    if (!anchor) {
      missing.push(annotation.id);
      diagnostics.push({
        code: "annotation-orphan",
        severity: "error",
        message: `Annotation "${annotation.label}" targets "${annotation.targetId}", which is not present in this layout.`,
        targetId: annotation.id,
        path: `/annotations/${annotation.id}/targetId`,
      });
      continue;
    }

    const measurement = measureAnnotationBox(annotation, context, maxLabelWidth, options.targetLabel);
    const size = { width: measurement.width, height: measurement.height };
    const all = candidates(anchor, size, gap);

    // Authored side wins when it is usable; otherwise the fixed auto order.
    const orderedCandidates = annotation.side && annotation.side !== "auto"
      ? [
          ...all.filter((candidate) => candidate.side === annotation.side),
          ...all.filter((candidate) => candidate.side !== annotation.side),
        ]
      : [...all].sort(
          (a, b) => AUTO_ORDER.indexOf(a.side) - AUTO_ORDER.indexOf(b.side)
        );

    const avoid = annotation.avoidIds
      ?.map((id) => placedBoxes.find((entry) => entry.id === id)?.box)
      .filter((box): box is RectInfo => Boolean(box)) ?? [];

    const blockers = [
      ...placedBoxes.map((entry) => entry.box),
      ...targetRects,
      ...avoid,
      ...(options.avoid ?? []),
    ];

    let chosen: Candidate | null = null;
    let best: { candidate: Candidate; area: number } | null = null;

    for (const candidate of orderedCandidates) {
      const box = clampRect(candidate.box, bounds);
      const area = occupiedArea(box, blockers);
      if (area === 0) {
        chosen = { side: candidate.side, box };
        break;
      }
      if (!best || area < best.area) best = { candidate: { side: candidate.side, box }, area };
    }

    // No collision-free side: omit rather than draw over other content. The
    // label is reported so the author can shorten it or move the target; a
    // silently overlapping annotation is exactly what docs/12 §5 forbids.
    if (!chosen) {
      diagnostics.push({
        code: "annotation-overlap",
        severity: "error",
        message: `Annotation "${annotation.label}" could not be placed clear of other content and was omitted; shorten it or move its target.`,
        targetId: annotation.id,
        overflow: round(best?.area ?? 0),
      });
      continue;
    }

    const labelBox = chosen.box;
    placedBoxes.push({ id: annotation.id, box: labelBox });
    placed.push(annotation.id);

    // ---- label ---------------------------------------------------------
    // A quiet callout surface: the label reads as a label, and the leader
    // visibly starts at its edge instead of among loose words.
    primitives.push(
      rectPrimitive(
        labelBox,
        {
          fill: style.surface.fill ? style.color.surface : style.color.canvas,
          stroke: style.color.grid,
          strokeWidth: style.stroke.hairline,
          radius: style.radius.md,
          elevation: elevationFor(style, 1),
          role: "annotation-surface",
          semanticId: annotation.id,
        },
        context
      )
    );
    const labelStyle = typeStyle(style, "annotation");
    const labelText = layoutText(
      {
        text: measurement.text,
        box: insetRect(labelBox, style.spacing[1]),
        style: labelStyle,
        color: style.color.ink,
        role: "annotation-label",
        semanticId: annotation.id,
      },
      context
    );
    if (labelText.fit === "overflow") {
      diagnostics.push({
        code: "annotation-label-overflow",
        severity: "warning",
        message: `Annotation "${annotation.label}" did not fit its label box.`,
        targetId: annotation.id,
        overflow: round(labelText.requiredHeight - labelBox.height),
      });
    }
    primitives.push(labelText.primitive);

    if (annotation.detail) {
      primitives.push(
        layoutText(
          {
            text: annotation.detail,
            box: {
              x: round(labelBox.x + style.spacing[1]),
              y: round(labelBox.y + style.spacing[1] + labelText.height + style.spacing[0]),
              width: round(labelBox.width - style.spacing[1] * 2),
              height: round(Math.max(0, labelBox.height - labelText.height - style.spacing[1] * 2)),
            },
            style: typeStyle(style, "caption"),
            color: style.color.inkMuted,
            role: "annotation-detail",
          },
          context
        ).primitive
      );
    }

    // ---- leader / bracket / arrow -------------------------------------
    const shape = annotation.shape ?? "leader";
    const from = leaderOrigin(labelBox, chosen.side);
    const to = anchorEdgePoint(anchor, chosen.side, gap * 0.5);

    if (shape === "arrow") {
      primitives.push(
        ...connectorPrimitives(
          from,
          to,
          {
            style,
            route: "straight",
            arrow: "arrow",
            color: style.color.connector,
            width: style.stroke.hairline,
            role: "annotation-leader",
            semanticId: annotation.id,
          },
          context
        )
      );
    } else if (shape === "bracket") {
      primitives.push(...bracketPrimitives(anchor, chosen.side, from, style, context, annotation.id));
    } else {
      primitives.push(
        ...connectorPrimitives(
          from,
          to,
          {
            style,
            route: style.connector.route,
            arrow: "dot",
            color: style.color.connector,
            width: style.stroke.hairline,
            role: "annotation-leader",
            semanticId: annotation.id,
          },
          context
        )
      );
    }

    primitives.push(
      ellipsePrimitive(
        { x: round(rectCenter(anchor).x - style.stroke.strong), y: round(rectCenter(anchor).y - style.stroke.strong), width: style.stroke.strong * 2, height: style.stroke.strong * 2 },
        {
          fill: style.color.accent,
          role: "annotation-anchor",
          semanticId: annotation.id,
        },
        context
      )
    );

    if (!targetRects.some((rect) => rectsOverlap(rect, anchor))) {
      targetRects.push(anchor);
    }
  }

  return { primitives, diagnostics, missing, placed };
}

/**
 * Edge of the label box that faces the target. A label placed on the target's
 * `top` side faces it with its *bottom* edge, and so on — starting the leader
 * on the far edge would draw it straight through the label's own words.
 */
function leaderOrigin(box: RectInfo, side: AnnotationSide): { x: number; y: number } {
  const center = rectCenter(box);
  switch (side) {
    case "right":
      return { x: box.x, y: round(center.y) };
    case "left":
      return { x: round(rectRight(box)), y: round(center.y) };
    case "top":
      return { x: round(center.x), y: round(rectBottom(box)) };
    case "bottom":
    default:
      return { x: round(center.x), y: box.y };
  }
}

/** Point on the target edge the connector attaches to. */
function anchorEdgePoint(anchor: RectInfo, side: AnnotationSide, inset: number): { x: number; y: number } {
  const center = rectCenter(anchor);
  switch (side) {
    case "right":
      return { x: round(rectRight(anchor) - inset), y: round(center.y) };
    case "left":
      return { x: round(anchor.x + inset), y: round(center.y) };
    case "top":
      return { x: round(center.x), y: round(anchor.y + inset) };
    case "bottom":
    default:
      return { x: round(center.x), y: round(rectBottom(anchor) - inset) };
  }
}

/**
 * Bracket: a rule spanning the target's facing edge with ticks at both ends, plus
 * a short connector to the label. Unlike a leader it claims the whole extent of
 * what it labels, which is what a range/interval annotation needs.
 */
function bracketPrimitives(
  anchor: RectInfo,
  side: AnnotationSide,
  labelPoint: { x: number; y: number },
  style: SectionRenderContext["style"],
  context: SectionRenderContext,
  semanticId: string
): InfographicPrimitive[] {
  const horizontal = side === "top" || side === "bottom";
  const offset = style.spacing[1];
  const span = horizontal
    ? {
        start: { x: round(anchor.x), y: round(side === "top" ? anchor.y - offset : rectBottom(anchor) + offset) },
        end: { x: round(rectRight(anchor)), y: round(side === "top" ? anchor.y - offset : rectBottom(anchor) + offset) },
      }
    : {
        start: { x: round(side === "left" ? anchor.x - offset : rectRight(anchor) + offset), y: round(anchor.y) },
        end: { x: round(side === "left" ? anchor.x - offset : rectRight(anchor) + offset), y: round(rectBottom(anchor)) },
      };

  const primitives: InfographicPrimitive[] = [
    linePrimitive(span.start, span.end, {
      stroke: style.color.connector,
      strokeWidth: style.stroke.rule,
      role: "annotation-bracket",
      semanticId,
    }, context),
    linePrimitive(
      span.start,
      horizontal
        ? { x: span.start.x, y: round(span.start.y + style.spacing[0]) }
        : { x: round(span.start.x + style.spacing[0]), y: span.start.y },
      {
        stroke: style.color.connector,
        strokeWidth: style.stroke.rule,
        role: "annotation-bracket-tick",
      },
      context
    ),
    linePrimitive(
      span.end,
      horizontal
        ? { x: span.end.x, y: round(span.end.y + style.spacing[0]) }
        : { x: round(span.end.x - style.spacing[0]), y: span.end.y },
      {
        stroke: style.color.connector,
        strokeWidth: style.stroke.rule,
        role: "annotation-bracket-tick",
      },
      context
    ),
  ];

  const mid = horizontal
    ? { x: round((span.start.x + span.end.x) / 2), y: span.start.y }
    : { x: span.start.x, y: round((span.start.y + span.end.y) / 2) };

  primitives.push(
    ...connectorPrimitives(
      labelPoint,
      mid,
      {
        style,
        route: "straight",
        arrow: "none",
        color: style.color.connectorMuted,
        width: style.stroke.hairline,
        role: "annotation-connector",
        semanticId,
      },
      context
    )
  );

  return primitives;
}
