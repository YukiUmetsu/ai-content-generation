/** Draws one OS1 frame. Art comes from the caller; this component owns stage, labels, links and caption. */
import { forwardRef } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import type { MeasureText } from "../media/text-layout";
import { evaluateObjectStory } from "./object-story";
import type { ObjectStoryFrame, ObjectStoryMark, ObjectStoryObjectFrame, ObjectStoryPlan } from "./object-story";

export interface ObjectStoryProps extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  plan: ObjectStoryPlan;
  /** Absolute frame from the host. */
  frame: number;
  /** Draw an object into its box. Return null to show its label as a word. */
  renderObject?: (object: ObjectStoryObjectFrame, size: { width: number; height: number }) => ReactNode;
  /** Show each beat's finished state, for reduced motion. */
  settled?: boolean;
}

const INK = "var(--km-shot-ink, #edf3f6)", ACCENT = "var(--km-shot-accent, #65dbc7)", WARM = "var(--km-shot-warm, #f4b860)", SURFACE = "var(--km-shot-surface, #101a27)";
const MARKS: Record<ObjectStoryMark, { glyph: string; color: string }> = {
  check: { glyph: "✓", color: "var(--km-shot-positive, #4cc38a)" }, cross: { glyph: "✕", color: "var(--km-shot-negative, #ef6b6b)" },
  question: { glyph: "?", color: WARM }, warning: { glyph: "!", color: WARM },
};

/** A word as the object, for ideas with no picture. Used when no `renderObject` is given or it returns null. */
export function ObjectStoryWord({ text, width, height }: { text: string; width: number; height: number }) {
  const fit = Math.min(height * .3, (width * .86) / Math.max(1, Math.max(...text.split(/\s+/u).map(word => word.length)) * .56));
  return <div data-km-story-word="" style={{ width, height, boxSizing: "border-box", padding: "7%", borderRadius: width * .07, display: "grid", placeItems: "center", textAlign: "center",
    background: "var(--km-shot-subject-surface, #1a2e42)", color: INK, fontWeight: 750, fontSize: fit, lineHeight: 1.08 }}>{text}</div>;
}

function StageObject({ object, height, renderObject }: { object: ObjectStoryObjectFrame; height: number; renderObject: ObjectStoryProps["renderObject"] }) {
  const { rect, opacity, dimmed, pulse, label, value, mark } = object;
  const labelSize = Math.max(height * .034, Math.min(rect.width * .1, height * .04));
  const art = renderObject?.(object, { width: rect.width, height: rect.height - (label ? labelSize * 1.5 : 0) }) ?? null;
  // A word object already says its label, so it takes the label's room too.
  const showLabel = Boolean(label && art !== null);
  const artHeight = rect.height - (showLabel ? labelSize * 1.5 : 0);
  return <div data-km-story-object={object.id} style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.width, height: rect.height, opacity: dimmed ? opacity * .42 : opacity }}>
    <div style={{ position: "absolute", left: 0, top: 0, width: rect.width, height: artHeight, transform: `scale(${1 + pulse * .09})`, filter: pulse > .01 ? `drop-shadow(0 0 ${pulse * height * .03}px ${ACCENT})` : undefined }}>
      {art ?? <ObjectStoryWord text={label ?? object.id} width={rect.width} height={artHeight} />}
      {mark && <span data-km-story-mark={mark.kind} aria-label={mark.kind} style={{ position: "absolute", right: "-2%", top: "-2%", width: rect.width * .2, height: rect.width * .2, borderRadius: "50%", display: "grid", placeItems: "center",
        background: MARKS[mark.kind].color, color: SURFACE, fontWeight: 800, fontSize: rect.width * .13, transform: `scale(${mark.progress})` }}>{MARKS[mark.kind].glyph}</span>}
      {value && <span data-km-story-value="" style={{ position: "absolute", left: "50%", bottom: "4%", transform: `translateX(-50%) scale(${value.progress})`, padding: `${height * .008}px ${height * .018}px`, borderRadius: height * .014, whiteSpace: "nowrap",
        background: SURFACE, color: WARM, fontWeight: 800, fontSize: Math.min(rect.width * .17, height * .066), fontVariantNumeric: "tabular-nums", boxShadow: "0 6px 24px rgba(0,0,0,.35)" }}>{value.text}</span>}
    </div>
    {showLabel && <p style={{ position: "absolute", left: 0, right: 0, bottom: 0, margin: 0, textAlign: "center", color: INK, fontWeight: 650, fontSize: labelSize, lineHeight: 1.2 }}>{label}</p>}
  </div>;
}

