/**
 * The layout engine — one call from a semantic source to a renderable layout.
 *
 * `buildInfographic` is the only place that knows the whole pipeline, and it
 * keeps the order of operations that docs/12 §5 specifies:
 *
 * 1. **Validate** the semantic source. Structural problems become error
 *    diagnostics, never a crash and never a silent fix-up.
 * 2. **Resolve** the art direction (tokens) and the output profile (artboard +
 *    pagination policy), then derive the safe region from the profile's inset.
 * 3. **Choose a template** (authored, or scored by content shape) and turn it
 *    into frames.
 * 4. **Render** each frame by dispatching on section kind — the only dispatch
 *    table in the subsystem.
 * 5. **Annotate** last, against the anchors the renderers produced, so labels
 *    attach to whatever the layout actually drew.
 * 6. **Return** an {@link InfographicLayout}: primitives, frames, diagnostics,
 *    provenance and an accessible summary. Pure function of its inputs — no
 *    clock, no randomness, no I/O.
 */

import {
  getArtDirection,
  getOutputProfile,
  LAYOUT_VERSION,
  resolveStyle,
  safeInset,
} from "./art-direction";
import { renderAnnotations } from "./annotations";
import { BLOCK_RENDERERS } from "./blocks";
import { CHART_RENDERER } from "./chart";
import {
  boundsOverflow,
  createIdFactory,
  insetRect,
  layoutTextForRole,
  overlapArea,
  primitivesBounds,
  rectPrimitive,
  round,
} from "./primitives";
import { planTemplate, selectTemplate, TEMPLATE_INFO, type TemplateContext } from "./templates";
import type { DeepPartial } from "./art-direction";
import { VISUALIZER_RENDERERS } from "./visualizers";
import { sourceDigest, validateSource } from "./validate";
import type {
  ArtDirectionId,
  ChartSection,
  InfographicDiagnostic,
  InfographicEvidence,
  InfographicLayout,
  InfographicPrimitive,
  InfographicSection,
  InfographicSource,
  OutputProfileId,
  RectInfo,
  ResolvedStyle,
  SectionFrame,
  SectionKind,
  SectionRenderContext,
  SectionRenderer,
  TemplateId,
} from "./types";

export interface BuildInfographicOptions {
  /** Authored template. Omit to let the engine score and choose. */
  template?: TemplateId;
  /** @default "editorial" */
  artDirection?: ArtDirectionId;
  /** @default "youtube-landscape" */
  profile?: OutputProfileId;
  /** Overrides the profile's artboard size (e.g. an article-inline slot). */
  size?: { width: number; height: number };
  /** Token-level overrides on top of the art direction. */
  styleOverride?: DeepPartial<ResolvedStyle>;
  /** 1-based page to build. @default 1 */
  page?: number;
  /** Layout id. @default `"infographic:<source id>"` */
  id?: string;
  /** Render `source.annotations`. @default true */
  annotations?: boolean;
  /**
   * Optically centre short content in the space under the header instead of
   * leaving it top-heavy. Set `false` for strict top alignment. @default true
   */
  balance?: boolean;
  /** Preferred column count for multi-column templates (e.g. `visual-cheat-sheet`). */
  columns?: number;
  /** Rhythm override; `dense` packs entries closer together. @default the art direction's density */
  density?: "airy" | "balanced" | "dense";
  /** Which region wins structural dominance. @default template-specific */
  emphasis?: "header" | "focal" | "even";
  /** Stacking direction for `layered-architecture`. @default "vertical" */
  orientation?: "vertical" | "horizontal";
}

/** Every section renderer in the subsystem, keyed by section kind. */
export const SECTION_RENDERERS: Partial<Record<SectionKind, SectionRenderer>> = {
  ...BLOCK_RENDERERS,
  ...VISUALIZER_RENDERERS,
  chart: CHART_RENDERER as SectionRenderer,
};

/**
 * Containment tolerance for the render guard. Text is a fact, so it must sit
 * inside its frame almost exactly; decorative geometry (a rule on a frame edge,
 * a connector head, a panel bleed) gets a slightly larger allowance so a hairline
 * is not mistaken for an overflow.
 */
const TEXT_CONTAINMENT_EPSILON = 1.5;

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

