import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Clapperboard, Film, Image, Palette, PanelLeft, Share2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FEATURE_IDS, FEATURE_METADATA, type FeatureId, type Locale } from "@/features/registry";
import { FEATURE_SLOTS } from "@/features/slots";
import { SplitPane } from "@/components/ui/split-pane";
import { Tabs } from "@/components/ui/tabs";
import { FeatureErrorBoundary } from "./feature-boundary";
import { PreviewCanvas } from "./preview-canvas";
import { useWide } from "./use-wide";

const TOOL_ICONS: Record<FeatureId, LucideIcon> = {
  "brand-appearance": Palette,
  "thumbnail-composer": Image,
  "storyboard-planner": Clapperboard,
  "motion-gallery": Film,
  "platform-composer": Share2,
};

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
  activeFeatureId: FeatureId;
  onFeatureChange: (id: FeatureId) => void;
  onOpenNav: () => void;
}

export function Workspace({
  locale,
  projectId,
  activeFeatureId,
  onFeatureChange,
  onOpenNav,
}: WorkspaceProps) {
  const isWide = useWide();
  const { ref: tabsListRef, overflowing: tabsOverflowing } = useHorizontalOverflow<HTMLDivElement>();
  const [previewState, setPreviewState] = useState<{
    featureId: FeatureId;
    content: ReactNode | null;
  } | null>(null);
  const onPreviewChange = useCallback(
    (content: ReactNode | null) => setPreviewState({ featureId: activeFeatureId, content }),
    [activeFeatureId],
  );

  const activeIndex = FEATURE_IDS.indexOf(activeFeatureId);
  const currentMeta = FEATURE_METADATA[activeFeatureId];
  const Slot = FEATURE_SLOTS[activeFeatureId];
  const currentPreview = previewState?.featureId === activeFeatureId ? previewState.content : null;

  return (
    <section
      id="workspace"
      aria-label="Workspace"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <Tabs
        activeIndex={activeIndex >= 0 ? activeIndex : 0}
        onChange={(index) => {
          if (index !== null && FEATURE_IDS[index]) onFeatureChange(FEATURE_IDS[index]);
        }}
        label={locale === "ja" ? "スタジオツール" : "Studio tools"}
        className="flex min-h-0 flex-1 flex-col px-4 pb-4"
      >
        <div className="flex items-center justify-between gap-2 pt-3 lg:hidden">
          <Button
            variant="subtle"
            size="sm"
            aria-label={locale === "ja" ? "ナビゲーションを開く" : "Open navigation"}
            title={locale === "ja" ? "ナビゲーションを開く" : "Open navigation"}
            onClick={onOpenNav}
            icon={<PanelLeft aria-hidden="true" className="size-4" />}
          >
            {locale === "ja" ? "メニュー" : "Menu"}
          </Button>
          <span className="text-caption text-muted-foreground">
            {locale === "ja" ? "ツールを選択" : "Choose a tool"}
          </span>
        </div>

        <div className="relative mt-3 shrink-0">
          <Tabs.List
            ref={tabsListRef}
            className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:grid md:grid-cols-5 md:px-0"
          >
            {FEATURE_IDS.map((id, index) => {
              const Icon = TOOL_ICONS[id];
              const title = locale === "ja" ? FEATURE_METADATA[id].titleJa : FEATURE_METADATA[id].title;
              return (
                <Tabs.Tab
                  key={id}
                  value={index}
                  className="min-w-0 !px-1 text-[13px] md:!px-1.5 lg:!px-2"
                >
                  <span className="flex min-w-0 items-center justify-center gap-1.5">
                    <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                    <span className="truncate">{title}</span>
                  </span>
                </Tabs.Tab>
              );
            })}
          </Tabs.List>
          <div
            aria-hidden="true"
            className={"pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-track to-transparent transition-opacity duration-[var(--km-duration-short)] " + (tabsOverflowing ? "opacity-100" : "opacity-0")}
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
                <FeatureErrorBoundary title={locale === "ja" ? currentMeta.titleJa : currentMeta.title}>
                  <Slot
                    projectId={projectId}
                    locale={locale}
                    className="rounded-surface"
                    onPreviewChange={onPreviewChange}
                  />
                </FeatureErrorBoundary>
              </div>
            }
            secondary={
              <PreviewCanvas locale={locale} featureId={activeFeatureId} preview={currentPreview} />
            }
          />
        </Tabs.Panel>
      </Tabs>
    </section>
  );
}
