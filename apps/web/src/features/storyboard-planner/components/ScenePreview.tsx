import type { ReactNode } from "react";
import { copy } from "../i18n";
import { formatTimecode, type BeatTiming } from "../model/timeline";
import type { Locale, SemanticStoryboard, StoryboardBeat } from "../model/types";

interface ScenePreviewProps {
  board: SemanticStoryboard;
  beat: StoryboardBeat;
  timing?: BeatTiming;
  locale: Locale;
}

function clip(value: string, max: number): string {
  const chars = Array.from(value.trim());
  return chars.length <= max ? value.trim() : `${chars.slice(0, Math.max(0, max - 1)).join("")}…`;
}

function objectLabel(board: SemanticStoryboard, id: string): string {
  const known: Record<string, string> = {
    "hvac-system": "HVAC system",
    "installed-quote": "Installed",
    "equipment-price": "Equipment",
    "labor-cost": "Labor",
    "ductwork-cost": "Ductwork",
    "permits-cost": "Permits",
    "running-total": "Total",
    "cost-breakdown": "Cost breakdown",
    "comparison-bracket": "Scope",
    "assumptions-note": "Assumptions",
  };
  if (known[id]) return known[id];
  const label = board.semanticObjects.find((object) => object.id === id)?.label ?? id;
  return clip(label, 16);
}

function hasObject(board: SemanticStoryboard, id: string): boolean {
  return board.semanticObjects.some((object) => object.id === id);
}

const COST_ROWS = [
  { id: "equipment-price", label: "Equipment", value: 7100 },
  { id: "labor-cost", label: "Labor", value: 3200 },
  { id: "ductwork-cost", label: "Ductwork", value: 1400 },
  { id: "permits-cost", label: "Permits", value: 700 },
] as const;

const TOTAL = 12400;

function money(value: number): string {
  return `$${value.toLocaleString("en-US")}`;
}

function Frame({
  children,
  label,
  kicker,
  title,
  footer,
}: {
  children: ReactNode;
  label: string;
  kicker: string;
  title: string;
  footer: string;
}) {
  return (
    <svg viewBox="0 0 960 540" role="img" aria-label={label} className="sp-svg">
      <rect className="sp-svg-bg" x="0" y="0" width="960" height="540" rx="18" />
      <text className="sp-svg-kicker" x="48" y="52">
        {kicker}
      </text>
      <text className="sp-svg-title" x="48" y="98">
        {title}
      </text>
      {children}
      <line className="sp-svg-rule" x1="48" y1="470" x2="912" y2="470" />
      <text className="sp-svg-footer" x="48" y="502">
        {footer}
      </text>
    </svg>
  );
}

function QuestionScene({
  board,
  title,
  focus,
  kicker,
}: {
  board: SemanticStoryboard;
  title: string;
  focus: string;
  kicker: string;
}) {
  return (
    <Frame
      label={title}
      kicker={kicker}
      title={title}
      footer={`Focus: ${objectLabel(board, focus)}`}
    >
      <rect className="sp-svg-panel" x="62" y="156" width="250" height="258" rx="16" />
      <rect className="sp-svg-panel-strong" x="84" y="180" width="206" height="112" rx="8" />
      {[0, 1, 2, 3].map((row) => (
        <line
          key={row}
          className="sp-svg-muted-stroke"
          x1="102"
          y1={204 + row * 20}
          x2="272"
          y2={204 + row * 20}
        />
      ))}
      <circle className="sp-svg-accent-stroke" cx="187" cy="344" r="36" />
      <path className="sp-svg-accent-stroke" d="M187 326 L215 374 L159 374 Z" />
      <text className="sp-svg-small" x="187" y="442" textAnchor="middle">
        {objectLabel(board, "hvac-system")}
      </text>

      <rect className="sp-svg-panel-strong" x="428" y="158" width="360" height="146" rx="14" />
      <text className="sp-svg-small" x="454" y="190">
        {objectLabel(board, "installed-quote")}
      </text>
      <text className="sp-svg-number" x="454" y="254">
        $12,400
      </text>
      <text className="sp-svg-small" x="454" y="282">
        illustrative
      </text>

      <path className="sp-svg-dashed" d="M428 342 H640 V386 H700" />
      <text className="sp-svg-small" x="596" y="374">
        $7,100 equipment
      </text>
      <text className="sp-svg-accent" x="712" y="392">
        the rest = ?
      </text>
      <circle className="sp-svg-question-ring" cx="836" cy="290" r="64" />
      <text className="sp-svg-question" x="836" y="318" textAnchor="middle">
        ?
      </text>
    </Frame>
  );
}

