import { Eye, PanelRightClose, PanelRightOpen } from "lucide-react";
import type { ReactNode } from "react";
import { FEATURE_METADATA, type FeatureId, type Locale } from "@/features/registry";
import { Button } from "@/components/ui/button";
import { FeaturePreview } from "./feature-preview";

interface PreviewCanvasProps {
  locale: Locale;
  featureId: FeatureId;
  preview: ReactNode | null;
  toolGuideOpen: boolean;
  onToolGuideOpenChange: (open: boolean) => void;
}

export function PreviewCanvas({
  locale,
  featureId,
  preview,
  toolGuideOpen,
  onToolGuideOpenChange,
}: PreviewCanvasProps) {
  const meta = FEATURE_METADATA[featureId];
  const live = preview !== null;
  const heading = locale === "ja" ? "プレビュー" : "Preview";
  const status = live
    ? locale === "ja" ? "ライブ" : "Live"
    : meta.availability === "planned"
      ? locale === "ja" ? "コンセプト" : "Concept"
      : locale === "ja" ? "サンプル" : "Sample";
  const description = live
    ? locale === "ja" ? "編集内容に合わせて更新されます" : "Updates as you edit"
    : meta.availability === "planned"
      ? locale === "ja" ? "完成時の出力イメージ" : "Illustrative output — this tool isn't interactive yet"
      : locale === "ja" ? "エディター内のデモからのサンプル" : "Example output from the interactive demo";

  return (
    <section
      data-preview-surface
      aria-label={heading}
      className="flex h-full min-h-0 flex-col overflow-hidden bg-canvas"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Eye aria-hidden="true" className="size-4 text-muted-foreground" />
            {heading}
          </h2>
          <p className="mt-1 text-caption text-muted-foreground">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full border border-border bg-surface px-2 py-1 text-caption font-medium text-muted-foreground">
            {status}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="hidden lg:inline-flex"
            aria-label={toolGuideOpen
              ? locale === "ja" ? "ガイドを非表示" : "Hide tool guide"
              : locale === "ja" ? "ガイドを表示" : "Show tool guide"}
            title={toolGuideOpen
              ? locale === "ja" ? "ガイドを非表示" : "Hide tool guide"
              : locale === "ja" ? "ガイドを表示" : "Show tool guide"}
            icon={toolGuideOpen
              ? <PanelRightClose aria-hidden="true" className="size-4" />
              : <PanelRightOpen aria-hidden="true" className="size-4" />}
            onClick={() => onToolGuideOpenChange(!toolGuideOpen)}
          >
            {toolGuideOpen
              ? locale === "ja" ? "ガイドを閉じる" : "Hide guide"
              : locale === "ja" ? "ガイドを開く" : "Show guide"}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4" data-testid="preview-content">
        {preview ?? <FeaturePreview featureId={featureId} locale={locale} />}
      </div>
    </section>
  );
}
