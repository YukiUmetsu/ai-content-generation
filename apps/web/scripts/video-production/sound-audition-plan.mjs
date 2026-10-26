/** Editor-only, not a production timecode or a substitute for measured narration.
 * Preview plans contain only reviewed local URLs, never filesystem paths.
 */
const HASH=/^[a-f\d]{64}$/iu;
const finite=(value,min,max)=>typeof value==="number"&&Number.isFinite(value)&&value>=min&&value<=max;

export function planSoundAudition({shotId,choice=null,layers=[],ambience=null,library=[],windowMs=12000}){
  if(!Number.isSafeInteger(windowMs)||windowMs<4000||windowMs>20000)
    throw Error("Sound audition window must be 4–20 seconds.");
  const cues=[],warnings=new Set();
  const bank=Array.isArray(library)?library:[];
  const approved=item=>{
    const match=bank.find(asset=>asset.assetId===item?.assetId&&asset.sha256===item?.sha256&&
      asset.license==="cc0"&&asset.rightsStatus==="user-reviewed"&&HASH.test(asset.sha256??"")&&
      finite(asset.durationSeconds,0.01,900));
    if(!match)warnings.add("An approved sound is no longer available for this audition. Review your sound library.");
    return match;
  };
  function add(item,kind,{startMs=0,gainDb=-24,fadeInMs=0,fadeOutMs=0,loop=false}={}){
    if(item.trigger==="first-visual-reveal"){
      warnings.add("Visual reveal cues need measured frame timing and are heard only in the final render.");
      return;
    }
    const match=approved(item);
    if(!match)return;
    if(!Number.isSafeInteger(startMs)||startMs<0||startMs>=windowMs){
      warnings.add("A sound starts outside the audition window; preview it in the final render.");return;
    }
    if(!finite(gainDb,-48,0)||!Number.isSafeInteger(fadeInMs)||!Number.isSafeInteger(fadeOutMs)||
      fadeInMs<0||fadeOutMs<0||fadeInMs>5000||fadeOutMs>5000){
      warnings.add("A sound has invalid mix settings; fix its saved level and fades.");return;
    }
    const durationMs=loop?windowMs:Math.min(windowMs-startMs,Math.round(match.durationSeconds*1000));
    if(durationMs<=0)return;
    cues.push({id:kind==="layer"?item.layerId:`${kind}-${item.assetId}`,
      kind,title:match.title,sha256:match.sha256,url:`/api/contentgen-sfx/preview/${match.sha256}`,
      startMs,durationMs,loop,
      gain:kind==="primary"?0.12:10**(gainDb/20),fadeInMs,fadeOutMs});
  }
  if(choice?.mode!=="mute"&&choice?.assetId)add(choice,"primary",{gainDb:0});
  for(const layer of Array.isArray(layers)?layers:[]){
    if(layer.shotId!==shotId)continue;
    add(layer,"layer",{startMs:layer.offsetMs,gainDb:layer.gainDb,
      fadeInMs:layer.fadeInMs,fadeOutMs:layer.fadeOutMs});
  }
  if(ambience)add(ambience,"ambience",{gainDb:ambience.gainDb,
    fadeInMs:ambience.fadeInMs,fadeOutMs:ambience.fadeOutMs,loop:true});
  return {durationMs:windowMs,cues,warnings:[...warnings]};
}
