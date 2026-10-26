/**
 * One-shot, localhost-only structured-output smoke test. This never starts
 * Vite, Docker, or any model; it only calls an already running local server.
 */
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { localChatEndpoint } from "./topic-generator.mjs";
import { resolveModelForTask } from "./model-profiles.mjs";

const MAX_REPLY_BYTES=128*1024;

export function summarizeProbe(envelope){
  const choice=envelope?.choices?.[0];
  const answer=choice?.message?.content;
  let validJson=false,validShape=false;
  if(typeof answer==="string"){
    try{
      const payload=JSON.parse(answer.trim().replace(/^```(?:json)?\s*\n/iu,"").replace(/\n\s*```$/u,""));
      validJson=payload!==null&&typeof payload==="object"&&!Array.isArray(payload);
      validShape=validJson&&typeof payload.subject==="string"&&
        Array.isArray(payload.parts)&&payload.parts.length===2&&
        payload.parts.every(part=>typeof part==="string")&&
        ["compare","split"].includes(payload.operator);
    }catch{/* An incomplete answer must not be logged. */}
  }
  const finiteCount=value=>Number.isSafeInteger(value)&&value>=0?value:null;
  const finishReason=choice?.finish_reason;
  return {
    finishReason:["stop","length","content_filter","tool_calls"].includes(finishReason)?finishReason:"unknown",
    promptTokens:finiteCount(envelope?.usage?.prompt_tokens),
    completionTokens:finiteCount(envelope?.usage?.completion_tokens),
    reasoningTokens:finiteCount(envelope?.usage?.completion_tokens_details?.reasoning_tokens),
    answerBytes:typeof answer==="string"?Buffer.byteLength(answer):0,
    validJson,validShape,
  };
}

export async function probeModel({endpoint,model,transport=fetch,maxTokens=768,mode="off",timeoutMs=240000}){
  const url=localChatEndpoint(endpoint);
  if(typeof model!=="string"||!model.trim()||model.length>120)throw Error("An installed local model ID is required.");
  if(!Number.isInteger(maxTokens)||maxTokens<128||maxTokens>16384)throw Error("maxTokens must be 128–16384.");
  if(!["off","baseline"].includes(mode))throw Error("Unknown probe mode.");
  const body={
    model,temperature:0.3,stream:false,max_tokens:maxTokens,response_format:{type:"json_object"},
    messages:[
      {role:"system",content:"Return one complete JSON object with exactly these fields: subject, parts (two short strings), operator (compare or split). No explanation."},
      {role:"user",content:"For a simple educational animation, choose visible objects explaining the cost of roof repair. Keep every value concise."},
    ],
    ...(mode==="off"?{chat_template_kwargs:{enable_thinking:false}}:{}),
  };
  const response=await transport(url,{method:"POST",redirect:"error",
    headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
    signal:AbortSignal.timeout(timeoutMs)});
  if(!response.ok)return {httpStatus:response.status,finishReason:"unknown",
    promptTokens:null,completionTokens:null,reasoningTokens:null,
    answerBytes:0,validJson:false,validShape:false};
  if(Number(response.headers?.get?.("content-length")??0)>MAX_REPLY_BYTES)
    throw Error("Local model provider returned an oversized response.");
  const content=await response.text();
  if(Buffer.byteLength(content)>MAX_REPLY_BYTES)throw Error("Local model provider returned an oversized response.");
  let envelope;
  try{envelope=JSON.parse(content);}catch{throw Error("Local model provider returned an invalid response envelope.");}
  return summarizeProbe(envelope);
}

function help(){
  return "Usage: node apps/web/scripts/video-production/local-model-probe.mjs [--model MODEL] [--endpoint URL] [--max-tokens N] [--mode off|baseline] [--timeout-seconds N]\n"+
    "Reads the Story model from ContentGen Settings by default. Sends only a synthetic example and prints metadata, never model text.";
}
export async function main(argv=process.argv.slice(2)){
  const {values}=parseArgs({args:argv,strict:true,options:{
    help:{type:"boolean"},model:{type:"string"},endpoint:{type:"string"},
    "max-tokens":{type:"string"},mode:{type:"string"},"timeout-seconds":{type:"string"},
  }});
  if(values.help){process.stdout.write(help()+"\n");return 0;}
  const configured=values.model&&values.endpoint?null:await resolveModelForTask("story");
  const endpoint=values.endpoint??configured?.endpoint;
  const model=values.model??configured?.model;
  const maxTokens=values["max-tokens"]?Number(values["max-tokens"]):768;
  const timeoutMs=values["timeout-seconds"]?Number(values["timeout-seconds"])*1000:240000;
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>900000)throw Error("timeout-seconds must be 1–900.");
  const result=await probeModel({endpoint,model,maxTokens,mode:values.mode??"off",timeoutMs});
  process.stdout.write(JSON.stringify({mode:values.mode??"off",model,...result})+"\n");
  return result.validShape?0:2;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().then(code=>{process.exitCode=code;}).catch(error=>{
    // Never print provider error response bodies, endpoint URLs, or model output.
    process.stderr.write("Local model probe failed: "+
      (/timeout|aborted/iu.test(String(error?.name??"")+" "+String(error?.message??""))?
        "request timed out.":"check the local model endpoint, model availability, and server compatibility.")+"\n");
    process.exitCode=2;
  });
}
