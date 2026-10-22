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
        {INSPECTION_WIDTHS.map((width) => {
          const height = Math.round((width * 9) / 16);
          return (
            <figure key={width} className="tc-mini">
              <div className="tc-mini__viewport" style={{ width, height }}>
                <div
                  className="tc-mini__frame"
                  style={{ transform: `scale(${width / 1280})` }}
                >
                  <ThumbnailStage
                    media={media}
                    fit="none"
                    testId={`thumbnail-mini-${width}`}
                    label={`${label} — ${copy.sizeAt(width)}`}
                  />
                </div>
              </div>
              <figcaption className="tc-mini__caption">
                <span className="tc-mini__size">{copy.sizeAt(width)}</span>
              </figcaption>
            </figure>
          );
        })}
      </div>

      <div className="tc-readability__checks">
        <h4 className="tc-subheading">{copy.checksHeading}</h4>
        <DiagnosticsList issues={issues} copy={copy} />
      </div>
    </section>
  );
}