/**
 * Map every addressable id in a source to a human label. Used for annotation
 * targets: an annotation on `step-3` reads as "… — Retrieve chunks" rather than
 * as an unmoored bubble.
 */
export function buildLabelIndex(source: InfographicSource): Map<string, string> {
  const index = new Map<string, string>();
  const remember = (id: string | undefined, label: string | undefined) => {
    if (id && label && !index.has(id)) index.set(id, label);
  };

  for (const section of source.sections ?? []) {
    remember(section.id, section.heading ?? truncate(section.summary ?? "", 48));
    switch (section.kind) {
      case "process":
        for (const step of section.steps) remember(step.id, step.title);
        break;
      case "comparison":
        for (const entry of section.cases) remember(entry.id, entry.label);
        break;
      case "timeline":
        for (const milestone of section.milestones) remember(milestone.id, milestone.label);
        break;
      case "hierarchy": {
        const walk = (node: { id: string; label: string; children?: readonly { id: string; label: string; children?: unknown[] }[] }) => {
          remember(node.id, node.label);
          for (const child of node.children ?? []) {
            walk(child as { id: string; label: string; children?: readonly { id: string; label: string; children?: unknown[] }[] });
          }
        };
        if (section.root) walk(section.root);
        break;
      }
      case "diagram":
        for (const node of section.diagram.nodes) remember(node.id, node.label);
        for (const edge of section.diagram.edges) {
          const from = section.diagram.nodes.find((node) => node.id === edge.from)?.label ?? edge.from;
          const to = section.diagram.nodes.find((node) => node.id === edge.to)?.label ?? edge.to;
          remember(edge.id, edge.label ?? `${from} → ${to}`);
        }
        break;
      default:
        break;
    }
  }

  return index;
}

function describeSection(section: InfographicSection, language: string): string {
  const heading = section.heading ? `${section.heading}: ` : "";
  switch (section.kind) {
    case "text":
      return `${heading}${truncate(section.paragraphs.join(" "), 140)}`;
    case "statistic":
      return `${heading}${section.value}${section.unit ? ` ${section.unit}` : ""} (${section.measureLabel})${section.period ? `, ${section.period}` : ""}`;
    case "process":
      return `${heading}${section.steps.length} steps: ${section.steps.map((step) => step.title).join(" → ")}`;
    case "comparison":
      return `${heading}${section.cases.length} cases across ${section.criteria.length} dimensions: ${section.criteria.join(", ")}`;
    case "timeline":
      return `${heading}${section.milestones.length} milestones: ${section.milestones.map((milestone) => milestone.label).join(", ")}`;
    case "hierarchy":
      return `${heading}hierarchy rooted at ${section.root?.label ?? "unknown"}`;
    case "chart":
      return `${heading}${section.chart.recipe} chart of ${section.chart.series.length} series over ${section.chart.categories.length} categories`;
    case "diagram":
      return `${heading}diagram with ${section.diagram.nodes.length} nodes and ${section.diagram.edges.length} edges`;
    case "quote":
      return `${heading}"${truncate(section.data.quote, 100)}" — ${section.data.attribution}`;
    default:
      return heading || `(${language})`;
  }
}

function buildSummary(
  source: InfographicSource,
  frames: readonly SectionFrame[],
  sections: readonly InfographicSection[],
  page: number,
  pages: number
): string {
  const parts: string[] = [];
  parts.push(source.title);
  if (source.thesis) parts.push(truncate(source.thesis, 200));
  if (pages > 1) parts.push(`Page ${page} of ${pages}.`);
  for (const frame of frames) {
    const section = sections.find((entry) => entry.id === frame.id);
    if (section) parts.push(describeSection(section, source.language));
  }
  return parts.join(" ");
}

function dedupeDiagnostics(diagnostics: readonly InfographicDiagnostic[]): InfographicDiagnostic[] {
  const seen = new Set<string>();
  const output: InfographicDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = [
      diagnostic.code,
      diagnostic.severity,
      diagnostic.sectionId ?? "",
      diagnostic.targetId ?? "",
      diagnostic.message,
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(diagnostic);
  }
  return output;
}

/**
 * Build a complete, static layout for one page of an infographic.
 *
 * The layout is a pure data structure: it can be drawn to SVG, rendered to DOM
 * or diffed in a golden test without any renderer being involved.
 */
