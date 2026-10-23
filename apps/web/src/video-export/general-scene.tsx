import { fitSvgText } from "../../scripts/video-production/text-layout.mjs";
import { getGeneralFrame } from "../../scripts/video-production/general-visual-plan.mjs";
import type { GeneralFrame, GeneralVisualPlan } from "../../scripts/video-production/general-visual-plan.mjs";
import { useMemo } from "react";
import type { ReactNode } from "react";
import { DiagramStage } from "@/components/motion/diagram-stage-react";
import { evaluateProcessJourney } from "@/components/motion/process-journey";
import { createGeneralJourney, GENERAL_JOURNEY_VIEWPORT } from "./general-journey";
import type { RationalFps } from "@/components/motion/types";
import { ChartStoryView } from "@/components/infographic/chart-story-react";
import { buildQuantitativeChartStory } from "./quantitative-chart-story";
import { compileChapterAttention, sampleChapterAttention } from "./attention-style";
import { sampleSemanticMotion } from "./semantic-scene-motion";
import { SemanticDiagram } from "./semantic-scene-diagrams";

const ink = "#F5F2EB";
const muted = "#A5B9C5";
const accent = "#D9AF7C";
const turquoise = "#81C4BF";
const palette = [turquoise, accent, "#A89CD5", "#B4D99B", "#D98D9C"];

function Node({ x, y, width, height, label, index, highlight = false }: { x: number; y: number; width: number; height: number; label: string; index: number; highlight?: boolean }) {
  const text = fitSvgText(label, { maxWidthPx: width - 55, preferredSize: 29, minSize: 17, maxLines: 2 });
  return <g data-general-node={index}>
    <rect x={x} y={y} width={width} height={height} rx="23" fill={highlight ? "#294C52" : "#203743"} stroke={palette[index % palette.length]} strokeWidth={highlight ? 4 : 2} />
    <rect x={x + 20} y={y + 22} width="7" height={height - 44} rx="3" fill={palette[index % palette.length]} />
    {text.lines.map((line, i) => <text key={`${i}-${line}`} x={x + width / 2 + 5} y={y + height / 2 - (text.lines.length - 1) * 18 + i * 36 + 11} fontSize={text.fontSize} fontWeight="650" textAnchor="middle" fill={ink}>{line}</text>)}
  </g>;
}

function Journey({ items, fps, chapterFrames, frame, fallback }: { items: string[]; fps: RationalFps; chapterFrames: number; frame: number; fallback: ReactNode }) {
  const plan = useMemo(() => createGeneralJourney(items, chapterFrames, fps), [items, chapterFrames, fps]);
  if (!plan) return fallback;
  const sample = evaluateProcessJourney(plan, frame);
  const overlay = <>
    <circle cx={sample.position.x} cy={sample.position.y} r="25" fill={turquoise} opacity=".15" />
    <circle data-process-journey-subject={sample.subjectId} cx={sample.position.x} cy={sample.position.y} r="13" fill={accent} stroke="#101D2D" strokeWidth="4" />
  </>;
  return <g transform="translate(1040 242)">
    <DiagramStage graph={plan.graph} timeline={plan.diagramTimeline} frame={frame}
      width={GENERAL_JOURNEY_VIEWPORT.width} height={GENERAL_JOURNEY_VIEWPORT.height}
      ariaLabel="Illustrative process showing how the stages connect" reducedMotion={false}
      focusedNodeIds={sample.focusedNodeIds} overlay={overlay}
      style={{ width: "770px", height: "640px", background: "transparent", overflow: "visible" }}
      theme={{ node: "#203743", edge: "#72929F", accent, ink, fontSize: 28, strokeWidth: 3 }}
      renderNode={({ node, bounds, focused }) => <g opacity={focused ? 1 : .8}>
        <Node x={0} y={0} width={bounds.width} height={bounds.height} label={node.label}
          index={Number(node.id.slice("step-".length))} highlight={focused} />
      </g>}
    />
  </g>;
}

function StaticVerticalDiagram({ state }: { state: GeneralFrame }) {
  const items = state.visual.items.slice(0, state.visibleItems);
  const all = state.visual.items;
  const height = 110;
  const gap = all.length === 5 ? 18 : all.length === 4 ? 26 : 46;
  const startY = Math.max(240, 540 - (all.length * height + (all.length - 1) * gap) / 2);
  return <g>
    {items.map((label, i) => <g key={`${label}-${i}`}>
      <Node x={1150} y={startY + i * (height + gap)} width={555} height={height} label={label} index={i} highlight={state.intent === "general-payoff" && i === all.length - 1} />
      {i > 0 && <g><path d={`M1427 ${startY + i * (height + gap) - gap + 4} v${gap - 14}`} stroke={accent} strokeWidth="4" strokeLinecap="round"/><path d={`M1418 ${startY + i * (height + gap) - 14} l9 11 9 -11`} fill="none" stroke={accent} strokeWidth="4" strokeLinejoin="round"/></g>}
    </g>)}
  </g>;
}

