import { fitSvgText } from "../../scripts/video-production/text-layout.mjs";
import { layoutTeachingCard } from "../../scripts/video-production/teaching-card-layout.mjs";
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
import { entryFadeOpacity, motionRevealState } from "../../scripts/video-production/scene-motion.mjs";
import { SemanticDiagram } from "./semantic-scene-diagrams";
import { HomeCostStoryScene } from "./home-cost-story-scene";
import { TeachingStateScene } from "./teaching-state-scene";
import { SemanticMechanicScene } from "./semantic-mechanic-scene";
import { ConversationCharacters } from "./conversation-characters";
import type { ExportRigMap } from "./conversation-characters";

const ink = "#F5F2EB";
const muted = "#A5B9C5";
const accent = "#D9AF7C";
const turquoise = "#81C4BF";
const palette = [turquoise, accent, "#A89CD5", "#B4D99B", "#D98D9C"];

function Node({ x, y, width, height, label, note, index, highlight = false }: { x: number; y: number; width: number; height: number; label: string; note?: string; index: number; highlight?: boolean }) {
  // Named explanatory notes share one height budget with their titles.
  // Legacy cards without notes keep their original typography and placement.
  const card = note ? layoutTeachingCard({ label, note, width, height }) : null;
  const title = card?.title ?? fitSvgText(label, { maxWidthPx: width - 55, preferredSize: 29, minSize: 17, maxLines: 2 });
  return <g data-general-node={index}>
    <rect x={x} y={y} width={width} height={height} rx="23" fill={highlight ? "#294C52" : "#203743"} stroke={palette[index % palette.length]} strokeWidth={highlight ? 4 : 2} />
    <rect x={x + 20} y={y + 22} width="7" height={height - 44} rx="3" fill={palette[index % palette.length]} />
    {title.lines.map((line, i) => <text key={`${i}-${line}`} x={x + width / 2 + 5}
      y={card ? y + card.title.baselines[i] : y + height / 2 - (title.lines.length - 1) * 18 + i * 36 + 11}
      fontSize={title.fontSize} fontWeight="650" textAnchor="middle" fill={ink}>{line}</text>)}
    {card?.detail.lines.map((line, i) => <text data-teaching-detail="" key={i} x={x + width / 2 + 5}
      y={y + card.detail.baselines[i]} fontSize={card.detail.fontSize} textAnchor="middle" fill={muted}>{line}</text>)}
  </g>;
}

function Journey({ items, notes, fps, chapterFrames, frame, fallback, visibleCount }: { items: string[]; notes?: string[]; fps: RationalFps; chapterFrames: number; frame: number; fallback: ReactNode; visibleCount?: number }) {
  const plan = useMemo(() => createGeneralJourney(items, chapterFrames, fps), [items, chapterFrames, fps]);
  if (!plan) return fallback;
  const sample = evaluateProcessJourney(plan, frame);
  const overlay = <>
    <circle cx={sample.position.x} cy={sample.position.y} r="25" fill={turquoise} opacity=".15" />
    <circle data-process-journey-subject={sample.subjectId} cx={sample.position.x} cy={sample.position.y} r="13" fill={accent} stroke="#101D2D" strokeWidth="4" />
  </>;
  // The Kumiki process graph remains intact for accurate routes, but authored
  // motion reveals only the permitted top-to-bottom stages.
  const height=items.length>=5?84:items.length===4?100:116;
  const gap=Math.min(90,Math.floor((GENERAL_JOURNEY_VIEWPORT.height-80-items.length*height)/(items.length-1)));
  const top=Math.round((GENERAL_JOURNEY_VIEWPORT.height-(items.length*height+(items.length-1)*gap))/2);
  const revealHeight=visibleCount===undefined?GENERAL_JOURNEY_VIEWPORT.height:
    visibleCount===0?0:Math.min(GENERAL_JOURNEY_VIEWPORT.height,
      top+visibleCount*height+(visibleCount-1)*gap+12);
  return <g transform="translate(1040 242)">
    <clipPath id="contentgen-flow-safe-bounds"><rect x="0" y="0" width="770" height="640"/></clipPath>
    {visibleCount!==undefined&&<clipPath id="contentgen-flow-reveal">
      <rect width={GENERAL_JOURNEY_VIEWPORT.width} height={revealHeight}/>
    </clipPath>}
    <g clipPath="url(#contentgen-flow-safe-bounds)">
    <g clipPath={visibleCount!==undefined?"url(#contentgen-flow-reveal)":undefined}>
    <DiagramStage graph={plan.graph} timeline={plan.diagramTimeline} frame={frame}
      width={GENERAL_JOURNEY_VIEWPORT.width} height={GENERAL_JOURNEY_VIEWPORT.height}
      ariaLabel="Illustrative process showing how the stages connect" reducedMotion={false}
      focusedNodeIds={sample.focusedNodeIds} overlay={overlay}
      style={{ width: "770px", height: "640px", background: "transparent", overflow: "visible" }}
      theme={{ node: "#203743", edge: "#72929F", accent, ink, fontSize: 28, strokeWidth: 3 }}
      renderNode={({ node, bounds, focused }) => <g opacity={focused ? 1 : .8}>
        <Node x={0} y={0} width={bounds.width} height={bounds.height} label={node.label}
          index={Number(node.id.slice("step-".length))} note={notes?.[Number(node.id.slice("step-".length))]} highlight={focused} />
      </g>}
    />
    </g>
    </g>
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
      <Node x={1150} y={startY + i * (height + gap)} width={555} height={height} label={label} index={i} note={state.visual.itemNotes?.[i]} highlight={state.intent === "general-payoff" && i === all.length - 1} />
      {i > 0 && <g><path d={`M1427 ${startY + i * (height + gap) - gap + 4} v${gap - 14}`} stroke={accent} strokeWidth="4" strokeLinecap="round"/><path d={`M1418 ${startY + i * (height + gap) - 14} l9 11 9 -11`} fill="none" stroke={accent} strokeWidth="4" strokeLinejoin="round"/></g>}
    </g>)}
  </g>;
}

