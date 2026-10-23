import { useEffect, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import type { Locale } from "@/features/registry";

type PromptData={version:1;overrides:Record<string,string>};
const endpoint="/api/contentgen-director";
const field="w-full min-w-0 rounded-control border border-input bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const names:Record<string,string>={research:"Research & evidence",story:"Story architecture",hooks:"Hooks & creative variants",
  script:"Scriptwriting & scene revision",visuals:"Visual direction",audio:"Performance & sound design",
  thumbnails:"Thumbnail concepts",captions:"Captions & accessibility",review:"Editorial quality review"};
async function request(method:"GET"|"POST",data?:unknown){
  const res=await fetch(endpoint+"/prompts",{method,
    headers:method==="POST"?{"Content-Type":"application/json","X-Contentgen-Director":"local-only"}:undefined,
    body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(10000)});
  const json=await res.json() as Record<string,unknown>;
  if(!res.ok)throw Error(String(json.error??"Prompt settings unavailable."));
  return json;
}
export function PromptStudio({locale}:{locale:Locale}){
  const ja=locale==="ja";
  const [defaults,setDefaults]=useState<Record<string,string>>({});
  const [overrides,setOverrides]=useState<Record<string,string>>({});
  const [selected,setSelected]=useState("hooks");
  const [editor,setEditor]=useState("");
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [status,setStatus]=useState("");
  useEffect(()=>{
    let active=true;
    void request("GET").then(raw=>{
      if(!active)return;
      const def=raw.defaults,settings=raw.settings;
      if(!def||typeof def!=="object"||!settings||typeof settings!=="object"||
        !("overrides" in settings)||typeof settings.overrides!=="object"||
        settings.overrides===null)
        throw Error("AI Prompt Studio settings endpoint returned an incomplete response.");
      const safeDefaults=def as Record<string,string>;
      const safeSettings=settings as PromptData;
      setDefaults(safeDefaults);setOverrides(safeSettings.overrides);
      setEditor(safeSettings.overrides.hooks??"");
    }).catch(error=>{if(active)setStatus(String(error.message));})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[]);
  function switchStage(stage:string){
    // Keep in-progress edits on other stages in the current unsaved batch.
    const next={...overrides};
    if(editor.trim())next[selected]=editor;
    else delete next[selected];
    setOverrides(next);setSelected(stage);setEditor(next[stage]??"");setStatus("");
  }
  function nextOverrides(){
    const next={...overrides};
    if(editor.trim())next[selected]=editor.trim();else delete next[selected];
    return next;
  }
  async function save(){
    setSaving(true);setStatus("");
    try{
      const candidate={version:1 as const,overrides:nextOverrides()};
      const response=await request("POST",candidate);
      const settings=response.settings as PromptData;
      setOverrides(settings.overrides);setEditor(settings.overrides[selected]??"");
      setStatus(ja?"プロンプト設定を保存しました。":"Prompt settings saved and shared with local generators.");
    }catch(error){setStatus(error instanceof Error?error.message:"Unable to save.");}
    finally{setSaving(false);}
  }
  return <Surface header={<h2 className="font-medium">{ja?"AI システムプロンプト":"AI Prompt Studio"}</h2>}>
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">{ja
        ?"工程ごとに AI の指示を変更できます。検証や安全規則は維持されます。"
        :"Customize instructions for each AI production stage. Built-in validation, evidence and safety contracts remain mandatory."}</p>
      <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
        {ja?"生成工程":"Generation stage"}
        <select className={field} aria-label="AI prompt stage" value={selected}
          disabled={loading} onChange={e=>switchStage(e.target.value)}>
          {Object.keys(names).map(key=><option key={key} value={key}>{names[key]}{overrides[key]?" · Custom":""}</option>)}
        </select>
      </label>
      <div className="rounded-control border border-border bg-surface-subtle p-3">
        <p className="mb-1 text-xs font-medium text-muted-foreground">Default instruction (read-only)</p>
        <p className="text-sm leading-relaxed">{defaults[selected]??"Loading…"}</p>
      </div>
      <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
        {ja?"カスタム指示":"Custom system instruction"}
        <textarea aria-label="Custom AI system instruction" rows={7} className={field}
          value={editor} onChange={e=>setEditor(e.target.value)} maxLength={8000}
          placeholder="Leave blank to use the default for this stage."/>
      </label>
      <p className="text-xs text-muted-foreground">Custom instructions replace the stage's default creative guidance; fixed JSON schemas, source constraints, and provider permissions are not replaceable. Saved locally in data/contentgen-prompts.json. Raw speech synthesis (Fish/local TTS) has voice/direction settings, not an LLM system prompt.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={()=>void save()} disabled={loading||saving}
          icon={<Save className="size-4"/>}>{saving?"Saving…":"Save AI prompts"}</Button>
        <Button variant="outline" size="sm" icon={<RotateCcw className="size-4"/>}
          onClick={()=>{setEditor("");setStatus("Default restored in the editor. Save to apply.");}}>
          Restore default
        </Button>
      </div>
      {status&&<p role="status" className="text-xs text-muted-foreground">{status}</p>}
    </div>
  </Surface>;
}
