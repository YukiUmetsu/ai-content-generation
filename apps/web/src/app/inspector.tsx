import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import type { FeatureMetadata, Locale } from "@/features/registry";

interface InspectorProps {
  meta: FeatureMetadata | null;
  locale: Locale;
  projectId: string;
  appearance: string;
  density: string;
}

export function InspectorPanel({ meta, locale, projectId, appearance, density }: InspectorProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-t border-border bg-surface lg:border-t-0 lg:border-l">
      <Button
        variant="subtle"
        size="sm"
        className="w-full justify-between rounded-none px-4 lg:hidden"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span>{locale === "ja" ? "プロパティ" : "Properties"}</span>
        <ChevronDown
          aria-hidden
          className={`size-4 shrink-0 transition-transform duration-[var(--km-duration-short)] ${expanded ? "rotate-180" : ""}`}
        />
      </Button>

      <aside
        aria-label="Properties"
        className={`${expanded ? "block" : "hidden"} flex w-full flex-col gap-3 overflow-auto p-4 lg:block lg:w-[320px] lg:shrink-0`}
      >
        <Surface variant="outline">
          <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">Document</p>
          <p className="mt-2 text-body-sm text-muted-foreground">
            {locale === "ja" ? "ドキュメントが読み込まれていません。" : "No document loaded"}
          </p>
        </Surface>

        {meta && (
          <>
            <Surface variant="ghost">
              <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
                {locale === "ja" ? "入力" : "Consumes"}
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-body-sm text-foreground">
                {meta.consumes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Surface>

            <Surface variant="ghost">
              <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
                {locale === "ja" ? "出力" : "Produces"}
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-body-sm text-foreground">
                {meta.produces.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Surface>
          </>
        )}

        <Surface variant="outline">
          <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
            {locale === "ja" ? "状態" : "State"}
          </p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body-sm">
            <dt className="text-muted-foreground">Project</dt>
            <dd className="break-all text-foreground">{projectId}</dd>
            <dt className="text-muted-foreground">Locale</dt>
            <dd className="uppercase text-foreground">{locale}</dd>
            <dt className="text-muted-foreground">Appearance</dt>
            <dd className="capitalize text-foreground">{appearance}</dd>
            <dt className="text-muted-foreground">Density</dt>
            <dd className="capitalize text-foreground">{density}</dd>
          </dl>
        </Surface>
      </aside>
    </div>
  );
}