export function buildInfographic(
  source: InfographicSource,
  options: BuildInfographicOptions = {}
): InfographicLayout {
  const sections: InfographicSection[] = Array.isArray(source.sections) ? source.sections : [];
  const validation = validateSource(source);
  const diagnostics: InfographicDiagnostic[] = [...validation.diagnostics];

  const artDirection = options.artDirection ?? "editorial";
  const style = resolveStyle(artDirection, options.styleOverride);
  const profile = getOutputProfile(options.profile ?? "youtube-landscape", options.size);
  const inset = options.size ? round(Math.min(options.size.width, options.size.height) * profile.safeInset) : safeInset(profile);

  const canvas = {
    width: profile.width,
    height: profile.height,
    profile: profile.id,
    background: style.color.canvas,
    safeRegion: inset,
  };

  const safe: RectInfo = insetRect(
    { x: 0, y: 0, width: canvas.width, height: canvas.height },
    inset
  );

  const templateContext: TemplateContext = {
    style,
    canvas,
    safe,
    sections,
    columns: options.columns,
    density: options.density,
    emphasis: options.emphasis,
    orientation: options.orientation,
  };

  const selection = options.template
    ? null
    : selectTemplate(templateContext);
  const template: TemplateId = options.template ?? selection!.template;
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const plan = planTemplate(template, templateContext);
  diagnostics.push(...(selection?.candidates.find((entry) => entry.template === template)?.violations ?? []).map((violation) => ({
    code: violation.code,
    severity: "warning" as const,
    message: violation.message,
    sectionId: violation.sectionId,
  })));

  // ---- render ----------------------------------------------------------
  const evidence: ReadonlyMap<string, InfographicEvidence> = new Map(
    (source.evidence ?? []).map((entry) => [entry.id, entry] as const)
  );
  const evidenceLabels = new Map<string, string>();
  (source.evidence ?? []).forEach((entry, index) => evidenceLabels.set(entry.id, String(index + 1)));
  const labelIndex = buildLabelIndex(source);

  const idFactory = createIdFactory(`ig-${options.id ?? source.id}`);
  const anchors = new Map<string, RectInfo>();
  const primitives: InfographicPrimitive[] = [];
  const frames: SectionFrame[] = [];

  const context: SectionRenderContext = {
    style,
    language: source.language ?? "en",
    evidence,
    evidenceLabel: (evidenceId) => evidenceLabels.get(evidenceId),
    id: idFactory,
    report: (diagnostic) => {
      diagnostics.push(diagnostic);
    },
  };

  primitives.push(
    rectPrimitive(
      { x: 0, y: 0, width: canvas.width, height: canvas.height },
      { fill: canvas.background, role: "infographic-background", semanticId: source.id },
      context
    )
  );

  const pageFrames = plan.frames.filter((frame) => frame.page === page);

  if (page === 1 && plan.header) {
    primitives.push(...renderHeader(source, plan.header, context));
  }

  const balance = options.balance === false
    ? 0
    : verticalBalanceOffset(pageFrames, sections.map((section) => withoutEchoedHeading(section, source.title)), context);

  for (const planned of pageFrames) {
    const frame = balance > 0
      ? { ...planned, frame: { ...planned.frame, y: round(planned.frame.y + balance), height: round(planned.frame.height - balance) } }
      : planned;
    const found = sections.find((entry) => entry.id === frame.sectionId);
    if (!found) continue;
    const section = withoutEchoedHeading(found, source.title);
    const renderer = SECTION_RENDERERS[section.kind];
    if (!renderer) {
      context.report({
        code: "renderer-unavailable",
        severity: "error",
        message: `No renderer is registered for section kind "${section.kind}".`,
        sectionId: section.id,
      });
      continue;
    }
    const result = renderer(section, frame.frame, context);

    // Containment guard (docs/12 §5): a section whose render leaves its frame, or
    // whose own text primitives collide, is a measurement failure — not something
    // to draw overlapping its neighbour. It is omitted and reported rather than
    // drawn out of band.
    const decorationEpsilon = Math.max(2, context.style.spacing[2]);
    const textPrimitives = result.primitives.filter((primitive) => primitive.kind === "text");
    const textOverflow = boundsOverflow(primitivesBounds(textPrimitives), frame.frame);
    const overallOverflow = boundsOverflow(primitivesBounds(result.primitives), frame.frame);
    let collision = 0;
    for (let a = 0; a < textPrimitives.length; a += 1) {
      for (let b = a + 1; b < textPrimitives.length; b += 1) {
        const area = overlapArea(textPrimitives[a], textPrimitives[b]);
        if (area > collision) collision = area;
      }
    }
    if (
      textOverflow > TEXT_CONTAINMENT_EPSILON ||
      overallOverflow > decorationEpsilon ||
      collision > 8
    ) {
      const overflow = round(Math.max(textOverflow, overallOverflow));
      const reason =
        collision > 8 && overflow <= TEXT_CONTAINMENT_EPSILON
          ? `overlapping text primitives (${round(collision)}px²)`
          : `${overflow}px outside its ${round(frame.frame.width)}×${round(frame.frame.height)}px frame`;
      context.report({
        code: "section-overflow",
        severity: "error",
        message: `Section "${section.id}" (${section.kind}) rendered ${reason} and was omitted; shorten the section or use a paginating profile.`,
        sectionId: section.id,
        overflow: round(Math.max(overflow, collision > 8 ? collision : 0)),
      });
      continue;
    }

    frames.push({
      id: section.id,
      kind: section.kind,
      title: section.heading ?? TEMPLATE_INFO[template].label,
      page,
      ...frame.frame,
    });
    primitives.push(...result.primitives);
    for (const [key, rect] of Object.entries(result.anchors ?? {})) {
      anchors.set(key, rect);
    }
  }

  for (const id of plan.unplaced) {
    if (page === 1) {
      context.report({
        code: "section-unplaced",
        severity: "error",
        message: `Section "${id}" has no frame in the ${template} template for the ${profile.id} profile.`,
        sectionId: id,
      });
    }
  }

  // Sections the planner rejected for their measured size carry an actionable
  // `section-overflow` (the id is also in `unplaced`, which is the placement
  // fact; this is the measurement reason).
  if (page === 1) {
    for (const entry of plan.rejected) {
      context.report({
        code: "section-overflow",
        severity: "error",
        message: entry.message,
        sectionId: entry.sectionId,
        overflow: entry.overflow,
      });
    }
  }

  // ---- annotations -----------------------------------------------------
  if (options.annotations !== false && (source.annotations?.length ?? 0) > 0) {
    const avoidBoxes = primitives
      .filter((primitive) => primitive.kind === "text")
      .map((primitive) => ({
        x: (primitive as { x: number }).x,
        y: (primitive as { y: number }).y,
        width: (primitive as { width: number }).width,
        height: (primitive as { height: number }).height,
      }));
    const annotationResult = renderAnnotations(source.annotations ?? [], anchors, context, {
      bounds: safe,
      targetLabel: (targetId) => labelIndex.get(targetId),
      avoid: avoidBoxes,
    });
    primitives.push(...annotationResult.primitives);
    diagnostics.push(...annotationResult.diagnostics);
  }

  const summary = buildSummary(source, frames, sections, page, plan.pages);

  return {
    schemaVersion: 1,
    id: options.id ?? `infographic:${source.id}`,
    sourceId: source.id,
    template,
    artDirection,
    profile: profile.id,
    canvas,
    primitives,
    summary,
    sections: frames,
    diagnostics: dedupeDiagnostics(diagnostics),
    provenance: {
      sourceDigest: sourceDigest(source),
      template,
      artDirection,
      profile: profile.id,
      layoutVersion: LAYOUT_VERSION,
    },
    pages: plan.pages,
    metadata: { title: source.title, language: source.language },
  };
}

