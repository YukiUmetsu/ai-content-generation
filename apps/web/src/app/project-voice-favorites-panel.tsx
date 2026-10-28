import {useEffect,useState} from "react";
import {Button} from "@/components/ui/button";
import {Surface} from "@/components/ui/surface-card";
import {addVoiceFavorite,defaultProjectVoices,rankVoiceFavorite,readProjectVoices,removeVoiceFavorite,
  saveProjectVoices,updateVoiceFavorite,voiceFavoritesKey,type ProjectVoiceFavorites,
  type VoiceFavorite,type VoiceGender,type VoiceProvider} from "./project-voice-favorites";
import {loadSavedProjectVoices,writeSavedProjectVoices} from "./project-voice-favorites-api";

const input="mt-1 w-full min-w-0 rounded-control border border-input bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const label="text-xs font-semibold text-muted-foreground";
const emptyVoice:VoiceFavorite={provider:"fish",voiceId:"",name:"",gender:"unspecified",situation:"narration",language:"und"};
type Snapshot={library:ProjectVoiceFavorites;error:string;revision:number;
  status:"loading"|"ready"|"error"|"conflict";remoteLibrary:ProjectVoiceFavorites|null};
function readSnapshot(projectId:string):Snapshot{
  try{return {library:readProjectVoices(projectId),error:"",revision:0,status:"loading",remoteLibrary:null};}
  catch(error){return {library:defaultProjectVoices(projectId),error:error instanceof Error?error.message:"Could not load saved voices.",revision:0,status:"error",remoteLibrary:null};}
}

