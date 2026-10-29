/** Convert the user's registered-sprite Pip v1.6 ZIP to an inert Character Studio
 * ZIP that the existing Kumiki character presenter and raster preflight accept.
 *
 * Usage: node scripts/video-production/convert-legacy-pip-v16.mjs SOURCE.zip DEST.zip
 * The source artwork stays local. No JavaScript inside SOURCE.zip is executed.
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { readCharacterZip } from "./character-rig-render.mjs";

const exec = promisify(execFile);
const sourceRoot = "Pip_Animated_Rig/";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const finite = value => Number.isFinite(value) && value >= -3000 && value <= 3000;
const provenance = { source:"User-provided Pip Animated Rig v1.6, registered sprite artwork",
  license:"User-supplied original artwork; confirm publication rights before release" };
function expect(condition, message) { if (!condition) throw Error(`Pip v1.6 conversion: ${message}`); }

/** Pure mapping: all motion remains Kumiki actions and phases, never imported scripts. */
export function convertPipMetadata(rig, arms, assetMetadata) {
  expect(rig?.schemaVersion==="1.6-rebuild" && rig?.id==="pipkin_sprig" &&
    rig?.renderer==="registered-sprite-2d" && rig.stage?.width===1440 && rig.stage?.height===900,
  "this archive is not the supported Pip v1.6 registered-sprite layout");
  const required=["tail","leg_left","leg_right","torso","head","scarf","satchel"];
  for (const name of required) {
    const region=rig.regions?.[name];
    expect(region && Number.isInteger(region.width) && Number.isInteger(region.height) &&
      region.width>0 && region.height>0 && region.width<=1200 && region.height<=1200 &&
      Array.isArray(region.origin) && region.origin.length===2 && region.origin.every(finite),
    `invalid ${name} region metadata`);
  }
  const coordinates=["tail_base","hip_left","hip_right","shoulder_left","shoulder_right","torso_center","neck","satchel_mount"];
  for (const key of coordinates) expect(finite(rig.landmarks?.[key]?.x) && finite(rig.landmarks?.[key]?.y),
    `missing ${key} landmark`);
  for (const [name, data] of Object.entries(arms))
    expect(/^(relaxed|point|wave|open|ask)_(left|right)$/.test(name) &&
      /^arm_[a-z_]+\.png$/.test(data?.file) && Number.isInteger(data.width) &&
      Number.isInteger(data.height) && data.width>0 && data.width<400 && data.height>0 &&
      data.height<400 && Array.isArray(data.origin) && data.origin.length===2 && data.origin.every(finite),
    `invalid ${name} arm registration`);
  for (const name of ["relaxed_left","relaxed_right","ask_right","point_left","point_right","wave_right"])
    expect(arms[name],`missing ${name} pose-specific forepaw artwork`);
  const regions=rig.regions, lm=rig.landmarks, shift={x:340,y:180};
  const part=(id,asset,pivot,rest,z,parent="root",channel="body",variants)=>({
    id,channel,asset,pivot:{x:pivot[0],y:pivot[1]},rest,z,parent,
    ...(variants?{variants}:{}) });
  const location=(key,origin,yOffset=0)=>({x:lm[key].x-origin[0]-shift.x,
    y:lm[key].y+yOffset-origin[1]-shift.y});
  const armVariants=(side)=>Object.fromEntries(Object.entries(arms)
    .filter(([name])=>name.endsWith(`_${side}`))
    .map(([name])=>[name,`arm_${name}`]));
  const parts=[
    {id:"root",channel:"body",asset:"mouth0",pivot:{x:560,y:520},z:-50},
    part("tail","tail",regions.tail.origin,location("tail_base",regions.tail.origin),-8),
    part("leg_left","leg_left",regions.leg_left.origin,location("hip_left",regions.leg_left.origin),-7),
    part("leg_right","leg_right",regions.leg_right.origin,location("hip_right",regions.leg_right.origin),-6),
    part("arm_left","arm_relaxed_left",[310,310],location("shoulder_left",[310,310]),-5,"root","body",armVariants("left")),
    part("arm_right","arm_relaxed_right",[310,310],location("shoulder_right",[310,310]),-4,"root","body",armVariants("right")),
    part("torso","torso",regions.torso.origin,location("torso_center",regions.torso.origin),-3),
    part("satchel","satchel",regions.satchel.origin,location("satchel_mount",regions.satchel.origin),-2),
    part("head","head",regions.head.origin,location("neck",regions.head.origin),2),
    part("mouth","mouth0",regions.head.origin,{x:0,y:0},3,"head","mouth",
      Object.fromEntries([...Array.from({length:7},(_,i)=>[`stage${i}`,`mouth${i}`]),
        ...Array.from({length:6},(_,i)=>Array.from({length:3},(_,j)=>[
          `between_${i}_${i+1}_${j+1}`,`mouth_between_${i}_${i+1}_${j+1}`])).flat()])),
    part("scarf","scarf",regions.scarf.origin,location("neck",regions.scarf.origin,60),4)
  ];
  const pose=(name,frames,pose,variants)=>({name,frames,pose,...(variants?{variants}:{})});
  const armsRest={arm_left:{rotation:0},arm_right:{rotation:0}};
  const action=phases=>({channel:"body",blend:"override",priority:2,takeover:"cut",phases});
  const settle=frames=>pose("recover",frames,{});
  const point=side=>action([
    pose("prepare",10,{[`arm_${side}`]:{rotation:side==="left"?-65:65}},
      {[`arm_${side}`]:`point_${side}`}),
    pose("act",55,{[`arm_${side}`]:{rotation:side==="left"?-4:4},head:{rotation:side==="left"?-2:2}},
      {[`arm_${side}`]:`point_${side}`}),settle(12)]);
  const gait=[];
  for(let i=0;i<8;i++) {
    const left=i%2===0,offset=i*5;
    gait.push(pose("act",15,{root:{y:-55+offset,scaleX:.94+offset/900,scaleY:.94+offset/900},
      leg_left:{y:left?-22:5,rotation:left?-6:3},leg_right:{y:left?5:-22,rotation:left?-3:6},
      arm_left:{rotation:left?-5:5},arm_right:{rotation:left?5:-5},head:{rotation:left?1:-1}}));
  }
  const assets={};
  for(const [name,item] of Object.entries(assetMetadata))assets[name]={kind:"image",
    uri:`layers/${name}.png`,mediaType:"image/png",width:item.width,height:item.height,
    sha256:item.sha256,provenance};
  for(const part of parts) {
    expect(assets[part.asset],`missing ${part.asset} artwork`);
    for(const key of Object.values(part.variants??{}))expect(assets[key],`missing ${key} variant`);
  }
  return {schemaVersion:1,characterId:"pip",revision:"pip-animated-rig-v1.6-imported",
    mode:"puppet-2.5d",design:{width:1020,height:750},channels:["body","mouth"],
    palette:{},assets,parts,poses:{neutral:{tail:{rotation:-7}}},basePose:"neutral",
    actions:{
      "pip-explain":action([pose("prepare",7,{arm_right:{rotation:-10}}),
        pose("act",15,{arm_right:{rotation:-18},arm_left:{rotation:6},head:{rotation:2}}),settle(10)]),
      "ask_question":action([pose("prepare",12,{arm_right:{rotation:44}},{arm_right:"ask_right"}),
        pose("act",54,{arm_right:{rotation:3},head:{rotation:3}},{arm_right:"ask_right"}),settle(14)]),
      "point_left":point("left"),"point_right":point("right"),
      "wave":action([pose("prepare",12,{arm_right:{rotation:48}},{arm_right:"wave_right"}),
        pose("act",14,{arm_right:{rotation:7}},{arm_right:"wave_right"}),
        pose("act",14,{arm_right:{rotation:18}},{arm_right:"wave_right"}),
        pose("act",14,{arm_right:{rotation:5}},{arm_right:"wave_right"}),settle(12)]),
      "walk":action([pose("prepare",6,{root:{y:-55,scaleX:.94,scaleY:.94}}),...gait,settle(8)])
    },
    expressions:{default:"calm",sets:{calm:{},curious:{pose:{head:{rotation:4}}}}},
    speech:{mouthPart:"mouth",rest:"stage0",visemes:{A:"stage3",O:"stage5",M:"stage0"},
      approximateCycle:["stage0","between_0_1_2","stage2","between_2_3_2",
        "stage4","between_4_5_2","stage6","between_5_6_2","stage4",
        "between_2_3_3","stage2","between_0_1_3","stage0"],
      approximateStepFrames:2,transitionFrames:1},
    idle:{parts:{head:{property:"rotation",amplitude:1.3,periodFrames:93},
      tail:{property:"rotation",amplitude:3.2,periodFrames:139},
      torso:{property:"scaleY",amplitude:.004,periodFrames:86}}},
    capabilities:["approximate-speech","arm-gesture","idle","expression","walking"]};
}

