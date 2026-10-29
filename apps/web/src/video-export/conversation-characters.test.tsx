import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { validateCharacterDefinition } from "@/components/character/validate";
import type { GeneralVisualPlan } from "../../scripts/video-production/general-visual-plan.mjs";
import { GeneralExportScene } from "./general-scene";
import { PortraitGeneralExportScene } from "./portrait-general-scene";
import { PIP_RIG, QUILL_RIG } from "./pip-quill-rigs";
import type { CharacterDefinition } from "@/components/character/definition";
import type { ExportRigMap } from "./conversation-characters";

const plan: GeneralVisualPlan = {
  schemaVersion: 1, kind: "general-explainer-visual-plan", title: "Conversation test",
  manifest: { schemaVersion: 1, id: "dialogue-test", durationFrames: 150,
    width: 1920, height: 1080, fps: { num: 30, den: 1 }, preset: "youtube" },
  chapters: [
    { id: "dialogue", intent: "general-flow", visual: { headline: "HOW THE VALVE WORKS",
      subhead: "Pip and Quill explain the routing mechanism", emphasis: "CONVERSATION",
      items: ["Inlet", "Valve", "Outlet"] }, startFrame: 0, endFrame: 100,
      claimRefs: [], evidenceRefs: [], eventIds: [], dialogue: { turns: [
        { id: "ask", role: "character", speakerId: "pip", startFrame: 10, endFrame: 35 },
        { id: "answer", role: "character", speakerId: "quill", startFrame: 40, endFrame: 65 },
        { id: "explain", role: "narrator", speakerId: "narrator", startFrame: 70, endFrame: 90 },
      ] } },
    { id: "payoff", intent: "general-payoff", visual: { headline: "EVERYTHING CONNECTS",
      subhead: "The fluid follows the valve", emphasis: "ANSWER", items: ["Inlet", "Outlet"] },
      startFrame: 100, endFrame: 150, claimRefs: [], evidenceRefs: [], eventIds: ["answer"] },
  ], claims: [], evidence: [], events: { answer: 100 }, payoffEventId: "answer",
  disclaimer: "EDITORIAL REVIEW REQUIRED", commercialReady: false,
};
const render = (frame: number) => renderToStaticMarkup(<GeneralExportScene plan={plan} frame={frame}/>);

describe("original Pip and Quill rig integration in exported scenes", () => {
  it("bundles two distinct valid vector rigs, with local art provenance and animated facial/arm parts", () => {
    expect(validateCharacterDefinition(PIP_RIG)).toEqual([]);
    expect(validateCharacterDefinition(QUILL_RIG)).toEqual([]);
    expect(PIP_RIG.assets.head).not.toEqual(QUILL_RIG.assets.head);
    for (const rig of [PIP_RIG, QUILL_RIG]) {
      expect(Object.values(rig.assets).every(asset => asset.kind === "shapes")).toBe(true);
      expect(rig.speech?.approximateCycle.length).toBeGreaterThan(2);
      expect(rig.blink?.parts).toEqual(["eyes"]);
      expect(rig.actions[`${rig.characterId}-explain`].phases).toHaveLength(3);
    }
  });

  it("speaks only for the right actor during the measured frame window, then closes the mouth", () => {
    const pip = render(19), quill = render(45), narrator = render(75), silent = render(4);
    expect(pip).toContain('data-dialogue-active="pip"');
    expect(pip).toContain('data-conversation-performer="quill"');
    expect(pip).toContain('data-asset="mouthOpen"');
    expect(pip).toContain('data-speaking="true"');
    expect(quill).toContain('data-dialogue-active="quill"');
    expect(quill).toContain('data-asset="mouthWide"');
    expect(narrator).toContain('data-dialogue-active="narrator"');
    expect(narrator).not.toContain('data-asset="mouthOpen"');
    expect(narrator).not.toContain('data-asset="mouthWide"');
    expect(silent).toContain('data-dialogue-active="quiet"');
    expect(silent).toContain('data-asset="mouthRest"');
    expect(render(19)).toBe(pip);
    expect(pip).not.toBe(render(24));
  });

  it("uses local scene artwork instead of fetching missing character images or inventing cast voices", () => {
    const html = render(19);
    expect(html).toContain('data-conversation-characters=""');
    expect(html).toContain("Inlet");
    expect(html).toContain("Valve");
    expect(html).not.toContain("<image");
    expect(html).not.toContain("fish.audio");
    expect(render(115)).not.toContain('data-conversation-characters=""');
  });

  it("also stages both characters on a native 9:16 layout, without drawing semantic cards under the actors", () => {
    const portrait: GeneralVisualPlan = { ...plan, manifest: { ...plan.manifest,
      width: 1080, height: 1920, preset: "youtube-shorts" } };
    const html = renderToStaticMarkup(<PortraitGeneralExportScene plan={portrait} frame={49}/>);
    expect(html).toContain('data-portrait-general-scene=""');
    expect(html).toContain('data-dialogue-active="quill"');
    expect(html).not.toContain('data-portrait-node=');
    expect(html).toContain('data-conversation-performer="pip"');
  });
});

