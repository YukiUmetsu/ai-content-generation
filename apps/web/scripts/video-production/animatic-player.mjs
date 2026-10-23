/** One-file, standalone offline rough-cut preview. No CDN, assets, or network requests. */
import { readFileSync } from "node:fs";
import { sampleAnimatic } from "./animatic.mjs";
const template = readFileSync(new URL("./animatic-template.html", import.meta.url), "utf8");
export function renderAnimaticHtml(animatic) {
  if(animatic?.kind!=="progressive-teaching-animatic" ||
    !Number.isSafeInteger(animatic.totalFrames) || animatic.totalFrames<1)
    throw Error("Compile a valid animatic before generating a preview.");
  sampleAnimatic(animatic,0);
  sampleAnimatic(animatic,animatic.totalFrames-1);
  const data=JSON.stringify(animatic);
  if(Buffer.byteLength(data)>512*1024)throw Error("Animatic preview exceeds 512 KiB.");
  // No raw HTML/script delimiters in the JSON-bearing script tag.
  const escaped=data.replace(/&/gu,"\\u0026").replace(/</gu,"\\u003c")
    .replace(/>/gu,"\\u003e").replace(/\u2028/gu,"\\u2028").replace(/\u2029/gu,"\\u2029");
  if(!template.includes("__CONTENTGEN_ANIMATIC_DATA__"))throw Error("Player template is missing its data slot.");
  return template.replace("__CONTENTGEN_ANIMATIC_DATA__",escaped);
}
