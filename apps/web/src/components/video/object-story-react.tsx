/** Draws one OS1 frame. Art comes from the caller; this component owns stage, labels, links and caption. */
import { forwardRef } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import type { MeasureText } from "../media/text-layout";
import { evaluateObjectStory } from "./object-story";
import type { ObjectStoryFrame, ObjectStoryMark, ObjectStoryObjectFrame, ObjectStoryPlan, ObjectStoryWordShape } from "./object-story";

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

/** A spiked star. Every other spike runs a little longer, so it reads as a blast and not a gear. */
const starPoints = (spikes: number, outer: number, inner: number) => Array.from({ length: spikes * 2 }, (_, index) => {
  const angle = (index * Math.PI) / spikes, radius = index % 2 ? inner : outer * (index % 4 ? .84 : 1);
  return `${(Math.sin(angle) * radius).toFixed(2)},${(-Math.cos(angle) * radius).toFixed(2)}`;
}).join(" ");

/** An analog clock. `minutes` can pass 720, so the hands keep going forward. */
export function ObjectStoryClock({ minutes, width, height }: { minutes: number; width: number; height: number }) {
  const ink = "var(--km-shot-paper-ink, #1c2b3a)";
  return <svg data-km-story-clock={Math.round(minutes)} aria-hidden="true" width={width} height={height} viewBox="-100 -100 200 200">
    <circle r={92} fill="var(--km-shot-paper, #f2f5f7)" stroke={ACCENT} strokeWidth={8} />
    {Array.from({ length: 12 }, (_, index) => {
      const hour = index + 1, angle = (hour * Math.PI) / 6;
      return <text key={hour} x={Math.sin(angle) * 70} y={-Math.cos(angle) * 70} textAnchor="middle" dominantBaseline="central" fill={ink} fontWeight={800} fontSize={20}>{hour}</text>;
    })}
    <line x2={0} y2={-38} stroke={ink} strokeWidth={9} strokeLinecap="round" transform={`rotate(${minutes / 2})`} />
    <line x2={0} y2={-58} stroke={WARM} strokeWidth={5} strokeLinecap="round" transform={`rotate(${(minutes % 60) * 6})`} />
    <circle r={7} fill={ink} />
  </svg>;
}

/** A word as the object, for ideas with no picture. Used when no `renderObject` is given or it returns null. */
export function ObjectStoryWord({ text, width, height, shape = "card" }: { text: string; width: number; height: number; shape?: ObjectStoryWordShape }) {
  // Heavy letters such as m and w run wide, so the estimate has to hold for them too.
  const fit = Math.min(height * .3, (width * (shape === "burst" ? .58 : .86)) / Math.max(1, Math.max(...text.split(/\s+/u).map(word => word.length)) * .68));
  if (shape === "burst") return <div data-km-story-word="burst" style={{ position: "relative", width, height, display: "grid", placeItems: "center", textAlign: "center", color: SURFACE, fontWeight: 850, fontSize: fit, lineHeight: 1.05 }}>
    <svg aria-hidden="true" width={width} height={height} viewBox="-100 -100 200 200" style={{ position: "absolute", inset: 0 }}>
      <polygon points={starPoints(18, 98, 70)} fill="var(--km-shot-negative, #ef6b6b)" />
      <polygon points={starPoints(18, 84, 60)} fill={WARM} />
    </svg>
    <span style={{ position: "relative", transform: "rotate(-6deg)" }}>{text}</span>
  </div>;
  return <div data-km-story-word="" style={{ width, height, boxSizing: "border-box", padding: "7%", borderRadius: width * .07, display: "grid", placeItems: "center", textAlign: "center",
    background: "var(--km-shot-subject-surface, #1a2e42)", color: INK, fontWeight: 750, fontSize: fit, lineHeight: 1.08 }}>{text}</div>;
}

