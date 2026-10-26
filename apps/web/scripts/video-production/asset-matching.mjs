/** Pure metadata ranking. It cannot inspect imagery or prove what a clip depicts. */
const STOP=new Set(["the","for","and","are","you","with","from","this","that","into","how","why",
  "cost","costs","video","footage","pexels","photo","stock","clip","image","show","shows","actual",
  "scene","visual","explaining","explain","after","before","over","than","then","their","there"]);
const clean=value=>String(value??"").replace(/<[^>]*>/gu," ").replace(/[\u0000-\u001f\u007f]/gu," ").trim().slice(0,900);
const tokens=value=>[...new Set(clean(value).toLowerCase().split(/[^\p{L}\p{N}]+/u)
  .filter(x=>x.length>=3&&!STOP.has(x)))].slice(0,100);
const isPositive=value=>typeof value==="number"&&Number.isFinite(value)&&value>0;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
function sourceWords(value){
  try{
    const uri=new URL(value);
    if(uri.protocol!=="https:")return "";
    return decodeURIComponent(uri.pathname.split("/").filter(Boolean).at(-1)??"")
      .replace(/-\d+$/u,"").replace(/[-_]/gu," ").slice(0,160);
  }catch{return "";}
}
function shotDuration(narration,explicit){
  if(isPositive(explicit)&&explicit<=600)return {seconds:Math.round(explicit*10)/10,source:"measured"};
  const text=clean(narration?.narration);
  const latin=(text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/gu)??[]).length;
  const japanese=(text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)??[]).length;
  const pause=isPositive(narration?.pauseAfterMs)?Math.min(3000,narration.pauseAfterMs)/1000:0;
  return {seconds:clamp(Math.round(latin/2.5+japanese/5.5+pause),3,120),source:"estimated"};
}

/** Rank providers' untrusted descriptive metadata; never auto-approve or auto-bind. */
export function rankShotCandidates({shot,narration,query="",candidates=[],destination="landscape",durationSeconds}={}){
  if(!["landscape","portrait"].includes(destination))throw Error("Unknown asset matching destination.");
  const desired=destination==="portrait"?9/16:16/9;
  const labels=(Array.isArray(shot?.visualElements)?shot.visualElements:[])
    .slice(0,5).map(x=>x?.label).filter(x=>typeof x==="string");
  const subjects=tokens(labels.join(" ")||query||shot?.visualChange);
  const remaining=tokens(clean(narration?.narration)+" "+clean(shot?.visualChange))
    .filter(x=>!subjects.includes(x));
  const timing=shotDuration(narration,durationSeconds);
  const ranked=(Array.isArray(candidates)?candidates:[]).slice(0,20).map(asset=>{
    const keywordText=(Array.isArray(asset?.keywords)?asset.keywords:[]).slice(0,12)
      .filter(x=>typeof x==="string").map(x=>clean(x).slice(0,80)).join(" ");
    const names=new Set(tokens(clean(asset?.title)+" "+sourceWords(asset?.sourceUrl)+" "+keywordText));
    const matched=subjects.filter(x=>names.has(x));
    const contextual=remaining.filter(x=>names.has(x));
    const semantic=Math.min(matched.length,2)*40+Math.min(contextual.length,3)*6;
    const reasons=[];
    if(matched.length)reasons.push("Matches visible subject: "+matched.slice(0,3).join(", "));
    else if(contextual.length)reasons.push("Narration-related metadata; visible subject needs review");
    else reasons.push("No clear subject match in provider metadata; inspect the preview");

    let framing=0;
    if(["photo","video"].includes(asset.assetType)){
      if(!isPositive(asset.width)||!isPositive(asset.height)){
        framing=-8;reasons.push("Framing unknown: provider dimensions missing");
      }else{
        const deviation=Math.abs(Math.log((asset.width/asset.height)/desired));
        framing=deviation<=0.1?0:deviation<=0.32?-8:deviation<=0.7?-18:-30;
        reasons.push(framing===0?`Fits ${destination==="portrait"?"9:16":"16:9"} framing`:
          framing===-30?"Heavy crop needed for this output aspect":"Some cropping may be needed");
      }
    }

    let duration=0;
    if(asset.assetType==="video"){
      if(!isPositive(asset.durationSeconds)){
        duration=-8;reasons.push("Clip duration missing: review timing");
      }else if(asset.durationSeconds<timing.seconds*0.6){
        duration=-26;reasons.push(`Clip is much shorter than the ${timing.source} ${timing.seconds}s shot`);
      }else if(asset.durationSeconds<timing.seconds*0.9){
        duration=-14;reasons.push(`Clip is shorter than the ${timing.source} ${timing.seconds}s shot`);
      }else reasons.push("Clip can cover the planned shot; trim at render time");
    }
    const score=clamp(semantic+framing+duration+(asset.assetType==="video"?3:0),0,100);
    const grade=!matched.length?(contextual.length?"review":"weak"):
      score>=30&&framing>-30&&duration>-26?"strong":"review";
    return {...asset,match:{score,grade,breakdown:{semantic,framing,duration},reasons}};
  }).sort((a,b)=>b.match.score-a.match.score||
    `${a.provider}:${a.assetType}:${a.assetId}`.localeCompare(`${b.provider}:${b.assetType}:${b.assetId}`));
  const best=ranked[0];
  return {shotDuration:timing,candidates:ranked,
    recommendedAssetKey:best?.match.grade==="strong"?`${best.provider}:${best.assetType}:${best.assetId}`:null};
}
