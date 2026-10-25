import { useCallback, useEffect, useState } from "react";
import { FEATURE_IDS, FEATURE_METADATA, type FeatureId } from "@/features/registry";
import { Header } from "./header";
import { InspectorPanel } from "./inspector";
import { MobileNavDrawer, StudioSidebar } from "./sidebar";
import type { SectionId } from "./navigation";
import { usePreferences } from "./use-preferences";
import { Workspace } from "./workspace";
import { CatalogWorkspace } from "./catalog-workspace";
import { loadCatalog, makeCatalogId, persistCatalog, type LocalContent, type StudioCatalog } from "./catalog-model";
import { ResearchWorkspace, type ResearchIdeaHandoff } from "./research-workspace";
import { JobsWorkspace } from "./jobs-workspace";
import { VideoDirectorWorkspace } from "./video-director-workspace";
import { ProductionWorkspace } from "./production-workspace";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { createEditorialProject } from "./editorial-project";
import type { EditorialDraft } from "./editorial-brief";
import type { ResearchDraftResult } from "./researched-storyboard";
import { deleteDiscoveryProject, syncDiscoveryProject } from "@/lib/api/discovery";
import { enqueueProjectDeletion, flushProjectDeletions, pendingProjectDeletions } from "./project-deletion-queue";


function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || target.isContentEditable;
}

