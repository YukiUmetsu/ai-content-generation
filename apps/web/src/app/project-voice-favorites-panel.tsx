import {useEffect,useState} from "react";
import {Button} from "@/components/ui/button";
import {Surface} from "@/components/ui/surface-card";
import {addVoiceFavorite,defaultProjectVoices,rankVoiceFavorite,readProjectVoices,removeVoiceFavorite,
  saveProjectVoices,updateVoiceFavorite,voiceFavoritesKey,type ProjectVoiceFavorites,
  type VoiceFavorite,type VoiceGender,type VoiceProvider} from "./project-voice-favorites";

const input="mt-1 w-full min-w-0 rounded-control border border-input bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const label="text-xs font-semibold text-muted-foreground";
const emptyVoice:VoiceFavorite={provider:"fish",voiceId:"",name:"",gender:"unspecified",situation:"narration",language:"und"};
type Snapshot={library:ProjectVoiceFavorites;error:string};
function readSnapshot(projectId:string):Snapshot{
  try{return {library:readProjectVoices(projectId),error:""};}
  catch(error){return {library:defaultProjectVoices(projectId),error:error instanceof Error?error.message:"Could not load saved voices."};}
}

/** A compact browser-local editor; selecting a voice never starts synthesis or grants consent. */
export function ProjectVoiceFavoritesPanel({projectId,onUseVoice,selectedVoice}:{
  projectId:string;onUseVoice:(voice:VoiceFavorite)=>void;selectedVoice:{provider:VoiceProvider;voiceId:string};
}){
  const [snapshot,setSnapshot]=useState<Snapshot>(()=>readSnapshot(projectId));
  const [editing,setEditing]=useState<VoiceFavorite|null>(null);
  const [original,setOriginal]=useState<VoiceFavorite|null>(null);
  const [formError,setFormError]=useState("");
  useEffect(()=>{
    // Do not overwrite corrupt or unrecognized previous data. The default is
    // persisted for this project only, and never conveys rights or TTS consent.
    if(snapshot.error)return;
    try{
      if(localStorage.getItem(voiceFavoritesKey(projectId))===null)saveProjectVoices(snapshot.library);
    }catch(error){setSnapshot(current=>({...current,error:error instanceof Error?error.message:"Could not save default voice."}));}
    // This component is keyed by project; no background reload may clobber edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[projectId]);
  function commit(next:ProjectVoiceFavorites){
    try{saveProjectVoices(next,localStorage,snapshot.library);setSnapshot({library:next,error:""});setFormError("");return true;}
    catch(error){setFormError(error instanceof Error?error.message:"Could not save project voices.");return false;}
  }
  function openForm(voice:VoiceFavorite|null){
    setOriginal(voice);setEditing(voice?{...voice}:{...emptyVoice});setFormError("");
  }
  function saveForm(){
    if(!editing)return;
    try{
      const cleaned={...editing,voiceId:editing.voiceId.trim(),name:editing.name.trim(),
        situation:editing.situation.trim(),language:editing.language.trim()};
      const next=original?updateVoiceFavorite(snapshot.library,original,cleaned):addVoiceFavorite(snapshot.library,cleaned);
      if(commit(next)){setEditing(null);setOriginal(null);}
    }catch(error){setFormError(error instanceof Error?error.message:"Invalid voice details.");}
  }
  const voices=snapshot.library.voices;
  return <Surface variant="outline" aria-label="Project voice favorites" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h4 className="text-sm font-semibold text-foreground">Project voices</h4>
        <p className="mt-1 text-xs text-muted-foreground">Primary is offered first; secondary is next. Nothing plays or leaves your device until you authorize it.</p></div>
      <Button size="sm" variant="outline" disabled={!!snapshot.error||editing!==null} onClick={()=>openForm(null)}>Add voice</Button>
    </div>
    {snapshot.error&&<div className="flex flex-wrap items-center justify-between gap-2"><p role="alert" className="text-xs text-danger">{snapshot.error} Your saved voice data was not changed.</p>
      <Button variant="outline" size="sm" onClick={()=>{setSnapshot(readSnapshot(projectId));setEditing(null);setOriginal(null);setFormError("");}}>Reload voices</Button></div>}
    {!snapshot.error&&formError&&<div className="flex flex-wrap items-center justify-between gap-2"><p role="alert" className="text-xs text-danger">{formError}</p>
      <Button variant="outline" size="sm" onClick={()=>{setSnapshot(readSnapshot(projectId));setEditing(null);setOriginal(null);setFormError("");}}>Reload voices</Button></div>}
    {!snapshot.error&&voices.length===0&&<p className="rounded-control border border-dashed border-border p-3 text-xs text-muted-foreground">No saved voices. Add a voice to choose a narrator.</p>}
    {!snapshot.error&&<ol className="space-y-2" aria-label="Ordered project voices">{voices.map((voice,index)=>{
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
          <Button size="sm" variant={selected?"subtle":"outline"} disabled={selected} onClick={()=>onUseVoice(voice)}>{selected?"Selected":"Use"}</Button>
          {index!==0&&<Button size="sm" variant="subtle" onClick={()=>commit(rankVoiceFavorite(snapshot.library,voice,0))}>Make primary</Button>}
          {index>1&&<Button size="sm" variant="subtle" onClick={()=>commit(rankVoiceFavorite(snapshot.library,voice,1))}>Make secondary</Button>}
          <Button size="sm" variant="subtle" disabled={editing!==null} onClick={()=>openForm(voice)}>Edit</Button>
          <Button size="sm" variant="subtle" disabled={editing!==null} onClick={()=>commit(removeVoiceFavorite(snapshot.library,voice))}>Remove</Button>
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
        <Button size="sm" onClick={saveForm}>Save voice</Button>
        <Button size="sm" variant="outline" onClick={()=>{setEditing(null);setOriginal(null);setFormError("");}}>Cancel</Button>
      </div>
    </div>}
  </Surface>;
}