function TrendGraph({ trend, width, height, stroke }: { trend: NonNullable<ObjectStoryObjectFrame["trend"]>; width: number; height: number; stroke: number }) {
  const at = (point: { x: number; y: number }) => `${point.x * width},${point.y * height}`;
  const line = trend.points.map(at).join(" ");
  const first = trend.points[0], last = trend.head, turn = Math.min(trend.turn, trend.points.length - 1);
  const up = "var(--km-shot-positive, #4cc38a)", down = "var(--km-shot-negative, #ef6b6b)";
  const falling = trend.points.length - 1 > trend.turn;
  const before = trend.points[trend.points.length - 2] ?? first, tip = stroke * 3.2;
  const heading = (Math.atan2((last.y - before.y) * height, (last.x - before.x) * width) * 180) / Math.PI;
  return <div data-km-story-trend={trend.shape} style={{ position: "absolute", inset: 0 }}>
    <svg aria-hidden="true" width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
      <path d={`M ${width * .06} ${height * .04} V ${height * .94} H ${width * .96}`} fill="none" stroke="var(--km-shot-track, rgba(255,255,255,.3))" strokeWidth={stroke * .7} strokeLinecap="round" />
      <polygon points={`${first.x * width},${height * .94} ${line} ${last.x * width},${height * .94}`} fill={falling ? down : up} opacity={.16} />
      {turn > 0 && <polyline points={trend.points.slice(0, turn + 1).map(at).join(" ")} fill="none" stroke={up} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />}
      {falling && <polyline points={trend.points.slice(turn).map(at).join(" ")} fill="none" stroke={down} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />}
      <polygon data-km-story-trend-tip="" points={`${tip * .9},0 ${-tip * .7},${-tip * .8} ${-tip * .7},${tip * .8}`} fill={falling ? down : up} transform={`translate(${last.x * width} ${last.y * height}) rotate(${heading})`} />
    </svg>
  </div>;
}

const TONES: Record<string, string> = { accent: ACCENT, warm: WARM, danger: "var(--km-shot-negative, #ef6b6b)", ink: INK };

/** What a motion throws off: copies of the object, printed pages, particles and rings. */
function MotionEffects({ object, width, height, art, label, emit }: { object: ObjectStoryObjectFrame; width: number; height: number; art: ReactNode; label: string; emit: (size: { width: number; height: number }) => ReactNode }) {
  const { copies, sheets, particles, rings } = object.motion;
  const cx = width / 2, cy = height / 2;
  return <>
    {sheets.map((sheet, index) => {
      const printed = emit({ width: sheet.fullWidth, height: sheet.height });
      return <div key={`sheet-${index}`} data-km-story-sheet="" style={{ position: "absolute", left: cx + sheet.x - sheet.width / 2, top: cy + sheet.y, width: sheet.width, height: sheet.height, opacity: sheet.opacity, overflow: "hidden", borderRadius: width * .012, ...(printed ? {} : { background: "var(--km-shot-paper, #f2f5f7)", boxShadow: "0 8px 22px rgba(0,0,0,.35)" }) }}>
        {printed ? <div style={{ width: sheet.fullWidth, height: sheet.height }}>{printed}</div>
          : [.14, .3, .46, .62, .78].map(row => <span key={row} style={{ position: "absolute", left: "12%", right: row === .78 ? "46%" : "12%", top: `${row * sheet.fullWidth * 1.1}px`, height: Math.max(2, width * .012), borderRadius: 3, background: "var(--km-shot-paper-ink, #8fa3b1)" }} />)}
      </div>;
    })}
    {copies.map((copy, index) => <div key={`copy-${index}`} data-km-story-copy="" style={{ position: "absolute", left: 0, top: 0, width, height, opacity: copy.opacity, transform: `translate(${copy.x}px, ${copy.y}px) rotate(${copy.rotate}deg) scale(${copy.scale})`,
      clipPath: copy.clip === "left" ? "inset(0 50% 0 0)" : copy.clip === "right" ? "inset(0 0 0 50%)" : undefined }}>{art ?? <ObjectStoryWord text={label} width={width} height={height} />}</div>)}
    {rings.map((ring, index) => <span key={`ring-${index}`} aria-hidden="true" style={{ position: "absolute", left: cx - ring.radius, top: cy - ring.radius, width: ring.radius * 2, height: ring.radius * 2, borderRadius: "50%", border: `${Math.max(2, width * .012)}px solid ${WARM}`, opacity: ring.opacity }} />)}
    {particles.map((particle, index) => particle.shape === "z"
      ? <span key={`particle-${index}`} aria-hidden="true" data-km-story-particle="z" style={{ position: "absolute", left: cx + particle.x, top: cy + particle.y, color: TONES[particle.tone], fontWeight: 850, fontSize: particle.size * 1.6, lineHeight: 1, opacity: particle.opacity, transform: `rotate(${particle.rotate}deg)` }}>Z</span>
      : <span key={`particle-${index}`} aria-hidden="true" data-km-story-particle={particle.shape} style={{ position: "absolute", left: cx + particle.x - particle.size / 2, top: cy + particle.y - particle.size / 2, width: particle.size, height: particle.shape === "flame" || particle.shape === "drop" ? particle.size * 1.5 : particle.size,
        opacity: particle.opacity, background: TONES[particle.tone], transform: `rotate(${particle.rotate}deg)`, borderRadius: particle.shape === "shard" ? "12%" : particle.shape === "dot" ? "50%" : "50% 50% 50% 50% / 62% 62% 38% 38%", clipPath: particle.shape === "shard" ? "polygon(50% 0, 100% 100%, 0 80%)" : undefined }} />)}
  </>;
}

