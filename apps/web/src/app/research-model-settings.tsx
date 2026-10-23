import { useEffect, useState } from "react";
import { CheckCircle2, Cpu, Plus, RefreshCcw, Save, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import type { Locale } from "@/features/registry";

type Provider = "ollama" | "magnitude" | "lm-studio" | "custom";
type Task = "research" | "story" | "hooks" | "script";
type Profile = { id: string; name: string; provider: Provider; endpoint: string; model: string };
type ModelProfiles = { version: 1; profiles: Profile[]; defaultProfileId: string; assignments: Partial<Record<Task,string>> };
const route = "/api/local-research-model";
const endpoints: Record<Exclude<Provider,"custom">,string> = {
  ollama: "http://127.0.0.1:11434/v1/chat/completions",
  magnitude: "http://127.0.0.1:10100/inference/v1/chat/completions",
  "lm-studio": "http://127.0.0.1:1234/v1/chat/completions",
};
const taskLabels: Record<Task,{en:string;ja:string;hintEn:string;hintJa:string}> = {
  research: {en:"Research model",ja:"リサーチ",hintEn:"Source analysis and evidence extraction",hintJa:"資料の分析と根拠の抽出"},
  story: {en:"Story planning model",ja:"構成・ストーリー",hintEn:"Research to visual storyboard",hintJa:"調査から映像構成への変換"},
  hooks: {en:"Hooks & variants model",ja:"フック・バリエーション",hintEn:"Opening hooks and editorial alternatives",hintJa:"冒頭フックと編集案"},
  script: {en:"Script drafting model",ja:"台本生成",hintEn:"Topic-to-script CLI generation",hintJa:"トピックから台本への生成（CLI）"},
};
const field = "min-w-0 w-full rounded-control border border-input bg-surface px-3 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const label = "block text-sm font-medium text-foreground";
const hint = "mt-1 text-xs leading-relaxed text-muted-foreground";
const initial: ModelProfiles = { version:1, profiles:[{ id:"local-default", name:"Local model", provider:"ollama", endpoint:endpoints.ollama, model:"" }], defaultProfileId:"local-default",assignments:{} };

async function request(path: string,method:"GET"|"POST",value?:unknown) {
  const response=await fetch(route+path,{method,headers:method==="POST"
    ?{"Content-Type":"application/json","X-Contentgen-Settings":"local-only"}:undefined,
    body:method==="POST"?JSON.stringify(value):undefined,signal:AbortSignal.timeout(8000)});
  const data=await response.json() as Record<string,unknown>;
  if(!response.ok)throw Error(String(data.error??"Local AI settings request failed."));
  return data;
}

export function ResearchModelSettings({locale}:{locale:Locale}){
  const ja=locale==="ja";
  const copy=(en:string,jp:string)=>ja?jp:en;
  const [config,setConfig]=useState<ModelProfiles>(initial);
  const [selectedId,setSelectedId]=useState("local-default");
  const [models,setModels]=useState<string[]>([]);
  const [searchEndpoint,setSearchEndpoint]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [discovering,setDiscovering]=useState(false);
  const [saving,setSaving]=useState(false);
  const [notice,setNotice]=useState<{kind:"success"|"error"|"neutral";message:string}|null>(null);
  const selected=config.profiles.find(p=>p.id===selectedId)??config.profiles[0];

  useEffect(()=>{
    let active=true;
    void request("/profiles","GET").then(raw=>{
      if(!active)return;
      const loaded=raw.profiles as ModelProfiles;
      if(!Array.isArray(loaded?.profiles)||!loaded.profiles.length)throw Error("Invalid local profile settings response.");
      setConfig(loaded);setSelectedId(loaded.defaultProfileId);
      setSearchEndpoint(typeof raw.searchEndpoint==="string"?raw.searchEndpoint:null);
    }).catch(error=>{if(active)setNotice({kind:"error",message:String(error.message??error)});})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[]);

  function editProfile(patch:Partial<Profile>){
    setConfig(previous=>({...previous,profiles:previous.profiles.map(p=>p.id===selected.id?{...p,...patch}:p)}));
    setModels([]);setNotice(null);
  }
  function addProfile(){
    if(config.profiles.length>=12){setNotice({kind:"error",message:copy("A maximum of 12 local model profiles is supported.","プロファイルの上限は 12 個です。")});return;}
    let number=1;
    while(config.profiles.some(p=>p.id===`profile-${number}`))number++;
    const id=`profile-${number}`;
    setConfig(old=>({...old,profiles:[...old.profiles,{id,name:copy(`Local model ${number}`,`ローカルモデル ${number}`),provider:"ollama",endpoint:endpoints.ollama,model:""}]}));
    setSelectedId(id);setModels([]);setNotice(null);
  }
  function removeProfile(){
    if(config.profiles.length===1)return;
    const rest=config.profiles.filter(p=>p.id!==selectedId);
    const assignments=Object.fromEntries(Object.entries(config.assignments).filter(([,id])=>id!==selectedId)) as ModelProfiles["assignments"];
    setConfig(previous=>({...previous,profiles:rest,defaultProfileId:previous.defaultProfileId===selectedId?rest[0].id:previous.defaultProfileId,assignments}));
    setSelectedId(rest[0].id);setModels([]);setNotice(null);
  }
  function setTaskProfile(task:Task,id:string){
    setConfig(previous=>{
      const assignments={...previous.assignments};
      if(!id)delete assignments[task];else assignments[task]=id;
      return {...previous,assignments};
    });
    setNotice(null);
  }
  async function discover(){
    setDiscovering(true);setNotice(null);setModels([]);
    try{
      const response=await request("/models","POST",{endpoint:selected.endpoint});
      if(!Array.isArray(response.models)||!response.models.every(x=>typeof x==="string"))throw Error("Invalid local model list.");
      const ids=response.models as string[];
      setModels(ids);
      setNotice({kind:ids.length?"success":"neutral",message:ids.length
        ?copy(`${ids.length} installed model(s) found. Select one below or type an ID.`,`${ids.length} 件のモデルが見つかりました。選択または ID を入力してください。`)
        :copy("No models reported. Start or load a model in your local server first.","モデルがありません。ローカルサーバーでモデルを起動してください。")});
    }catch(error){setNotice({kind:"error",message:error instanceof Error?error.message:"Model discovery failed."});}
    finally{setDiscovering(false);}
  }
  async function save(){
    setSaving(true);setNotice(null);
    try{
      const response=await request("/profiles/save","POST",config);
      setConfig(response.profiles as ModelProfiles);
      setNotice({kind:"success",message:copy("Saved. New Research, Story, Hooks, and Script runs use these assignments.","保存しました。次回のリサーチ・構成・フック・台本生成から適用されます。")});
    }catch(error){setNotice({kind:"error",message:error instanceof Error?error.message:"Unable to save AI settings."});}
    finally{setSaving(false);}
  }

  return <Surface header={<div className="flex flex-wrap items-center gap-3">
      <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Cpu aria-hidden className="size-5"/></span>
      <div className="min-w-0 flex-1"><h2 className="text-base font-semibold">{copy("Local AI models","ローカル AI モデル")}</h2>
        <p className="mt-0.5 text-xs font-normal text-muted-foreground">{copy("Profiles, model servers and task routing · Local inference only","プロファイル・モデルサーバー・タスク別の割り当て · ローカル推論のみ")}</p></div>
      <span className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground">{copy("On-device","ローカル")}</span>
    </div>}>
    <div className="flex flex-col gap-6" aria-busy={loading}>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="min-w-0 space-y-4" aria-label={copy("Model profiles","モデルプロファイル")}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><h3 className="text-sm font-semibold">{copy("1. Configure a model profile","1. モデルプロファイル")}</h3>
              <p className={hint}>{copy("Save a reusable server + model combination.","サーバーとモデルの組み合わせを保存します。")}</p></div>
            <Button size="sm" variant="outline" icon={<Plus className="size-4"/>} onClick={addProfile} disabled={loading||config.profiles.length>=12}>{copy("New profile","追加")}</Button>
          </div>
          <label className={label}>{copy("Edit profile","編集するプロファイル")}
            <select className={`${field} mt-1.5`} aria-label="Model profile" value={selected?.id??""} onChange={e=>{setSelectedId(e.target.value);setModels([]);setNotice(null);}}>
              {config.profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>{copy("Profile name","プロファイル名")}
              <input className={`${field} mt-1.5`} aria-label="Profile name" maxLength={80} value={selected?.name??""} onChange={e=>editProfile({name:e.target.value})}/>
            </label>
            <label className={label}>{copy("Provider","プロバイダー")}
              <select className={`${field} mt-1.5`} aria-label="Provider" value={selected?.provider??"ollama"} onChange={e=>{
                const provider=e.target.value as Provider;
                editProfile(provider==="custom"?{provider}:{provider,endpoint:endpoints[provider]});
              }}>
                <option value="ollama">Ollama</option><option value="magnitude">Magnitude</option>
                <option value="lm-studio">LM Studio</option><option value="custom">{copy("Custom (local)","カスタム（ローカル）")}</option>
              </select>
            </label>
          </div>
          <label className={label}>{copy("Local API endpoint","ローカル API エンドポイント")}
            <input className={`${field} mt-1.5 font-mono text-xs`} aria-label="Local API endpoint" spellCheck={false} maxLength={240}
              value={selected?.endpoint??""} onChange={e=>editProfile({endpoint:e.target.value,provider:"custom"})}/>
            <p className={hint}>{copy("Loopback HTTP only. Magnitude uses /inference/v1/chat/completions.","ローカル HTTP のみ。Magnitude は /inference/v1/chat/completions を使用します。")}</p>
          </label>
          <div className="space-y-2">
            <div className="flex flex-wrap items-end justify-between gap-2"><label htmlFor="local-ai-model-id" className={label}>{copy("Model ID","モデル ID")}</label>
              <Button size="sm" variant="outline" icon={<RefreshCcw className="size-4"/>} disabled={loading||discovering} onClick={()=>void discover()}>
                {discovering?copy("Checking…","確認中…"):copy("Find installed models","インストール済みモデルを検索")}
              </Button></div>
            <input id="local-ai-model-id" className={field} aria-label="Model ID" spellCheck={false} maxLength={120} placeholder="e.g. qwen3.6-35b-a3b"
              value={selected?.model??""} onChange={e=>editProfile({model:e.target.value})}/>
            {models.length>0&&<label className={label}>{copy("Detected installed models","検出されたモデル")}
              <select className={`${field} mt-1.5`} aria-label="Detected installed models" value="" onChange={e=>editProfile({model:e.target.value})}>
                <option value="">{copy("Choose a detected model…","モデルを選択…")}</option>
                {models.map(id=><option key={id} value={id}>{id}</option>)}
              </select>
            </label>}
            <p className={hint}>{copy("Discovery only lists models. It does not download or start them.","一覧の取得のみ。モデルのダウンロードや起動は行いません。")}</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <button type="button" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-destructive hover:underline disabled:opacity-40"
              onClick={removeProfile} disabled={config.profiles.length<=1}>
              <Trash2 aria-hidden className="size-3.5"/>{copy("Remove this profile","このプロファイルを削除")}
            </button>
            <span className="text-xs text-muted-foreground">{config.profiles.length}/12 {copy("profiles","プロファイル")}</span>
          </div>
        </section>
        <section className="min-w-0 space-y-4 rounded-xl border border-border bg-surface-subtle p-4 sm:p-5" aria-label={copy("Task model assignments","タスク別モデル割り当て")}>
          <div><h3 className="text-sm font-semibold">{copy("2. Assign models to tasks","2. タスクごとにモデルを割り当て")}</h3>
            <p className={hint}>{copy("Use one default everywhere, or override individual tasks.","共通のデフォルトを設定し、必要なタスクのみ変更できます。")}</p></div>
          <label className={label}>{copy("Default model profile","デフォルトモデル")}
            <select className={`${field} mt-1.5`} aria-label="Default model profile" value={config.defaultProfileId}
              onChange={e=>setConfig(old=>({...old,defaultProfileId:e.target.value}))}>
              {config.profiles.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}
            </select>
          </label>
          <div className="space-y-3 border-t border-border pt-3">
            {(["research","story","hooks","script"] as const).map(task=><label className="block" key={task}>
              <span className={label}>{copy(taskLabels[task].en,taskLabels[task].ja)}</span>
              <span className={hint}>{copy(taskLabels[task].hintEn,taskLabels[task].hintJa)}</span>
              <select className={`${field} mt-1.5`} aria-label={taskLabels[task].en} value={config.assignments[task]??""}
                onChange={e=>setTaskProfile(task,e.target.value)}>
                <option value="">{copy("Use default", "デフォルトを使用")} · {config.profiles.find(p=>p.id===config.defaultProfileId)?.name}</option>
                {config.profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>)}
          </div>
          <p className="rounded-lg border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            {copy("These four routes are connected today. Other stages in Prompt Studio do not yet use assigned models.","現在この 4 つのタスクに対応しています。Prompt Studio の他の工程はまだモデル割り当てに対応していません。")}
          </p>
        </section>
      </div>
      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <Search aria-hidden className="mt-0.5 size-4 shrink-0"/>
          <div><span className="font-medium text-foreground">{copy("Research search · ","調査用検索 · ")}</span>
            {searchEndpoint?copy(`SearXNG configured at ${searchEndpoint}`,`SearXNG 設定済み: ${searchEndpoint}`):copy("SearXNG not configured; use research:up to enable source discovery.","SearXNG 未設定。research:up で検索を有効にできます。")}
          </div>
        </div>
        <Button size="sm" onClick={()=>void save()} disabled={loading||saving} icon={saving?<RefreshCcw className="size-4"/>:<Save className="size-4"/>}>
          {saving?copy("Saving…","保存中…"):copy("Save AI settings","AI 設定を保存")}
        </Button>
      </div>
      {notice&&<p role={notice.kind==="error"?"alert":"status"} className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm ${notice.kind==="error"?"border border-destructive/30 bg-destructive/5 text-destructive":"border border-border bg-surface-subtle text-foreground"}`}>
        {notice.kind==="success"&&<CheckCircle2 aria-hidden className="size-4 shrink-0 text-emerald-600"/>}{notice.message}
      </p>}
    </div>
  </Surface>;
}
