import { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import { CharacterPresenter } from "@/components/character/character-presenter-react";
import { Button } from "@/components/ui/button";
import type { CharacterCue, CharacterInstance } from "@/components/character/definition";
import type { Locale } from "@/features/registry";
import { STARTER_CHARACTERS, type StarterCharacterId } from "./starter-characters";

export function StarterCharacterPreview({id, locale}: {id: StarterCharacterId; locale: Locale}) {
  const starter = STARTER_CHARACTERS.find(entry => entry.id === id)!;
  const [playing,setPlaying] = useState(false);
  const [frame,setFrame] = useState(0);
  useEffect(()=>{
    if(!playing)return;
    const started=performance.now();
    let request=0;
    const sample=(timestamp:number)=>{
      setFrame(Math.floor(((timestamp-started)*30/1000)%72));
      request=window.requestAnimationFrame(sample);
    };
    request=window.requestAnimationFrame(sample);
    return ()=>window.cancelAnimationFrame(request);
  },[playing]);
  const performer:CharacterInstance={instanceId:`${id}-studio-preview`,characterId:id,
    revision:starter.definition.revision,seed:id==="pip"?117:283};
  const cues:CharacterCue[]=[
    {id:`${id}-gesture`,kind:"action",instanceId:performer.instanceId,name:`${id}-explain`,startFrame:6},
    {id:`${id}-speech`,kind:"speech",instanceId:performer.instanceId,startFrame:14,endFrame:58,precision:"approximate"},
  ];
  return <div className="flex shrink-0 flex-col items-center gap-2">
    <div className="w-32 rounded-xl border border-border/60 bg-[#172f3a] p-1.5 sm:w-36"
      data-starter-character={id}>
      <CharacterPresenter definition={starter.definition} instance={performer} cues={cues} frame={frame}
        label={`${starter.name} original animated character`} reducedMotion="auto" />
    </div>
    <Button size="sm" variant="subtle" icon={playing?<Pause className="size-3.5"/>:<Play className="size-3.5"/>}
      aria-pressed={playing} onClick={()=>setPlaying(value=>!value)}>
      {playing?(locale==="ja"?"一時停止":"Pause motion"):(locale==="ja"?"動きを確認":"Preview motion")}
    </Button>
  </div>;
}
