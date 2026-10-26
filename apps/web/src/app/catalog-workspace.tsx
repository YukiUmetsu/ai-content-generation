import { useState } from "react";
import type { FormEvent } from "react";
import { Archive, Check, Download, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import { Tabs } from "@/components/ui/tabs";
import type { Locale } from "@/features/registry";
import type { SectionId } from "./navigation";
import { sectionLabel } from "./navigation";
import {
  catalogCounts, makeCatalogId, newCatalog, parseCatalog, saveProjectAppearance, withoutProject,
  type LocalAsset, type LocalContent, type LocalProduct,
  type StudioCatalog, type ContentKind, type ContentStage, type AssetKind,
  type Rights, type ProductKind, type ProductStage,
} from "./catalog-model";
import { usePreferences } from "./use-preferences";
import { ResearchModelSettings } from "./research-model-settings";
import { PromptStudio } from "./prompt-studio";
import { ProviderConnections } from "./provider-connections";
import { ProjectDiscoveryPanel } from "./project-discovery-panel";
import { ProjectBrandAppearancePanel } from "./project-brand-appearance-panel";
import { CharacterPackInspector } from "@/features/character-studio/CharacterPackInspector";
import type {DiscoveryCandidate,GraphSource} from "@/lib/api/discovery";

interface Props {
  section: SectionId;
  locale: Locale;
  catalog: StudioCatalog;
  save: (next: StudioCatalog) => boolean;
  onCreate: () => void;
  onResearchIdea?: (idea:DiscoveryCandidate,sources:GraphSource[])=>void;
  onDeleteProject?: (projectId:string)=>boolean|Promise<boolean>;
  discoverySync?: "syncing" | "synced" | "offline";
}
const inputClass = "min-w-0 w-full rounded-control border border-input bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labelClass = "flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground";
const rowClass = "flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-b-0";
const CONTENT_KINDS: ContentKind[] = ["video", "short", "article", "thumbnail", "other"];
const CONTENT_STAGES: ContentStage[] = ["idea", "draft", "review", "ready", "published"];
const ASSET_KINDS: AssetKind[] = ["image", "audio", "video", "document", "other"];
const RIGHTS: Rights[] = ["unknown", "cleared", "restricted", "denied"];
const PRODUCT_KINDS: ProductKind[] = ["course", "download", "membership", "service", "other"];
const PRODUCT_STAGES: ProductStage[] = ["idea", "planned", "active", "retired"];
const localMessage = (locale: Locale, en: string, ja: string) => locale === "ja" ? ja : en;

function SectionIntro({section,locale,description}: {section:SectionId;locale:Locale;description:string}) {
  return <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 className="font-serif text-xl font-semibold text-foreground">{sectionLabel(section,locale)}</h1>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
    <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
      {localMessage(locale,"Local metadata only","ローカルの管理情報のみ")}
    </span>
  </div>;
}
function TextField({name,value,onChange,limit=120,placeholder=""}: {
  name:string;value:string;onChange:(s:string)=>void;limit?:number;placeholder?:string;
}) {
  return <label className={labelClass}>{name}
    <input className={inputClass} value={value} onChange={e=>onChange(e.target.value)}
      maxLength={limit} placeholder={placeholder} />
  </label>;
}
function Dropdown<T extends string>({name,selected,choices,onSelect}: {
  name:string;selected:T;choices:readonly T[];onSelect:(s:T)=>void;
}) {
  return <label className={labelClass}>{name}
    <select className={inputClass} value={selected} onChange={e=>onSelect(e.target.value as T)}>
      {choices.map(x=><option key={x} value={x}>{x.replaceAll("-"," ")}</option>)}
    </select>
  </label>;
}
function ProjectWorkspace({locale,catalog,save,onCreate,onResearchIdea,onDeleteProject,discoverySync}: Omit<Props,"section">) {
  const [projectTab,setProjectTab] = useState(0);
  const [name,setName] = useState("");
  const [notes,setNotes] = useState("");
  const [editName,setEditName] = useState(catalog.projects.find(p=>p.id===catalog.activeProjectId)?.name ?? "");
  const [editNotes,setEditNotes] = useState(catalog.projects.find(p=>p.id===catalog.activeProjectId)?.notes ?? "");
  const current = catalog.projects.find(p=>p.id===catalog.activeProjectId)!;
  const counts = catalogCounts(catalog,catalog.activeProjectId);
  const create = (event:FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    const id = makeCatalogId("project");
    const next = {...catalog,activeProjectId:id,projects:[...catalog.projects,{id,name:name.trim(),notes:notes.trim(),createdAt:new Date().toISOString()}]};
    if (save(next)) {setName("");setNotes("");setEditName(next.projects.at(-1)!.name);setEditNotes(next.projects.at(-1)!.notes);setProjectTab(1);}
  };
  function select(id:string) {
    const project = catalog.projects.find(p=>p.id===id);
    if (!project) return;
    if(save({...catalog,activeProjectId:id})){setEditName(project.name);setEditNotes(project.notes);}
  }
  return <>
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-xl text-lg font-bold"
          style={{background:current.brandAppearance?.palette.primary??"#152A45",color:current.brandAppearance?.palette.background??"#F6F3EC"}} aria-hidden="true">
          {current.name.trim().split(/\s+/).slice(0,2).map(word=>word.charAt(0)).join("").toUpperCase()}
        </div>
        <div className="min-w-0"><h1 className="break-words font-serif text-3xl font-semibold text-foreground">{current.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{localMessage(locale,"Manage your brand identity and project defaults.","ブランドの設定とプロジェクトの既定値を管理します。")}</p>
        </div>
      </div>
      <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">{localMessage(locale,"Local project", "ローカルプロジェクト")}</span>
    </header>
    <Tabs activeIndex={projectTab} onChange={next=>setProjectTab(next??0)} label={localMessage(locale,"Project sections","プロジェクトの項目")}
      className="min-w-0 space-y-5">
    <Tabs.List className="w-fit max-w-full" aria-label={localMessage(locale,"Project sections","プロジェクトの項目")}>
      <Tabs.Tab value={0}>{localMessage(locale,"Overview","概要")}</Tabs.Tab>
      <Tabs.Tab value={1}>{localMessage(locale,"Brand & appearance","ブランドと外観")}</Tabs.Tab>
      <Tabs.Tab value={2}>{localMessage(locale,"Discovery preferences","リサーチ設定")}</Tabs.Tab>
    </Tabs.List>
    <Tabs.Panel value={0} className="min-w-0 space-y-4">
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,.85fr)]">
      <Surface header={<h2 className="font-medium">Projects · {catalog.projects.length}</h2>}>
        {catalog.projects.map(project=>{
          const selected = project.id===catalog.activeProjectId;
          return <div key={project.id} className={rowClass}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{project.name} {selected&&<span className="ml-2 text-xs text-primary">Current</span>}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{project.notes||localMessage(locale,"No description","説明なし")}</p>
            </div>
            <div className="flex gap-1.5">
              <Button variant={selected?"secondary":"outline"} size="sm" disabled={selected} onClick={()=>select(project.id)}>
                {selected?localMessage(locale,"Selected","選択中"):localMessage(locale,"Select","選択")}
              </Button>
              <Button variant="subtle" size="icon" aria-label={"Delete "+project.name} disabled={catalog.projects.length<=1}
                onClick={()=>{if(window.confirm("Delete project "+project.name+" and its content, assets, products, and local research history?")){
                  void (async()=>{
                    if(onDeleteProject&&!(await onDeleteProject(project.id)))return;
                    save(withoutProject(catalog,project.id));
                  })();
                }}}>
                <Trash2 aria-hidden className="size-4"/>
              </Button>
            </div>
          </div>;
        })}
      </Surface>
      <div className="flex flex-col gap-4">
        <Surface header={<h2 className="font-medium">Current project</h2>}>
          <form className="flex flex-col gap-3" onSubmit={event=>{
            event.preventDefault();
            save({...catalog,projects:catalog.projects.map(p=>p.id===current.id?{...p,name:editName.trim(),notes:editNotes.trim()}:p)});
          }}>
            <TextField name="Project name" value={editName} onChange={setEditName}/>
            <label className={labelClass}>Description<textarea className={inputClass} rows={2} maxLength={2000} value={editNotes} onChange={e=>setEditNotes(e.target.value)}/></label>
            <div className="text-xs text-muted-foreground">{counts.content} content · {counts.assets} assets · {counts.products} products</div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm">Save project</Button>
              <Button size="sm" variant="outline" onClick={onCreate}>Go to Create</Button>
            </div>
          </form>
        </Surface>
        <Surface header={<h2 className="font-medium">New project</h2>}>
          <form className="flex flex-col gap-3" onSubmit={create}>
            <TextField name="Name" value={name} onChange={setName} placeholder="e.g. Tech explainers"/>
            <TextField name="Purpose (optional)" value={notes} onChange={setNotes} limit={2000}/>
            <Button icon={<Plus className="size-4"/>} type="submit" disabled={!name.trim()}>Create project</Button>
          </form>
        </Surface>
      </div>
    </div>
    </Tabs.Panel>
    <Tabs.Panel value={1} className="min-w-0">
      <ProjectBrandAppearancePanel key={`${current.id}:${current.brandAppearance?.revision??0}`} project={current} locale={locale}
        onSave={draft=>save(saveProjectAppearance(catalog,current.id,draft))}/>
    </Tabs.Panel>
    <Tabs.Panel value={2} className="min-w-0">
    <ProjectDiscoveryPanel key={current.id} project={current} content={catalog.content.filter(item=>item.projectId===current.id)}
      locale={locale} syncStatus={discoverySync??"offline"}
      onSaveIdea={(idea,openResearch,sources=[])=>{
        const exists=catalog.content.some(item=>item.projectId===current.id&&item.name.toLowerCase()===idea.title.toLowerCase());
        if(!exists){
          const item:LocalContent={id:makeCatalogId("item"),projectId:current.id,name:idea.title.slice(0,120),
            notes:([idea.hook,idea.premise,idea.whyNow].join(" · ")).slice(0,2000),
            createdAt:new Date().toISOString(),kind:"video",stage:"idea"};
          if(!save({...catalog,content:[...catalog.content,item]}))return false;
        }
        if(openResearch)onResearchIdea?.(idea,sources);
        return true;
      }}/>
    </Tabs.Panel>
    </Tabs>
  </>;
}
function InventoryWorkspace({section,locale,catalog,save}:Props) {
  const key = section==="content"?"content":section==="assets"?"assets":"products";
  const rows = catalog[key].filter(entry=>entry.projectId===catalog.activeProjectId);
  const [name,setName]=useState("");
  const [notes,setNotes]=useState("");
  const [source,setSource]=useState("");
  const [kind,setKind]=useState("video");
  const [stage,setStage]=useState("idea");
  const [rights,setRights]=useState<Rights>("unknown");
  const project = catalog.projects.find(p=>p.id===catalog.activeProjectId)!;
  const types = key==="content"?CONTENT_KINDS:key==="assets"?ASSET_KINDS:PRODUCT_KINDS;
  const steps = key==="content"?CONTENT_STAGES:PRODUCT_STAGES;
  const description = key==="content" ? "Track planned videos, shorts, articles and thumbnails with editorial status. This list does not claim a render or publication." :
    key==="assets" ? "Track references to local media and their usage rights. This does not upload, copy or license the media itself." :
    "Plan courses, downloads, memberships and services. Entries are not storefront products or Stripe listings.";
  function create(event:FormEvent) {
    event.preventDefault();
    if(!name.trim())return;
    const base = {id:makeCatalogId("item"),projectId:catalog.activeProjectId,name:name.trim(),notes:notes.trim(),createdAt:new Date().toISOString()};
    if(key==="content"){
      const content:LocalContent={...base,kind:CONTENT_KINDS.includes(kind as ContentKind)?kind as ContentKind:"other",stage:CONTENT_STAGES.includes(stage as ContentStage)?stage as ContentStage:"idea"};
      if(save({...catalog,content:[...catalog.content,content]})){setName("");setNotes("");}
    }else if(key==="assets"){
      const asset:LocalAsset={...base,kind:ASSET_KINDS.includes(kind as AssetKind)?kind as AssetKind:"other",rights,source:source.trim()};
      if(save({...catalog,assets:[...catalog.assets,asset]})){setName("");setNotes("");setSource("");}
    }else{
      const product:LocalProduct={...base,kind:PRODUCT_KINDS.includes(kind as ProductKind)?kind as ProductKind:"other",stage:PRODUCT_STAGES.includes(stage as ProductStage)?stage as ProductStage:"idea"};
      if(save({...catalog,products:[...catalog.products,product]})){setName("");setNotes("");}
    }
  }
  function modify(id:string,field:"stage"|"rights",value:string) {
    if(key==="content"&&field==="stage"){
      save({...catalog,content:catalog.content.map(x=>x.id===id?{...x,stage:value as ContentStage}:x)});
    }else if(key==="assets"&&field==="rights"){
      save({...catalog,assets:catalog.assets.map(x=>x.id===id?{...x,rights:value as Rights}:x)});
    }else if(key==="products"&&field==="stage"){
      save({...catalog,products:catalog.products.map(x=>x.id===id?{...x,stage:value as ProductStage}:x)});
    }
  }
  function remove(id:string) {
    if (!window.confirm("Remove this local entry?")) return;
    if(key==="content")save({...catalog,content:catalog.content.filter(x=>x.id!==id)});
    else if(key==="assets")save({...catalog,assets:catalog.assets.filter(x=>x.id!==id)});
    else save({...catalog,products:catalog.products.filter(x=>x.id!==id)});
  }
  return <>
    <SectionIntro section={section} locale={locale} description={description}/>
    <p className="mb-3 text-xs text-muted-foreground">Project: <strong>{project.name}</strong> · {rows.length} entries</p>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(270px,.7fr)]">
      <Surface header={<h2 className="font-medium">Inventory</h2>}>
        {rows.length===0?<p className="text-sm text-muted-foreground">No entries yet. Use the editor to add one.</p>:rows.map(item=>
          <div key={item.id} className={rowClass}>
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm font-medium">{item.name}</p>
              <p className="text-xs capitalize text-muted-foreground">{item.kind} · {item.notes||"No notes"}</p>
              {key==="assets" && <p className="max-w-md break-words text-xs text-muted-foreground">Source: {(item as LocalAsset).source||"Not recorded"}</p>}
            </div>
            <div className="flex items-center gap-2">
              {key==="assets" ? <select aria-label={"Rights for "+item.name} className={inputClass+" !w-auto"} value={(item as LocalAsset).rights} onChange={e=>modify(item.id,"rights",e.target.value)}>
                {RIGHTS.map(x=><option key={x} value={x}>{x}</option>)}
              </select> : <select aria-label={"Stage for "+item.name} className={inputClass+" !w-auto"} value={(item as LocalContent|LocalProduct).stage} onChange={e=>modify(item.id,"stage",e.target.value)}>
                {steps.map(x=><option key={x} value={x}>{x}</option>)}
              </select>}
              <Button variant="subtle" size="icon" aria-label={"Remove "+item.name} onClick={()=>remove(item.id)}><Trash2 aria-hidden className="size-4"/></Button>
            </div>
          </div>
        )}
      </Surface>
      <Surface header={<h2 className="font-medium">Add {key==="content"?"content":key==="assets"?"asset reference":"product idea"}</h2>}>
        <form onSubmit={create} className="flex flex-col gap-3">
          <TextField name="Title / label" value={name} onChange={setName} placeholder={key==="content"?"Video working title":key==="assets"?"Asset filename or name":"Product name"}/>
          <Dropdown name="Kind" selected={types.includes(kind as never)?kind:"other"} choices={types} onSelect={setKind}/>
          {key!=="assets" && <Dropdown name="Initial stage" selected={steps.includes(stage as never)?stage:"idea"} choices={steps} onSelect={setStage}/>}
          {key==="assets"&& <>
            <Dropdown name="Rights" selected={rights} choices={RIGHTS} onSelect={setRights}/>
            <TextField name="Source or local path (metadata only)" value={source} onChange={setSource} limit={500}/>
          </>}
          <label className={labelClass}>Notes<textarea className={inputClass} rows={3} value={notes} onChange={e=>setNotes(e.target.value)} maxLength={2000}/></label>
          <Button type="submit" disabled={!name.trim()} icon={<Plus className="size-4"/>}>Add entry</Button>
        </form>
      </Surface>
    </div>
    {key === "assets" && <CharacterPackInspector locale={locale} />}
  </>;
}
function InsightsWorkspace({catalog,locale}:Pick<Props,"catalog"|"locale">) {
  const project = catalog.projects.find(x=>x.id===catalog.activeProjectId)!;
  const counts=catalogCounts(catalog,project.id);
  const values=[["Content plans",counts.content],["Ready for review",counts.ready],["Marked published",counts.published],
    ["Asset references",counts.assets],["Rights to review",counts.rightsNeedsReview],["Product ideas",counts.products]];
  return <>
    <SectionIntro section="insights" locale={locale} description="These are exact counts of manually entered local catalog records. No YouTube analytics, views, revenue, engagement, estimates or performance predictions are connected."/>
    <p className="mb-4 text-sm text-muted-foreground">Project: <strong>{project.name}</strong></p>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {values.map(([label,count])=><Surface key={label} variant="outline">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-2 font-serif text-3xl font-semibold tabular-nums">{count}</p>
      </Surface>)}
    </div>
    <p className="mt-5 text-sm text-muted-foreground">Publication and rights statuses are author-entered metadata, not platform-verified events. Connect analytics APIs before showing views, watch time or advertising revenue.</p>
  </>;
}
function SettingsWorkspace({catalog,save,locale}:Pick<Props,"catalog"|"save"|"locale">){
  const {appearance,setAppearance,density,setDensity,setLocale}=usePreferences();
  const [status,setStatus]=useState("");
  function download() {
    const url=URL.createObjectURL(new Blob([JSON.stringify(catalog,null,2)],{type:"application/json"}));
    const a=document.createElement("a");a.href=url;a.download="contentgen-studio-catalog.json";
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    setStatus("Backup downloaded. Only local catalog metadata is included.");
  }
  async function importFile(file:File|null|undefined){
    if(!file)return;
    try {
      if(file.size>512*1024)throw new Error("Backup exceeds 512 KB.");
      const next=parseCatalog(await file.text());
      if(!window.confirm("Replace the current local Studio catalog with this backup?"))return;
      if(save(next))setStatus("Validated catalog imported.");
    }catch(error){setStatus(error instanceof Error?error.message:"Import failed.");}
  }
  return <>
    <SectionIntro section="settings" locale={locale} description={localMessage(locale,
      "Configure local models, provider connections and your Studio workspace. API keys are not included in browser storage or catalog backups.",
      "ローカルモデル、API 接続、Studio の設定を管理します。API キーはブラウザーやバックアップに保存されません。")}/>
    <Tabs defaultActiveIndex={0} label={localMessage(locale,"Settings sections","設定項目")}
      className="flex min-w-0 flex-col gap-4">
      <Tabs.List className="w-fit max-w-full" aria-label={localMessage(locale,"Settings sections","設定項目")}>
        <Tabs.Tab value={0} className="h-10">{localMessage(locale,"AI models","AI モデル")}</Tabs.Tab>
        <Tabs.Tab value={1} className="h-10">{localMessage(locale,"Connections","API 接続")}</Tabs.Tab>
        <Tabs.Tab value={2} className="h-10">{localMessage(locale,"Appearance","表示")}</Tabs.Tab>
        <Tabs.Tab value={3} className="h-10">{localMessage(locale,"Prompts","プロンプト")}</Tabs.Tab>
        <Tabs.Tab value={4} className="h-10">{localMessage(locale,"Data & privacy","データとプライバシー")}</Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel value={0} keepMounted className="mt-0 min-w-0 space-y-3">
        <p className="text-sm text-muted-foreground">{localMessage(locale,
          "Choose your local AI providers, model profiles, and task-by-task assignments.",
          "ローカル AI プロバイダー、モデルプロファイル、タスク別の割り当てを管理します。")}</p>
        <ResearchModelSettings locale={locale}/>
      </Tabs.Panel>

      <Tabs.Panel value={1} className="mt-0 min-w-0 space-y-3">
        <p className="text-sm text-muted-foreground">{localMessage(locale,
          "Connect external providers. Secrets stay in your operating system's credential store where supported.",
          "外部サービスと接続します。対応環境ではシークレットを OS の資格情報ストアに保存します。")}</p>
        <ProviderConnections locale={locale}/>
      </Tabs.Panel>

      <Tabs.Panel value={2} className="mt-0 min-w-0 space-y-3">
        <p className="text-sm text-muted-foreground">{localMessage(locale,
          "Customize how ContentGen looks and reads on this device.",
          "この端末での ContentGen の表示と言語を設定します。")}</p>
        <Surface header={<h2 className="font-medium">{localMessage(locale,"Appearance & language","表示と言語")}</h2>}>
        <div className="flex flex-col gap-3">
          <Dropdown name={localMessage(locale,"Theme","テーマ")} selected={appearance} choices={["light","dark"] as const} onSelect={setAppearance}/>
          <Dropdown name={localMessage(locale,"Density","表示密度")} selected={density} choices={["compact","spacious"] as const} onSelect={setDensity}/>
          <Dropdown name={localMessage(locale,"Language","言語")} selected={locale} choices={["en","ja"] as const} onSelect={setLocale}/>
        </div>
        </Surface>
      </Tabs.Panel>

      <Tabs.Panel value={3} className="mt-0 min-w-0 space-y-3">
        <p className="text-sm text-muted-foreground">{localMessage(locale,
          "Advanced: edit generation-stage instructions when the defaults do not fit your workflow.",
          "詳細設定: 既定の設定が合わない場合、生成ステージごとの指示を編集します。")}</p>
        <Surface><PromptStudio locale={locale}/></Surface>
      </Tabs.Panel>

      <Tabs.Panel value={4} className="mt-0 min-w-0 space-y-3">
        <p className="text-sm text-muted-foreground">{localMessage(locale,
          "Export your local project catalog before changing devices or resetting it.",
          "端末の変更やリセットの前にローカルカタログをエクスポートできます。")}</p>
        <Surface header={<h2 className="font-medium">{localMessage(locale,"Local catalog backup","ローカルカタログのバックアップ")}</h2>}>
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">Export or import the project catalog for this browser. Backups include names, editorial stages and asset license notes, not actual media files or voice credentials.</p>
          <Button icon={<Download className="size-4"/>} onClick={download}>Download catalog JSON</Button>
          <label className={labelClass}>Import a backup
            <input type="file" accept=".json,application/json" aria-label="Import catalog JSON" className={inputClass}
              onChange={event=>{void importFile(event.target.files?.[0]);event.target.value="";}} />
          </label>
          <Button variant="destructive" icon={<Trash2 className="size-4"/>}
            onClick={()=>{if(window.confirm("Reset all locally stored Studio catalog entries? This cannot be undone without a backup."))if(save(newCatalog()))setStatus("Local catalog reset.");}}>
            Reset local catalog
          </Button>
          {status&&<p role="status" className="text-xs text-muted-foreground">{status}</p>}
        </div>
        </Surface>
      </Tabs.Panel>
    </Tabs>
  </>;
}
export function CatalogWorkspace(props:Props) {
  const {section,locale,catalog,save,onCreate}=props;
  return <main id="workspace" className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6" aria-label={sectionLabel(section,locale)}>
    <div className="mx-auto w-full max-w-6xl">
      {section==="projects"?<ProjectWorkspace locale={locale} catalog={catalog} save={save} onCreate={onCreate}
        onResearchIdea={props.onResearchIdea} onDeleteProject={props.onDeleteProject} discoverySync={props.discoverySync}/>:
       section==="content"||section==="assets"||section==="products"?<InventoryWorkspace {...props}/>:
       section==="insights"?<InsightsWorkspace catalog={catalog} locale={locale}/>:
       section==="settings"?<SettingsWorkspace catalog={catalog} save={save} locale={locale}/>:
       <p>Unknown section</p>}
      <div className="mt-8 flex items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
        <Archive aria-hidden className="size-4"/>
        <span>Edits stay in this browser; discovery insights sync with the local server when available. No cloud catalog sync.</span>
        <Check aria-hidden className="size-4"/>
      </div>
    </div>
  </main>;
}
