import { Clock3 } from "lucide-react";
import { Surface } from "@/components/ui/surface-card";
import type { FeatureMetadata, FeatureSlotProps } from "@/features/registry";

/** Honest scaffold for tools whose editor is not wired up yet. */
export function FeatureSlotShell({
  meta,
  locale,
  className,
}: {
  meta: FeatureMetadata;
  locale: FeatureSlotProps["locale"];
  className?: string;
}) {
  const title = locale === "ja" ? meta.titleJa : meta.title;
  const outcome = locale === "ja" ? meta.outcomeJa : meta.outcome;
  const steps = meta.steps[locale];

  return (
    <div className={"flex min-h-full w-full min-w-0 flex-col gap-5 " + (className ?? "")}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words font-serif text-heading-sm text-foreground">{title}</h2>
          <p className="mt-2 max-w-2xl break-words text-body-sm leading-relaxed text-muted-foreground">{outcome}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-subtle px-2.5 py-1 text-caption text-muted-foreground">
          <Clock3 aria-hidden="true" className="size-3.5" />
          {locale === "ja" ? "準備中" : "Planned"}
        </span>
      </header>

      <Surface variant="outline" className="gap-2">
        <h3 className="text-sm font-medium text-foreground">
          {locale === "ja" ? "このツールについて" : "What to expect"}
        </h3>
        <p className="text-body-sm leading-relaxed text-muted-foreground">
          {locale === "ja"
            ? "編集機能はまだ接続されていません。右側のプレビューで、完成時の出力イメージを確認できます。"
            : "The editor isn't connected yet. Use the example preview on the right to understand the kind of result this tool is designed to create."}
        </p>
      </Surface>

      <section>
        <h3 className="mb-3 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
          {locale === "ja" ? "予定している手順" : "Planned workflow"}
        </h3>
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
          {steps.map((step, index) => (
            <li key={step} className="flex items-start gap-3 rounded-control border border-border bg-surface p-3">
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-caption font-medium text-foreground">
                {index + 1}
              </span>
              <span className="text-body-sm text-foreground">{step}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