function Connections({ state, width, height }: { state: ObjectStoryFrame; width: number; height: number }) {
  const stroke = Math.max(3, height * .005);
  return <svg aria-hidden="true" viewBox={`0 0 ${width} ${height}`} style={{ position: "absolute", inset: 0, width, height, overflow: "visible" }}>
    {state.links.map(link => <g key={link.id} opacity={link.opacity}>
      <path d={`M ${link.from.x} ${link.from.y} Q ${(link.from.x + link.to.x) / 2} ${Math.min(link.from.y, link.to.y) - link.bow} ${link.to.x} ${link.to.y}`} pathLength={1} strokeDasharray={`${link.progress} 1`} fill="none" stroke={ACCENT} strokeWidth={stroke} strokeLinecap="round" />
      {link.label && link.progress > .6 && <text x={(link.from.x + link.to.x) / 2} y={(link.from.y + link.to.y) / 2 - height * .02} textAnchor="middle" fill={INK} fontWeight={650} fontSize={height * .028} opacity={(link.progress - .6) / .4}>{link.label}</text>}
    </g>)}
    {state.gaps.map(gap => {
      const middle = { x: (gap.from.x + gap.to.x) / 2, y: (gap.from.y + gap.to.y) / 2 }, half = (gap.to.x - gap.from.x) / 2 * gap.progress, tick = height * .02;
      return <g key={gap.id} stroke={WARM} strokeWidth={stroke} strokeLinecap="round">
        <line x1={middle.x - half} y1={middle.y} x2={middle.x + half} y2={middle.y} />
        <line x1={middle.x - half} y1={middle.y - tick} x2={middle.x - half} y2={middle.y + tick} />
        <line x1={middle.x + half} y1={middle.y - tick} x2={middle.x + half} y2={middle.y + tick} />
        <text x={middle.x} y={middle.y - tick * 1.6} textAnchor="middle" stroke="none" fill={WARM} fontWeight={800} fontSize={height * .05} opacity={gap.progress}>{gap.label}</text>
      </g>;
    })}
  </svg>;
}

/** Width from the browser's text engine, for `compileObjectStory`. Call after the fonts have loaded. */
export function createStoryTextMeasure(): MeasureText {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) throw new Error("A 2D canvas is required to measure caption text.");
  return (font, text) => { context.font = font; return context.measureText(text).width; };
}

/** One frame of a narrated object scene. Deterministic for a given plan and frame. */
export const ObjectStory = forwardRef<HTMLDivElement, ObjectStoryProps>(function ObjectStory({ plan, frame, renderObject, settled, style, ...props }, ref) {
  const { width, height } = plan.spec;
  const state = evaluateObjectStory(plan, frame, { settled });
  const { scale, origin } = state.camera;
  const { caption } = state;
  return <div {...props} ref={ref} data-km-object-story={plan.spec.id} data-km-story-beat={state.beatId}
    style={{ position: "relative", width, height, overflow: "hidden", color: INK, fontFamily: "var(--km-shot-font, var(--km-font-body, system-ui, sans-serif))", ...style }}>
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: `radial-gradient(circle at ${origin.x}px ${origin.y}px, var(--km-shot-glow, #1d3a52) 0%, ${SURFACE} 62%)` }} />
    <div style={{ position: "absolute", inset: 0, transformOrigin: `${origin.x}px ${origin.y}px`, transform: `scale(${scale})` }}>
      <Connections state={state} width={width} height={height} />
      {state.objects.map(object => <StageObject key={object.id} object={object} height={height} renderObject={renderObject} />)}
      {state.tokens.map(token => <span key={token.id} data-km-story-token="" style={{ position: "absolute", left: token.at.x, top: token.at.y, transform: "translate(-50%,-50%)", opacity: token.opacity, padding: `${height * .008}px ${height * .016}px`, borderRadius: height * .03,
        background: WARM, color: SURFACE, fontWeight: 800, fontSize: height * .03, whiteSpace: "nowrap", minWidth: height * .03, minHeight: height * .03 }}>{token.label}</span>)}
    </div>
    {caption && <p data-km-story-caption="" style={{ position: "absolute", left: caption.rect.x, top: caption.rect.y, width: caption.rect.width, margin: 0, textAlign: caption.align, fontWeight: 700, fontSize: caption.fontSizePx, lineHeight: `${caption.lineHeightPx}px` }}>
      {caption.lines.map((line, lineIndex) => <span key={lineIndex} style={{ display: "block", whiteSpace: "nowrap" }}>
        {line.map((word, wordIndex) => <span key={wordIndex} style={{ display: "inline-block", margin: "0 .13em", opacity: word.progress, transform: `translateY(${(1 - word.progress) * .28}em)`, color: word.emphasis ? ACCENT : undefined }}>{word.text}</span>)}
      </span>)}
    </p>}
  </div>;
});