/**
 * A section heading that repeats the panel title says nothing new and doubles
 * the largest words on the canvas; drop it (the title already names the panel).
 */
function withoutEchoedHeading<S extends InfographicSection>(section: S, title: string): S {
  const normalise = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  return section.heading && normalise(section.heading) === normalise(title) ? { ...section, heading: undefined } : section;
}

/**
 * Optical balance for short content. Renders every section once with a silent
 * context and measures each frame's own slack (frame bottom − content bottom).
 * The body moves down by ≈38% of the *smallest* slack — just above centre,
 * where the eye reads "centred". Using the minimum keeps the invariant that no
 * section loses height it actually uses: every frame shifts by the same amount
 * (so column and row alignment holds) and no frame shrinks below its content.
 * Frame-filling sections (charts, timelines) have no slack, so pages using
 * them are left exactly as planned.
 */
function verticalBalanceOffset(
  frames: readonly { sectionId: string; frame: RectInfo }[],
  sections: readonly InfographicSection[],
  context: SectionRenderContext
): number {
  if (frames.length === 0) return 0;
  const silent: SectionRenderContext = { ...context, id: () => "measure", report: () => undefined };
  let slack = Infinity;
  for (const entry of frames) {
    const section = sections.find((candidate) => candidate.id === entry.sectionId);
    const renderer = section ? SECTION_RENDERERS[section.kind] : undefined;
    if (!section || !renderer) continue;
    const bounds = primitivesBounds(renderer(section, entry.frame, silent).primitives);
    if (!bounds) continue;
    slack = Math.min(slack, entry.frame.y + entry.frame.height - (bounds.y + bounds.height));
  }
  if (!Number.isFinite(slack) || slack < context.style.spacing[4]) return 0;
  return round(slack * 0.38);
}

