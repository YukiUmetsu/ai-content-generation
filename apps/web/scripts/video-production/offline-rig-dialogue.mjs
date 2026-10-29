/** Offline speech fixture for real Kumiki/FFmpeg export QA; never a publishing voice.
 * Converts *measured* audio sample boundaries into Kumiki absolute frame cues.
 * The generated voices are test-only Flite assets, not provider voice permission.
 */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const exec=promisify(execFile);
const sampleRate=48000;
const fail=message=>{throw Error(`Offline rig dialogue QA: ${message}`);};
const idPattern=/^[A-Za-z][A-Za-z0-9_-]{0,80}$/;
const speechText=/^[A-Za-z0-9 .!?-]{1,160}$/;
const approvedVoices=new Set(["kal","slt","awb","rms","kal16"]);

async function samplesInWav(path){
  const {stdout}=await exec("ffprobe",["-v","error","-select_streams","a:0",
    "-show_entries","stream=sample_rate,time_base,duration_ts","-of","json",path],{timeout:15000});
  const s=JSON.parse(stdout).streams?.[0];
  if(s?.sample_rate!==String(sampleRate)||s.time_base!==`1/${sampleRate}`||
    !Number.isSafeInteger(Number(s.duration_ts))||Number(s.duration_ts)<1)
    fail("a generated WAV did not contain a measured 48-kHz audio stream");
  return Number(s.duration_ts);
}

export async function makeOfflineRigDialogue({outDir,turns,fps}){
  if(!outDir||!Array.isArray(turns)||turns.length<1||turns.length>6||
    !Number.isSafeInteger(fps?.num)||fps.num<1||fps.num>120||
    !Number.isSafeInteger(fps?.den)||fps.den<1||fps.den>1001)
    fail("choose one to six dialogue turns and a rational frame rate");
  for(const turn of turns)if(!idPattern.test(turn?.id??"")||
    !["pip","quill","narrator"].includes(turn?.speakerId)||
    !speechText.test(turn?.text??"")||!approvedVoices.has(turn?.voice))
    fail("each test turn needs a valid role, safe spoken text and installed Flite voice");
  await mkdir(outDir,{recursive:true,mode:0o700});
  const runId=randomUUID(),inputs=[],windows=[];
  let samples=0;
  for(const [index,turn] of turns.entries()){
    const wavPath=join(outDir,`${runId}-turn-${index}.wav`);
    // The sanitized text contains no FFmpeg filter-graph delimiters such as
    // commas, semicolons, colons or backslashes; execFile never starts a shell.
    await exec("ffmpeg",["-hide_banner","-loglevel","error","-nostdin","-y",
      "-f","lavfi","-i",`flite=text=${turn.text}:voice=${turn.voice}`,
      "-ar",String(sampleRate),"-ac","1","-c:a","pcm_s16le",wavPath],{timeout:30000});
    const duration=await samplesInWav(wavPath);
    windows.push({id:turn.id,speakerId:turn.speakerId,startSample:samples,
      endSample:samples+duration,startFrame:Math.round(samples*fps.num/(fps.den*sampleRate)),
      endFrame:Math.round((samples+duration)*fps.num/(fps.den*sampleRate))});
    samples+=duration;
    inputs.push(wavPath);
  }
  const wavPath=join(outDir,`${runId}-spoken-dialogue.wav`);
  const joined=inputs.map((_,index)=>`[${index}:a]`).join("")+
    `concat=n=${inputs.length}:v=0:a=1[a]`;
  await exec("ffmpeg",["-hide_banner","-loglevel","error","-nostdin","-y",
    ...inputs.flatMap(input=>["-i",input]),"-filter_complex",joined,
    "-map","[a]","-ar",String(sampleRate),"-ac","1","-c:a","pcm_s16le",wavPath],{timeout:45000});
  const measured=await samplesInWav(wavPath);
  if(Math.abs(measured-samples)>1)fail("joined dialogue changed the spoken sample boundaries");
  return {wavPath,turns:windows,samples:measured,sampleRate};
}
