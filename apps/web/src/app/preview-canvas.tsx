import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import type { Locale } from "@/features/registry";

interface PreviewCanvasProps {
  locale: Locale;
  featureTitle: string;
}

export function PreviewCanvas({ locale, featureTitle }: PreviewCanvasProps) {
  const [aspect, setAspect] = useState<"16:9" | "9:16">("16:9");

  return (
    <div
      data-preview-surface
      className="flex h-full min-h-0 flex-col gap-3 overflow-auto bg-canvas p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
          {locale === "ja" ? "プレビュー" : "Preview"}
        </span>
        <div className="flex items-center rounded-control border border-border p-0.5">
          <Button
            variant={aspect === "16:9" ? "secondary" : "subtle"}
            size="sm"
            aria-pressed={aspect === "16:9"}
            onClick={() => setAspect("16:9")}
          >
            16:9
          </Button>
          <Button
            variant={aspect === "9:16" ? "secondary" : "subtle"}
            size="sm"
            aria-pressed={aspect === "9:16"}
            onClick={() => setAspect("9:16")}
          >
            9:16
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-1">
        <Surface
          variant="outline"
          className={`flex min-h-[180px] items-center justify-center border-dashed ${
            aspect === "16:9"
              ? "aspect-video w-full max-w-full"
              : "aspect-[9/16] h-full max-h-full"
          }`}
        >
          <div className="max-w-[24ch] p-4 text-center">
            <p className="text-body-sm font-medium text-foreground">{featureTitle}</p>
            <p className="mt-1 text-body-sm text-muted-foreground">
              {locale === "ja" ? "ここにプレビューが表示されます。" : "Nothing to preview yet."}
            </p>
          </div>
        </Surface>
      </div>
    </div>
  );
}