/** Title block for page 1: subtitle eyebrow, display title, optional thesis. */
function renderHeader(
  source: InfographicSource,
  box: RectInfo,
  context: SectionRenderContext
): InfographicPrimitive[] {
  const style = context.style;
  const primitives: InfographicPrimitive[] = [];
  let cursor = box.y;

  if (source.subtitle) {
    const eyebrow = layoutTextForRole(
      {
        text: source.subtitle,
        box: { x: box.x, y: cursor, width: box.width, height: 0 },
        typeRole: "label",
        overrides: { family: style.font.heading },
        color: style.color.accent,
        role: "infographic-subtitle",
        semanticId: source.id,
        maxLines: 2,
      },
      context
    );
    primitives.push(eyebrow.primitive);
    cursor += eyebrow.height + style.spacing[1];
  }

  const title = layoutTextForRole(
    {
      text: source.title,
      box: { x: box.x, y: cursor, width: box.width, height: 0 },
      typeRole: "title",
      color: style.color.ink,
      role: "infographic-title",
      semanticId: source.id,
      maxLines: 3,
      maxHeight: round(box.height * 0.6),
      shrink: { floor: style.type.h2 },
    },
    context
  );
  primitives.push(title.primitive);
  cursor += title.height + style.spacing[1];

  if (source.thesis) {
    primitives.push(
      layoutTextForRole(
        {
          text: source.thesis,
          box: { x: box.x, y: cursor, width: box.width, height: round(Math.max(0, box.y + box.height - cursor)) },
          typeRole: "body",
          color: style.color.inkMuted,
          role: "infographic-thesis",
          maxLines: 4,
        },
        context
      ).primitive
    );
  }

  return primitives;
}

/** Convenience: all pages of a source, built with the same options. */
export function buildInfographicPages(
  source: InfographicSource,
  options: BuildInfographicOptions = {}
): InfographicLayout[] {
  const first = buildInfographic(source, { ...options, page: 1 });
  const pages: InfographicLayout[] = [first];
  for (let page = 2; page <= first.pages; page += 1) {
    pages.push(buildInfographic(source, { ...options, page }));
  }
  return pages;
}

/** Template the engine would choose, without building a layout. */
export function chooseTemplate(
  source: InfographicSource,
  options: Pick<
    BuildInfographicOptions,
    "artDirection" | "profile" | "size" | "styleOverride" | "columns" | "density" | "emphasis" | "orientation"
  > = {}
) {
  const style = resolveStyle(options.artDirection ?? "editorial", options.styleOverride);
  const profile = getOutputProfile(options.profile ?? "youtube-landscape", options.size);
  const canvas = {
    width: profile.width,
    height: profile.height,
    profile: profile.id,
    background: style.color.canvas,
    safeRegion: options.size
      ? round(Math.min(profile.width, profile.height) * profile.safeInset)
      : safeInset(profile),
  };
  return selectTemplate({
    style,
    canvas,
    safe: insetRect({ x: 0, y: 0, width: canvas.width, height: canvas.height }, canvas.safeRegion),
    sections: source.sections ?? [],
    columns: options.columns,
    density: options.density,
    emphasis: options.emphasis,
    orientation: options.orientation,
  });
}

export { getArtDirection, getOutputProfile };
export type { ChartSection };