function StageObject({ object, height, renderObject }: { object: ObjectStoryObjectFrame; height: number; renderObject: ObjectStoryProps["renderObject"] }) {
  const { rect, opacity, dimmed, pulse, label, value, mark, level, figure, motion, trend, clockMinutes, wordShape, emits } = object;
  if (figure && value) return <div data-km-story-object={object.id} data-km-story-figure="" style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.width, height: rect.height, opacity, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: height * .02 }}>
    <span data-km-story-value="" style={{ color: WARM, fontWeight: 800, fontSize: Math.min(rect.width * .24, rect.height * .5), lineHeight: 1, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", transform: `scale(${(1 + pulse * .06) * value.progress})` }}>{value.text}</span>
    {label && <p style={{ margin: 0, color: INK, fontWeight: 650, fontSize: height * .05, lineHeight: 1.2 }}>{label}</p>}
  </div>;
  const labelSize = Math.max(height * .034, Math.min(rect.width * .1, height * .04));
  const boxHeight = rect.height - (label ? labelSize * 1.5 : 0);
  // A graph takes the object's place, and its label says what the line is.
  const art = trend ? null : clockMinutes !== undefined ? <ObjectStoryClock minutes={clockMinutes} width={rect.width} height={boxHeight} /> : renderObject?.(object, { width: rect.width, height: boxHeight }) ?? null;
  // A word object already says its label, so it takes the label's room too.
  const showLabel = Boolean(label && (trend || art !== null));
  const artHeight = rect.height - (showLabel ? labelSize * 1.5 : 0);
  return <div data-km-story-object={object.id} style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.width, height: rect.height, opacity: dimmed ? opacity * .42 : opacity }}>
    <div style={{ position: "absolute", left: 0, top: 0, width: rect.width, height: artHeight, opacity: motion.opacity, transformOrigin: motion.origin === "bottom" ? "50% 100%" : "50% 50%", transform: `translate(${motion.x}px, ${motion.y}px) rotate(${motion.rotate}deg) scale(${motion.scale * motion.scaleX * (1 + pulse * .09)}, ${motion.scale * motion.scaleY * (1 + pulse * .09)})`, filter: pulse > .01 ? `drop-shadow(0 0 ${pulse * height * .03}px ${ACCENT})` : undefined }}>
      {trend ? <TrendGraph trend={trend} width={rect.width} height={artHeight} stroke={height * .007} />
        : art ?? <ObjectStoryWord text={label ?? object.id} width={rect.width} height={artHeight} shape={wordShape} />}
      {level !== undefined && <div data-km-story-level={level.toFixed(3)} aria-hidden="true" style={{ position: "absolute", left: "12%", right: "12%", bottom: "-1%", height: height * .022, borderRadius: height * .011, overflow: "hidden", background: "var(--km-shot-track, rgba(255,255,255,.14))" }}>
        <div style={{ width: `${level * 100}%`, height: "100%", borderRadius: "inherit", background: WARM }} />
      </div>}
      {mark && <span data-km-story-mark={mark.kind} aria-label={mark.kind} style={{ position: "absolute", right: "-2%", top: "-2%", width: rect.width * .26, height: rect.width * .26, borderRadius: "50%", display: "grid", placeItems: "center",
        background: MARKS[mark.kind].color, color: SURFACE, fontWeight: 800, fontSize: rect.width * .17, transform: `scale(${mark.progress})` }}>{MARKS[mark.kind].glyph}</span>}
      {value && <span data-km-story-value="" style={{ position: "absolute", left: "50%", bottom: "4%", transform: `translateX(-50%) scale(${value.progress})`, padding: `${height * .008}px ${height * .018}px`, borderRadius: height * .014, whiteSpace: "nowrap",
        background: SURFACE, color: WARM, fontWeight: 800, fontSize: Math.min(rect.width * .17, height * .066), fontVariantNumeric: "tabular-nums", boxShadow: "0 6px 24px rgba(0,0,0,.35)" }}>{value.text}</span>}
    </div>
    <MotionEffects object={object} width={rect.width} height={artHeight} art={art} label={label ?? object.id} emit={size => (emits && renderObject ? renderObject({ ...object, id: emits.id, label: emits.label, art: emits.art, trend: undefined }, size) : null)} />
    {showLabel && <p style={{ position: "absolute", left: 0, right: 0, bottom: 0, margin: 0, textAlign: "center", color: INK, fontWeight: 650, fontSize: labelSize, lineHeight: 1.2 }}>{label}</p>}
  </div>;
}

