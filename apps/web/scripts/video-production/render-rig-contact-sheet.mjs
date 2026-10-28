/** Offline visual QA: node --experimental-strip-types scripts/video-production/render-rig-contact-sheet.mjs /tmp/rigs.svg */
import { writeFile } from "node:fs/promises";
import { PIP_RIG, QUILL_RIG } from "../../src/video-export/pip-quill-rigs.ts";

const esc = (value) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
const drawShape = (shape, palette) => {
  const attrs = Object.entries(shape).filter(([key]) => key !== "type").map(([key, value]) => {
    const name = key === "strokeWidth" ? "stroke-width" : key;
    const color = typeof value === "string" && value.startsWith("$") ? palette[value.slice(1)] : value;
    return `${name}="${esc(color)}"`;
  }).join(" ");
  return `<${shape.type} ${attrs}/>`;
};
function character(definition, x) {
  const parts = [...definition.parts].sort((a,b)=>a.z-b.z);
  const painted = parts.map(part => {
    const asset = definition.assets[part.asset];
    return `<g>${asset.shapes.map(shape=>drawShape(shape,definition.palette)).join("")}</g>`;
  }).join("");
  return `<g transform="translate(${x} 88)">
    <rect width="400" height="500" rx="24" fill="#203744" stroke="#496A74" stroke-width="2"/>
    <g transform="translate(20 32)">${painted}</g>
    <text x="200" y="471" font-family="DejaVu Sans" text-anchor="middle" font-size="35" font-weight="700" fill="#F4EDE2">${definition.characterId.toUpperCase()}</text>
  </g>`;
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="880" height="620" viewBox="0 0 880 620">
  <rect width="880" height="620" fill="#101D2D"/>
  <text x="40" y="60" font-family="DejaVu Sans" font-size="24" fill="#EBC191">CONTENTGEN · ORIGINAL PIP AND QUILL VECTOR RIGS</text>
  ${character(PIP_RIG, 30)}${character(QUILL_RIG, 450)}
</svg>`;
if (!process.argv[2]) throw Error("Pass an exact SVG output path within an owned temporary directory");
await writeFile(process.argv[2], svg, { flag: "wx" });