function AccumulationScene({
  board,
  title,
  focus,
  kicker,
}: {
  board: SemanticStoryboard;
  title: string;
  focus: string;
  kicker: string;
}) {
  const max = COST_ROWS[0].value;
  return (
    <Frame
      label={title}
      kicker={kicker}
      title={title}
      footer={`Focus: ${objectLabel(board, focus)} · sums are illustrative`}
    >
      {COST_ROWS.map((row, index) => {
        const width = Math.round((row.value / max) * 380);
        const y = 158 + index * 66;
        return (
          <g key={row.id}>
            <text className="sp-svg-small" x="62" y={y + 22}>
              {hasObject(board, row.id) ? objectLabel(board, row.id) : row.label}
            </text>
            <rect className="sp-svg-track" x="280" y={y} width="380" height="34" rx="6" />
            <rect
              className={index === 0 ? "sp-svg-bar sp-svg-bar-base" : "sp-svg-bar"}
              x="280"
              y={y}
              width={width}
              height="34"
              rx="6"
            />
            <text className="sp-svg-value" x="676" y={y + 24}>
              {money(row.value)}
            </text>
          </g>
        );
      })}

      <path className="sp-svg-flow" d="M700 176 H760 V400 H700" />
      <rect className="sp-svg-total-panel" x="762" y="214" width="150" height="146" rx="14" />
      <text className="sp-svg-small" x="842" y="246" textAnchor="middle">
        {objectLabel(board, "running-total")}
      </text>
      <text className="sp-svg-total" x="842" y="308" textAnchor="middle">
        $12,400
      </text>
      <text className="sp-svg-small" x="842" y="334" textAnchor="middle">
        illustrative
      </text>
    </Frame>
  );
}

function ComparisonScene({
  board,
  title,
  focus,
  kicker,
}: {
  board: SemanticStoryboard;
  title: string;
  focus: string;
  kicker: string;
}) {
  const equipmentHeight = 150;
  const installedHeight = 262;
  return (
    <Frame
      label={title}
      kicker={kicker}
      title={title}
      footer={`Focus: ${objectLabel(board, focus)} · illustrative figures`}
    >
      <line className="sp-svg-rule" x1="110" y1="424" x2="850" y2="424" />
      <rect className="sp-svg-track" x="180" y={424 - equipmentHeight} width="170" height={equipmentHeight} rx="8" />
      <rect
        className="sp-svg-bar sp-svg-bar-base"
        x="180"
        y={424 - equipmentHeight}
        width="170"
        height={equipmentHeight}
        rx="8"
      />
      <text className="sp-svg-small" x="265" y="444" textAnchor="middle">
        {objectLabel(board, "equipment-price")}
      </text>
      <text className="sp-svg-value" x="265" y={406 - equipmentHeight} textAnchor="middle">
        $7,100
      </text>

      <rect className="sp-svg-track" x="500" y={424 - installedHeight} width="170" height={installedHeight} rx="8" />
      <rect
        className="sp-svg-bar sp-svg-bar-total"
        x="500"
        y={424 - installedHeight}
        width="170"
        height={installedHeight}
        rx="8"
      />
      <text className="sp-svg-small" x="585" y="444" textAnchor="middle">
        {objectLabel(board, "installed-quote")}
      </text>
      <text className="sp-svg-value" x="585" y={406 - installedHeight} textAnchor="middle">
        $12,400
      </text>

      <path className="sp-svg-dashed" d="M350 170 H500" />
      <text className="sp-svg-accent" x="425" y="158" textAnchor="middle">
        +$5,300
      </text>
      <path className="sp-svg-bracket" d="M728 150 V398" />
      <path className="sp-svg-bracket" d="M718 150 H738 M718 398 H738" />
      <text className="sp-svg-small" x="756" y="254">
        complete
      </text>
      <text className="sp-svg-small" x="756" y="276">
        installed
      </text>
      <text className="sp-svg-small" x="756" y="298">
        scope
      </text>
    </Frame>
  );
}

