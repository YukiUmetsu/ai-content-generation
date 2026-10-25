import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {AudioLines,Headphones,Play,Square,Upload,Volume2} from "lucide-react";
import {Button} from "@/components/ui/button";
import {planSoundAudition} from "../../scripts/video-production/sound-audition-plan.mjs";
import {createSoundAuditionPlayer} from "../../scripts/video-production/sound-audition-player.mjs";

type Mix={assetId:string;sha256:string;title?:string;gainDb:number;fadeInMs:number;fadeOutMs:number};
type Layer=Mix&{layerId:string;shotId:string;trigger:"shot-start"|"first-visual-reveal";offsetMs:number};
type Choice={shotId:string;mode:string;assetId:string|null;sha256:string|null;
  trigger:"shot-start"|"first-visual-reveal"};
type Asset={assetId:string;sha256:string;title:string;durationSeconds:number;
  license:string;rightsStatus:string};
type Props={shotId:string;choice:Choice|null|undefined;layers:Layer[];ambience:Mix|null;library:Asset[]};

const laneColor={primary:"bg-sky-500",layer:"bg-indigo-500",ambience:"bg-teal-500"};
const tag={primary:"Main effect",layer:"Added cue",ambience:"Ambience"};
const asTime=(ms:number)=>(ms/1000).toFixed(ms%1000?1:0)+"s";

