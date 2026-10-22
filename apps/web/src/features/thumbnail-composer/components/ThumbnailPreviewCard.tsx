import type { MediaDocument } from "@/components/media/document";
import type { ComposerCopy } from "../i18n";
import type { ConceptId, ThumbnailCopy, ThumbnailIssue } from "../model/types";
import { ThumbnailStage } from "./ThumbnailStage";

export interface ThumbnailPreviewCardProps {
  media: MediaDocument;
  concept: ConceptId;
  artwork: ThumbnailCopy;
  issues: ThumbnailIssue[];
  copy: ComposerCopy;
  topic: string;
  testId?: string;
}

function stageLabel(concept: ConceptId, artwork: ThumbnailCopy, copy: ComposerCopy): string {
  return `${copy.stageLabel(copy.conceptNames[concept])}: ${artwork.headline} / ${artwork.value}`;
}

/**
 * The node published to the shared preview pane (and rendered inline when the
 * host has no preview pane). It is intentionally the artwork plus one quiet
 * caption, not a second workspace.
 */
export function ThumbnailPreviewCard({
  media,
  concept,
  artwork,
  issues,
  copy,
  topic,
  testId = "thumbnail-live-preview",
}: ThumbnailPreviewCardProps) {
  const blocked = issues.some((issue) => issue.severity === "error");
  const warnings = issues.length;
  return (
    <div className="tc-preview-card" data-testid={testId}>
      <div className="tc-preview-card__stage">
        <ThumbnailStage
          media={media}
          label={stageLabel(concept, artwork, copy)}
          testId="thumbnail-preview-stage"
        />
      </div>
      <div className="tc-preview-card__meta">
        <span className="tc-preview-card__concept">{copy.conceptNames[concept]}</span>
        <span className="tc-preview-card__size">1280 × 720</span>
        <span
          className="tc-preview-card__status"
          data-status={blocked ? "blocked" : warnings > 0 ? "warnings" : "pass"}
        >
          {blocked
            ? copy.checksBlocked(issues.filter((issue) => issue.severity === "error").length)
            : warnings > 0
              ? copy.checksWarnings(warnings)
              : copy.checksPass}
        </span>
      </div>
      <p className="tc-preview-card__topic" title={topic}>
        {topic}
      </p>
    </div>
  );
}
