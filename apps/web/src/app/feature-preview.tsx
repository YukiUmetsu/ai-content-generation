import type { FeatureId, Locale } from "@/features/registry";

interface FeaturePreviewProps {
  featureId: FeatureId;
  locale: Locale;
}

function HeroArtwork({ variant, locale }: { variant: "brand" | "thumbnail" | "motion"; locale: Locale }) {
  const isJa = locale === "ja";
  const headline = isJa ? "新しい HVAC の本当の費用" : "THE REAL COST OF A NEW HVAC SYSTEM";
  const isThumbnail = variant === "thumbnail";

  return (
    <div
      data-testid={"concept-preview-" + variant}
      className={"relative aspect-video w-full overflow-hidden rounded-surface border border-border bg-surface-inset p-4 sm:p-6 " + (isThumbnail ? "flex flex-col justify-between" : "")}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold tracking-[0.18em] text-primary sm:text-xs">
          HOUSE MATH / FIELD NOTES
        </span>
        <span className="rounded-full border border-border bg-surface px-2 py-1 text-[9px] uppercase tracking-wide text-muted-foreground sm:text-[10px]">
          {isJa ? "コストガイド" : "Cost guide"}
        </span>
      </div>

      <div className={"grid min-w-0 grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] items-center gap-3 " + (isThumbnail ? "my-2 flex-1" : "mt-4 sm:mt-6")}>
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:text-xs">
            {isJa ? "住宅コストを解説" : "A clearer look at home costs"}
          </p>
          <h3 className={"mt-2 break-words font-serif font-semibold leading-tight text-foreground " + (isThumbnail ? "text-lg sm:text-2xl" : "text-base sm:text-xl")}>
            {headline}
          </h3>
          <div className="mt-3 h-1 w-10 rounded-full bg-primary" />
        </div>

        <div className="min-w-0 rounded-control border border-border bg-surface p-3 sm:p-4">
          <p className="text-[8px] font-medium uppercase tracking-wide text-muted-foreground sm:text-[10px]">
            {isJa ? "設置費用の例" : "Illustrative installed cost"}
          </p>
          <p className="mt-1 break-words font-serif text-xl font-semibold tabular-nums text-foreground sm:text-3xl">$12,400</p>
          <div className="mt-3 flex flex-col gap-1.5">
            <div className="h-1.5 w-full rounded-full bg-surface-subtle"><div className="h-full w-[58%] rounded-full bg-primary" /></div>
            <div className="h-1.5 w-full rounded-full bg-surface-subtle"><div className="h-full w-[28%] rounded-full bg-primary/50" /></div>
            <div className="h-1.5 w-full rounded-full bg-surface-subtle"><div className="h-full w-[17%] rounded-full bg-border" /></div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border pt-2 text-[9px] text-muted-foreground sm:text-[10px]">
        <span>{isJa ? "説明用データ" : "Illustrative example"}</span>
        {variant === "motion" ? <span className="font-mono">FRAME 042 / 180</span> : <span>16:9</span>}
      </div>
    </div>
  );
}

function StoryboardPreview({ locale }: { locale: Locale }) {
  const scenes = locale === "ja"
    ? [
        { number: "01", title: "問いを立てる", detail: "最初の 3 秒で注目を集める" },
        { number: "02", title: "内訳を見せる", detail: "費用を要素ごとに分解" },
        { number: "03", title: "要点を残す", detail: "視聴者が覚える結論" },
      ]
    : [
        { number: "01", title: "Hook", detail: "Earn attention in the first seconds" },
        { number: "02", title: "Breakdown", detail: "Explain the cost drivers" },
        { number: "03", title: "Takeaway", detail: "Leave one useful conclusion" },
      ];

  return (
    <div className="flex flex-col gap-3" data-testid="concept-preview-storyboard">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {scenes.map((scene, index) => (
          <div key={scene.number} className="min-w-0">
            <div className="relative aspect-video overflow-hidden rounded-control border border-border bg-surface-inset p-3">
              <span className="text-caption font-mono text-muted-foreground">{scene.number} / 03</span>
              {index === 0 ? (
                <div className="mt-3 flex h-1/2 items-end">
                  <div className="h-3/4 w-1/3 rounded-control bg-primary/70" />
                  <div className="ml-2 h-full w-1/3 rounded-t-control bg-surface-subtle" />
                  <div className="ml-2 h-1/2 w-1/3 rounded-t-control bg-border" />
                </div>
              ) : index === 1 ? (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="h-2 w-4/5 rounded-full bg-primary/70" />
                  <div className="h-2 w-3/5 rounded-full bg-surface-subtle" />
                  <div className="h-2 w-2/5 rounded-full bg-border" />
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-2">
                  <span className="font-serif text-xl font-semibold text-foreground">$12.4K</span>
                  <span className="h-5 w-1 rounded-full bg-primary" />
                </div>
              )}
            </div>
            <p className="mt-2 text-body-sm font-medium text-foreground">{scene.title}</p>
            <p className="mt-1 text-caption leading-relaxed text-muted-foreground">{scene.detail}</p>
          </div>
        ))}
      </div>
      <p className="text-caption text-muted-foreground">
        {locale === "ja" ? "シーンの順序とナレーションを組み立てるイメージです。" : "A sample sequence showing how scenes and narration beats fit together."}
      </p>
    </div>
  );
}

function PlatformPreview({ locale }: { locale: Locale }) {
  const isJa = locale === "ja";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(96px,0.45fr)] items-start gap-3" data-testid="concept-preview-platform">
      <div className="min-w-0">
        <p className="mb-2 text-caption font-medium text-muted-foreground">YouTube · 16:9</p>
        <HeroArtwork variant="thumbnail" locale={locale} />
      </div>
      <div className="min-w-0">
        <p className="mb-2 text-caption font-medium text-muted-foreground">{isJa ? "Shorts · 9:16" : "Shorts · 9:16"}</p>
        <div className="relative mx-auto flex aspect-[9/16] w-full flex-col justify-between overflow-hidden rounded-surface border border-border bg-surface-inset p-2 sm:p-3">
          <span className="text-[8px] font-semibold tracking-widest text-primary">HOUSE MATH</span>
          <div>
            <h3 className="font-serif text-sm font-semibold leading-tight text-foreground sm:text-base">
              {isJa ? "HVAC の費用" : "HVAC COSTS"}
            </h3>
            <p className="mt-1 text-[10px] text-muted-foreground">{isJa ? "何にお金がかかる？" : "Where the money goes"}</p>
          </div>
          <div className="rounded-control border border-border bg-surface p-2">
            <p className="text-[8px] uppercase tracking-wide text-muted-foreground">{isJa ? "費用例" : "Example cost"}</p>
            <p className="font-serif text-base font-semibold text-foreground">$12.4K</p>
            <div className="mt-1 h-1 rounded-full bg-primary/70" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function FeaturePreview({ featureId, locale }: FeaturePreviewProps) {
  if (featureId === "storyboard-planner") return <StoryboardPreview locale={locale} />;
  if (featureId === "platform-composer") return <PlatformPreview locale={locale} />;
  if (featureId === "thumbnail-composer") return <HeroArtwork variant="thumbnail" locale={locale} />;
  if (featureId === "motion-gallery") return <HeroArtwork variant="motion" locale={locale} />;
  return <HeroArtwork variant="brand" locale={locale} />;
}