/** No narration is synthesized here. The editor can audition a user-provided temporary WAV in memory. */
export function SoundAuditionControls({shotId,choice,layers,ambience,library}:Props){
  const plan=useMemo(()=>planSoundAudition({shotId,choice,layers,ambience,library}),
    [shotId,choice,layers,ambience,library]);
  const [voiceFile,setVoiceFile]=useState<File|null>(null);
  const [phase,setPhase]=useState<"idle"|"loading"|"playing">("idle");
  const [progressMs,setProgressMs]=useState(0);
  const [message,setMessage]=useState("");
  const player=useRef<ReturnType<typeof createSoundAuditionPlayer>|null>(null);
  const endTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const progressTimer=useRef<ReturnType<typeof setInterval>|null>(null);

  const stop=useCallback(()=>{
    if(endTimer.current){clearTimeout(endTimer.current);endTimer.current=null;}
    if(progressTimer.current){clearInterval(progressTimer.current);progressTimer.current=null;}
    player.current?.stop();player.current=null;setPhase("idle");setProgressMs(0);
  },[]);
  // A newly selected shot or updated mix must never continue playing the previous configuration.
  useEffect(()=>{
    setPhase("idle");setMessage("");
    return ()=>{
      player.current?.stop();player.current=null;
      if(endTimer.current){clearTimeout(endTimer.current);endTimer.current=null;}
      if(progressTimer.current){clearInterval(progressTimer.current);progressTimer.current=null;}
    };
  },[plan,voiceFile]);

  async function play(){
    stop();setMessage("");
    const AudioContextClass=window.AudioContext;
    if(!AudioContextClass){setMessage("Browser audio is unavailable. Try a recent desktop browser.");return;}
    let session:ReturnType<typeof createSoundAuditionPlayer>;
    try{session=createSoundAuditionPlayer(plan,{createContext:()=>new AudioContextClass(),voiceFile});}
    catch(error){setMessage(error instanceof Error?error.message:"Could not prepare the audio sketch.");return;}
    player.current=session;setPhase("loading");
    try{
      await session.ready;
      if(player.current!==session)return;
      setPhase("playing");setMessage("Browser-local audition · not the mastered export");
      const startedAt=Date.now();
      progressTimer.current=setInterval(()=>setProgressMs(Math.min(plan.durationMs,Date.now()-startedAt)),80);
      endTimer.current=setTimeout(()=>{if(player.current===session){stop();setMessage("Audition finished.");}},
        plan.durationMs+200);
    }catch(error){if(player.current===session){stop();setMessage(error instanceof Error?
      error.message:"Audition failed. Check your approved library.");}}
  }
  const canPlay=plan.cues.length>0||voiceFile!==null;
  return <section aria-label="Sound audition" className="rounded-surface border border-border bg-surface shadow-sm">
    <div className="flex items-start gap-3 border-b border-border p-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary">
        <Headphones className="size-5"/>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold">Listen to your mix</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Preview the selected shot's approved effects and ambience before a full export.</p>
      </div>
      <span className="rounded-full border border-border bg-surface-subtle px-2 py-1 text-[11px] font-semibold text-muted-foreground">LOCAL</span>
    </div>
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><AudioLines className="size-3.5"/>Sound sketch</span>
        <span className="text-xs tabular-nums text-muted-foreground">{asTime(progressMs)} / {asTime(plan.durationMs)}</span>
      </div>
      <div role="progressbar" aria-label="Sound audition playback" aria-valuemin={0}
        aria-valuemax={plan.durationMs} aria-valuenow={progressMs}
        className="h-1 overflow-hidden rounded-full bg-border" >
        <div className="h-full rounded-full bg-primary transition-[width] duration-75"
          style={{width:`${progressMs/plan.durationMs*100}%`}}/>
      </div>
      <div className="space-y-3 rounded-control border border-border bg-surface-subtle p-3">
        {plan.cues.length===0&&<p className="py-3 text-center text-xs leading-relaxed text-muted-foreground">No timed sound cues in this shot yet. Choose an approved effect in the Library.</p>}
        {plan.cues.map(cue=><div key={cue.id} className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="min-w-0 truncate font-medium">{cue.title}</span>
            <span className="shrink-0 text-muted-foreground">{tag[cue.kind as keyof typeof tag]} · {asTime(cue.startMs)}</span>
          </div>
          <div className="relative h-2.5 overflow-hidden rounded-full bg-border/70" aria-hidden="true">
            <div className={`absolute inset-y-0 rounded-full ${laneColor[cue.kind as keyof typeof laneColor]}`}
              style={{left:`${cue.startMs/plan.durationMs*100}%`,
                width:`${Math.max(.8,cue.durationMs/plan.durationMs*100)}%`,opacity:.85}}/>
          </div>
        </div>)}
        <div className="flex justify-between border-t border-border/70 pt-2 text-[10px] tabular-nums text-muted-foreground">
          <span>0s</span><span>{asTime(plan.durationMs/2)}</span><span>{asTime(plan.durationMs)}</span>
        </div>
      </div>
      <label className="block rounded-control border border-dashed border-border px-3 py-3 text-xs">
        <span className="flex items-center gap-2 font-semibold"><Upload className="size-4 text-muted-foreground"/>Optional narration WAV</span>
        <span className="mt-1 block leading-relaxed text-muted-foreground">Hear a recording alongside these cues. The file stays in your browser and does not enter the exported video.</span>
        <input className="mt-2 block w-full cursor-pointer text-xs text-muted-foreground file:mr-3 file:rounded-control file:border file:border-border file:bg-surface-subtle file:px-3 file:py-2 file:text-xs file:font-semibold"
          aria-label="Narration WAV for audition" type="file" accept=".wav,audio/wav,audio/x-wav"
          onChange={event=>{stop();setVoiceFile(event.target.files?.[0]??null);setMessage("");}}/>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!canPlay||phase!=="idle"} onClick={()=>void play()}>
          {phase==="loading"?<AudioLines className="mr-1.5 size-4 animate-pulse"/>:<Play className="mr-1.5 size-4"/>}
          {phase==="loading"?"Loading approved audio…":"Play sound sketch"}
        </Button>
        <Button size="sm" variant="outline" disabled={phase==="idle"} onClick={()=>{stop();setMessage("Audition stopped.");}}>
          <Square className="mr-1.5 size-3.5"/>Stop
        </Button>
      </div>
      {message&&<p role="status" className="rounded-control bg-surface-subtle px-3 py-2 text-xs text-muted-foreground">{message}</p>}
      {plan.warnings.map((warning,i)=><p key={i} className="rounded-control border border-amber-400/40 bg-amber-400/5 px-3 py-2 text-xs leading-relaxed text-muted-foreground">{warning}</p>)}
      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <Volume2 className="mt-0.5 size-3.5 shrink-0"/>
        No narration is generated here. This browser preview uses a short editorial window, so exact voice timing, visual reveals and mastered loudness are verified only in the exported video.
      </p>
    </div>
  </section>;
}