/** A compact durable editor; selecting a voice never starts synthesis or grants consent. */
export function ProjectVoiceFavoritesPanel({projectId,onUseVoice,selectedVoice}:{
  projectId:string;onUseVoice:(voice:VoiceFavorite)=>void;selectedVoice:{provider:VoiceProvider;voiceId:string};
}){
  const [snapshot,setSnapshot]=useState<Snapshot>(()=>readSnapshot(projectId));
  const [editing,setEditing]=useState<VoiceFavorite|null>(null);
  const [original,setOriginal]=useState<VoiceFavorite|null>(null);
  const [formError,setFormError]=useState("");
  const [pending,setPending]=useState(false);
  const [reloadToken,setReloadToken]=useState(0);
  useEffect(()=>{
    let active=true;
    const local=readSnapshot(projectId);
    setSnapshot(local);
    if(local.error)return;
    const localExists=localStorage.getItem(voiceFavoritesKey(projectId))!==null;
    void (async()=>{
      try{
        const remote=await loadSavedProjectVoices(projectId);
        if(!active)return;
        if(remote.library===null){
          // A missing server row is not an empty list. Promote the intact
          // browser library with revision 0; concurrent promotion conflicts.
          const saved=await writeSavedProjectVoices(projectId,0,local.library);
          if(!active)return;
          saveProjectVoices(local.library,localStorage,local.library);
          setSnapshot({...local,status:"ready",revision:saved.revision,remoteLibrary:saved.library});
        }else if(localExists&&JSON.stringify(local.library)!==JSON.stringify(remote.library)){
          setSnapshot({...local,status:"conflict",revision:remote.revision,remoteLibrary:remote.library});
        }else{
          saveProjectVoices(remote.library,localStorage,local.library);
          setSnapshot({library:remote.library,error:"",status:"ready",revision:remote.revision,remoteLibrary:remote.library});
        }
      }catch(error){
        if(active)setSnapshot(current=>({...current,status:"error",error:error instanceof Error?error.message:"Could not load project voices."}));
      }
    })();
    return ()=>{active=false;};
  },[projectId,reloadToken]);
  function reload(){setEditing(null);setOriginal(null);setFormError("");setReloadToken(value=>value+1);}
  async function commit(next:ProjectVoiceFavorites):Promise<boolean>{
    if(pending||snapshot.status!=="ready")return false;
    setPending(true);
    try{
      if(JSON.stringify(readProjectVoices(projectId))!==JSON.stringify(snapshot.library))
        throw Error("Project voices changed in another tab. Reload before editing.");
      const saved=await writeSavedProjectVoices(projectId,snapshot.revision,next);
      saveProjectVoices(next,localStorage,snapshot.library);
      setSnapshot({library:next,error:"",status:"ready",revision:saved.revision,remoteLibrary:next});
      setFormError("");return true;
    }catch(error){setFormError(error instanceof Error?error.message:"Could not save project voices. No other changes were made.");return false;}
    finally{setPending(false);}
  }
  function openForm(voice:VoiceFavorite|null){
    setOriginal(voice);setEditing(voice?{...voice}:{...emptyVoice});setFormError("");
  }
  async function saveForm(){
    if(!editing)return;
    try{
      const cleaned={...editing,voiceId:editing.voiceId.trim(),name:editing.name.trim(),
        situation:editing.situation.trim(),language:editing.language.trim()};
      const next=original?updateVoiceFavorite(snapshot.library,original,cleaned):addVoiceFavorite(snapshot.library,cleaned);
      if(await commit(next)){setEditing(null);setOriginal(null);}
    }catch(error){setFormError(error instanceof Error?error.message:"Invalid voice details.");}
  }
  const voices=snapshot.library.voices;
  const ready=snapshot.status==="ready"&&!pending;
  async function keepBrowserVoices(){
    if(!snapshot.remoteLibrary||pending)return;
    setPending(true);
    try{
      if(JSON.stringify(readProjectVoices(projectId))!==JSON.stringify(snapshot.library))throw Error("Browser voices changed in another tab. Reload first.");
      const saved=await writeSavedProjectVoices(projectId,snapshot.revision,snapshot.library);
      setSnapshot(current=>({...current,status:"ready",error:"",revision:saved.revision,remoteLibrary:saved.library}));
    }catch(error){setFormError(error instanceof Error?error.message:"Could not save browser favorites.");}
    finally{setPending(false);}
  }
  function useServerVoices(){
    if(!snapshot.remoteLibrary)return;
    try{
      saveProjectVoices(snapshot.remoteLibrary,localStorage,snapshot.library);
      setSnapshot(current=>({...current,library:current.remoteLibrary!,status:"ready",error:""}));setFormError("");
    }catch(error){setFormError(error instanceof Error?error.message:"Cannot use server favorites.");}
  }
  return <Surface variant="outline" aria-label="Project voice favorites" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h4 className="text-sm font-semibold text-foreground">Project voices</h4>
        <p className="mt-1 text-xs text-muted-foreground">Primary is offered first; secondary is next. Saving IDs and tags never starts voice synthesis.</p></div>
      <Button size="sm" variant="outline" disabled={!ready||editing!==null} onClick={()=>openForm(null)}>Add voice</Button>
    </div>
    {snapshot.status==="loading"&&<p role="status" className="text-xs text-muted-foreground">Syncing saved project voices…</p>}
    {snapshot.status==="error"&&<div className="flex flex-wrap items-center justify-between gap-2"><p role="alert" className="text-xs text-danger">{snapshot.error} Your local favorites remain unchanged.</p>
      <Button variant="outline" size="sm" onClick={reload}>Retry sync</Button></div>}
    {snapshot.status==="conflict"&&<div className="space-y-2 rounded-control border border-warning/50 bg-surface-subtle p-3">
      <p role="alert" className="text-xs text-foreground">This project has different saved voices on the server and this browser. Choose which list to keep; neither was overwritten.</p>
      <div className="flex flex-wrap gap-2"><Button size="sm" disabled={pending} onClick={useServerVoices}>Use server favorites</Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={()=>void keepBrowserVoices()}>Keep browser favorites</Button>
        <Button size="sm" variant="subtle" disabled={pending} onClick={reload}>Reload</Button></div>
    </div>}
    {formError&&<div className="flex flex-wrap items-center justify-between gap-2"><p role="alert" className="text-xs text-danger">{formError}</p>
      <Button variant="outline" size="sm" disabled={pending} onClick={reload}>Reload voices</Button></div>}
    {snapshot.status==="ready"&&voices.length===0&&<p className="rounded-control border border-dashed border-border p-3 text-xs text-muted-foreground">No saved voices. Add a voice to choose a narrator.</p>}
    {snapshot.status==="ready"&&<ol className="space-y-2" aria-label="Ordered project voices">{voices.map((voice,index)=>{
      const id=voice.provider+":"+voice.voiceId;
      const selected=selectedVoice.provider===voice.provider&&selectedVoice.voiceId===voice.voiceId;
      return <li key={id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control border border-border bg-surface px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{index===0?"Primary":index===1?"Secondary":`#${index+1}`}</span>
            <span className="min-w-0 break-words text-sm font-semibold text-foreground">{voice.name}</span>
            {selected&&<span className="text-xs text-success">In use</span>}
          </div>
          <p className="mt-1 break-all text-xs text-muted-foreground">{voice.provider==="fish"?"Fish Audio":"Local TTS"} · {voice.voiceId}</p>
          <p className="mt-1 text-xs text-muted-foreground">{voice.gender} · {voice.situation} · {voice.language==="und"?"language unverified":voice.language}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant={selected?"subtle":"outline"} disabled={selected||pending} onClick={()=>onUseVoice(voice)}>{selected?"Selected":"Use"}</Button>
          {index!==0&&<Button size="sm" variant="subtle" disabled={!ready} onClick={()=>void commit(rankVoiceFavorite(snapshot.library,voice,0))}>Make primary</Button>}
          {index>1&&<Button size="sm" variant="subtle" disabled={!ready} onClick={()=>void commit(rankVoiceFavorite(snapshot.library,voice,1))}>Make secondary</Button>}
          <Button size="sm" variant="subtle" disabled={!ready||editing!==null} onClick={()=>openForm(voice)}>Edit</Button>
          <Button size="sm" variant="subtle" disabled={!ready||editing!==null} onClick={()=>void commit(removeVoiceFavorite(snapshot.library,voice))}>Remove</Button>
        </div>
      </li>;
    })}</ol>}
    {editing&&<div className="space-y-3 rounded-control border border-primary/40 bg-surface-subtle p-3" aria-label="Save a project voice">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>Provider<select className={input} value={editing.provider} onChange={event=>setEditing(current=>current&&({...current,provider:event.target.value as VoiceProvider}))}>
          <option value="fish">Fish Audio</option><option value="local">Local TTS</option>
        </select></label>
        <label className={label}>Voice ID<input className={input} value={editing.voiceId} maxLength={128} placeholder="Your authorized provider voice ID"
          onChange={event=>setEditing(current=>current&&({...current,voiceId:event.target.value.trim()}))}/></label>
        <label className={label}>Display name<input className={input} value={editing.name} maxLength={72} placeholder="e.g. Calm guide"
          onChange={event=>setEditing(current=>current&&({...current,name:event.target.value}))}/></label>
        <label className={label}>Gender tag<select className={input} value={editing.gender} onChange={event=>setEditing(current=>current&&({...current,gender:event.target.value as VoiceGender}))}>
          <option value="unspecified">Unspecified</option><option value="female">Female</option><option value="male">Male</option><option value="nonbinary">Nonbinary</option>
        </select></label>
        <label className={label}>Situation tag<input className={input} value={editing.situation} maxLength={48} placeholder="narration, conversation…"
          onChange={event=>setEditing(current=>current&&({...current,situation:event.target.value}))}/></label>
        <label className={label}>Language code<input className={input} value={editing.language} maxLength={35} placeholder="en, ja or und"
          onChange={event=>setEditing(current=>current&&({...current,language:event.target.value}))}/></label>
      </div>
      <p className="text-xs text-muted-foreground">Tags describe your choices; they do not verify a provider's language support, voice rights or commercial license.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!ready} onClick={()=>void saveForm()}>{pending?"Saving…":"Save voice"}</Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={()=>{setEditing(null);setOriginal(null);setFormError("");}}>Cancel</Button>
      </div>
    </div>}
  </Surface>;
}