describe("custom Character Studio rigs in exported conversation frames", () => {
  it("uses the saved raster revision and its animated mouth/arm parts instead of the bundled vector puppet", () => {
    const assets = Object.fromEntries(Object.keys(PIP_RIG.assets).map(key => [key, {
      kind: "image", uri: `layers/${key}.png`, mediaType: "image/png", width: 360, height: 420,
      provenance: {source:"Original custom art",license:"Private draft test"}
    }])) as CharacterDefinition["assets"];
    const definition: CharacterDefinition = {...PIP_RIG,revision:"custom-pip-v2",assets};
    const assetUrls = Object.fromEntries(Object.keys(assets).map(key =>
      [`layers/${key}.png`, `/__character_assets/${"a".repeat(64)}.png`]));
    const rigs: ExportRigMap = {pip:{definition,assetUrls,
      draftId:`character-draft-${"b".repeat(32)}`,archiveSha256:"c".repeat(64)}};
    const customPlan = {...plan,characterRigs:rigs};
    const custom = (frame:number) => renderToStaticMarkup(<GeneralExportScene plan={customPlan} frame={frame}/>);
    const speaking = custom(19), silent = custom(4), gesture = custom(24);
    expect(validateCharacterDefinition(definition)).toEqual([]);
    expect(speaking).toContain('data-rig-source="character-studio"');
    expect(speaking).toContain('data-rig-revision="custom-pip-v2"');
    expect(speaking).toContain('data-asset="mouthOpen"');
    expect(speaking).toContain('<image href="/__character_assets/');
    expect(speaking).toContain('data-rig-draft-id="character-draft-');
    expect(silent).toContain('data-asset="mouthRest"');
    expect(silent).not.toContain('data-asset="mouthOpen"');
    expect(silent).toContain('data-rig-mouth-part="mouth"');
    expect(silent).toContain('data-rig-rest-asset="mouthRest"');
    // A changed mouth sprite alone is not animation verification: the
    // customized articulated arm must move during the measured speech turn.
    const customArm = (html: string) => {
      const pip = html.match(/<div[^>]*data-conversation-performer="pip"[\s\S]*?(?=<div[^>]*data-conversation-performer="quill")/)?.[0];
      return pip?.match(/data-part="right-arm" transform="([^"]+)"/)?.[1];
    };
    expect(customArm(silent)).toBeTruthy();
    expect(customArm(speaking)).toBeTruthy();
    expect(customArm(silent)).not.toBe(customArm(speaking));
    expect(custom(75)).toContain('data-rig-rest-asset="mouthRest"');
    expect(gesture).not.toEqual(speaking);
    expect(speaking).toContain('data-rig-source="bundled"');
    const portrait = {...customPlan,manifest:{...customPlan.manifest,width:1080,height:1920,preset:"youtube-shorts" as const}};
    expect(renderToStaticMarkup(<PortraitGeneralExportScene plan={portrait} frame={19}/>))
      .toContain('data-rig-revision="custom-pip-v2"');
  });
});
