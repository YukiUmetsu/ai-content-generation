import { useEffect, useMemo, useRef, useState } from "react";
import { FEATURE_IDS, FEATURE_METADATA, type FeatureId, type Locale } from "@/features/registry";
import { FEATURE_SLOTS } from "@/features/slots";
import { SplitPane } from "@/components/ui/split-pane";
import { Tabs } from "@/components/ui/tabs";
import { FeatureErrorBoundary } from "./feature-boundary";
import { PreviewCanvas } from "./preview-canvas";
import { EmptyState } from "./empty-state";
import { useWide } from "./use-wide";

function useHorizontalOverflow<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;

    function update() {
      if (!element) return;
      setOverflowing(element.scrollWidth > element.clientWidth);
    }

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, overflowing };
}

interface WorkspaceProps {
  locale: Locale;
  projectId: string;
  filter: string;
  activeFeatureId: FeatureId;
  onFeatureChange: (id: FeatureId) => void;
}

export function Workspace({ locale, projectId, filter, activeFeatureId, onFeatureChange }: WorkspaceProps) {
  const isWide = useWide();
  const { ref: tabsListRef, overflowing: tabsOverflowing } = useHorizontalOverflow<HTMLDivElement>();

  const filteredIds = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return FEATURE_IDS.slice();
    return FEATURE_IDS.filter((id) => {
      const meta = FEATURE_METADATA[id];
      const title = (locale === "ja" ? meta.titleJa : meta.title).toLowerCase();
      const outcome = (locale === "ja" ? meta.outcomeJa : meta.outcome).toLowerCase();
      return title.includes(query) || outcome.includes(query);
    });
  }, [filter, locale]);

  const activeIndex = filteredIds.indexOf(activeFeatureId);

  useEffect(() => {
    if (filteredIds.length > 0 && !filteredIds.includes(activeFeatureId)) {
      onFeatureChange(filteredIds[0]);
    }
  }, [filteredIds, activeFeatureId, onFeatureChange]);

  if (filteredIds.length === 0) {
    return (
      <main id="workspace" aria-label="Workspace" className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        <EmptyState
          title={locale === "ja" ? "一致するツールがありません" : "No tools match"}
          description={
            locale === "ja"
              ? `「${filter}」に一致するツールはありません。`
              : `"${filter}" did not match any studio tool.`
          }
        />
      </main>
    );
  }

  const currentMeta = FEATURE_METADATA[activeFeatureId];
  const Slot = FEATURE_SLOTS[activeFeatureId];
  const currentTitle = locale === "ja" ? currentMeta.titleJa : currentMeta.title;

  return (
    <section
      id="workspace"
      aria-label="Workspace"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <Tabs
        activeIndex={activeIndex >= 0 ? activeIndex : 0}
        onChange={(index) => {
          if (index !== null && filteredIds[index]) {
            onFeatureChange(filteredIds[index]);
          }
        }}
        label={locale === "ja" ? "スタジオツール" : "Studio tools"}
        className="flex min-h-0 flex-1 flex-col px-4 pb-4"
      >
        <div className="relative mt-3 shrink-0">
          <Tabs.List
            ref={tabsListRef}
            className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:grid md:grid-cols-5 md:px-0"
          >
            {filteredIds.map((id, index) => (
              <Tabs.Tab
                key={id}
                value={index}
                className="min-w-0 !px-1 text-[13px] md:!px-1.5 lg:!px-2"
              >
                {locale === "ja" ? FEATURE_METADATA[id].titleJa : FEATURE_METADATA[id].title}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-track to-transparent transition-opacity duration-[var(--km-duration-short)] ${
              tabsOverflowing ? "opacity-100" : "opacity-0"
            }`}
          />
        </div>

        <Tabs.Panel
          value={activeIndex >= 0 ? activeIndex : 0}
          className="mt-3 flex min-h-0 flex-1 flex-col"
        >
          <SplitPane
            key={isWide ? "wide" : "narrow"}
            className="h-full"
            orientation={isWide ? "horizontal" : "vertical"}
            defaultPrimarySize={isWide ? 55 : 45}
            minPrimarySize={20}
            maxPrimarySize={80}
            primary={
              <div className="h-full min-w-0 w-full overflow-x-hidden overflow-y-auto p-4">
                <FeatureErrorBoundary title={currentTitle}>
                  <Slot projectId={projectId} locale={locale} className="rounded-surface" />
                </FeatureErrorBoundary>
              </div>
            }
            secondary={
              <PreviewCanvas locale={locale} featureTitle={currentTitle} />
            }
          />
        </Tabs.Panel>
      </Tabs>
    </section>
  );
}
