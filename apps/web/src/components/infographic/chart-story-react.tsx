import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { createCanvasMeasurer, segmentText } from "../media/text-layout";
import type { MeasureText } from "../media/text-layout";
import type { ComponentPropsWithoutRef } from "react";
import { resolveStyle } from "./art-direction";
import type { DeepPartial } from "./art-direction";
import { resolvePaint } from "./paint";
import { PaintDefs, PrimitiveShape } from "./react";
import type { ArtDirectionId, RectInfo, ResolvedStyle } from "./types";
import {
  chartCompareLabel, chartMarkBox, chartStoryPrimitives, chartValueLabel, checkChartClaim, evaluateChartStory, layoutChartStory, validateChartStory,
} from "./chart-story";
import type { ChartStoryDiagnostic, ChartStorySpec } from "./chart-story";

export interface ChartStoryViewProps extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  spec: ChartStorySpec;
  /** Absolute frame. The view owns no clock. */
  frame: number;
  /** Output box in px. The chart frame between the title and claim lanes stays constant across beats. */
  width: number;
  height: number;
  artDirection?: ArtDirectionId;
  /** Normalized safe rect (e.g. a ShortSafeFrame content area). Default: 5% inset. */
  safe?: RectInfo;
  /** Token overrides applied after the output scaling (palette, faces, type, strokes). */
  styleOverride?: DeepPartial<ResolvedStyle>;
  onDiagnostics?: (diagnostics: ChartStoryDiagnostic[]) => void;
}

/**
 * The art direction's tokens at this output size. Ramps are authored for a 1080 px short side read at
 * poster distance; a video frame is read once, at a glance, so small text gets a floor of 2.6% of the
 * short side and strokes are 1.5× heavier.
 */
export function chartStoryStyle(id: ArtDirectionId, width: number, height: number, override?: DeepPartial<ResolvedStyle>): ResolvedStyle {
  const base = resolveStyle(id), u = Math.min(width, height), k = u / 1080, floor = Math.round(u * 0.026);
  const scaled: Record<string, unknown> = {
    type: Object.fromEntries(Object.entries(base.type).map(([key, v]) => [key, Math.max(floor, Math.round(v * k))])),
    stroke: Object.fromEntries(Object.entries(base.stroke).map(([key, v]) => [key, Math.round(v * k * 15) / 10])),
    spacing: base.spacing.map(v => Math.round(v * k)),
  };
  // Consumer overrides win, merged per token group like resolveStyle does.
  for (const [key, v] of Object.entries(override ?? {})) {
    const prior = scaled[key];
    scaled[key] = v && typeof v === "object" && !Array.isArray(v) && prior && typeof prior === "object" && !Array.isArray(prior) ? { ...prior, ...v } : v;
  }
  return resolveStyle(id, scaled as DeepPartial<ResolvedStyle>);
}

/** The same line count as a greedy wrap at `maxWidth`, at the narrowest width that keeps it: no lone last word. */
function balancedWrap(text: string, font: string, maxWidth: number, measure: MeasureText, language?: string): string[] {
  const greedy = wrapMeasured(text, font, maxWidth, measure, language);
  if (greedy.length < 2) return greedy;
  let lo = maxWidth / greedy.length, hi = maxWidth;
  while (hi - lo > 2) { const mid = (lo + hi) / 2; if (wrapMeasured(text, font, mid, measure, language).length > greedy.length) lo = mid; else hi = mid; }
  return wrapMeasured(text, font, hi, measure, language);
}

/** Height of a claim card holding `lines` claim lines and the data-check line. */
const claimCardHeight = (type: { size: number; check: number; pad: number }, lines: number) => type.pad * 2 + lines * type.size * 1.2 + type.check * 1.6;

