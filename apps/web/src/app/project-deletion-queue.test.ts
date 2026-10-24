import {describe,expect,it,vi} from "vitest";
import {enqueueProjectDeletion,flushProjectDeletions} from "./project-deletion-queue";

function mockStorage():Storage {
  const entries=new Map<string,string>();
  return {
    get length(){return entries.size;},clear(){entries.clear();},
    getItem(key){return entries.get(key)??null;},key(index){return [...entries.keys()][index]??null;},
    removeItem(key){entries.delete(key);},setItem(key,value){entries.set(key,String(value));},
  };
}

describe("local project deletion cleanup",()=>{
  it("deduplicates deleted IDs and retries after an unavailable server",async()=>{
    const store=mockStorage();
    enqueueProjectDeletion(store,"project-deleted");
    enqueueProjectDeletion(store,"project-deleted");
    const fail=vi.fn().mockRejectedValue(new Error("offline"));
    expect(await flushProjectDeletions(store,new Set(["project-current"]),fail)).toBe(0);
    expect(fail).toHaveBeenCalledTimes(1);
    const deleted=vi.fn().mockResolvedValue(undefined);
    expect(await flushProjectDeletions(store,new Set(["project-current"]),deleted)).toBe(1);
    expect(deleted).toHaveBeenCalledOnce();
    expect(await flushProjectDeletions(store,new Set(),deleted)).toBe(0);
  });

  it("never deletes a project which has been restored locally",async()=>{
    const store=mockStorage(),deleted=vi.fn();
    enqueueProjectDeletion(store,"project-restored");
    expect(await flushProjectDeletions(store,new Set(["project-restored"]),deleted)).toBe(0);
    expect(deleted).not.toHaveBeenCalled();
    expect(await flushProjectDeletions(store,new Set(),deleted)).toBe(0);
  });
});