function Diagram({ state, fps, chapterFrames }: { state: GeneralFrame; fps: RationalFps; chapterFrames: number }) {
  const items = state.visual.items.slice(0, state.visibleItems);
  const all = state.visual.items;
  if (state.intent === "general-flow") return <Journey items={all} fps={fps} chapterFrames={chapterFrames}
    frame={state.localFrame} fallback={<StaticVerticalDiagram state={state} />} />;
  if (state.intent === "general-comparison" && all.length <= 3) {
    const width = all.length === 3 ? 220 : 325;
    const gap = all.length === 3 ? 25 : 40;
    return <g>
      {items.map((label, i) => <g key={`${label}-${i}`}>
        <Node x={1060 + i * (width + gap)} y={470} width={width} height={165} label={label} index={i} />
        {i > 0 && <text x={1040 + i * (width + gap)} y={560} fill={accent} textAnchor="middle" fontSize="25" fontWeight="700">VS</text>}
      </g>)}
    </g>;
  }
  if (state.intent === "general-breakdown") {
    // Labels are qualitative: never draw different bar lengths without sourced
    // measurements and an honest zero-origin scale.
    const height = 94;
    const gap = 18;
    const startY = 540 - (all.length * height + (all.length - 1) * gap) / 2;
    return <g data-general-breakdown="qualitative">
      {items.map((label, i) => <Node key={`${label}-${i}`} x={1077} y={startY + i * (height + gap)}
        width={680} height={height} label={label} index={i} />)}
      <text x="1417" y={startY + all.length * height + (all.length - 1) * gap + 44}
        fontSize="20" fill={muted} letterSpacing="2" textAnchor="middle">QUALITATIVE · NOT TO SCALE</text>
    </g>;
  }
  return <StaticVerticalDiagram state={state} />;
}

