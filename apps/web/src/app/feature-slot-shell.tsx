import type { FeatureMetadata, FeatureSlotProps } from "@/features/registry";
import { Surface } from "@/components/ui/surface-card";

/**
 * Placeholder body shared by the five feature slots. It is a composition of a
 * Kumiki Surface, not a second card primitive. `min-h-full` lets the slot grow
 * and the surrounding SplitPane scroll on short mobile viewports instead of
 * clipping the description and metadata behind `overflow-hidden`.
 */
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
  const labels =
    locale === "ja"
      ? {
          consumes: "入力",
          produces: "出力",
          empty: "ドキュメントはまだ読み込まれていません。機能チームが接続すると、ここに実際のエディターが表示されます。",
        }
      : {
          consumes: "Consumes",
          produces: "Produces",
          empty:
            "No document loaded. This slot will render the real editor once the feature team wires it in.",
        };

  return (
    <Surface variant="outline" className={`min-h-full w-full min-w-0 ${className ?? ""}`.trim()}>
      <div className="flex w-full min-w-0 flex-col gap-6">
        <div className="min-w-0">
          <h2 className="break-words font-serif text-heading-sm text-foreground">{title}</h2>
          <p className="mt-1 break-words text-body-sm text-muted-foreground">{outcome}</p>
        </div>

        <div className="grid w-full min-w-0 grid-cols-1 gap-6 border-t border-border pt-4 sm:grid-cols-2">
          <section className="min-w-0">
            <h3 className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
              {labels.consumes}
            </h3>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-body-sm text-foreground">
              {meta.consumes.map((item) => (
                <li key={item} className="break-words">
                  {item}
                </li>
              ))}
            </ul>
          </section>
          <section className="min-w-0">
            <h3 className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
              {labels.produces}
            </h3>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-body-sm text-foreground">
              {meta.produces.map((item) => (
                <li key={item} className="break-words">
                  {item}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <p className="break-words text-body-sm text-muted-foreground">{labels.empty}</p>
      </div>
    </Surface>
  );
}