function Connections({ state, width, height }: { state: ObjectStoryFrame; width: number; height: number }) {
  const stroke = Math.max(3, height * .005);
  const arrow = height * .018;
  return <svg aria-hidden="true" viewBox={`0 0 ${width} ${height}`} style={{ position: "absolute", inset: 0, width, height, overflow: "visible" }}>
    {state.links.map(link => <g key={link.id} opacity={link.opacity}>
      <path d={`M ${link.from.x} ${link.from.y} Q ${(link.from.x + link.to.x) / 2} ${Math.min(link.from.y, link.to.y) - link.bow} ${link.to.x} ${link.to.y}`} pathLength={1} strokeDasharray={`${link.progress} 1`} fill="none" stroke={ACCENT} strokeWidth={stroke} strokeLinecap="round" />
      {link.progress >= 1 && (() => {
        const dx = link.to.x - link.from.x, dy = link.bow ? link.to.y - (Math.min(link.from.y, link.to.y) - link.bow) : link.to.y - link.from.y;
        const angle = (Math.atan2(link.bow ? dy : dy, link.bow ? dx / 2 : dx) * 180) / Math.PI;
        return <polygon data-km-story-arrow="" points={`0,0 ${-arrow * 1.6},${-arrow} ${-arrow * 1.6},${arrow}`} fill={ACCENT} transform={`translate(${link.to.x} ${link.to.y}) rotate(${angle})`} />;
      })()}
      {link.label && link.progress > .6 && <text x={(link.from.x + link.to.x) / 2} y={(link.from.y + link.to.y) / 2 - height * .02} textAnchor="middle" fill={INK} fontWeight={650} fontSize={height * .028} opacity={(link.progress - .6) / .4}>{link.label}</text>}
    </g>)}
    {state.gaps.map(gap => {
      const middle = { x: (gap.from.x + gap.to.x) / 2, y: (gap.from.y + gap.to.y) / 2 }, half = (gap.to.x - gap.from.x) / 2 * gap.progress, tick = height * .02;
      return <g key={gap.id} stroke={WARM} strokeWidth={stroke} strokeLinecap="round">
        <line x1={middle.x - half} y1={middle.y} x2={middle.x + half} y2={middle.y} />
        <line x1={middle.x - half} y1={middle.y - tick} x2={middle.x - half} y2={middle.y + tick} />
        <line x1={middle.x + half} y1={middle.y - tick} x2={middle.x + half} y2={middle.y + tick} />
        <text x={middle.x} y={middle.y - tick * 1.6} textAnchor="middle" stroke="none" fill={WARM} fontWeight={800} fontSize={height * .075} opacity={gap.progress}>{gap.label}</text>
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
  const { scale, origin, shake } = state.camera;
  const { caption } = state;
  return <div {...props} ref={ref} data-km-object-story={plan.spec.id} data-km-story-beat={state.beatId}
    style={{ position: "relative", width, height, overflow: "hidden", color: INK, fontFamily: "var(--km-shot-font, var(--km-font-body, system-ui, sans-serif))", ...style }}>
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: `radial-gradient(circle at ${origin.x}px ${origin.y}px, var(--km-shot-glow, #1d3a52) 0%, ${SURFACE} 62%)` }} />
    <div style={{ position: "absolute", inset: 0, transformOrigin: `${origin.x}px ${origin.y}px`, transform: `translate(${shake.x}px, ${shake.y}px) scale(${scale})` }}>
      <Connections state={state} width={width} height={height} />
      {state.objects.flatMap(object => object.trail.map((step, index) => <span key={`${object.id}-${index}`} data-km-story-step="" style={{ position: "absolute", left: step.x, top: step.y, width: height * .02, height: height * .03, borderRadius: "50%", transform: "translate(-50%,-50%)", background: ACCENT, opacity: step.opacity }} />))}
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
