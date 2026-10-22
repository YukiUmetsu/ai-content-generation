import { useEffect, useState } from "react";
import { FEATURE_IDS, FEATURE_METADATA, type FeatureId } from "@/features/registry";
import { Header } from "./header";
import { InspectorPanel } from "./inspector";
import { MobileNavDrawer, StudioSidebar } from "./sidebar";
import { sectionLabel, type SectionId } from "./navigation";
import { usePreferences } from "./use-preferences";
import { Workspace } from "./workspace";
import { EmptyState } from "./empty-state";
import { ResearchWorkspace } from "./research-workspace";
import { JobsWorkspace } from "./jobs-workspace";
import { ShortcutsDialog } from "./shortcuts-dialog";

const PROJECT_ID = "demo-project-1";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || target.isContentEditable;
}

export function Shell() {
  const { locale } = usePreferences();
  const [activeSection, setActiveSection] = useState<SectionId>("create");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [activeFeatureId, setActiveFeatureId] = useState<FeatureId>(FEATURE_IDS[0]);
  const [toolGuideOpen, setToolGuideOpen] = useState(true);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "?" && !isTypingTarget(event.target)) {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      if (
        activeSection === "create" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        /^[1-5]$/.test(event.key)
      ) {
        const index = parseInt(event.key, 10) - 1;
        const next = FEATURE_IDS[index];
        if (next) {
          event.preventDefault();
          setActiveFeatureId(next);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeSection]);

  const activeMeta = FEATURE_METADATA[activeFeatureId];

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-canvas text-foreground">
      <a
        href="#workspace"
        className="sr-only fixed top-2 left-2 z-50 rounded-control bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {locale === "ja" ? "ワークスペースへスキップ" : "Skip to workspace"}
      </a>

      <div className="hidden lg:block">
        <StudioSidebar
          activeSection={activeSection}
          onSelectSection={setActiveSection}
          locale={locale}
          onOpenShortcuts={() => setShortcutsOpen(true)}
        />
      </div>

      <MobileNavDrawer
        open={mobileNavOpen}
        onOpenChange={setMobileNavOpen}
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        locale={locale}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {activeSection !== "create" && (
          <Header activeSection={activeSection} onOpenNav={() => setMobileNavOpen(true)} />
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          {activeSection === "create" ? (
            <Workspace
              locale={locale}
              projectId={PROJECT_ID}
              activeFeatureId={activeFeatureId}
              onFeatureChange={setActiveFeatureId}
              onOpenNav={() => setMobileNavOpen(true)}
              toolGuideOpen={toolGuideOpen}
              onToolGuideOpenChange={setToolGuideOpen}
            />
          ) : activeSection === "research" ? (
            <ResearchWorkspace locale={locale} />
          ) : activeSection === "jobs-qa" ? (
            <JobsWorkspace locale={locale} />
          ) : (
            <main
              id="workspace"
              aria-label="Workspace"
              className="flex min-h-0 flex-1 flex-col overflow-auto p-4"
            >
              <EmptyState
                title={sectionEmptyTitle(activeSection, locale)}
                description={sectionEmptyDescription(activeSection, locale)}
              />
            </main>
          )}

          {activeSection === "create" && (
            <InspectorPanel
              meta={activeMeta}
              locale={locale}
              open={toolGuideOpen}
              onOpenChange={setToolGuideOpen}
            />
          )}
        </div>
      </div>

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} showTrigger={false} />
    </div>
  );
}

function sectionEmptyTitle(id: SectionId, locale: "en" | "ja"): string {
  const labels: Record<SectionId, Record<"en" | "ja", string>> = {
    projects: { en: "Projects", ja: "プロジェクト" },
    research: { en: "Research", ja: "調査" },
    create: { en: "Create", ja: "作成" },
    content: { en: "Content", ja: "コンテンツ" },
    assets: { en: "Assets", ja: "アセット" },
    products: { en: "Products", ja: "プロダクト" },
    "jobs-qa": { en: "Jobs & QA", ja: "ジョブとQA" },
    insights: { en: "Insights", ja: "分析" },
    settings: { en: "Settings", ja: "設定" },
  };
  return locale === "ja" ? labels[id].ja + "はこの基盤の範囲外です" : labels[id].en + " is outside this foundation";
}

function sectionEmptyDescription(id: SectionId, locale: "en" | "ja"): string {
  return locale === "ja"
    ? "「" + sectionLabel(id, locale) + "」の機能はまだ接続されていません。作成セクションで使用可能なスタジオツールから始めてください。"
    : "The " + sectionLabel(id, locale).toLowerCase() + " area is not wired in this foundation. Start with the available studio tools in Create.";
}
