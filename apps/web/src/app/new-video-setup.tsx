import { useRef, useState } from "react";
import { BookOpen, ExternalLink, Film, Play, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";

type Dossier={kind:string;id:string;topic:{title:string;audience:string};
  evidence:Array<{id:string;title:string;sourceUri:string;passageLocator:string}>;
  claims:Array<{id:string;text:string;status:string;sourceRefs:string[]}>;
  gaps:string[]};
type QuotePreview={claimId:string;sourceId:string;quote:string};
type Bundle={kind:string;researchId:string;status:string;plan:{
  shots:Array<{id:string;onScreenText:string;visualChange:string;claimIds:string[]}>;
  sound?:Array<{shotId:string;narration:string}>}};
const field="mt-1.5 w-full min-w-0 rounded-control border border-input bg-surface px-3 py-2 text-sm text-foreground";
async function api(route:string,payload:unknown){
  const response=await fetch("/api/contentgen-video/"+route,{method:"POST",
    headers:{"Content-Type":"application/json","X-Contentgen-Director":"local-only"},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(220000)});
  const data=await response.json() as Record<string,unknown>;
  if(!response.ok)throw Error(String(data.error||"Local research service unavailable."));
  return data;
}
export function NewVideoSetup({onGenerated}:{onGenerated:(dossier:unknown,bundle:unknown,source:"sample"|"topic")=>void}){
  const [brief,setBrief]=useState({title:"",viewerQuestion:"",audience:"Homeowners",locale:"en-US"});
  const [consent,setConsent]=useState(false);
  const [research,setResearch]=useState<Dossier|null>(null);
  const [quotePreviews,setQuotePreviews]=useState<QuotePreview[]>([]);
  const [bundle,setBundle]=useState<Bundle|null>(null);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const revision=useRef(0);
  const edit=(changes:Partial<typeof brief>)=>{
    revision.current++;
    setBrief(x=>({...x,...changes}));
    // The server serializes research/story calls. Keep the action locked until
    // an obsolete request settles, even though its response will be ignored.
    setResearch(null);setQuotePreviews([]);setBundle(null);setError("");
  };
  async function demo(mode:"sample"|"conversation"="sample"){
    setBusy("demo");setError("");
    try{
      const response=await fetch(mode==="conversation"?"/api/contentgen-video/demo-conversation":"/api/contentgen-video/demo",
        {cache:"no-store",signal:AbortSignal.timeout(10000)});
      const data=await response.json() as Record<string,unknown>;
      if(!response.ok)throw Error(String(data.error||"Demo unavailable."));
      const dossier=data.dossier as Partial<Dossier>|undefined;
      const bundle=data.bundle as Partial<Bundle>|undefined;
      if(dossier?.kind!=="research-dossier"||bundle?.kind!=="preproduction-bundle")
        throw Error("The installed ContentGen sample is incomplete. Restart the Studio server after git pull.");
      onGenerated(data.dossier,data.bundle,"sample");
    }catch(e){setError(e instanceof Error?e.message:"Demo failed to load.");}
    finally{setBusy("");}
  }
  async function draftStoryboard(dossier:Dossier,run:number){
    if(run!==revision.current)return;
    setBusy("story");setError("");
    try{
      const result=await api("story",{dossier});
      if(run!==revision.current)return;
      const generated=result.bundle as Bundle|undefined;
      if(generated?.kind!=="preproduction-bundle"||generated.researchId!==dossier.id||
        generated.status!=="draft-needs-review"||!Array.isArray(generated.plan?.shots)||
        !generated.plan.shots.length)
        throw Error("The storyboard response does not match the captured research. Please retry.");
      setBundle(generated);
    }catch(e){
      if(run===revision.current)setError(e instanceof Error?e.message:"The local model could not draft the story.");
    }finally{setBusy("");}
  }
  async function researchAndGenerate(){
    const run=++revision.current;
    setBusy("research");setError("");setResearch(null);setBundle(null);setQuotePreviews([]);
    try{
      const result=await api("research",{brief:{...brief,viewerQuestion:brief.viewerQuestion||brief.title},
        allowNetwork:consent});
      if(run!==revision.current)return;
      const dossier=result.dossier as Dossier|undefined;
      if(dossier?.kind!=="research-dossier"||!Array.isArray(dossier.evidence)||
        !Array.isArray(dossier.claims)||!Array.isArray(dossier.gaps))
        throw Error("Research returned an incomplete dossier.");
      setResearch(dossier);
      setQuotePreviews(Array.isArray(result.quotePreviews)
        ?result.quotePreviews.filter((q):q is QuotePreview=>
          typeof q?.claimId==="string"&&typeof q?.sourceId==="string"&&typeof q?.quote==="string")
        :[]);
      await draftStoryboard(dossier,run);
    }catch(e){
      if(run===revision.current)setError(e instanceof Error?e.message:"Research could not finish.");
    }finally{setBusy("");}
  }
  return <Surface header={<h2 className="flex items-center gap-2 font-medium"><Sparkles className="size-4"/>Start a video from a topic</h2>}>
    <div className="space-y-4 text-sm">
      <div className="rounded-surface border border-primary/30 bg-surface-subtle p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-control bg-primary/10 p-2"><Film className="size-5 text-primary"/></div>
          <div className="min-w-0 flex-1 space-y-2">
            <h3 className="text-base font-semibold">First time here? Open the interactive demo.</h3>
            <p className="text-sm text-muted-foreground">A complete example is included with ContentGen. One click loads three sample scenes and opens the real animation preview and timeline editor. No files to upload, models to download, or audio setup.</p>
            <Button disabled={!!busy} onClick={()=>void demo()} icon={<Play className="size-4"/>}>
              {busy==="demo"?"Opening the sample studio…":"Open interactive sample"}
            </Button>
            <div className="mt-3 rounded-control border border-primary/25 bg-surface p-3">
              <p className="text-sm font-semibold">Conversation + narration</p>
              <p className="mt-1 text-xs text-muted-foreground">One-click starter: Pip asks, Quill responds and the narrator explains while the same scene continues playing. Edit every line and choose distinct saved voices before exporting.</p>
              <Button className="mt-3" variant="outline" disabled={!!busy} onClick={()=>void demo("conversation")} icon={<Play className="size-4"/>}>
                Open conversation video template
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">Uses the project-default Fish voice as a temporary voice for both characters. Voice authorization and the full narrated render are still required.</p>
            </div>
            <p className="text-xs text-muted-foreground">Synthetic test content only. Safe to explore, edit, and discard.</p>
          </div>
        </div>
      </div>
      <p className="font-medium">Or create a video from your own topic</p>
      <p className="text-muted-foreground">Enter a topic for the local research workflow. This is optional for trying the editor.</p>
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
      <Button disabled={!consent||!brief.title.trim()||!brief.audience.trim()||!!busy}
        onClick={()=>void researchAndGenerate()} icon={<BookOpen className="size-4"/>}>
        {busy==="research"?"Researching and checking source quotes…":
          busy==="story"?"Generating a sourced storyboard…":"Research & generate draft"}
      </Button>
      {research&&<div className="space-y-3 rounded-control border border-border bg-surface-subtle p-3">
        <div><p className="font-semibold">Draft — not approved</p>
          <p className="mt-1 text-xs text-muted-foreground">{research.evidence.length} captured sources · {research.claims.length} candidate claims. Quotes are exact matches against captured page text, not independent fact checks. Research and media rights still require your review.</p>
        </div>
        <div className="space-y-2">
          {research.evidence.map(source=><div key={source.id} className="rounded-control border border-border p-2">
            <a className="flex items-center gap-1 text-xs font-semibold underline" href={source.sourceUri}
              rel="noopener noreferrer" target="_blank">{source.title}<ExternalLink className="size-3"/></a>
            <p className="mt-1 text-xs text-muted-foreground">{source.id} · {source.passageLocator}</p>
          </div>)}
        </div>
        <div className="space-y-2" aria-label="Candidate claims and source quotes">
          {research.claims.map(c=><div key={c.id} className="space-y-1 rounded-control border border-border p-2 text-xs leading-relaxed">
            <p><strong>{c.status.toUpperCase()} · {c.id}:</strong> {c.text}</p>
            {quotePreviews.filter(q=>q.claimId===c.id).map((q,i)=><blockquote key={q.sourceId+":"+i}
              className="border-l-2 border-primary/50 pl-3 text-muted-foreground">
              <p>“{q.quote}”</p><p>Captured quote · {q.sourceId}</p>
            </blockquote>)}
            {!quotePreviews.some(q=>q.claimId===c.id)&&<p className="text-muted-foreground">
              No exact quote preview is available here. Open the source links to verify the claim.
            </p>}
          </div>)}
        </div>
        {research.gaps.length>0&&<div className="space-y-1 rounded-control border border-border p-2 text-xs">
          <p className="font-semibold">Research gaps to resolve</p>
          <ul className="list-disc space-y-1 pl-5">{research.gaps.map((gap,i)=><li key={i}>{gap}</li>)}</ul>
        </div>}
        {bundle&&<div className="space-y-2" aria-label="Proposed storyboard shots">
          <h3 className="text-sm font-semibold">Proposed shots · {bundle.plan.shots.length}</h3>
          {bundle.plan.shots.map((shot,i)=><div key={shot.id} className="rounded-control border border-border p-3 text-xs">
            <p className="font-semibold">{i+1}. {shot.onScreenText}</p>
            <p className="mt-1 text-muted-foreground">{shot.visualChange}</p>
            {bundle.plan.sound?.find(sound=>sound.shotId===shot.id)?.narration&&<p className="mt-1">
              Voice: {bundle.plan.sound.find(sound=>sound.shotId===shot.id)?.narration}</p>}
            <p className="mt-1 text-muted-foreground">Evidence: {shot.claimIds?.join(", ")||"None — review required"}</p>
          </div>)}
        </div>}
        {bundle?<Button disabled={!!busy} onClick={()=>onGenerated(research,bundle,"topic")}
          icon={<Sparkles className="size-4"/>}>Open editable storyboard</Button>:
          !busy&&<Button onClick={()=>void draftStoryboard(research,revision.current)}
            icon={<Sparkles className="size-4"/>}>Retry storyboard generation</Button>}
      </div>}
      {error&&<p className="rounded-control border border-border p-2 text-xs" role="alert">{error}</p>}
      <p className="text-xs text-muted-foreground">First-time setup: run <code>pnpm research:up</code> in apps/web (Docker Desktop needed) and choose an installed local research model in Settings. Source capture is opt-in; no automatic Docker image or LLM downloads. This is a draft, not a source-fact-checked video.</p>
    </div>
  </Surface>;
}
