import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FeatureMetadata, Locale } from "@/features/registry";

interface InspectorProps {
  meta: FeatureMetadata | null;
  locale: Locale;
}

export function InspectorPanel({ meta, locale }: InspectorProps) {
  const [expanded, setExpanded] = useState(false);
  const title = locale === "ja" ? "使い方" : "How to use this tool";
  const planned = meta?.availability === "planned";
  const status = !meta
    ? ""
    : locale === "ja"
      ? meta.availability === "live" ? "ライブプレビュー" : meta.availability === "demo" ? "操作できるデモ" : "準備中"
      : meta.availability === "live" ? "Live preview" : meta.availability === "demo" ? "Interactive demo" : "Planned";

  return (
    <div className="border-t border-border bg-surface lg:border-t-0 lg:border-l">
      <Button
        variant="subtle"
        size="sm"
        className="w-full justify-between rounded-none px-4 lg:hidden"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span>{title}</span>
        <ChevronDown
          aria-hidden
          className={"size-4 shrink-0 transition-transform duration-[var(--km-duration-short)] " + (expanded ? "rotate-180" : "")}
        />
      </Button>

      <aside
        aria-label="How to use this tool"
        className={(expanded ? "block" : "hidden") + " flex w-full flex-col gap-4 overflow-auto p-4 lg:block lg:w-[300px] lg:shrink-0"}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">{locale === "ja" ? "ツールガイド" : "Tool guide"}</h2>
          {meta && (
            <span className="rounded-full border border-border bg-surface-subtle px-2 py-1 text-caption text-muted-foreground">
              {status}
            </span>
          )}
        </div>

        {meta ? (
          <>
            <section className="border-b border-border pb-4">
              <h3 className="font-serif text-subheading text-foreground">
                {locale === "ja" ? meta.titleJa : meta.title}
              </h3>
              <p className="mt-2 text-body-sm leading-relaxed text-muted-foreground">
                {locale === "ja" ? meta.outcomeJa : meta.outcome}
              </p>
            </section>

            <section>
              <h3 className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                {locale === "ja" ? "手順" : "Steps"}
              </h3>
              <ol className="mt-3 flex flex-col gap-3">
                {meta.steps[locale].map((step, index) => (
                  <li key={step} className="flex items-start gap-3">
                    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface-subtle text-caption font-medium text-foreground">
                      {index + 1}
                    </span>
                    <span className="pt-0.5 text-body-sm text-foreground">{step}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section className="border-t border-border pt-4">
              <h3 className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                {locale === "ja" ? "作成できるもの" : "You'll get"}
              </h3>
              <ul className="mt-2 flex flex-col gap-2">
                {meta.outputs[locale].map((output) => (
                  <li key={output} className="flex items-start gap-2 text-body-sm text-foreground">
                    <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                    {output}
                  </li>
                ))}
              </ul>
            </section>

            <p className="rounded-control bg-surface-subtle p-3 text-caption leading-relaxed text-muted-foreground">
              {locale === "ja"
                ? planned
                  ? "このツールはまだ操作できません。右側のプレビューは完成時のイメージです。"
                  : meta.availability === "live"
                    ? "色・書体・プリセットを変更すると、右側のプレビューに反映されます。"
                    : "エディター内でモーションや図解のデモを操作できます。右側にはサンプルを表示しています。"
                : planned
                  ? "This tool isn't interactive yet. The preview shows an example of the intended result."
                  : meta.availability === "live"
                    ? "Change a preset, color, or font to update the preview on the right."
                    : "Explore the motion and infographic demo in the editor. The right pane shows a sample output."}
            </p>
          </>
        ) : (
          <p className="text-body-sm text-muted-foreground">
            {locale === "ja" ? "ツールを選ぶと使い方が表示されます。" : "Choose a tool to see how it works."}
          </p>
        )}
      </aside>
    </div>
  );
}
