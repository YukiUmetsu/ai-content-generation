/** Opt-in, per-inference diagnostics for rejected local model answers. */
import {AsyncLocalStorage} from "node:async_hooks";

const outputContext=new AsyncLocalStorage();
const MAX_OUTPUT_BYTES=16*1024;
const safeToken=(value,pattern,max=120)=>typeof value==="string"&&value.length<=max&&pattern.test(value)?value:"unknown";

function boundedModelText(raw){
  const bytes=Buffer.from(raw,"utf8");
  if(bytes.length<=MAX_OUTPUT_BYTES)return {output:raw,truncated:false};
  const decoder=new TextDecoder("utf-8",{fatal:true});
  let end=MAX_OUTPUT_BYTES;
  while(end>0){
    try{return {output:decoder.decode(bytes.subarray(0,end)),truncated:true};}
    catch{end--;}
  }
  return {output:"",truncated:true};
}

/** Capture only the assistant message, never the HTTP envelope or prompt. */
export function captureModelOutput(raw){
  const state=outputContext.getStore();
  if(state&&typeof raw==="string")state.answer=boundedModelText(raw);
}

/**
 * Every failed schema-validation attempt gets its own log entry. Prior entries
 * remain in the server console; the async context prevents cross-job mixing.
 */
export async function withModelDebugContext(meta,action,{enabled=process.env.CONTENTGEN_DEBUG_AI_OUTPUT==="1",
  log=console.warn}={}){
  if(!enabled)return action();
  const state={answer:null};
  return outputContext.run(state,async()=>{
    try{return await action();}
    catch(error){
      if(error?.code==="schema_invalid"&&state.answer){
        const payload={
          jobId:safeToken(meta?.jobId,/^job_[a-f0-9]{24}$/u,28),
          stage:safeToken(meta?.stage,/^[a-z0-9:_-]+$/iu,80),
          currentStep:safeToken(meta?.currentStep,/^[a-z0-9:_-]+$/iu,80),
          model:safeToken(meta?.model,/^[\p{L}\p{N}_.:() /-]+$/u,120),
          attempt:Number.isSafeInteger(meta?.attempt)&&meta.attempt>=1?meta.attempt:null,
          field:safeToken(error?.field,/^[a-z][a-z0-9.\[\]/-]+$/iu,90),
          ...state.answer,
        };
        // JSON-escaping controls prevents the model from injecting log lines.
        const encoded=JSON.stringify(payload).replace(/\u2028/gu,"\\u2028").replace(/\u2029/gu,"\\u2029");
        try{log("[contentgen-ai-schema-error]",encoded);}catch{/* Preserve the original schema error. */}
      }
      throw error;
    }finally{state.answer=null;}
  });
}
