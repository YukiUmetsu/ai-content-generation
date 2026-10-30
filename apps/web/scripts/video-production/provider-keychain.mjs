/** Resolve local production credentials only inside the Node worker.
 *  The Rust Settings API is intentionally write-only; do not add secret
 *  readback routes, persist keys to a project, or send them to the browser.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const providers = Object.freeze({
  fish: { account: "fish-audio-api", environment: "FISH_AUDIO_API_KEY" },
});

/** The macOS Keychain account names must match crates/server/src/credentials.rs. */
export async function productionProviderKey(provider,{env=process.env,platform=process.platform,read=exec}={}){
  const entry=providers[provider];
  if(!entry)throw Error("Unknown production credential provider.");
  if(platform==="darwin"){
    try{
      const result=await read("/usr/bin/security",["find-generic-password", "-s",
        "com.contentgen.local.credentials", "-a",entry.account,"-w"],
      {timeout:5000,maxBuffer:2048,windowsHide:true});
      const key=String(result.stdout??"").trim();
      if(key.length>=8&&key.length<=512&&!/[\r\n\0]/u.test(key))return key;
    }catch{
      // A missing/locked Keychain entry must not leak OS error output.
      // An explicitly configured environment variable remains usable.
    }
  }
  const fallback=env[entry.environment];
  return typeof fallback==="string"&&fallback.trim()===fallback&&fallback.length>=8&&
    fallback.length<=512&&!/[\r\n\0]/u.test(fallback)?fallback:"";
}
