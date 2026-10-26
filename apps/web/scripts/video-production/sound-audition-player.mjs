/** Browser-only, opt-in sound sketch. Export uses a separate measured FFmpeg mixer. */
const LOCAL_PREVIEW=/^\/api\/contentgen-sfx\/preview\/[a-f\d]{64}$/iu;

export function createSoundAuditionPlayer(plan,{createContext,fetchImpl=fetch,voiceFile=null}={}){
  if(!plan||!Number.isSafeInteger(plan.durationMs)||plan.durationMs<1000||plan.durationMs>20000||
    !Array.isArray(plan.cues)||plan.cues.length>90)throw Error("Invalid sound audition plan.");
  for(const cue of plan.cues){
    if(!LOCAL_PREVIEW.test(cue?.url??"")||cue.url.split("/").at(-1)!==cue.sha256)
      throw Error("Audition accepts only local approved WAV preview URLs.");
    if(!Number.isSafeInteger(cue.startMs)||cue.startMs<0||
      !Number.isSafeInteger(cue.durationMs)||cue.durationMs<=0||cue.startMs+cue.durationMs>plan.durationMs||
      !Number.isFinite(cue.gain)||cue.gain<0||cue.gain>1||
      !Number.isSafeInteger(cue.fadeInMs)||cue.fadeInMs<0||cue.fadeInMs>5000||
      !Number.isSafeInteger(cue.fadeOutMs)||cue.fadeOutMs<0||cue.fadeOutMs>5000)
      throw Error("Invalid sound audition envelope.");
  }
  if(typeof createContext!=="function")throw Error("Your browser cannot play a multitrack sound audition.");
  if(voiceFile&&Number.isFinite(voiceFile.size)&&voiceFile.size>20*1024*1024)
    throw Error("Narration audition WAV must be 20 MB or smaller.");
  const context=createContext(),controller=new AbortController(),sources=[];
  let stopped=false;
  const stop=()=>{
    if(stopped)return;
    stopped=true;controller.abort();
    for(const source of sources)try{source.stop();}catch{/* source may have ended */}
    void context.close();
  };
  const ready=(async()=>{
    await context.resume();
    const unique=[...new Set(plan.cues.map(cue=>cue.url))];
    const buffers=new Map(await Promise.all(unique.map(async url=>{
      const response=await fetchImpl(url,{signal:controller.signal,cache:"no-store"});
      if(!response.ok)throw Error("An approved local sound is no longer available. Reopen the library and check its approval.");
      return [url,await context.decodeAudioData(await response.arrayBuffer())];
    })));
    // Local File.arrayBuffer() reads only; the optional narration is never uploaded.
    const voiceBuffer=voiceFile?await context.decodeAudioData(await voiceFile.arrayBuffer()):null;
    if(stopped)return;
    const base=context.currentTime+0.08;
    function schedule(buffer,{startMs,durationMs,gain,fadeInMs=0,fadeOutMs=0,loop=false}){
      if(!buffer||buffer.duration<=0)throw Error("A preview sound could not be decoded.");
      const source=context.createBufferSource();source.buffer=buffer;source.loop=loop;
      const volume=context.createGain(),start=base+startMs/1000;
      const seconds=Math.min(durationMs/1000,loop?durationMs/1000:buffer.duration);
      const end=start+seconds;
      let fadeIn=fadeInMs/1000,fadeOut=fadeOutMs/1000;
      if(fadeIn+fadeOut>seconds){const factor=seconds/(fadeIn+fadeOut);
        fadeIn*=factor;fadeOut*=factor;}
      volume.gain.setValueAtTime(fadeIn>0?0:gain,start);
      if(fadeIn>0)volume.gain.linearRampToValueAtTime(gain,start+fadeIn);
      if(fadeOut>0){volume.gain.setValueAtTime(gain,end-fadeOut);
        volume.gain.linearRampToValueAtTime(0,end);}
      source.connect(volume);volume.connect(context.destination);
      sources.push(source);source.start(start);source.stop(end);
    }
    for(const cue of plan.cues)schedule(buffers.get(cue.url),cue);
    if(voiceBuffer)schedule(voiceBuffer,{startMs:0,durationMs:plan.durationMs,gain:0.85,
      fadeInMs:0,fadeOutMs:0,loop:false});
  })().catch(error=>{stop();throw error;});
  return {ready,stop};
}
