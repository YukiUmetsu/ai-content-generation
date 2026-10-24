/** Browser catalog deletion tombstones; replay locally when the Rust server returns. */
const KEY="contentgen.discovery.pending-deletes.v1";
const ID=/^[a-z0-9_-]{1,128}$/iu;

function readPending(storage:Storage):string[] {
  const value=storage.getItem(KEY);
  if(value===null)return [];
  const ids:unknown=JSON.parse(value);
  if(!Array.isArray(ids)||ids.length>1000||ids.some(id=>typeof id!=="string"||!ID.test(id)))
    throw Error("Project cleanup queue is invalid. No server data was deleted.");
  return [...new Set(ids)];
}
export function pendingProjectDeletions(storage:Storage):number {
  return readPending(storage).length;
}

export function enqueueProjectDeletion(storage:Storage,projectId:string):void {
  if(!ID.test(projectId))throw Error("Invalid project deletion target.");
  const pending=readPending(storage);
  if(!pending.includes(projectId)){
    if(pending.length>=1000)throw Error("Project cleanup queue is full.");
    storage.setItem(KEY,JSON.stringify([...pending,projectId]));
  }
}

/** Return completed deletes. Failure leaves the tombstone intact for the next sync. */
export async function flushProjectDeletions(storage:Storage,liveIds:ReadonlySet<string>,
  remove:(id:string)=>Promise<unknown>):Promise<number> {
  let completed=0;
  for(const projectId of readPending(storage)){
    if(liveIds.has(projectId)){
      storage.setItem(KEY,JSON.stringify(readPending(storage).filter(id=>id!==projectId)));
      continue;
    }
    try{await remove(projectId);}
    catch{break;}
    completed++;
    storage.setItem(KEY,JSON.stringify(readPending(storage).filter(id=>id!==projectId)));
  }
  return completed;
}