export async function convertLegacyPipZip(input,output){
  const source=resolve(input),destination=resolve(output);
  const size=(await stat(source)).size;
  expect(size>200&&size<=64*1024*1024,"the source archive is empty or exceeds 64 MiB");
  expect(source!==destination,"output must differ from the original archive");
  const root=await mkdtemp(join(tmpdir(),"contentgen-pip-convert-"));
  try{
    const extract=async file=>{
      expect(/^[A-Za-z0-9_/.-]+$/.test(file)&&!file.includes(".."),"unsafe source path");
      const {stdout}=await exec("unzip",["-p",source,sourceRoot+file],
        {encoding:"buffer",maxBuffer:4*1024*1024,timeout:15000});
      return Buffer.from(stdout);
    };
    const rig=JSON.parse((await extract("rig.json")).toString("utf8"));
    const arms=JSON.parse((await extract("assets/pip/arm_registration.json")).toString("utf8"));
    // Reject malicious or accidental extra arm mappings before constructing any command.
    for(const [name,data] of Object.entries(arms))expect(/^(relaxed|point|wave|open|ask)_(left|right)$/.test(name)&&
      /^arm_[a-z_]+\.png$/.test(data.file),"unsupported arm mapping");
    const imageSpecs=[
      ...["tail","leg_left","leg_right","torso","head","satchel","scarf"].map(name=>({
        name,source:rig.art[name],width:rig.regions[name]?.width,height:rig.regions[name]?.height})),
      ...Array.from({length:7},(_,i)=>({name:`mouth${i}`,source:`assets/pip/mouth_stage_${i}.png`,
        width:rig.regions.head?.width,height:rig.regions.head?.height})),
      ...Array.from({length:6},(_,i)=>Array.from({length:3},(_,j)=>({
        name:`mouth_between_${i}_${i+1}_${j+1}`,
        source:`assets/pip/mouth_inbetween_${i}_${i+1}_${j+1}.png`,
        width:rig.regions.head?.width,height:rig.regions.head?.height}))).flat(),
      ...Object.entries(arms).map(([name,data])=>({name:`arm_${name}`,source:`assets/pip/${data.file}`,
        width:620,height:620,registration:data}))
    ];
    // Catch malformed landmarks and registrations before inflating image contents.
    convertPipMetadata(rig,arms,Object.fromEntries(imageSpecs.map(spec=>[spec.name,{width:spec.width,height:spec.height,sha256:"0".repeat(64)}])));
    await mkdir(join(root,"layers"));
    const metadata={},paths=[];
    for(const spec of imageSpecs){
      expect(/^assets\/pip\/[a-z0-9_]+\.png$/.test(spec.source),"unsupported source art path");
      const raw=await extract(spec.source),original=join(root,`${spec.name}-original.png`);
      expect(raw.length<4*1024*1024 && raw.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
        `invalid ${spec.name} image signature`);
      await writeFile(original,raw,{flag:"wx"});
      const target=`layers/${spec.name}.png`,png=join(root,target);
      let filter=`scale=${spec.width}:${spec.height}:flags=lanczos,format=rgba`;
      if(spec.registration){
        const [ox,oy]=spec.registration.origin;
        filter=`format=rgba,pad=620:620:${Math.round(310-ox)}:${Math.round(310-oy)}:color=black@0`;
      }
      await exec("ffmpeg",["-hide_banner","-loglevel","error","-nostdin","-y", "-i",original,
        "-vf",filter,"-frames:v","1","-pix_fmt","rgba",png],{timeout:30000});
      const bytes=await readFile(png);
      metadata[spec.name]={width:spec.width,height:spec.height,sha256:hash(bytes)};
      paths.push(target);
    }
    const definition=convertPipMetadata(rig,arms,metadata);
    await writeFile(join(root,"character.json"),JSON.stringify(definition,null,2)+"\n",{flag:"wx"});
    const archive=join(root,"character-studio.zip");
    await exec("zip",["-q","-X","-0",archive,"character.json",...paths],{cwd:root,timeout:30000});
    const bytes=await readFile(archive);
    expect(bytes.length<=16*1024*1024,"converted art exceeds Character Studio's 16 MiB limit");
    const verified=readCharacterZip(bytes);
    expect(verified.definition.revision===definition.revision&&verified.entries.size===paths.length+1,
      "converted ZIP does not match its render manifest");
    // Never overwrite an existing user's revision or their source ZIP.
    await writeFile(destination,bytes,{flag:"wx",mode:0o600});
    return {path:destination,bytes:bytes.length,sha256:hash(bytes),definition};
  }finally{await rm(root,{recursive:true,force:true});}
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname)){
  if(process.argv.length!==4)throw Error("Usage: node convert-legacy-pip-v16.mjs SOURCE.zip DEST.zip");
  const result=await convertLegacyPipZip(process.argv[2],process.argv[3]);
  process.stdout.write(JSON.stringify({path:result.path,bytes:result.bytes,sha256:result.sha256})+"\n");
}