export function Shell() {
  const { locale } = usePreferences();
  const [activeSection, setActiveSection] = useState<SectionId>("production");
  const [directorEntry,setDirectorEntry] = useState<{projectId:string;artifactId?:string;stage:"visuals"|"audio"|"export"}|null>(null);
  const selectSection = (next:SectionId) => {
    if(next==="video-director")setDirectorEntry(null);
    setActiveSection(next);
  };
  const [activeFeatureId, setActiveFeatureId] = useState<FeatureId>(FEATURE_IDS[0]);
  const [initialCatalog] = useState(loadCatalog);
  const [catalog, setCatalog] = useState(initialCatalog.catalog);
  const [catalogError, setCatalogError] = useState<string | null>(initialCatalog.warning);
  const [discoverySync, setDiscoverySync] = useState<"syncing" | "synced" | "offline">("syncing");
  const [researchHandoff,setResearchHandoff] = useState<ResearchIdeaHandoff|null>(null);
  const [discoveryVisit, setDiscoveryVisit] = useState(0);
  useEffect(() => {
    const visit = () => { if (document.visibilityState === "visible") setDiscoveryVisit(value => value + 1); };
    document.addEventListener("visibilitychange", visit);
    return () => document.removeEventListener("visibilitychange", visit);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setDiscoverySync("syncing");
      void (async () => {
        try {
          const ordered = [...catalog.projects].sort((a,b) => Number(b.id === catalog.activeProjectId) - Number(a.id === catalog.activeProjectId));
          for (const project of ordered) await syncDiscoveryProject(project, catalog.content, controller.signal);
          if (controller.signal.aborted) return;
          await flushProjectDeletions(window.localStorage,new Set(catalog.projects.map(project=>project.id)),deleteDiscoveryProject);
          if (!controller.signal.aborted) {
            setDiscoverySync("synced");
            const outstanding=pendingProjectDeletions(window.localStorage);
            setCatalogError(previous=>outstanding>0?previous??"Server cleanup for deleted projects is queued until the local Rust server responds.":
              previous?.startsWith("Server cleanup for deleted projects")?null:previous);
          }
        } catch {
          // Server may be stopped; the local catalog is saved independently.
          if (!controller.signal.aborted) setDiscoverySync("offline");
        }
      })();
    }, 600);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [catalog, discoveryVisit]);
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
  const queueProjectDeletion = useCallback((projectId:string):boolean=>{
    try{enqueueProjectDeletion(window.localStorage,projectId);return true;}
    catch(error){setCatalogError(error instanceof Error?error.message:"Could not queue server cleanup for this project.");return false;}
  },[]);
  const saveVideoIdea = useCallback((idea: {title: string; sourceUrl: string}): boolean => {
    const item: LocalContent = {
      id: makeCatalogId("item"),
      projectId: catalog.activeProjectId,
      name: idea.title.trim().slice(0, 120),
      notes: `Public YouTube inspiration: ${idea.sourceUrl}`,
      createdAt: new Date().toISOString(),
      kind: "video",
      stage: "idea",
    };
    const saved = saveCatalog({...catalog, content: [...catalog.content, item]});
    if (saved) setActiveSection("content");
    return saved;
  }, [catalog, saveCatalog]);
  const startEditorialStoryboard = useCallback((draft: EditorialDraft, research?: ResearchDraftResult): boolean => {
    try {
      const next = createEditorialProject(catalog, draft, locale, research);
      setCatalog(next);
      setCatalogError(null);
      setActiveFeatureId("storyboard-planner");
      setActiveSection("create");
      return true;
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : "Video project could not be saved.");
      return false;
    }
  }, [catalog, locale]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
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
          onSelectSection={selectSection}
          locale={locale}
          onOpenShortcuts={() => setShortcutsOpen(true)}
        />
      </div>

      <MobileNavDrawer
        open={mobileNavOpen}
        onOpenChange={setMobileNavOpen}
        activeSection={activeSection}
        onSelectSection={selectSection}
        locale={locale}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {catalogError && (
          <div role="alert" className="border-b border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
            Local catalog: {catalogError}. Existing data has not been overwritten.
          </div>
        )}
        {activeSection !== "create" && activeSection !== "production" && (
          <Header activeSection={activeSection} onOpenNav={() => setMobileNavOpen(true)} />
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          {activeSection === "production" ? (
            <ProductionWorkspace
              key={catalog.activeProjectId}
              locale={locale}
              catalog={catalog}
              onSelectProject={(projectId) => {
                if(catalog.projects.some(project=>project.id===projectId))
                  saveCatalog({...catalog,activeProjectId:projectId});
              }}
              onOpenNav={() => setMobileNavOpen(true)}
              onOpenResearch={() => setActiveSection("research")}
              onOpenStoryboard={() => {setActiveFeatureId("storyboard-planner");setActiveSection("create");}}
              onOpenVisuals={(artifactId) => {setDirectorEntry({projectId:catalog.activeProjectId,artifactId,stage:"visuals"});setActiveSection("video-director");}}
              onOpenAudio={(artifactId) => {setDirectorEntry({projectId:catalog.activeProjectId,artifactId,stage:"audio"});setActiveSection("video-director");}}
              onOpenExport={(artifactId) => {setDirectorEntry({projectId:catalog.activeProjectId,artifactId,stage:"export"});setActiveSection("video-director");}}
              onCreateStoryboard={startEditorialStoryboard}
              onUseVideo={saveVideoIdea}
            />
          ) : activeSection === "create" ? (
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
            <VideoDirectorWorkspace
              key={catalog.activeProjectId+":"+(directorEntry?.artifactId??"manual")+":"+(directorEntry?.stage??"manual")}
              locale={locale} projectId={catalog.activeProjectId}
              researchArtifactId={directorEntry?.projectId===catalog.activeProjectId?directorEntry.artifactId:undefined}
              focusStage={directorEntry?.projectId===catalog.activeProjectId?directorEntry.stage:undefined}/>
          ) : activeSection === "research" ? (
            <ResearchWorkspace key={catalog.activeProjectId+":"+(researchHandoff?.title??"")} locale={locale}
              handoff={researchHandoff} onUseVideo={saveVideoIdea} onCreateStoryboard={startEditorialStoryboard}
              projectTopic={catalog.content.filter(item=>item.projectId===catalog.activeProjectId && item.kind==="video").at(-1)?.name ??
                (catalog.projects.find(p=>p.id===catalog.activeProjectId)?.name === "My project" ? "" :
                  catalog.projects.find(p=>p.id===catalog.activeProjectId)?.name ?? "")}/>
          ) : activeSection === "jobs-qa" ? (
            <JobsWorkspace locale={locale} />
          ) : (
            <CatalogWorkspace
              key={activeSection + ":" + catalog.activeProjectId}
              section={activeSection}
              locale={locale}
              catalog={catalog}
              save={saveCatalog}
              onDeleteProject={queueProjectDeletion}
              onCreate={() => setActiveSection("create")}
              onResearchIdea={(idea,sources)=>{
                setResearchHandoff({title:idea.title,hook:idea.hook,premise:idea.premise,
                  sourceLeads:sources.map(source=>({title:source.title,url:source.url,evidenceState:source.evidenceState}))});
                setActiveSection("research");
              }}
              discoverySync={discoverySync}
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

