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
import { ProductionWorkspace } from "./production-workspace";
import { CharacterPackInspector } from "@/features/character-studio/CharacterPackInspector";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { createEditorialProject } from "./editorial-project";
import type { EditorialDraft } from "./editorial-brief";
import type { ResearchDraftResult } from "./researched-storyboard";
import { deleteDiscoveryProject, syncDiscoveryProject } from "@/lib/api/discovery";
import { enqueueProjectDeletion, flushProjectDeletions, pendingProjectDeletions } from "./project-deletion-queue";
import { listDiscoverySessions, listProductions } from "@/lib/api/discovery-sessions";


function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || target.isContentEditable;
}

export function Shell() {
  const { locale } = usePreferences();
  const [activeSection, setActiveSection] = useState<SectionId>("production");
  const [directorEntry,setDirectorEntry] = useState<{projectId:string;artifactId?:string;stage:"visuals"|"audio"|"draft"|"export"}|null>(null);
  const [directorDirty,setDirectorDirty] = useState(false);
  const [directorNavigationWarning,setDirectorNavigationWarning]=useState("");
  const [storyboardOwnerId,setStoryboardOwnerId] = useState<string|null>(null);
  const selectSection = (next:SectionId) => {
    const retainedEditorRoute=directorEntry!==null&&
      (activeSection==="production"||activeSection==="jobs-qa")&&
      (next==="production"||next==="jobs-qa");
    if(directorDirty&&next!==activeSection&&!retainedEditorRoute){
      setDirectorNavigationWarning("Save or discard the edited scene in Production before leaving. Your changes have not been lost.");
      return;
    }
    setDirectorNavigationWarning("");
    if(next==="create")setStoryboardOwnerId(null);
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
  const queueProjectDeletion = useCallback(async (projectId:string):Promise<boolean>=>{
    try{
      // The browser catalog is not the durable source of discovery history.
      // Never remove a brand locally until the Rust server confirms no saved work.
      const [sessions,productions]=await Promise.all([listDiscoverySessions(projectId),listProductions(projectId)]);
      if(sessions.length||productions.length){
        setCatalogError("This project owns saved discovery sessions or productions. Preserve or explicitly export that work before deleting the brand.");
        return false;
      }
      enqueueProjectDeletion(window.localStorage,projectId);return true;
    }catch(error){
      setCatalogError(error instanceof Error?`Cannot verify saved project work before deletion: ${error.message}`:
        "Cannot verify saved project work while the local server is unavailable. Nothing was deleted.");
      return false;
    }
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
  // Keep the in-progress Director alive while inspecting Jobs. The browser's
  // editor state, selected shot, sound preview and render status stay intact.
  const keepProductionMounted=activeSection==="production"||(activeSection==="jobs-qa"&&directorEntry!==null);

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
        {directorDirty&&directorNavigationWarning&&(activeSection==="production"||activeSection==="jobs-qa")&&<div role="alert" className="border-b border-status-warning/40 bg-surface-subtle px-4 py-2 text-sm text-status-warning">{directorNavigationWarning}</div>}
        {activeSection !== "create" && activeSection !== "production" && (
          <Header activeSection={activeSection} onOpenNav={() => setMobileNavOpen(true)} />
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          {keepProductionMounted&&<div className={activeSection==="production"?
            "flex min-h-0 min-w-0 flex-1 flex-col":"hidden"}
            aria-hidden={activeSection!=="production"} inert={activeSection!=="production"}>
            <ProductionWorkspace
              key={catalog.activeProjectId}
              locale={locale}
              workspaceId={activeSection==="production"?"workspace":null}
              catalog={catalog}
              onSelectProject={(projectId) => {
                if(projectId!==catalog.activeProjectId&&catalog.projects.some(project=>project.id===projectId)){
                  if(directorDirty){
                    setDirectorNavigationWarning("Save or discard the edited scene before switching projects. Your changes are still in Production.");
                    return;
                  }
                  setDirectorEntry(null);setDirectorDirty(false);
                  saveCatalog({...catalog,activeProjectId:projectId});
                }
              }}
              onOpenNav={() => setMobileNavOpen(true)}
              onOpenProjects={() => selectSection("projects")}
              onOpenResearch={() => selectSection("research")}
              onOpenJobs={() => selectSection("jobs-qa")}
              onOpenStoryboard={(productionId) => {
                if(directorDirty){selectSection("create");return;}
                setStoryboardOwnerId(productionId??catalog.activeProjectId);setActiveFeatureId("storyboard-planner");selectSection("create");
              }}
              onOpenVisuals={(artifactId,productionId) => setDirectorEntry({projectId:productionId??catalog.activeProjectId,artifactId,stage:"visuals"})}
              onOpenAudio={(artifactId,productionId) => setDirectorEntry({projectId:productionId??catalog.activeProjectId,artifactId,stage:"audio"})}
              onOpenDraft={(artifactId,productionId) => setDirectorEntry({projectId:productionId??catalog.activeProjectId,artifactId,stage:"draft"})}
              onOpenExport={(artifactId,productionId) => setDirectorEntry({projectId:productionId??catalog.activeProjectId,artifactId,stage:"export"})}
              directorEntry={directorEntry} directorDirty={directorDirty} onDirectorDirtyChange={setDirectorDirty}
              onCreateStoryboard={startEditorialStoryboard}
              onUseVideo={saveVideoIdea}
            />
          </div>}
          {activeSection === "production" ? null : activeSection === "create" ? (
            <Workspace
              key={storyboardOwnerId??catalog.activeProjectId}
              locale={locale}
              projectId={storyboardOwnerId??catalog.activeProjectId}
              activeFeatureId={activeFeatureId}
              onFeatureChange={setActiveFeatureId}
              onOpenNav={() => setMobileNavOpen(true)}
              toolGuideOpen={toolGuideOpen}
              onToolGuideOpenChange={setToolGuideOpen}
            />
          ) : activeSection === "research" ? (
            <ResearchWorkspace key={catalog.activeProjectId+":"+(researchHandoff?.title??"")} locale={locale}
              handoff={researchHandoff} onUseVideo={saveVideoIdea} onCreateStoryboard={startEditorialStoryboard}
              projectTopic={catalog.content.filter(item=>item.projectId===catalog.activeProjectId && item.kind==="video").at(-1)?.name ??
                (catalog.projects.find(p=>p.id===catalog.activeProjectId)?.name === "My project" ? "" :
                  catalog.projects.find(p=>p.id===catalog.activeProjectId)?.name ?? "")}/>
          ) : activeSection === "jobs-qa" ? (
            <JobsWorkspace locale={locale} projects={catalog.projects} />
          ) : activeSection === "characters" ? (
            <main className="min-w-0 flex-1 overflow-y-auto px-5 pb-10 sm:px-8" aria-label="Character Studio workspace">
              <div className="mx-auto max-w-6xl">
                <CharacterPackInspector locale={locale} projectId={catalog.activeProjectId} />
              </div>
            </main>
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

