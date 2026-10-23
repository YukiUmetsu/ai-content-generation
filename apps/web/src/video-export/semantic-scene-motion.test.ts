
import { describe, expect, it } from "vitest";
import { sampleSemanticMotion } from "./semantic-scene-motion";
const take=(intent:"general-intro"|"general-flow"|"general-comparison"|"general-breakdown"|"general-payoff",
  localFrame:number,visibleItems:number,itemCount=4,durationFrames=150)=>sampleSemanticMotion({
    intent,phase:"mechanism",localFrame,visibleItems,itemCount,durationFrames
  });
describe("frame-derived semantic motion direction",()=>{
  it("gives distinct teaching purposes genuinely different visual compositions",()=>{
    expect(take("general-intro",40,3).style).toBe("question-lens");
    expect(take("general-flow",40,3).style).toBe("journey");
    expect(take("general-comparison",40,3).style).toBe("contrast");
    expect(take("general-breakdown",40,3).style).toBe("decomposition");
    expect(take("general-payoff",40,3).style).toBe("synthesis");
  });
  it("does not leak future stages or hidden conclusions even during camera movement",()=>{
    const start=take("general-intro",0,1);
    expect(start.reveal.map(i=>i.visible)).toEqual([true,false,false,false]);
    expect(start.reveal.slice(1).every(i=>i.opacity===0)).toBe(true);
    const payoff=take("general-payoff",0,0);
    expect(payoff.isPayoffPending).toBe(true);
    expect(payoff.reveal.every(i=>!i.visible)).toBe(true);
    expect(take("general-payoff",80,4).isPayoffPending).toBe(false);
  });
  it("samples reproducibly at arbitrary absolute seeks, without stateful catch-up",()=>{
    const first=take("general-breakdown",73,4);
    take("general-breakdown",2,1);
    take("general-breakdown",148,4);
    expect(take("general-breakdown",73,4)).toEqual(first);
    expect(first.reveal.filter(i=>i.visible)).toHaveLength(4);
    expect(first.reveal.filter(i=>i.focused)).toHaveLength(1);
    expect(first.cameraScale).toBeGreaterThan(1);
    expect(first.lightSweep).toBeGreaterThan(0);
  });
  it("is bounded, stable and does not require expensive frame/image analysis",()=>{
    for(const intent of ["general-intro","general-flow","general-comparison","general-breakdown","general-payoff"] as const){
      for(const count of [2,3,4,5])for(const frame of [0,1,15,39,99]){
        const state=sampleSemanticMotion({intent,localFrame:frame,
          durationFrames:100,visibleItems:Math.min(count,1+Math.floor(frame/24)),itemCount:count});
        expect(state.cameraScale).toBeGreaterThanOrEqual(1);
        expect(state.cameraScale).toBeLessThanOrEqual(1.015);
        expect(Math.abs(state.cameraX)).toBeLessThan(20);
        expect(Math.abs(state.cameraY)).toBeLessThan(20);
        expect(state.reveal).toHaveLength(count);
        expect(state.reveal.every(i=>i.opacity>=0&&i.opacity<=1&&i.offset<=30)).toBe(true);
      }
    }
    expect(()=>take("general-intro",150,3)).toThrow(/frame/);
    expect(()=>take("general-intro",-1,2)).toThrow(/frame/);
  });
  it("supports reduced motion without changing which narrative labels are visible",()=>{
    const normal=take("general-comparison",56,3);
    const reduced=sampleSemanticMotion({intent:"general-comparison",localFrame:56,
      durationFrames:150,visibleItems:3,itemCount:4,reducedMotion:true});
    expect(reduced.reveal.map(i=>i.visible)).toEqual(normal.reveal.map(i=>i.visible));
    expect(reduced.reveal.filter(i=>i.visible).every(i=>i.scale===1&&i.offset===0)).toBe(true);
    expect(reduced.cameraScale).toBe(1);
  });
});
