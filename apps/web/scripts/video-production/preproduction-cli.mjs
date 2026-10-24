/** Create an inspectable preproduction bundle without TTS, rendering or publishing. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { generatePreproductionPlan } from "./preproduction-generator.mjs";
import { compilePreproductionBundle, parseResearchDossier } from "./preproduction.mjs";
import { resolveModelForTaskSync } from "./model-profiles.mjs";

export function parsePreproductionArgs(argv) {
  const {values}=parseArgs({args:argv,strict:true,allowPositionals:false,options:{
    help:{type:"boolean",default:false},research:{type:"string"},plan:{type:"string"},
    model:{type:"string"},endpoint:{type:"string"},
    out:{type:"string"}, "require-ready":{type:"boolean",default:false}
  }});
  if(values.help)return {help:true};
  if(!values.research||!values.out||!values.out.endsWith(".json"))throw Error("Specify --research and a new --out *.json path.");
  const saved = resolveModelForTaskSync("story");
  if (values.plan && values.model) throw Error("Choose only one of --plan or --model.");
  const model = values.plan ? undefined : (values.model || saved?.model);
  if(Boolean(values.plan)===Boolean(model))throw Error("Specify --plan existing-plan.json or choose a local model in Studio Settings / --model.");
  return {research:resolve(values.research),plan:values.plan?resolve(values.plan):null,model,
    endpoint:values.endpoint ?? saved.endpoint,
    out:resolve(values.out),requireReady:values["require-ready"]};
}
export async function runPreproductionCli(argv,{generate=generatePreproductionPlan,log=console.log}={}){
  const a=parsePreproductionArgs(argv);
  if(a.help){log("Usage: pnpm video:plan --research dossier.json --plan plan.json --out NEW-bundle.json [--require-ready]");
    log("Or opt into a local model: pnpm video:plan --research dossier.json --model INSTALLED_MODEL --out NEW-bundle.json [--endpoint http://127.0.0.1:11434/v1/chat/completions]");
    log("No web research, external text service, TTS, paid model, rendering or publication is invoked.");return null;}
  const dossier=JSON.parse(await readFile(a.research,"utf8"));
  const checked=parseResearchDossier(dossier);
  if(!checked.ok)throw Error("Research dossier rejected: "+checked.findings.map(f=>f.code).join(", "));
  const plan=a.plan?JSON.parse(await readFile(a.plan,"utf8")):await generate(dossier,{model:a.model,endpoint:a.endpoint});
  const bundle=compilePreproductionBundle(dossier,plan);
  if(a.requireReady&&!bundle.assessment.ready)throw Error("Preproduction not ready: "+bundle.assessment.findings.filter(f=>f.severity==="error").map(f=>f.code).join(", "));
  await writeFile(a.out,JSON.stringify(bundle,null,2)+"\n",{flag:"wx",mode:0o600});
  log("Wrote "+a.out+" ("+bundle.status+").");
  log("Research, rights, rendering and publishing are not independently approved by this tool.");
  return bundle;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))
  runPreproductionCli(process.argv.slice(2)).catch(e=>{console.error(String(e.message||e));process.exitCode=2;});
