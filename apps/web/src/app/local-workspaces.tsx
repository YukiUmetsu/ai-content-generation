/** Transparent local-only planning workspaces for menu sections not yet backed by APIs.
 * A local catalog must not be presented as production content, uploaded assets or monetization analytics.
 */
import { useEffect, useMemo, useState } from "react";
import type { SectionId } from "./navigation";
import type { Locale } from "@/features/registry";
import { usePreferences } from "./use-preferences";

type Entry = { id: string; title: string; notes: string; status: "idea" | "draft" | "ready"; createdAt: string };
type Domain = "projects" | "content" | "assets" | "products";
type Collection = Record<Domain, Entry[]>;
const KEY = "contentgen:local-workspace:v1";
const empty = (): Collection => ({ projects: [], content: [], assets: [], products: [] });
const labels: Record<Domain, { en: string; ja: string; singular: string; help: string }> = {
  projects: { en: "Projects", ja: "プロジェクト", singular: "Project", help: "Plan a production and record its scope. This does not create a backend project." },
  content: { en: "Content", ja: "コンテンツ", singular: "Content item", help: "Track scripts, ideas and publishing status. Nothing is uploaded or published." },
  assets: { en: "Assets", ja: "アセット", singular: "Asset reference", help: "Catalog descriptions, source locations and rights notes. This does not upload or store media." },
  products: { en: "Products", ja: "プロダクト", singular: "Product", help: "Plan courses, digital goods or channels. No store or payment provider is connected." },
};
function isEntry(x: unknown): x is Entry {
  if (!x || typeof x !== "object") return false;
  const v = x as Partial<Entry>;
  return typeof v.id === "string" && v.id.length <= 80 &&
    typeof v.title === "string" && v.title.length <= 140 &&
    typeof v.notes === "string" && v.notes.length <= 2000 &&
    ["idea","draft","ready"].includes(v.status ?? "") &&
    typeof v.createdAt === "string" && v.createdAt.length <= 40;
}
function readCollection(): Collection {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return empty();
    const record = parsed as Record<string, unknown>;
    const copy = empty();
    for (const domain of Object.keys(copy) as Domain[]) {
      if (Array.isArray(record[domain])) copy[domain] = record[domain].filter(isEntry).slice(0, 200);
    }
    return copy;
  } catch { return empty(); }
}
function useCollection() {
  const [data, setData] = useState<Collection>(readCollection);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* Storage unavailable or full. */ }
  }, [data]);
  return [data, setData] as const;
}
const field = "w-full rounded-md border border-border bg-canvas p-2 text-sm";
const panel = "rounded-xl border border-border bg-surface p-4";
export function LocalStudioWorkspace({ section, locale }: { section: SectionId; locale: Locale }) {
  const [data, update] = useCollection();
  const { appearance, setAppearance, density, setDensity, setLocale } = usePreferences();
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const isDomain = section === "projects" || section === "content" || section === "assets" || section === "products";
  const entries = isDomain ? data[section] : [];
  const allEntries = useMemo(() => Object.values(data).flat(), [data]);
  const visible = entries.filter(x => (x.title+" "+x.notes).toLowerCase().includes(filter.toLowerCase()));
  const exportData = () => {
    const bytes = new Blob([JSON.stringify({ kind:"contentgen-local-catalog", schemaVersion:1, entries:data },null,2)], {type:"application/json"});
    const url=URL.createObjectURL(bytes), a=document.createElement("a");
    a.href=url; a.download="contentgen-local-catalog.json"; document.body.append(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const titleText = isDomain ? labels[section][locale] : section === "insights" ? (locale==="ja"?"分析":"Insights") : (locale==="ja"?"設定":"Settings");
  return <main id="workspace" aria-label={titleText} className="min-h-0 flex-1 overflow-auto p-5">
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-semibold">{titleText}</h1><p className="mt-1 text-sm text-muted-foreground">
          {isDomain ? labels[section].help : section === "insights" ?
            "Overview of this browser's local planning catalog only. Real viewership, revenue and published video analytics are not connected." :
            "Studio preferences apply immediately and stay in this browser."}
        </p></div>
        {section !== "settings" && <button className="rounded-md border border-border px-3 py-2 text-sm hover:bg-track" onClick={exportData}>Export local catalog</button>}
      </header>
      {isDomain && <>
        <form className={panel+" grid gap-3"} onSubmit={event=>{
          event.preventDefault(); setError("");
          const name=title.trim(), detail=notes.trim();
          if (!name || name.length > 140 || detail.length>2000) {setError("Title required (up to 140 characters); notes up to 2,000.");return;}
          if (data[section].length>=200) {setError("200 local entries per section maximum. Export your catalog before adding more.");return;}
          const item: Entry = { id: crypto.randomUUID(), title:name, notes:detail, status:"idea", createdAt:new Date().toISOString() };
          update(previous=>({...previous,[section]:[item,...previous[section]]}));setTitle("");setNotes("");
        }}>
          <h2 className="font-semibold">New {labels[section].singular.toLowerCase()}</h2>
          <label className="grid gap-1 text-sm">Title<input className={field} maxLength={140} value={title} onChange={e=>setTitle(e.target.value)} placeholder="A clear working title" required /></label>
          <label className="grid gap-1 text-sm">Notes<textarea className={field} rows={3} maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Summary, references, next steps, licensing notes..." /></label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <button className="w-fit rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground" type="submit">Add to local catalog</button>
        </form>
        <label className="grid gap-1 text-sm">Find entries<input className={field} value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Filter title or notes" /></label>
        <div className="grid gap-3">{visible.length===0 ? <p className={panel+" text-sm text-muted-foreground"}>No matching entries in this browser.</p>:visible.map(entry=><article key={entry.id} className={panel+" grid gap-2"}>
          <div className="flex items-start justify-between gap-3"><h3 className="font-medium break-words">{entry.title}</h3><button className="text-sm text-muted-foreground underline" onClick={()=>{
            if(window.confirm("Delete this local entry?"))update(prev=>({...prev,[section]:prev[section].filter(x=>x.id!==entry.id)}));
          }}>Delete</button></div>
          {entry.notes&&<p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{entry.notes}</p>}
          <label className="flex items-center gap-2 text-sm">Status<select aria-label={entry.title+" status"} className="rounded-md border border-border bg-canvas px-2 py-1" value={entry.status} onChange={e=>{
            const status=e.target.value as Entry["status"];
            update(prev=>({...prev,[section]:prev[section].map(x=>x.id===entry.id?{...x,status}:x)}));
          }}><option value="idea">Idea</option><option value="draft">Draft</option><option value="ready">Ready for review</option></select></label>
        </article>)}</div>
      </>}
      {section==="insights" && <><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{(Object.keys(data) as Domain[]).map(domain=><article key={domain} className={panel}><p className="text-xs text-muted-foreground">{labels[domain][locale]}</p><strong className="text-3xl tabular-nums">{data[domain].length}</strong></article>)}</div>
        <article className={panel}><h2 className="font-semibold">Local planning status</h2>
          <p className="mt-2 text-sm">{allEntries.filter(x=>x.status==="ready").length} ready for review · {allEntries.filter(x=>x.status==="draft").length} drafts · {allEntries.filter(x=>x.status==="idea").length} ideas</p>
          <p className="mt-2 text-xs text-muted-foreground">Not YouTube analytics. No RPM, views, watch time or revenue data is inferred.</p></article></>}
      {section==="settings" && <article className={panel+" grid gap-4"}>
        <h2 className="font-semibold">Appearance and language</h2>
        <label className="grid gap-1 text-sm">Appearance<select className={field} value={appearance} onChange={e=>setAppearance(e.target.value as "light"|"dark")}><option value="light">Light</option><option value="dark">Dark</option></select></label>
        <label className="grid gap-1 text-sm">Density<select className={field} value={density} onChange={e=>setDensity(e.target.value as "compact"|"spacious")}><option value="compact">Compact</option><option value="spacious">Spacious</option></select></label>
        <label className="grid gap-1 text-sm">Language<select className={field} value={locale} onChange={e=>setLocale(e.target.value as Locale)}><option value="en">English</option><option value="ja">日本語</option></select></label>
        <p className="text-sm text-muted-foreground">Only interface preferences are changed here. Fish Audio credentials must still be supplied to the local Video Test Studio when rendering.</p>
      </article>}
    </div>
  </main>;
}
