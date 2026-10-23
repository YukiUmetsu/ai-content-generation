import { describe, expect, it } from "vitest";
import { createDeliveryLayout, PLATFORMS } from "./model";

describe("platform layout planner", () => {
  const input = {headline:"Why replacing a roof is expensive",supportingText:"The headline price hides several distinct jobs.",labels:["Materials","Labor","Disposal"]};
  it("builds independently composed aspect-correct safe regions for supported platforms",()=>{
    for(const preset of PLATFORMS){
      const plan=createDeliveryLayout({...input,preset});
      expect(plan.width).toBeGreaterThan(0);
      expect(plan.height).toBeGreaterThan(0);
      expect(plan.preset).toBe(preset);
      expect(plan.exportable).toBe(true);
      expect(plan.placements).toHaveLength(5);
      expect(plan.diagnostics.filter(x=>x.severity==="error")).toEqual([]);
      expect(plan.placements.every(x=>x.rect.x>=plan.safeArea.x && x.rect.x+x.rect.width<=plan.safeArea.x+plan.safeArea.width+1e-6)).toBe(true);
    }
    const landscape=createDeliveryLayout({...input,preset:"youtube"});
    const portrait=createDeliveryLayout({...input,preset:"youtube-shorts"});
    expect([landscape.width,landscape.height]).toEqual([1920,1080]);
    expect([portrait.width,portrait.height]).toEqual([1080,1920]);
    expect(landscape.placements[2].rect).not.toEqual(portrait.placements[2].rect);
  });
  it("blocks invalid input and never invents a virality prediction or rights clearance",()=>{
    expect(()=>createDeliveryLayout({...input,preset:"fake-channel" as never})).toThrow(/Unsupported/);
    expect(()=>createDeliveryLayout({...input,headline:""})).toThrow(/Headline/);
    expect(()=>createDeliveryLayout({...input,labels:["Just one"]})).toThrow(/2–4/);
    const plan=createDeliveryLayout({...input,preset:"tiktok"});
    const json=JSON.stringify(plan);
    expect(json).not.toMatch(/viral|views|revenue|commercialrightsverified/i);
  });
});