function EvidenceScene({
  board,
  title,
  focus,
  illustrative,
  kicker,
}: {
  board: SemanticStoryboard;
  title: string;
  focus: string;
  illustrative: string;
  kicker: string;
}) {
  const max = COST_ROWS[0].value;
  return (
    <Frame
      label={title}
      kicker={kicker}
      title={title}
      footer={`Focus: ${objectLabel(board, focus)}`}
    >
      <text className="sp-svg-axis" x="80" y="144">
        illustrative share of the installed quote
      </text>
      <line className="sp-svg-rule" x1="82" y1="414" x2="820" y2="414" />
      {COST_ROWS.map((row, index) => {
        const height = Math.max(18, Math.round((row.value / max) * 230));
        const x = 120 + index * 170;
        return (
          <g key={row.id}>
            <rect className="sp-svg-track" x={x} y={414 - height} width="88" height={height} rx="6" />
            <rect
              className={index === 0 ? "sp-svg-bar sp-svg-bar-base" : "sp-svg-bar"}
              x={x}
              y={414 - height}
              width="88"
              height={height}
              rx="6"
            />
            <text className="sp-svg-tick" x={x + 44} y="438" textAnchor="middle">
              {hasObject(board, row.id) ? objectLabel(board, row.id) : row.label}
            </text>
            <text className="sp-svg-value" x={x + 44} y={414 - height - 12} textAnchor="middle">
              {money(row.value)}
            </text>
          </g>
        );
      })}
      <rect className="sp-svg-stamp" x="660" y="136" width="220" height="58" rx="8" />
      <text className="sp-svg-stamp-text" x="770" y="171" textAnchor="middle">
        {illustrative}
      </text>
    </Frame>
  );
}

function ExplanationScene({
  board,
  title,
  focus,
  kicker,
}: {
  board: SemanticStoryboard;
  title: string;
  focus: string;
  kicker: string;
}) {
  return (
    <Frame
      label={title}
      kicker={kicker}
      title={title}
      footer={`Focus: ${objectLabel(board, focus)}`}
    >
      <rect className="sp-svg-panel" x="86" y="152" width="270" height="270" rx="16" />
      <rect className="sp-svg-panel-strong" x="110" y="176" width="222" height="86" rx="8" />
      {[0, 1, 2, 3].map((row) => (
        <line
          key={row}
          className="sp-svg-muted-stroke"
          x1="126"
          y1={198 + row * 16}
          x2="316"
          y2={198 + row * 16}
        />
      ))}
      <circle className="sp-svg-accent-stroke" cx="221" cy="342" r="42" />
      <circle className="sp-svg-accent-dot" cx="221" cy="342" r="9" />
      <text className="sp-svg-small" x="221" y="438" textAnchor="middle">
        {objectLabel(board, "hvac-system")}
      </text>

      <path className="sp-svg-duct" d="M356 236 H520 V188 H650 M356 268 H470 V316 H650" />
      <path className="sp-svg-flow" d="M520 212 H580" />
      <path className="sp-svg-flow" d="M470 292 H530" />
      <text className="sp-svg-small" x="662" y="192">
        {objectLabel(board, "equipment-price")}
      </text>
      <text className="sp-svg-small" x="662" y="320">
        {objectLabel(board, "ductwork-cost")}
      </text>
      <rect className="sp-svg-note" x="662" y="360" width="230" height="70" rx="10" />
      <text className="sp-svg-small" x="678" y="388">
        equipment is one
      </text>
      <text className="sp-svg-small" x="678" y="410">
        part of the scope
      </text>
    </Frame>
  );
}

