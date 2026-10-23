import { useState } from "react";
import { BookOpen, ExternalLink, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";

type Dossier={kind:string;id:string;topic:{title:string;audience:string};
  evidence:Array<{id:string;title:string;sourceUri:string;passageLocator:string}>;
  claims:Array<{id:string;text:string;status:string;sourceRefs:string[]}>;
  gaps:string[]};
type Bundle={kind:string;researchId:string;plan:{shots:Array<{id:string}>}};
const field="mt-1.5 w-full min-w-0 rounded-control border border-input bg-surface px-3 py-2 text-sm text-foreground";
async function api(route:string,payload:unknown){
  const response=await fetch("/api/contentgen-video/"+route,{method:"POST",
    headers:{"Content-Type":"application/json","X-Contentgen-Director":"local-only"},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(220000)});
  const data=await response.json() as Record<string,unknown>;
  if(!response.ok)throw Error(String(data.error||"Local research service unavailable."));
  return data;
}
export function NewVideoSetup({onGenerated}:{onGenerated:(dossier:unknown,bundle:unknown)=>void}){
  const [brief,setBrief]=useState({title:"",viewerQuestion:"",audience:"Homeowners",locale:"en-US"});
  const [consent,setConsent]=useState(false);
  const [research,setResearch]=useState<Dossier|null>(null);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const edit=(changes:Partial<typeof brief>)=>{setBrief(x=>({...x,...changes}));setResearch(null);};
  async function demo(){
    setBusy("demo");setError("");
    try{
      const response=await fetch("/api/contentgen-video/demo",{cache:"no-store",signal:AbortSignal.timeout(10000)});
      const data=await response.json() as Record<string,unknown>;
      if(!response.ok)throw Error(String(data.error||"Demo unavailable."));
      onGenerated(data.dossier,data.bundle);
    }catch(e){setError(e instanceof Error?e.message:"Demo failed to load.");}
    finally{setBusy("");}
  }
  async function capture(){
    setBusy("research");setError("");
    try{
      const result=await api("research",{brief:{...brief,viewerQuestion:brief.viewerQuestion||brief.title},
        allowNetwork:consent});
      setResearch(result.dossier as Dossier);
    }catch(e){setError(e instanceof Error?e.message:"Research could not finish.");}
    finally{setBusy("");}
  }
  async function storyboard(){
    if(!research)return;
    setBusy("story");setError("");
    try{
      const result=await api("story",{dossier:research});
      onGenerated(research,result.bundle as Bundle);
    }catch(e){setError(e instanceof Error?e.message:"The local model could not draft the story.");}
    finally{setBusy("");}
  }
  return <Surface header={<h2 className="flex items-center gap-2 font-medium"><Sparkles className="size-4"/>Start a video from a topic</h2>}>
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">Write the question viewers care about. ContentGen uses your configured local research model and SearXNG to gather sources, then drafts a visual explanation you can edit before rendering.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-xs font-medium">Video topic<input className={field} aria-label="New video topic"
          value={brief.title} maxLength={220} onChange={e=>edit({title:e.target.value})}
          placeholder="Why replacing an HVAC system costs so much"/></label>
        <label className="text-xs font-medium">Target audience<input className={field} aria-label="Target audience"
          value={brief.audience} maxLength={160} onChange={e=>edit({audience:e.target.value})}
          placeholder="Homeowners comparing replacement quotes"/></label>
        <label className="text-xs font-medium md:col-span-2">Main question<input className={field}
          aria-label="Main video question" maxLength={240} value={brief.viewerQuestion}
          onChange={e=>edit({viewerQuestion:e.target.value})}
          placeholder="Why does the total price seem so high?"/></label>
        <label className="text-xs font-medium">Narration language<select className={field} aria-label="Video language"
          value={brief.locale} onChange={e=>edit({locale:e.target.value})}>
          <option value="en-US">English</option><option value="ja-JP">日本語</option></select></label>
      </div>
      <label className="flex items-start gap-2 text-xs leading-relaxed">
        <input className="mt-1" type="checkbox" checked={consent} aria-label="Allow public web research"
          onChange={e=>setConsent(e.target.checked)}/>
        Allow ContentGen to query my local SearXNG instance and fetch public web pages for this topic. The installed LLM analyzes these captured passages locally. Retrieved content is untrusted.
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={!!busy} onClick={()=>void demo()}>
          Try sample project (no research/model setup)
        </Button>
        <p className="text-xs text-muted-foreground">Synthetic figures and claims; for interface testing only.</p>
      </div>
      <Button disabled={!consent||!brief.title.trim()||!brief.audience.trim()||!!busy}
        onClick={()=>void capture()} icon={<BookOpen className="size-4"/>}>
        {busy==="research"?"Researching public sources…":"Research this topic"}
      </Button>
      {research&&<div className="space-y-3 rounded-control border border-border bg-surface-subtle p-3">
        <div><p className="font-semibold">Research draft · {research.evidence.length} sources · {research.claims.length} claims</p>
          <p className="mt-1 text-xs text-muted-foreground">No claims are independently verified. Review these links, especially if a factual mistake would affect viewers.</p>
        </div>
        <div className="space-y-2">
          {research.evidence.map(source=><div key={source.id} className="rounded-control border border-border p-2">
            <a className="flex items-center gap-1 text-xs font-semibold underline" href={source.sourceUri}
              rel="noopener noreferrer" target="_blank">{source.title}<ExternalLink className="size-3"/></a>
            <p className="mt-1 text-xs text-muted-foreground">{source.passageLocator}</p>
          </div>)}
        </div>
        <div className="space-y-1">
          {research.claims.map(c=><p key={c.id} className="text-xs leading-relaxed">
            <strong>{c.status.toUpperCase()}:</strong> {c.text}</p>)}
        </div>
        {research.gaps.length>0&&<p className="text-xs text-muted-foreground">
          Research gaps: {research.gaps.join("; ")}</p>}
        <Button disabled={!!busy} onClick={()=>void storyboard()} icon={<Sparkles className="size-4"/>}>
          {busy==="story"?"Designing explanation…":"Generate editable storyboard"}
        </Button>
      </div>}
      {error&&<p className="rounded-control border border-border p-2 text-xs" role="alert">{error}</p>}
      <p className="text-xs text-muted-foreground">First-time setup: run <code>pnpm research:up</code> in apps/web (Docker Desktop needed) and choose an installed local research model in Settings. Source capture is opt-in; no automatic Docker image or LLM downloads. This is a draft, not a source-fact-checked video.</p>
    </div>
  </Surface>;
}
