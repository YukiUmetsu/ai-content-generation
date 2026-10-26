/** Serialize actual heavyweight local-model operations, not caller lifetimes.
 * Aborting a queued waiter removes it; aborting an active caller cannot unlock the
 * model slot until the provider's in-flight operation has really settled.
 */
export function createLocalInferenceGate(){
const pending=[];
let running=false;

function pump(){
  if(running)return;
  const task=pending.shift();
  if(!task)return;
  if(task.signal?.aborted){task.abort();pump();return;}
  running=true;
  task.started=true;
  Promise.resolve().then(()=>{
    if(task.signal?.aborted)throw task.signal.reason??Error("Local AI task cancelled.");
    return task.action();
  }).then(value=>task.fulfill(value),error=>task.fail(error)).finally(()=>{
    task.cleanup();
    running=false;
    pump();
  });
}

return function withLocalInference(action,signal){
  if(signal?.aborted)return Promise.reject(signal.reason??Error("Local AI task cancelled."));
  return new Promise((resolve,reject)=>{
    const task={action,signal,started:false,settled:false,
      cleanup:()=>signal?.removeEventListener("abort",task.abort),
      fulfill(value){if(!this.settled){this.settled=true;resolve(value);}},
      fail(error){if(!this.settled){this.settled=true;reject(error);}},
      abort(){
        task.fail(signal?.reason??Error("Local AI task cancelled."));
        if(!task.started){
          const index=pending.indexOf(task);
          if(index>=0)pending.splice(index,1);
          task.cleanup();
        }
      }};
    signal?.addEventListener("abort",task.abort,{once:true});
    pending.push(task);
    pump();
  });
};
}

/** All production Research/Discovery/keyword tasks share one heavyweight slot. */
export const withLocalInference=createLocalInferenceGate();

/** Fetch resolves when headers arrive, which can precede heavyweight model
 * generation. Keep the shared slot until the successful response body is read.
 */
export function withLocalInferenceResponse(action,signal){
  return withLocalInference(async()=>{
    const response=await action();
    return {response,raw:response.ok?await response.text():null};
  },signal);
}
