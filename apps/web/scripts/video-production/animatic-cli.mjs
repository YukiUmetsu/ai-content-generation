/** Produce an offline, editable-review-only HTML animatic from a preproduction bundle. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { compileAnimatic } from "./animatic.mjs";
import { renderAnimaticHtml } from "./animatic-player.mjs";

export function parseAnimaticArgs(argv) {
  const { values }=parseArgs({args:argv.filter(x=>x!=="--"),strict:true,allowPositionals:false,options:{
    help:{type:"boolean",default:false},bundle:{type:"string"},out:{type:"string"},
    "spoken-wpm":{type:"string",default:"145"},fps:{type:"string",default:"30"}
  }});
  if(values.help)return {help:true};
  if(!values.bundle||!values.out||!values.out.endsWith(".html"))
    throw Error("Usage: pnpm video:animatic --bundle PREPRODUCTION.json --out NEW-preview.html");
  const spokenWpm=Number(values["spoken-wpm"]),fps=Number(values.fps);
  if(!Number.isFinite(spokenWpm)||spokenWpm<95||spokenWpm>210||
    !Number.isInteger(fps)||fps<12||fps>60)
    throw Error("Narration estimate must be 95–210 WPM and FPS must be an integer 12–60.");
  if(resolve(values.bundle)===resolve(values.out))throw Error("Never overwrite the source preproduction bundle.");
  return {bundle:resolve(values.bundle),out:resolve(values.out),spokenWpm,fps};
}
export async function runAnimaticCli(argv,{log=console.log}={}) {
  const args=parseAnimaticArgs(argv);
  if(args.help) {log("Usage: pnpm video:animatic --bundle BUNDLE.json --out NEW-preview.html [--spoken-wpm 145] [--fps 30]");
    log("Creates a no-network browser animatic with estimates, progressive reveals and optional synthesized SFX. No speech or video is rendered.");return null;}
  const bundle=JSON.parse(await readFile(args.bundle,"utf8"));
  const animatic=compileAnimatic(bundle,{fps:args.fps,spokenWpm:args.spokenWpm});
  const html=renderAnimaticHtml(animatic);
  await writeFile(args.out,html,{flag:"wx",mode:0o600});
  log("Wrote offline visual animatic: "+args.out);
  log(animatic.shots.length+" teaching shots / "+(animatic.totalFrames/animatic.fps).toFixed(1)+" estimated seconds.");
  log("Open the HTML file in a browser. No narration audio, production SFX, verified facts or licensed visuals are implied.");
  return {out:args.out,animatic};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))
  runAnimaticCli(process.argv.slice(2)).catch(error=>{console.error(String(error?.message??error));process.exitCode=2;});
