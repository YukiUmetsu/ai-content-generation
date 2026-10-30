/** Native 1080×1920 general explainer. Intentionally re-composed, never cropped from 16:9. */
import { useMemo } from "react";
import { fitSvgText } from "../../scripts/video-production/text-layout.mjs";
import { getGeneralFrame } from "../../scripts/video-production/general-visual-plan.mjs";
import type { GeneralVisualPlan } from "../../scripts/video-production/general-visual-plan.mjs";
import { ShortSafeFrame } from "@/components/visual/short-safe-frame";
import type { SafeFrameItem } from "@/components/visual/safe-frame";
import { compileChapterAttention, sampleChapterAttention } from "./attention-style";
import { portraitProfile } from "./portrait-profile";
import { ConversationCharacters } from "./conversation-characters";
import { characterRigsForChapter } from "./scene-character-rigs";
import type { ExportRigPlan } from "./scene-character-rigs";

const colors = ["#8CDAD2", "#EFC08B", "#BCAEF0", "#D6E9AC", "#F3ACC4"];
const bg = "#101D2D", ink = "#F8F6F0", muted = "#C0CDD6", accent = "#EFC08B";
const contentBoxes: SafeFrameItem[] = [
  { id: "eyebrow", kind: "text", rect: { x: .108, y: .122, width: .71, height: .04 } },
  { id: "heading", kind: "text", rect: { x: .108, y: .17, width: .72, height: .14 } },
  { id: "subheading", kind: "text", rect: { x: .108, y: .326, width: .72, height: .071 } },
  { id: "semantic-diagram", kind: "subject", critical: true, rect: { x: .108, y: .438, width: .723, height: .328 } },
];

function PortraitCard({ label, index, x, y, width, height, emphasized }: {
  label: string; index: number; x: number; y: number; width: number; height: number; emphasized: boolean;
}) {
  const size = fitSvgText(label, { maxWidthPx: width - 76, preferredSize: 34, minSize: 19, maxLines: 2 });
  const baseline = y + height / 2 + (size.fontSize * .35) - (size.lines.length - 1) * size.fontSize * .62;
  return <g data-portrait-node={index}>
    <rect x={x} y={y} width={width} height={height} rx={22}
      fill={emphasized ? "#315765" : "#233C4A"} stroke={colors[index % colors.length]} strokeWidth={emphasized ? 4 : 2} />
    <rect x={x + 16} y={y + 23} width={6} height={height - 46} rx={3} fill={colors[index % colors.length]} />
    {size.lines.map((line, j) => <text key={j} data-portrait-copy="node" x={x + width / 2 + 5}
      y={baseline + j * size.fontSize * 1.24} fill={ink} fontSize={size.fontSize} fontWeight={650} textAnchor="middle">{line}</text>)}
  </g>;
}

