import { Artboard } from "@/components/media/artboard";
import { LayerStack } from "@/components/media/layer-stack";
import type { MediaDocument } from "@/components/media/document";

export interface ThumbnailStageProps {
  media: MediaDocument;
  /** Accessible summary of what this artwork says. */
  label: string;
  fit?: "contain" | "none";
  showSafeRegion?: boolean;
  className?: string;
  testId?: string;
}

function joinClasses(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

/**
 * WYSIWYG thumbnail artwork.
 *
 * It paints the same `Artboard` + `LayerStack` the exporter walks, so the
 * preview, the small-format checks and the SVG cannot drift apart.
 */
export function ThumbnailStage({
  media,
  label,
  fit = "contain",
  showSafeRegion = false,
  className,
  testId = "thumbnail-stage",
}: ThumbnailStageProps) {
  return (
    <div
      className={joinClasses("tc-stage", className)}
      data-fit={fit}
      data-testid={testId}
      role="img"
      aria-label={label}
    >
      <Artboard
        artboard={media.artboard}
        fit={fit}
        showSafeRegion={showSafeRegion}
        tabIndex={-1}
        className="tc-stage__artboard"
      >
        <LayerStack
          layers={media.layers}
          fonts={media.fonts}
          assets={media.assets}
          headingSemantics="neutral"
        />
      </Artboard>
    </div>
  );
}