function Diagram({ state, fps, chapterFrames }: { state: GeneralFrame; fps: RationalFps; chapterFrames: number }) {
  const items = state.visual.items.slice(0, state.visibleItems);
  const all = state.visual.items;
  if (state.intent === "general-flow") return <Journey items={all} notes={state.visual.itemNotes} fps={fps} chapterFrames={chapterFrames}
    frame={state.localFrame} fallback={<StaticVerticalDiagram state={state} />}
    visibleCount={state.visual.motion?state.visibleItems:undefined} />;
  if (state.intent === "general-comparison" && all.length <= 3) {
    const width = all.length === 3 ? 220 : 325;
    const gap = all.length === 3 ? 25 : 40;
    return <g>
      {items.map((label, i) => <g key={`${label}-${i}`}>
        <Node x={1060 + i * (width + gap)} y={470} width={width} height={165} label={label} note={state.visual.itemNotes?.[i]} index={i} />
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
        width={680} height={height} label={label} note={state.visual.itemNotes?.[i]} index={i} />)}
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
  const chapterFrames=chapter.endFrame-chapter.startFrame;
  const stockMedia = state.visual.stockMedia;
  const mediaTime = stockMedia?.assetType === "video"
    ? (state.localFrame * plan.manifest.fps.den / plan.manifest.fps.num) % stockMedia.durationSeconds : 0;
  const authoredReveal=state.visual.motion?motionRevealState({frame:state.localFrame,frames:chapterFrames,
    itemCount:state.visual.items.length,intent:state.intent,motion:state.visual.motion}):null;
  const semanticMotion = sampleSemanticMotion({intent:state.intent,
    phase:state.visual.direction?.phase??"none",
    localFrame:state.localFrame,durationFrames:chapterFrames,
    visibleItems:diagramState.visibleItems,itemCount:state.visual.items.length,
    cameraMode:state.visual.motion?.camera??"subtle",
    revealStartFrame:authoredReveal?.revealStartFrame,revealStepFrames:authoredReveal?.revealStepFrames});
  const transitionOpacity=state.visual.motion
    ?entryFadeOpacity(state.localFrame,chapterFrames,state.visual.motion):0;

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
  if(state.visual.sceneRecipe==="home-cost-story-v1"){
    return <div style={{position:"relative",width:1920,height:1080}}>
      <HomeCostStoryScene state={state} motion={semanticMotion} frames={chapterFrames}/>
      {chapter.dialogue&&<ConversationCharacters chapter={chapter} frame={frame} rigs={(plan as GeneralVisualPlan & {characterRigs?: ExportRigMap}).characterRigs} compact/>}
    </div>;
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
    <line x1="988" y1="222" x2="988" y2="920" stroke="#425D6D" strokeWidth="2" />
    {!isPayoffHidden && <g opacity={attention?.titleOpacity ?? state.enterProgress}
      clipPath={attention && state.visual.typographyStyle === "wipe" ? "url(#kumiki-title-wipe)" : undefined}
      transform={attention ? `translate(${125 * (1 - typographyScale)} ${320 * (1 - typographyScale)}) scale(${typographyScale})` : `translate(${(1 - state.enterProgress) * -38} 0)`}>
      <text x="125" y="243" fill={accent} fontSize="26" letterSpacing="3.8" fontWeight="700">{state.visual.emphasis.toUpperCase()}</text>
      {heading.lines.map((line, i) => <text data-general-copy="heading" key={`${i}-${line}`} x="120" y={348 + i * 92} fill={ink} fontSize={heading.fontSize} fontWeight="750" letterSpacing="-1.7">{line}</text>)}
      {sub.lines.map((line, i) => <text data-general-copy="subheading" key={`${i}-${line}`} x="125" y={Math.max(662, 428 + heading.lines.length * 92) + i * 49} fill={muted} fontSize={sub.fontSize}>{line}</text>)}
    </g>}
    {!stockMedia && !chartStory && state.visual.direction?.visualMechanic &&
      ["problem","mechanism","payoff"].includes(state.visual.direction.phase)
      ? <SemanticMechanicScene mechanic={state.visual.direction.visualMechanic}
          phase={state.visual.direction.phase as "problem"|"mechanism"|"payoff"} motion={semanticMotion}
          localFrame={state.localFrame} durationFrames={chapterFrames} fps={plan.manifest.fps}/>
      : !stockMedia && !chartStory && state.visual.direction?.transformation &&
      ["problem","mechanism","payoff"].includes(state.visual.direction.phase)
      ?<TeachingStateScene state={diagramState} motion={semanticMotion}/>
      :!stockMedia && !chartStory && (state.intent==="general-flow"
      ? <g transform={state.visual.motion?.camera
          ?`translate(${semanticMotion.cameraX} ${semanticMotion.cameraY}) translate(1420 565) scale(${semanticMotion.cameraScale}) translate(-1420 -565)`
          :undefined}><Diagram state={diagramState} fps={plan.manifest.fps}
          chapterFrames={chapter.endFrame - chapter.startFrame}/></g>
      : <SemanticDiagram state={diagramState} motion={semanticMotion} renderNode={Node}/>)}
    {!stockMedia && chartStory && disclosure && source && <g data-chart-provenance-basis={chartStory.provenanceBasis} data-chart-source-refs={chart?.provenance.basis === "measured" ? chart.provenance.evidenceRefs.join(",") : ""}>
      {disclosure.lines.map((line, index) => <text data-general-chart-copy="disclosure" key={`d-${index}`} x="1040" y={848 + index * 29}
        fontSize={disclosure.fontSize} fill={accent}>{line}</text>)}
      {source.lines.map((line, index) => <text data-general-chart-copy="source" key={`s-${index}`} x="1040" y={856 + disclosure.lines.length * 29 + index * 27}
        fontSize={source.fontSize} fill={muted}>{line}</text>)}
    </g>}
    {!stockMedia&&transitionOpacity>0&&<rect data-scene-entry-fade="" width="1920" height="1080"
      fill="#101D2D" opacity={transitionOpacity} pointerEvents="none"/>}
  </svg>
  {stockMedia && <div data-contentgen-stock-frame="" role="img" aria-label={`Illustrative ${stockMedia.assetType === "photo" ? "photo" : "footage"} for this scene`}
    style={{position:"absolute",left:1040,top:230,width:760,height:650,overflow:"hidden",borderRadius:28,
      background:"#142431",border:"2px solid #526b73",boxShadow:"0 28px 95px #07131c80"}}>
    {stockMedia.assetType === "photo"
      ? <img data-contentgen-stock-photo="" src={stockMedia.url} alt="" decoding="async"
        style={{width:"100%",height:"100%",objectFit:"cover",display:"block",
          objectPosition:`${((stockMedia.focalPoint?.x??.5)*100).toFixed(1)}% ${((stockMedia.focalPoint?.y??.5)*100).toFixed(1)}%`,
          transform:`scale(${(1.03+0.065*state.progress).toFixed(5)}) translate3d(${(12-24*state.progress).toFixed(3)}px,${(6-12*state.progress).toFixed(3)}px,0)`,
          transformOrigin:`${((stockMedia.focalPoint?.x??.5)*100).toFixed(1)}% ${((stockMedia.focalPoint?.y??.5)*100).toFixed(1)}%`}}/>
      : <video data-contentgen-stock-video="" data-media-time={mediaTime.toFixed(6)}
        src={stockMedia.url} preload="auto" muted playsInline aria-hidden="true"
        style={{width:"100%",height:"100%",objectFit:"cover",display:"block",
          objectPosition:`${((stockMedia.focalPoint?.x??.5)*100).toFixed(1)}% ${((stockMedia.focalPoint?.y??.5)*100).toFixed(1)}%`}} />}
  </div>}
  {!stockMedia && chartStory && <div data-general-chart-container="" style={{ position: "absolute", left: 1040, top: 230, width: 760, height: 590 }}>
    <ChartStoryView spec={chartStory.spec} frame={state.localFrame} width={760} height={590} />
  </div>}
  {chapter.dialogue && <ConversationCharacters chapter={chapter} frame={frame} rigs={(plan as GeneralVisualPlan & {characterRigs?: ExportRigMap}).characterRigs} compact={Boolean(stockMedia || chartStory)} />}
  {stockMedia&&transitionOpacity>0&&<div data-scene-entry-fade="" aria-hidden="true"
    style={{position:"absolute",inset:0,background:"#101D2D",opacity:transitionOpacity,pointerEvents:"none"}}/>}
  </div>;
}