export function PortraitGeneralExportScene({ plan, frame }: { plan: GeneralVisualPlan; frame: number }) {
  const state = getGeneralFrame(plan, frame);
  const chapter = plan.chapters[state.chapterIndex];
  const selected = useMemo(() => compileChapterAttention(chapter, plan), [chapter, plan]);
  const attention = selected ? sampleChapterAttention(selected, state.localFrame, chapter.endFrame - chapter.startFrame) : null;
  const profile = useMemo(() => portraitProfile(plan.manifest.preset as "youtube-shorts" | "instagram-reels" | "tiktok"), [plan.manifest.preset]);
  if (state.visual.chart) throw new Error("Portrait charts require a separately verified chart reflow; use labeled qualitative scenes until available.");
  const heading = fitSvgText(state.visual.headline, { maxWidthPx: 780, preferredSize: 74, minSize: 42, maxLines: 3 });
  const subheading = fitSvgText(state.visual.subhead, { maxWidthPx: 770, preferredSize: 34, minSize: 24, maxLines: 3 });
  const hiddenPayoff = state.intent === "general-payoff" && state.visibleItems === 0;
  const items = state.visual.items.slice(0, attention?.showDiagram === false ? 0 : state.visibleItems);
  const split = state.intent === "general-comparison" && state.visual.items.length === 2;
  return <ShortSafeFrame profile={profile} items={contentBoxes} guides={false}
    data-portrait-general-scene="" style={{ width: 1080, height: 1920, background: bg }}>
    <svg viewBox="0 0 1080 1920" width="1080" height="1920" role="img"
      data-portrait-recipe={attention?.recipe ?? undefined}
      data-kumiki-typography-recipe={state.visual.typographyStyle}
      aria-label={hiddenPayoff ? "An answer will appear" : state.visual.headline}
      style={{ display: "block", fontFamily: "Geist Variable, Geist, Arial, sans-serif" }}>
      <defs>
        <linearGradient id="portrait-background" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={bg} /><stop offset="1" stopColor="#22414E" />
        </linearGradient>
        {attention && state.visual.typographyStyle === "wipe" && <clipPath id="portrait-title-wipe">
          <rect x="110" y="310" width={attention.wipeWidth} height="460" />
        </clipPath>}
      </defs>
      <rect width="1080" height="1920" fill="url(#portrait-background)" />
      <circle cx="820" cy="750" r="500" fill="#EFC08B" fillOpacity=".06" />
      <rect x="116" y="233" width="11" height="11" rx="3" fill={accent} />
      <text data-portrait-copy="eyebrow" x="148" y="250" fill={accent} fontSize="25" fontWeight="700" letterSpacing="3">CONTENTGEN · SHORT EXPLAINER</text>
      <path d="M116 288 H888" stroke="#4F6C78" strokeWidth="2"/>
      {!hiddenPayoff && <g opacity={attention?.titleOpacity ?? state.enterProgress}
        clipPath={attention && state.visual.typographyStyle === "wipe" ? "url(#portrait-title-wipe)" : undefined}
        transform={attention ? `translate(${116 * (1 - attention.titleScale)} ${440 * (1 - attention.titleScale)}) scale(${attention.titleScale})`
          : `translate(0 ${(1 - state.enterProgress) * 16})`}>
        <text data-portrait-copy="emphasis" x="116" y="350" fill={colors[0]} fontSize="25" fontWeight="750" letterSpacing="2">{state.visual.emphasis.toUpperCase()}</text>
        {heading.lines.map((line, index) => <text data-portrait-copy="heading" key={index}
          x="116" y={445 + index * 90} fill={ink} fontSize={heading.fontSize} fontWeight="750" letterSpacing="-1">{line}</text>)}
        {subheading.lines.map((line, index) => <text data-portrait-copy="subheading" key={index}
          x="118" y={659 + index * 43} fill={muted} fontSize={subheading.fontSize}>{line}</text>)}
      </g>}
      <path d="M116 810 H893" stroke="#446777" strokeWidth="2"/>
      {!chapter.dialogue && items.map((label, i) => {
        if (split) {
          return <PortraitCard key={i} label={label} index={i} x={118 + i * 392} y={975} width={370} height={230} emphasized={false} />;
        }
        const height = state.visual.items.length === 5 ? 98 : 112;
        const gap = state.visual.items.length === 5 ? 20 : state.visual.items.length === 4 ? 37 : 55;
        return <PortraitCard key={i} label={label} index={i} x={118} y={858 + i * (height + gap)}
          width={772} height={height} emphasized={state.intent === "general-payoff" && i === state.visual.items.length - 1} />;
      })}
      {!chapter.dialogue && split && items.length === 2 && <text x="497" y="1101" textAnchor="middle" fill={accent} fontSize="29" fontWeight="750">VS</text>}
      {!chapter.dialogue && state.intent === "general-breakdown" && <text data-portrait-copy="qualitative" x="118" y="1518"
        fill={accent} fontSize="20" letterSpacing="2">QUALITATIVE · NOT TO SCALE</text>}
      <path d="M116 1532 H893" stroke="#4F6C78" strokeWidth="2"/>
      <rect x="116" y="1532" width={777 * ((state.chapterIndex + state.progress) / state.chapterCount)} height="4" fill={accent}/>
    </svg>
    {chapter.dialogue && <ConversationCharacters chapter={chapter} frame={frame} rigs={characterRigsForChapter(plan as GeneralVisualPlan & ExportRigPlan,chapter.id)} portrait/>}
  </ShortSafeFrame>;
}