function TakeawayScene({
  board,
  title,
  focus,
  illustrative,
  kicker,
}: {
  board: SemanticStoryboard;
  title: string;
  focus: string;
  illustrative: string;
  kicker: string;
}) {
  const segments = [7100, 3200, 1400, 700];
  let x = 92;
  return (
    <Frame
      label={title}
      kicker={kicker}
      title={title}
      footer={`Focus: ${objectLabel(board, focus)} · illustrative figures`}
    >
      <text className="sp-svg-small" x="92" y="158">
        {objectLabel(board, "cost-breakdown")}
      </text>
      {segments.map((value, index) => {
        const width = Math.round((value / TOTAL) * 776);
        const segmentX = x;
        x += width;
        return (
          <rect
            key={COST_ROWS[index].id}
            className={index === 0 ? "sp-svg-bar sp-svg-bar-base" : "sp-svg-bar"}
            x={segmentX}
            y="176"
            width={Math.max(0, width - 4)}
            height="54"
            rx="6"
          />
        );
      })}
      <text className="sp-svg-total" x="92" y="292">
        $12,400 installed
      </text>
      <text className="sp-svg-small" x="92" y="322">
        equipment alone: $7,100
      </text>
      <rect className="sp-svg-panel" x="92" y="350" width="560" height="88" rx="12" />
      <text className="sp-svg-accent" x="114" y="382">
        Compare installed scope,
      </text>
      <text className="sp-svg-accent" x="114" y="408">
        not equipment alone.
      </text>
      <text className="sp-svg-small" x="114" y="430">
        {objectLabel(board, "assumptions-note")}
      </text>
      <rect className="sp-svg-stamp" x="700" y="350" width="180" height="58" rx="8" />
      <text className="sp-svg-stamp-text" x="790" y="385" textAnchor="middle">
        {illustrative}
      </text>
    </Frame>
  );
}

/** Research/custom storyboards must NEVER inherit the synthetic HVAC example's numbers.
 * This is an editorial still, not a claim of animated/FFmpeg output.
 */
function SourceDerivedScene({board,beat,title,kicker}:{
  board:SemanticStoryboard;beat:StoryboardBeat;title:string;kicker:string;
}){
  const state=beat.teachingState;
  const subject=objectLabel(board,state?.subjectId??beat.focusTarget);
  const resultVisible=state?.phase==="payoff";
  const showAction=state?.phase==="mechanism"||resultVisible;
  const left=state?.before??beat.objective;
  const right=resultVisible&&state?state.after:state?"?":beat.visualObjective;
  const lines=(value:string,maxChars:number)=>{
    const words=Array.from(value.trim());
    if(words.length<=maxChars)return [value.trim()];
    const cut=value.lastIndexOf(" ",maxChars);
    const at=cut>maxChars*.8 && value.slice(cut).trim().length<=maxChars?cut:maxChars;
    return [value.slice(0,at).trim(),value.slice(at).trim()];
  };
  return <Frame label={title} kicker={kicker} title={title}
    footer={`Focus: ${subject} · ${beat.claimRefs.length} research claim reference(s)`}>
    <g data-source-derived-scene={state?.phase??"schematic"}>
      <rect x="64" y="131" width="832" height="48" rx="10" className="sp-svg-panel"/>
      <text x="90" y="163" className="sp-svg-accent">{clip(subject,45)}</text>
      <rect x="64" y="204" width="360" height="153" rx="15" className="sp-svg-panel-strong"/>
      <text x="85" y="237" className="sp-svg-small">{state?"BEFORE":"QUESTION"}</text>
      <g role="group" aria-label={left}>{lines(clip(left,52),27).map((part,i)=><text key={i}
        x="85" y={285+i*30} className="sp-svg-accent">{part}</text>)}</g>
      <path d="M440 275 H514" className="sp-svg-flow"/>
      <rect x="531" y="204" width="365" height="153" rx="15" className="sp-svg-panel-strong"/>
      <text x="554" y="237" className="sp-svg-small">{resultVisible?"AFTER":state?"RESULT HELD":"VISUAL DIRECTION"}</text>
      <g role="group" aria-label={right}>{lines(clip(right,52),27).map((part,i)=><text key={i}
        x="554" y={285+i*30} className="sp-svg-accent">{part}</text>)}</g>
      {showAction&&state&&<g data-source-derived-action="">
        <text x="84" y="407" className="sp-svg-small">ACTION</text>
        <g role="group" aria-label={state.action}>{lines(clip(state.action,90),46).map((part,i)=><text key={i}
          x="200" y={404+i*27} className="sp-svg-accent">{part}</text>)}</g>
      </g>}
      {!state&&<text x="84" y="410" className="sp-svg-small">Planning sketch from the authored brief</text>}
    </g>
  </Frame>;
}

