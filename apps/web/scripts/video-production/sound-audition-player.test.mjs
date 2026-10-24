import test from "node:test";
import assert from "node:assert/strict";
import {createSoundAuditionPlayer} from "./sound-audition-player.mjs";

const SHA="a".repeat(64),URL=`/api/contentgen-sfx/preview/${SHA}`;
function setup(){
  const sources=[],volumes=[];let closed=0;
  const ctx={currentTime:3,destination:{},resume:async()=>{},close:async()=>{closed++;},
    decodeAudioData:async()=>({duration:2}),
    createBufferSource:()=>{const source={loop:false,connect(){},start(t){this.at=t;},stop(t){this.until=t;}};
      sources.push(source);return source;},
    createGain:()=>{const events=[],gain={setValueAtTime:(v,t)=>events.push(["set",v,t]),
      linearRampToValueAtTime:(v,t)=>events.push(["ramp",v,t])};
      const node={gain,connect(){}};volumes.push(events);return node;}
  };
  return {ctx,sources,volumes,closed:()=>closed};
}
const clip={id:"layer1",kind:"layer",title:"Whoosh",url:URL,sha256:SHA,startMs:250,durationMs:750,
  gain:0.1,fadeInMs:100,fadeOutMs:200,loop:false};

test("browser audition decodes only trusted local preview and schedules clip envelopes independently",async()=>{
  const state=setup(),calls=[];
  const preview=createSoundAuditionPlayer({durationMs:4000,cues:[clip]},
    {createContext:()=>state.ctx,fetchImpl:async (url)=>{calls.push(url);return {ok:true,arrayBuffer:async()=>new ArrayBuffer(16)};}});
  await preview.ready;
  assert.deepEqual(calls,[URL]);
  assert.equal(state.sources[0].loop,false);
  assert.equal(state.sources[0].at,3.33);
  assert.equal(state.sources[0].until,4.08);
  assert.deepEqual(state.volumes[0].map(x=>x[0]),["set","ramp","set","ramp"]);
  assert.equal(state.volumes[0].at(-1)[1],0);
  preview.stop();assert.equal(state.closed(),1);
});

test("audition loops ambience, mixes optional in-memory voice and reuses identical WAV fetches",async()=>{
  const state=setup();let fetched=0,voiceReads=0;
  const preview=createSoundAuditionPlayer({durationMs:5000,cues:[clip,{...clip,id:"amb",kind:"ambience",
    startMs:0,loop:true,durationMs:5000}]},{createContext:()=>state.ctx,
    fetchImpl:async()=>{fetched++;return {ok:true,arrayBuffer:async()=>new ArrayBuffer(2)};},
    voiceFile:{arrayBuffer:async()=>{voiceReads++;return new ArrayBuffer(2);}}});
  await preview.ready;
  assert.equal(fetched,1,"duplicate approved asset is fetched once");
  assert.equal(voiceReads,1,"narration stays in memory and is never fetched or uploaded");
  assert.equal(state.sources.length,3);
  assert.equal(state.sources[1].loop,true);
  preview.stop();
});

test("audition refuses external URLs and stops a pending session before any audio starts",async()=>{
  const state=setup();let finish;
  const deferred=new Promise(resolve=>{finish=resolve;});
  assert.throws(()=>createSoundAuditionPlayer({durationMs:5000,cues:[{...clip,url:"https://bad.example/track.wav"}]},
    {createContext:()=>state.ctx}),/local approved/i);
  const pending=createSoundAuditionPlayer({durationMs:5000,cues:[clip]},
    {createContext:()=>state.ctx,fetchImpl:()=>deferred});
  pending.stop();
  finish({ok:true,arrayBuffer:async()=>new ArrayBuffer(2)});
  await pending.ready;
  assert.equal(state.sources.length,0);
  assert.equal(state.closed(),1);
});

test("audition rejects changed or missing local WAV without scheduling playback",async()=>{
  const state=setup();
  const p=createSoundAuditionPlayer({durationMs:5000,cues:[clip]},
    {createContext:()=>state.ctx,fetchImpl:async()=>({ok:false,status:404})});
  await assert.rejects(p.ready,/no longer available/i);
  assert.equal(state.sources.length,0);
  p.stop();
});

test("short previews scale overlapping fades proportionally like the export mixer",async()=>{
  const state=setup();
  const p=createSoundAuditionPlayer({durationMs:4000,cues:[{...clip,fadeInMs:1000,fadeOutMs:2000}]},
    {createContext:()=>state.ctx,fetchImpl:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(2)})});
  await p.ready;
  const ramps=state.volumes[0].filter(x=>x[0]==="ramp");
  assert.ok(Math.abs(ramps[0][2]-3.58)<1e-7,"fade-in is 1/3 of 750 ms clip");
  assert.ok(Math.abs(state.volumes[0][2][2]-3.58)<1e-7,"fade-out begins at the scaled overlap point");
  p.stop();
});
