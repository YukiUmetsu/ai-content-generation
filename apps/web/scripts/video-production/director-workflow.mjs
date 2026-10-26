/** A single, predictable path through the existing Video Director tools. */
export const directorStages=Object.freeze([
  {id:"storyboard",number:"01",label:"Storyboard",detail:"Shape the explanation"},
  {id:"assets",number:"02",label:"Visual assets",detail:"Source your visuals"},
  {id:"sound",number:"03",label:"Sound",detail:"Design the soundtrack"},
  {id:"preview",number:"04",label:"Preview & Export",detail:"Inspect and render"}
]);

function indexOfStage(stage){
  const index=directorStages.findIndex(item=>item.id===stage);
  if(index===-1)throw Error("Unknown Video Director stage.");
  return index;
}

export function nextDirectorStage(current){
  const i=indexOfStage(current);
  return directorStages[i+1]?.id??null;
}

export function shouldInvalidateDirectorReadiness(current,target){
  indexOfStage(current);indexOfStage(target);
  return current!==target&&target==="preview";
}

export function resolveDirectorNavigation({current,target,unsaved=false}){
  indexOfStage(current);indexOfStage(target);
  if(unsaved&&current!==target)return {
    stage:current,blocked:true,
    message:"Save or discard your scene edits before continuing. Your changes are still here."
  };
  return {stage:target,blocked:false,message:""};
}