export function ScenePreview({ board, beat, timing, locale }: ScenePreviewProps) {
  const t = copy(locale);
  const title = clip(beat.onScreenText.trim() || beat.objective.trim() || board.title, 46);
  const focus = beat.focusTarget || "focus";
  const illustrative = t.statuses.illustrative.toUpperCase();
  const intentLabel = t.intents[beat.visualIntent];
  const beatNumber = board.beats.findIndex((entry) => entry.id === beat.id) + 1;
  const kicker = `${String(Math.max(1, beatNumber)).padStart(2, "0")} · ${intentLabel.toUpperCase()}`;
  const range = timing
    ? `${formatTimecode(timing.startFrame, board.fps)}–${formatTimecode(timing.endFrame, board.fps)}`
    : null;

  let scene: ReactNode;
  // Fixed example amounts are licensed only to the dedicated synthetic demo.
  if(board.id!=="storyboard-hvac-replacement-cost"||!board.illustrativeData){
    scene=<SourceDerivedScene board={board} beat={beat} title={title} kicker={kicker}/>;
  }else switch (beat.visualIntent) {
    case "question":
      scene = <QuestionScene board={board} title={title} focus={focus} kicker={kicker} />;
      break;
    case "cost-accumulation":
      scene = <AccumulationScene board={board} title={title} focus={focus} kicker={kicker} />;
      break;
    case "comparison":
      scene = <ComparisonScene board={board} title={title} focus={focus} kicker={kicker} />;
      break;
    case "evidence":
      scene = (
        <EvidenceScene
          board={board}
          title={title}
          focus={focus}
          illustrative={illustrative}
          kicker={kicker}
        />
      );
      break;
    case "takeaway":
      scene = (
        <TakeawayScene
          board={board}
          title={title}
          focus={focus}
          illustrative={illustrative}
          kicker={kicker}
        />
      );
      break;
    case "explanation":
    default:
      scene = <ExplanationScene board={board} title={title} focus={focus} kicker={kicker} />;
      break;
  }

  return (
    <div
      className="sp-preview"
      data-preview-surface
      data-testid="scene-preview"
      data-intent={beat.visualIntent}
    >
      <div className="sp-preview-topline">
        <span className="sp-preview-badge">{t.planningPreview}</span>
        <span className="sp-preview-intent">{intentLabel}</span>
        {range && <span className="sp-preview-range">{range}</span>}
      </div>
      <div className="sp-preview-frame">{scene}</div>
      <p className="sp-preview-notfinal">{t.previewNotFinal}</p>
      <div className="sp-preview-caption">
        <p className="sp-preview-onscreen">{beat.onScreenText.trim() || t.emptyPreview}</p>
        {beat.narration.trim() !== "" && (
          <p className="sp-preview-narration" data-testid="preview-narration">
            {beat.narration}
          </p>
        )}
        {beat.visualObjective.trim() !== "" && (
          <p className="sp-preview-objective">{beat.visualObjective}</p>
        )}
        {board.illustrativeData && <p className="sp-preview-note">{t.illustrativeNote}</p>}
      </div>
    </div>
  );
}