/** Greedy wrap at locale-aware break opportunities with a real font measurer. Never truncates. */
function wrapMeasured(text: string, font: string, maxWidth: number, measure: MeasureText, language?: string): string[] {
  const lines: string[] = [];
  let line = "";
  for (const part of segmentText(text, language)) {
    const next = line + part;
    if (line && measure(font, next.trimEnd()) > maxWidth) { lines.push(line.trimEnd()); line = part.trimStart(); }
    else line = next;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

/** Lanes are fixed for the whole story so the chart (and its axes) never move between beats. */
export function chartStoryFrames(width: number, height: number, safe?: RectInfo, claimHeight?: number) {
  const s = safe ? { x: safe.x * width, y: safe.y * height, width: safe.width * width, height: safe.height * height }
    : { x: width * 0.05, y: height * 0.05, width: width * 0.9, height: height * 0.9 };
  const portrait = height > width, title = Math.round(s.height * (portrait ? 0.12 : 0.15)), claim = Math.round(claimHeight ?? s.height * (portrait ? 0.17 : 0.2));
  return {
    title: { x: s.x, y: s.y, width: s.width, height: title },
    // A breathing gap keeps the chart's source note visually apart from the claim card.
    chart: { x: s.x, y: s.y + title, width: s.width, height: s.height - title - claim - (claim ? Math.round(Math.min(width, height) * 0.03) : 0) },
    claim: { x: s.x, y: s.y + s.height - claim, width: s.width, height: claim },
  };
}

/** Story beats over the existing chart renderer: constant axes, data-addressed emphasis, checked claims. */
export const ChartStoryView = forwardRef<HTMLDivElement, ChartStoryViewProps>(function ChartStoryView({
  spec, frame, width, height, artDirection = "editorial", safe, styleOverride, onDiagnostics, style, ...props
}, ref) {
  const theme = useMemo(() => chartStoryStyle(artDirection, width, height, styleOverride), [artDirection, width, height, styleOverride]);
  const u = Math.min(width, height), font = theme.font.body, heading = theme.font.heading;
  // Text is measured with the real faces: re-measure once they load, and report "pending" until then.
  const [fontEpoch, setFontEpoch] = useState(0);
  const [fontsReady, setFontsReady] = useState(() => typeof document === "undefined" || !document.fonts);
  useEffect(() => {
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (!fonts) return;
    let live = true;
    const faces = [`${theme.weight.heading} 32px ${heading}`, `${theme.weight.strong} 32px ${font}`, `${theme.weight.body} 32px ${font}`];
    const bump = () => { if (!live) return; setFontEpoch(n => n + 1); setFontsReady(faces.every(f => fonts.check(f))); };
    void Promise.all(faces.map(f => fonts.load(f))).then(bump, bump);
    fonts.addEventListener("loadingdone", bump);
    return () => { live = false; fonts.removeEventListener("loadingdone", bump); };
  }, [theme, heading, font]);
  const measure = useMemo(() => { void fontEpoch; return createCanvasMeasurer({}); }, [fontEpoch]);
  // Claims are measured first: the claim lane is sized for the longest one at this output (fixed for the
  // whole story, so the chart never moves) and capped at 30% of the safe height. Never truncated.
  const claimType = useMemo(() => ({ size: Math.round(u * 0.042), check: Math.round(u * 0.026), pad: Math.round(u * 0.03) }), [u]);
  const claimFont = `${theme.weight.heading} ${claimType.size}px ${heading}`;
  const base = useMemo(() => chartStoryFrames(width, height, safe), [width, height, safe]);
  const claims = useMemo(() => new Map(spec.beats.flatMap(b => b.kind === "conclude"
    ? [[b.id, balancedWrap(b.claim.text, claimFont, base.claim.width - claimType.pad * 2, measure, spec.language)] as const] : [])), [spec, claimFont, base, measure, claimType.pad]);
  const safeHeight = base.claim.y + base.claim.height - base.title.y;
  const claimLimit = Math.round(safeHeight * 0.3);
  const lanes = useMemo(() => {
    const need = Math.max(0, ...[...claims.values()].map(lines => claimCardHeight(claimType, lines.length)));
    return chartStoryFrames(width, height, safe, claims.size ? Math.min(claimLimit, Math.max(base.claim.height, Math.ceil(need))) : 0);
  }, [claims, claimType, width, height, safe, base, claimLimit]);
  const layout = useMemo(() => layoutChartStory(spec, lanes.chart, theme), [spec, lanes, theme]);
  const diagnostics = useMemo(() => {
    const list = validateChartStory(spec, layout, { minTextPx: Math.round(u * 0.02) });
    for (const [beatId, lines] of claims) {
      if (claimCardHeight(claimType, lines.length) > lanes.claim.height) list.push({ code: "chart-story-claim-overflow", severity: "error", beatId,
        message: `The claim in "${beatId}" needs ${lines.length} lines, more than 30% of the frame at ${width}×${height}; shorten it.` });
    }
    return list;
  }, [spec, layout, u, claims, claimType, lanes, width, height]);
  const notify = useRef(onDiagnostics), latest = useRef(diagnostics);
  notify.current = onDiagnostics; latest.current = diagnostics;
  const signature = JSON.stringify(diagnostics);
  useEffect(() => { notify.current?.(latest.current); }, [signature]);

  const state = evaluateChartStory(spec, frame);
  const primitives = chartStoryPrimitives(layout, state);
  const paint = useMemo(() => resolvePaint(primitives, `${spec.id}-${width}x${height}`), [primitives, spec.id, width, height]);
  const scenario = spec.scenarios.find(s => s.id === state.scenarioId)!, data = layout.scenarios[state.scenarioId].spec;
  const pill = (x: number, y: number, text: string, amount: number, tone: "accent" | "ink" = "accent") => {
    const size = Math.round(u * 0.034), pillFont = `${theme.weight.strong} ${size}px ${font}`;
    const w = Math.round(measure(pillFont, text) + size * 1.2), h = Math.round(size * 1.7);
    const left = Math.max(lanes.chart.x, Math.min(lanes.chart.x + lanes.chart.width - w, x - w / 2));
    return <g opacity={amount}>
      <rect x={left} y={y - h} width={w} height={h} rx={h / 2} fill={tone === "accent" ? theme.color.accent : theme.color.ink} />
      <text x={left + w / 2} y={y - h / 2} textAnchor="middle" dominantBaseline="central" fill={tone === "accent" ? theme.color.onAccent : theme.color.canvas}
        style={{ font: pillFont }}>{text}</text>
    </g>;
  };
  const focusBox = state.focus ? chartMarkBox(layout, state.scenarioId, state.focus.seriesId, state.focus.index) : undefined;
  const compareBoxes = state.compare ? [chartMarkBox(layout, state.scenarioId, state.compare.seriesId, state.compare.from), chartMarkBox(layout, state.scenarioId, state.compare.seriesId, state.compare.to)] : [];
  const claimCheck = state.claim ? checkChartClaim(spec, state.claim.claim) : undefined;
  const beatNote = state.beat.kind === "focus" ? state.beat.note : undefined;
  return <div {...props} ref={ref} data-km-chart-story="" data-chart-story-beat={state.beat.id} data-chart-story-scenario={state.scenarioId}
    data-chart-story-status={diagnostics.some(d => d.severity === "error") ? "error" : fontsReady ? "ready" : "pending"}
    style={{ position: "relative", width: "100%", aspectRatio: `${width} / ${height}`, ...style }}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${spec.title}. ${layout.scenarios[state.scenarioId].summary}`}
      style={{ display: "block", width: "100%", height: "100%", background: theme.color.canvas }}>
      <PaintDefs defs={paint.defs} />
      <text x={lanes.title.x} y={lanes.title.y + u * 0.05} fill={theme.color.ink} style={{ font: `${theme.weight.heading} ${Math.round(u * 0.05)}px ${heading}` }}>{spec.title}</text>
      <text x={lanes.title.x} y={lanes.title.y + u * 0.095} fill={theme.color.inkMuted} style={{ font: `${theme.weight.body} ${Math.round(u * 0.03)}px ${font}` }}>
        {scenario.label}{scenario.note ? ` · ${scenario.note}` : ""}{beatNote ? ` — ${beatNote}` : ""}</text>
      {primitives.map(p => <PrimitiveShape key={p.id} primitive={p} paint={paint} />)}
      {focusBox && state.focus ? <g data-chart-story-focus="">
        <rect x={focusBox.x - 8} y={focusBox.y - 8} width={focusBox.width + 16} height={focusBox.height + 16} rx={10} fill="none"
          stroke={theme.color.accentStrong} strokeWidth={Math.max(3, u * 0.004)} opacity={state.focus.amount} />
        {pill(focusBox.x + focusBox.width / 2, focusBox.y - 16, `${data.categories[state.focus.index]}: ${chartValueLabel(data, state.focus.seriesId, state.focus.index, spec.language)}`, state.focus.amount)}
      </g> : null}
      {state.compare && compareBoxes[0] && compareBoxes[1] ? (() => {
        const [a, b] = compareBoxes as RectInfo[], top = Math.min(a.y, b.y) - u * 0.04, ax = a.x + a.width / 2, bx = b.x + b.width / 2;
        return <g data-chart-story-compare="" opacity={state.compare.amount}>
          {[a, b].map((r, i) => <rect key={i} x={r.x - 8} y={r.y - 8} width={r.width + 16} height={r.height + 16} rx={10} fill="none" stroke={theme.color.accentStrong} strokeWidth={Math.max(3, u * 0.004)} />)}
          <path d={`M${ax} ${a.y - 12} V${top} H${bx} V${b.y - 12}`} fill="none" stroke={theme.color.accentStrong} strokeWidth={Math.max(2, u * 0.003)} />
          {pill((ax + bx) / 2, top - 10, `${chartValueLabel({ ...data, unit: undefined }, state.compare.seriesId, state.compare.from, spec.language)} → ${chartValueLabel(data, state.compare.seriesId, state.compare.to, spec.language)} · ${chartCompareLabel(data, state.compare.seriesId, state.compare.from, state.compare.to, state.compare.measure, spec.language)}`, 1)}
        </g>;
      })() : null}
      {state.claim ? <g data-chart-story-claim="" opacity={state.claim.amount}>
        <rect {...lanes.claim} rx={u * 0.02} fill={theme.color.surface} stroke={theme.color.rule} />
        {(() => {
          const lines = claims.get(state.beat.id) ?? [], blockHeight = lines.length * claimType.size * 1.2 + claimType.check * 1.6;
          const top = lanes.claim.y + Math.max(claimType.pad, (lanes.claim.height - blockHeight) / 2), x = lanes.claim.x + claimType.pad;
          const support = state.claim.claim.support.kind, verdict = claimCheck?.ok
            ? `Checked against the data: ${claimCheck.computed.toFixed(support === "percent-change" ? 1 : 0)}${support === "percent-change" ? "%" : data.unit ? ` ${data.unit}` : ""}`
            : `Not supported by the data: ${claimCheck && !claimCheck.ok ? claimCheck.message : ""}`;
          return <>
            {lines.map((line, i) => <text key={i} x={x} y={top + (i + 0.85) * claimType.size * 1.2} fill={theme.color.ink} style={{ font: claimFont }}>{line}</text>)}
            <text x={x} y={top + lines.length * claimType.size * 1.2 + claimType.check * 1.25} fill={claimCheck?.ok ? theme.color.positive : theme.color.negative}
              style={{ font: `${theme.weight.body} ${claimType.check}px ${font}` }}>{verdict}</text>
          </>;
        })()}
      </g> : null}
    </svg>
  </div>;
});