export function GeneralExportScene({ plan, frame }: { plan: GeneralVisualPlan; frame: number }) {
  const state = getGeneralFrame(plan, frame);
  const chapter = plan.chapters[state.chapterIndex];
  const chart = state.visual.chart;
  const compiledAttention = useMemo(() => compileChapterAttention(chapter, plan), [chapter, plan]);
  const attention = compiledAttention
    ? sampleChapterAttention(compiledAttention, state.localFrame, chapter.endFrame - chapter.startFrame)
    : null;
  const diagramState = attention && !attention.showDiagram ? { ...state, visibleItems: 0 } : state;
  const semanticMotion = sampleSemanticMotion({intent:state.intent,
    phase:state.visual.direction?.phase??"none",
    localFrame:state.localFrame,durationFrames:chapter.endFrame-chapter.startFrame,
    visibleItems:diagramState.visibleItems,itemCount:state.visual.items.length});

  const typographyScale = attention?.titleScale ?? 1;
  const chartStory = useMemo(() => chart ? buildQuantitativeChartStory({
    chart, beatId: chapter.id, title: state.visual.headline,
    durationFrames: chapter.endFrame - chapter.startFrame, fps: plan.manifest.fps,
    locale: plan.locale ?? "en-US", evidence: plan.evidence,
  }) : undefined, [chart, chapter, state.visual.headline, plan.manifest.fps, plan.locale, plan.evidence]);
  const isPayoffHidden = state.intent === "general-payoff" && state.visibleItems === 0;
  const heading = fitSvgText(state.visual.headline, { maxWidthPx: 760, preferredSize: 72, minSize: 35, maxLines: 3 });
  const sub = fitSvgText(state.visual.subhead, { maxWidthPx: 750, preferredSize: 32, minSize: 22, maxLines: 4 });
  const disclosure = chartStory ? fitSvgText(chartStory.disclosure, { maxWidthPx: 760, preferredSize: 22, minSize: 18, maxLines: 3 }) : undefined;
  const source = chartStory ? fitSvgText(chartStory.sourceText, { maxWidthPx: 760, preferredSize: 20, minSize: 17, maxLines: 3 }) : undefined;
  if (disclosure && source && disclosure.lines.length + source.lines.length > 4) {
    throw new Error(`Chart ${chapter.id} provenance copy needs shortening to fit its visual source area without clipping`);
  }
  return <div data-general-export-frame="" style={{ position: "relative", width: 1920, height: 1080, fontFamily: "Geist Variable, Geist, Arial, sans-serif" }}>
  <svg data-kumiki-hook-recipe={attention?.recipe ?? undefined} data-kumiki-typography-recipe={state.visual.typographyStyle} xmlns="http://www.w3.org/2000/svg" role="img" aria-label={isPayoffHidden ? "The closing answer is about to appear" : `${state.visual.headline}: ${state.visual.subhead}`} viewBox="0 0 1920 1080" width="1920" height="1080" style={{ fontFamily: "Geist Variable, Geist, Arial, sans-serif", display: "block" }}>
    <defs>
      <linearGradient id="general-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#101D2D"/><stop offset="1" stopColor="#1D3A48"/></linearGradient>
      <radialGradient id="general-glow"><stop offset="0" stopColor="#D9AF7C" stopOpacity=".16"/><stop offset="1" stopColor="#D9AF7C" stopOpacity="0"/></radialGradient>
      {attention && state.visual.typographyStyle === "wipe" && <clipPath id="kumiki-title-wipe"><rect x="110" y="195" width={attention.wipeWidth} height="690" /></clipPath>}
    </defs>
    <rect width="1920" height="1080" fill="url(#general-bg)" />
    <circle cx="1545" cy="500" r="605" fill="url(#general-glow)" />
    <path d="M120 156 H1800" stroke="#506676" strokeWidth="2" opacity=".7"/>
    <rect x="120" y="90" width="14" height="14" rx="4" fill={accent}/>
    <text x="156" y="107" fill={accent} fontSize="26" fontWeight="700" letterSpacing="5">CONTENTGEN · EXPLAINER</text>
    <text x="1800" y="107" fill={muted} fontSize="24" textAnchor="end">{String(state.chapterIndex + 1).padStart(2, "0")} / {String(state.chapterCount).padStart(2, "0")}</text>
    <line x1="988" y1="222" x2="988" y2="920" stroke="#425D6D" strokeWidth="2" />
    {!isPayoffHidden && <g opacity={attention?.titleOpacity ?? state.enterProgress}
      clipPath={attention && state.visual.typographyStyle === "wipe" ? "url(#kumiki-title-wipe)" : undefined}
      transform={attention ? `translate(${125 * (1 - typographyScale)} ${320 * (1 - typographyScale)}) scale(${typographyScale})` : `translate(${(1 - state.enterProgress) * -38} 0)`}>
      <text x="125" y="243" fill={accent} fontSize="26" letterSpacing="3.8" fontWeight="700">{state.visual.emphasis.toUpperCase()}</text>
      {heading.lines.map((line, i) => <text data-general-copy="heading" key={`${i}-${line}`} x="120" y={348 + i * 92} fill={ink} fontSize={heading.fontSize} fontWeight="750" letterSpacing="-1.7">{line}</text>)}
      {sub.lines.map((line, i) => <text data-general-copy="subheading" key={`${i}-${line}`} x="125" y={Math.max(662, 428 + heading.lines.length * 92) + i * 49} fill={muted} fontSize={sub.fontSize}>{line}</text>)}
    </g>}
    {!chartStory && (state.intent==="general-flow"
      ? <Diagram state={diagramState} fps={plan.manifest.fps}
          chapterFrames={chapter.endFrame - chapter.startFrame}/>
      : <SemanticDiagram state={diagramState} motion={semanticMotion} renderNode={Node}/>)}
    {chartStory && disclosure && source && <g data-chart-provenance-basis={chartStory.provenanceBasis} data-chart-source-refs={chart?.provenance.basis === "measured" ? chart.provenance.evidenceRefs.join(",") : ""}>
      {disclosure.lines.map((line, index) => <text data-general-chart-copy="disclosure" key={`d-${index}`} x="1040" y={848 + index * 29}
        fontSize={disclosure.fontSize} fill={accent}>{line}</text>)}
      {source.lines.map((line, index) => <text data-general-chart-copy="source" key={`s-${index}`} x="1040" y={856 + disclosure.lines.length * 29 + index * 27}
        fontSize={source.fontSize} fill={muted}>{line}</text>)}
    </g>}
    <path d="M120 978 H1800" stroke="#4C6570" strokeWidth="2" />
    <rect x="120" y="978" width={1680 * ((state.chapterIndex + state.progress) / state.chapterCount)} height="5" fill={accent} />
    <text x="120" y="1034" fill={muted} fontSize="22">{state.disclaimer}</text>
    <text x="1800" y="1034" textAnchor="end" fill={muted} fontSize="22">DRAFT · {frame}f</text>
  </svg>
  {chartStory && <div data-general-chart-container="" style={{ position: "absolute", left: 1040, top: 230, width: 760, height: 590 }}>
    <ChartStoryView spec={chartStory.spec} frame={state.localFrame} width={760} height={590} />
  </div>}
  </div>;
}
