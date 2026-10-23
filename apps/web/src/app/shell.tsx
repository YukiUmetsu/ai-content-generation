import { useCallback, useEffect, useState } from "react";
import { FEATURE_IDS, FEATURE_METADATA, type FeatureId } from "@/features/registry";
import { Header } from "./header";
import { InspectorPanel } from "./inspector";
import { MobileNavDrawer, StudioSidebar } from "./sidebar";
import type { SectionId } from "./navigation";
import { usePreferences } from "./use-preferences";
import { Workspace } from "./workspace";
import { CatalogWorkspace } from "./catalog-workspace";
import { loadCatalog, persistCatalog, type StudioCatalog } from "./catalog-model";
import { ResearchWorkspace } from "./research-workspace";
import { JobsWorkspace } from "./jobs-workspace";
import { VideoDirectorWorkspace } from "./video-director-workspace";
import { ShortcutsDialog } from "./shortcuts-dialog";


function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || target.isContentEditable;
}

export function Shell() {
  const { locale } = usePreferences();
  const [activeSection, setActiveSection] = useState<SectionId>("create");
  const [initialCatalog] = useState(loadCatalog);
  const [catalog, setCatalog] = useState(initialCatalog.catalog);
  const [catalogError, setCatalogError] = useState<string | null>(initialCatalog.warning);
  const saveCatalog = useCallback((next: StudioCatalog): boolean => {
    try {
      persistCatalog(next);
      setCatalog(next);
      setCatalogError(null);
      return true;
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : "Local catalog could not be saved.");
      return false;
    }
  }, []);
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
        !isTypingTarget(event.target) &&
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
        {catalogError && (
          <div role="alert" className="border-b border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
            Local catalog: {catalogError}. Existing data has not been overwritten.
          </div>
        )}
        {activeSection !== "create" && (
          <Header activeSection={activeSection} onOpenNav={() => setMobileNavOpen(true)} />
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          {activeSection === "create" ? (
            <Workspace
              key={catalog.activeProjectId}
              locale={locale}
              projectId={catalog.activeProjectId}
              activeFeatureId={activeFeatureId}
              onFeatureChange={setActiveFeatureId}
              onOpenNav={() => setMobileNavOpen(true)}
              toolGuideOpen={toolGuideOpen}
              onToolGuideOpenChange={setToolGuideOpen}
            />
          ) : activeSection === "video-director" ? (
            <VideoDirectorWorkspace locale={locale}/>
          ) : activeSection === "research" ? (
            <ResearchWorkspace locale={locale} />
          ) : activeSection === "jobs-qa" ? (
            <JobsWorkspace locale={locale} />
          ) : (
            <CatalogWorkspace
              key={activeSection + ":" + catalog.activeProjectId}
              section={activeSection}
              locale={locale}
              catalog={catalog}
              save={saveCatalog}
              onCreate={() => setActiveSection("create")}
            />
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

