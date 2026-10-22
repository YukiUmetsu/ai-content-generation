import { useEffect, useRef, useState } from "react";
import type { MediaDocument } from "@/components/media/document";
import type { ComposerCopy } from "../i18n";
import type { ThumbnailIssue } from "../model/types";
import { INSPECTION_WIDTHS } from "../model/types";
import { DiagnosticsList } from "./DiagnosticsList";
import { ThumbnailStage } from "./ThumbnailStage";

export interface ReadabilityPanelProps {
  media: MediaDocument;
  issues: ThumbnailIssue[];
  copy: ComposerCopy;
  /** Accessible summary of the artwork, reused from the concept. */
  label: string;
}

const DESIGN_WIDTH = 1280;

/**
 * Width the figure actually gets. The check is a real fixed-size render, so the
 * narrow pane must scale it down instead of clipping it; the caption then says
 * that it is shown scaled rather than pretending it is the full size.
 */
function useMeasuredWidth(fallback: number): {
  ref: React.RefObject<HTMLElement | null>;
  width: number;
} {
  const ref = useRef<HTMLElement | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const next = node.clientWidth;
      if (next > 0) setWidth(next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

interface MiniFigureProps {
  media: MediaDocument;
  /** Target inspection width: 320 or 160 CSS px. */
  targetWidth: number;
  copy: ComposerCopy;
  label: string;
}

function MiniFigure({ media, targetWidth, copy, label }: MiniFigureProps) {
  const { ref, width } = useMeasuredWidth(targetWidth);
  const stageWidth = Math.max(1, Math.min(targetWidth, width));
  const stageHeight = (stageWidth * 9) / 16;
  const scale = stageWidth / DESIGN_WIDTH;
  const scaled = stageWidth < targetWidth;

  return (
    <figure className="tc-mini" ref={ref} style={{ flexBasis: targetWidth }}>
      <div
        className="tc-mini__viewport"
        style={{ width: stageWidth, height: stageHeight }}
        data-scaled={scaled ? "true" : "false"}
      >
        <div className="tc-mini__frame" style={{ transform: `scale(${scale})` }}>
          <ThumbnailStage
            media={media}
            fit="none"
            testId={`thumbnail-mini-${targetWidth}`}
            label={`${label} — ${copy.sizeAt(targetWidth)}`}
          />
        </div>
      </div>
      <figcaption className="tc-mini__caption">
        <span className="tc-mini__size">{copy.sizeAt(targetWidth)}</span>
        {scaled ? (
          <span className="tc-mini__scale">{copy.scaledAt(Math.round(scale * 100))}</span>
        ) : null}
      </figcaption>
    </figure>
  );
}

/**
 * The two sizes YouTube actually renders: a mid-size recommendation card and a
 * small mobile card. Each is the same DOM composition scaled with CSS, so it
 * uses the real fonts rather than a reflowed approximation.
 */
export function ReadabilityPanel({ media, issues, copy, label }: ReadabilityPanelProps) {
  return (
    <section className="tc-section" aria-labelledby="tc-readability-heading">
      <div className="tc-section__header">
        <h3 className="tc-section__title" id="tc-readability-heading">
          {copy.readabilityHeading}
        </h3>
        <p className="tc-section__hint">{copy.readabilityHint}</p>
      </div>

      <div className="tc-minis">
        {INSPECTION_WIDTHS.map((width) => (
          <MiniFigure key={width} media={media} targetWidth={width} copy={copy} label={label} />
        ))}
      </div>

      <div className="tc-readability__checks">
        <h4 className="tc-subheading">{copy.checksHeading}</h4>
        <DiagnosticsList issues={issues} copy={copy} />
      </div>
    </section>
  );
}
