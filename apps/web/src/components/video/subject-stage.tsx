import type { CSSProperties, ReactNode } from "react";
import { DeviceFrame } from "./device-frame";
import type { DeviceKind, ScreenHighlight } from "./device-frame";
import { IconPlate } from "./icon-plate";
import { evaluateOneChangeHold } from "./one-change-hold";
import type { OneChangeSample, OneChangeWindow } from "./one-change-hold";

export type SubjectAsset =
  | { mode: "device"; src: string; alt: string; device?: DeviceKind;
      highlight?: ScreenHighlight; appMarkSrc?: string }
  | { mode: "screen"; src: string; alt: string }
  | { mode: "icon"; src?: string; alt?: string; name: string; claim: string }
  | { mode: "scene"; src: string; alt: string; focalPoint?: { x: number; y: number } };

export interface SubjectRect { x: number; y: number; width: number; height: number }
export interface SubjectStageLayout {
  width: number; height: number; subject: SubjectRect | null; explanation: SubjectRect;
  title: SubjectRect; caption: SubjectRect;
}
/** Coordinates are authored in output pixels; the entire frame scales together in previews. */
export function subjectStageLayout(orientation: "landscape" | "portrait", hasSubject: boolean): SubjectStageLayout {
  if (orientation === "landscape") return {
    width: 1920, height: 1080,
    subject: hasSubject ? { x: 120, y: 220, width: 980, height: 640 } : null,
    explanation: hasSubject ? { x: 1140, y: 220, width: 660, height: 640 } : { x: 120, y: 220, width: 1680, height: 640 },
    title: { x: 120, y: 70, width: 1680, height: 118 },
    caption: { x: 120, y: 968, width: 1680, height: 76 },
  };
  return {
    width: 1080, height: 1920,
    subject: hasSubject ? { x: 116, y: 420, width: 848, height: 620 } : null,
    explanation: hasSubject ? { x: 116, y: 1090, width: 848, height: 540 } : { x: 116, y: 420, width: 848, height: 1210 },
    title: { x: 116, y: 214, width: 848, height: 152 },
    caption: { x: 116, y: 1714, width: 848, height: 130 },
  };
}
export interface SubjectStageProps {
  frame: number;
  window: OneChangeWindow;
  orientation?: "landscape" | "portrait";
  subject?: SubjectAsset;
  /** Existing renderer receives its exact semantic state; its stage region is never arbitrarily scaled to 0.58. */
  explanation: ReactNode | ((sample: OneChangeSample) => ReactNode);
  title?: string;
  caption?: string;
  /** Optional shot accent; also overridable via --km-shot-accent. */
  accent?: string;
  /** Optional shot canvas; also overridable via --km-shot-surface. */
  background?: string;
  style?: CSSProperties;
  className?: string;
}
function placed(rect: SubjectRect, layout: SubjectStageLayout): CSSProperties {
  return { position: "absolute", left: (rect.x / layout.width * 100) + "%",
    top: (rect.y / layout.height * 100) + "%",
    width: (rect.width / layout.width * 100) + "%",
    height: (rect.height / layout.height * 100) + "%",
    minWidth: 0, minHeight: 0 };
}
function validSubject(subject?: SubjectAsset): boolean {
  if (!subject) return false;
  if (subject.mode === "icon") return true; // An original glyph needs no licensed image.
  return ["device", "screen", "scene"].includes(subject.mode) &&
    typeof subject.src === "string" && Boolean(subject.src.trim());
}
/** Photo-first 2D shot: no timers, camera drift, transitions, hidden asset search, or inferred claims. */
export function SubjectStage({ frame, window, orientation = "landscape", subject, explanation,
  title, caption, accent, background, style, className }: SubjectStageProps) {
  const sample = evaluateOneChangeHold(window, frame);
  if (!sample.active) return null;
  const hasSubject = validSubject(subject);
  const layout = subjectStageLayout(orientation, hasSubject);
  if (subject?.mode === "scene" && subject.focalPoint &&
      ![subject.focalPoint.x, subject.focalPoint.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) {
    throw new Error("Scene focal point must use normalized coordinates.");
  }
  const renderedExplanation = typeof explanation === "function" ? explanation(sample) : explanation;
  // The icon plate owns the only claim location: showing a second stage caption would duplicate it.
  const stageCaption = hasSubject && subject?.mode === "icon" ? undefined : caption;
  const subjectView = hasSubject && subject?.mode === "device"
    ? <DeviceFrame imageSrc={subject.src} alt={subject.alt} device={subject.device}
        highlight={subject.highlight} highlighted={sample.showHighlight} appMarkSrc={subject.appMarkSrc}/>
    : hasSubject && subject?.mode === "icon"
      ? <IconPlate name={subject.name} claim={subject.claim} markSrc={subject.src} markAlt={subject.alt}
          showClaim={sample.showCaption} canvasWidth={orientation === "portrait" ? 848 : 980}
          canvasHeight={orientation === "portrait" ? 620 : 640}/>
      : hasSubject && subject && (subject.mode === "screen" || subject.mode === "scene")
        ? <img src={subject.src} alt={subject.alt} draggable={false}
            style={{ width: "100%", height: "100%", display: "block",
              objectFit: subject.mode === "scene" ? "cover" : "contain",
              objectPosition: subject.mode === "scene" && subject.focalPoint
                ? (subject.focalPoint.x * 100) + "% " + (subject.focalPoint.y * 100) + "%" : "center" }}/>
        : null;
  const accentColor = accent ?? "var(--km-shot-accent, #65dbc7)";
  return <div data-km-subject-stage={orientation} data-km-frame={frame} data-km-phase={sample.phase}
    className={className}
    style={{ position: "relative", containerType: "inline-size", width: "100%",
      aspectRatio: layout.width + " / " + layout.height, overflow: "hidden",
      background: background ?? "var(--km-shot-surface, #101a27)",
      color: "var(--km-shot-ink, #edf3f6)",
      fontFamily: "var(--km-shot-font, var(--km-font-body, system-ui, sans-serif))", ...style }}>
    {title && <div data-km-shot-title="" style={{ ...placed(layout.title, layout), display: "flex",
      alignItems: "center", overflowWrap: "anywhere", lineHeight: 1.1,
      fontSize: orientation === "portrait" ? "5.25cqw" : "3.125cqw",
      fontWeight: 720, letterSpacing: "-.025em" }}>{title}</div>}
    {hasSubject && layout.subject && <div data-km-shot-subject={subject?.mode}
      data-km-subject-emphasis={sample.emphasizeSubject ? "true" : "false"}
      style={{ ...placed(layout.subject, layout), overflow: "hidden", display: "grid",
        placeItems: "center", background: "var(--km-shot-subject-surface, #122538)",
        borderRadius: "1.6%",
        boxShadow: sample.emphasizeSubject ? "inset 0 0 0 4px " + accentColor : "none" }}>
        {subjectView}
      </div>}
    <div data-km-shot-explanation="" style={{ ...placed(layout.explanation, layout),
      overflow: "hidden", color: "inherit" }}>{renderedExplanation}</div>
    {stageCaption && sample.showCaption && <div data-km-shot-caption=""
      style={{ ...placed(layout.caption, layout), display: "flex", alignItems: "center",
        overflowWrap: "anywhere", lineHeight: 1.15,
        fontSize: orientation === "portrait" ? "3.7cqw" : "2.1cqw",
        fontWeight: 600, color: accentColor }}>{stageCaption}</div>}
  </div>;
}
