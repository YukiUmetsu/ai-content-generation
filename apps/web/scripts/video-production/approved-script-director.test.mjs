import test from "node:test";
import assert from "node:assert/strict";
import { compileApprovedScriptDirector } from "./approved-script-director.mjs";
import { compilePreproductionRenderJob } from "./preproduction-render-bridge.mjs";

const productionId="production-"+"a".repeat(24);
const script={
  version:1,status:"approved",approvedAt:"2026-10-25T12:00:00.000Z",updatedAt:"2026-10-25T12:00:00.000Z",
  input:{productionId,projectId:"brand-one",platform:"youtube",locale:"en",
    title:"What really changes a home's insurance premium?",
    viewerQuestion:"Why might an insurance renewal cost more?",
    audience:"Homeowners",brandVoice:"Clear and candid"},
  sections:["hook","context","mechanism","practical","closing"].map((id,index)=>({
    id,heading:["Why the renewal changed","An important baseline","How risks interact",
      "Compare actual policy terms","What the homeowner can do"][index],
    purpose:"Show the homeowner what changes and why it matters.",
    text:`Section ${index+1}: Compare the same home and its insurance renewal, explain the changing risk and coverage terms, and avoid inventing premium figures. Each step adds a practical distinction to the answer.`,
    claimRefs:["claim_house"],sourceRefs:["source_house"],
  })),
};
const evidence=[{claimId:"claim_house",claimText:"Insurance costs differ by insured risk and coverage.",
  sourceId:"source_house",sourceUrl:"https://example.org/insurance",
  quote:"Premium changes can reflect changing risk, coverage, and local rebuilding expenses.",
  reviewStatus:"unverified"}];
const sources=[{id:"source_house",url:"https://example.org/insurance",title:"Home insurance guide",
  observedAt:1792929600}];

test("approved script preserves each section's narration through a valid renderable Director bundle",()=>{
  const result=compileApprovedScriptDirector({productionId,script,evidence,sources});
  assert.equal(result.dossier.kind,"research-dossier");
  assert.equal(result.bundle.kind,"preproduction-bundle");
  assert.equal(result.bundle.plan.shots.length,5);
  assert.deepEqual(result.bundle.plan.sound.map(sound=>sound.narration),
    script.sections.map(section=>section.text));
  assert.equal(result.dossier.claims[0].status,"unverified");
  assert.equal(result.dossier.review.status,"draft");
  assert.equal(result.bundle.status,"draft-needs-review");
  const rendered=compilePreproductionRenderJob(result.dossier,result.bundle);
  assert.equal(rendered.job.beats.length,5);
  assert.equal(rendered.editorialStatus,"unverified-test-draft");
  for (const shot of result.bundle.plan.shots) {
    const spoken = result.bundle.plan.sound.find(item => item.shotId === shot.id).narration;
    assert.equal(shot.motion.camera, "cinematic");
    assert.equal(shot.motion.revealPace, "deliberate");
    assert.ok(shot.visualElements.length >= 2);
    for (const element of shot.visualElements)
      assert.ok(spoken.toLocaleLowerCase().includes(element.label.toLocaleLowerCase()), element.label);
  }
  assert.equal(rendered.job.beats.some(beat => beat.visual.items.includes("Topic Focus")), false);
  assert.deepEqual(rendered.job.beats[0].visual.items, result.bundle.plan.shots[0].visualElements.map(element => element.label));
});

test("complete unapproved YouTube draft renders without captured research or an approved storyboard",()=>{
  const work={...script,status:"draft",approvedAt:null};
  const {dossier,bundle}=compileApprovedScriptDirector({productionId,script:work,evidence:[],sources:[]});
  assert.equal(dossier.evidence.length,0);
  assert.ok(dossier.claims.every(claim=>claim.status==="unverified"&&claim.sourceRefs.length===0));
  assert.equal(bundle.plan.sound.map(item=>item.narration).join(" "),script.sections.map(item=>item.text).join(" "));
  assert.equal(compilePreproductionRenderJob(dossier,bundle).job.beats.length,5);
  assert.equal(bundle.status,"draft-needs-review");
});

test("unsupported passages and invalid provenance do not become trusted source citations",()=>{
  assert.throws(()=>compileApprovedScriptDirector({productionId,script:{...script,sections:[{...script.sections[0],text:""}]},
    evidence,sources}),/narration|section/i);
  assert.throws(()=>compileApprovedScriptDirector({productionId,script,evidence,
    sources:[{...sources[0],url:"http://localhost/private"}]}),/https|source/i);
  assert.throws(()=>compileApprovedScriptDirector({productionId,
    script:{...script,sections:script.sections.map((section,index)=>index===2?
      {...section,text:"x".repeat(2200)}:section)},evidence,sources}),/split|2000/i);
});

test("long voice sections are split into renderable shots without dropping words",()=>{
  const longText=("A homeowner checks what changed in the renewal and compares the policy terms. ").repeat(35).trim();
  const updated={...script,sections:script.sections.map((section,index)=>index===2?
    {...section,text:longText}:section)};
  const result=compileApprovedScriptDirector({productionId,script:updated,evidence,sources});
  assert.ok(result.bundle.plan.shots.length>5);
  const mechanism=result.bundle.plan.sound.filter((sound)=>sound.shotId.startsWith("shot_3_"));
  assert.equal(mechanism.map(item=>item.narration).join(" "),longText);
  assert.ok(mechanism.every(item=>item.narration.length<=2000));
  assert.ok(compilePreproductionRenderJob(result.dossier,result.bundle).job.beats.length>5);
});

test("different excerpts from the same source retain distinct actual passage hashes",()=>{
  const other={...evidence[0],claimId:"claim_two",claimText:"Changes also depend on the policy's deductible.",
    quote:"The chosen deductible can affect the renewal amount."};
  const updated={...script,sections:script.sections.map((section,index)=>index===3?
    {...section,claimRefs:["claim_two"]}:section)};
  const result=compileApprovedScriptDirector({productionId,script:updated,
    evidence:[...evidence,other],sources});
  assert.equal(result.dossier.evidence.length,2);
  assert.notEqual(result.dossier.evidence[0].snapshotSha256,result.dossier.evidence[1].snapshotSha256);
  assert.notEqual(result.dossier.evidence[0].id,result.dossier.evidence[1].id);
});

test("paragraph breaks in approved voice text are accepted as normal speech spacing",()=>{
  const updated={...script,sections:script.sections.map((section,index)=>index===1?
    {...section,text:section.text.replace("insurance renewal,", "insurance renewal,\n\n")}:section)};
  const result=compileApprovedScriptDirector({productionId,script:updated,evidence,sources});
  assert.ok(result.bundle.plan.sound[1].narration.includes("insurance renewal, explain"));
});

test("edited storyboard visual instructions reach the Director but inconsistent narration is refused",()=>{
  const storyboard={assumptions:[`Approved script revision: ${script.updatedAt}.`],
    beats:script.sections.map(section=>({id:`script-beat-${section.id}`,
      narration:section.text,onScreenText:section.heading,claimRefs:section.claimRefs,
      visualObjective:`Animate a distinct change that demonstrates ${section.heading}.`}))};
  storyboard.beats[2].onScreenText="Compare risk and coverage";
  storyboard.beats[2].visualObjective="Reveal a local risk map alongside changing rebuilding costs.";
  const result=compileApprovedScriptDirector({productionId,script,evidence,sources,storyboard});
  assert.equal(result.bundle.plan.shots[2].onScreenText,"Compare risk and coverage");
  assert.equal(result.bundle.plan.shots[2].visualChange,
    "Reveal a local risk map alongside changing rebuilding costs.");
  assert.throws(()=>compileApprovedScriptDirector({productionId,script,evidence,sources,
    storyboard:{...storyboard,beats:storyboard.beats.map((beat,index)=>index===1?
      {...beat,narration:"Unapproved replacement narration."}:beat)}}),/narration|citations/i);
  assert.throws(()=>compileApprovedScriptDirector({productionId,script,evidence,sources,
    storyboard:{...storyboard,assumptions:["Older approved revision"]}}),/revision/i);
});

 test("sections between 1600 and 2000 characters are split before reaching the render adapter", () => {
   const text=("Insurance coverage and rebuilding risks change the renewal. ").repeat(30).trim();
   assert.ok(text.length>1600&&text.length<2000);
   const updated={...script,sections:script.sections.map(section=>({...section,text}))};
   const result=compileApprovedScriptDirector({productionId,script:updated,evidence,sources});
   assert.ok(compilePreproductionRenderJob(result.dossier,result.bundle).job.beats.every(beat=>beat.narration.length<=1600));
 });


test("a sixth promotional section survives Director and renderer handoff without invented citations",()=>{
  const promotion={id:"section-product",role:"promotion",heading:"FileQuell for accountants",purpose:"Show the product in the accounting workflow.",
    text:"Review FileQuell to see whether its local file tools fit your accounting preparation workflow.",claimRefs:[],sourceRefs:[]};
  const next={...script,sections:[...script.sections,promotion]};
  const result=compileApprovedScriptDirector({productionId,script:next,evidence,sources});
  assert.equal(result.bundle.plan.sound.length,6);
  assert.equal(result.bundle.plan.sound.at(-1).narration,promotion.text);
  assert.equal(result.bundle.plan.story.answerExplanationId,"explain_5");
  const manual=result.dossier.claims.find(claim=>claim.sourceRefs.length===0);
  assert.equal(manual.status,"unverified");
  assert.ok(result.dossier.gaps.some(gap=>/uncited|manual/i.test(gap)));
  assert.equal(compilePreproductionRenderJob(result.dossier,result.bundle).job.beats.length,6);
});

test("all-manual imports retain uncited gaps and accept the matching storyboard outline",()=>{
  const imported=structuredClone(script);
  imported.sections=imported.sections.slice(0,3).map((section,index)=>({...section,id:`section-${index}`,role:"custom",claimRefs:[],sourceRefs:[]}));
  const storyboard={assumptions:[`Approved script revision: ${script.updatedAt}.`],beats:imported.sections.map(section=>({
    id:`script-beat-${section.id}`,narration:section.text,visualObjective:section.purpose,onScreenText:section.heading,claimRefs:[`manual_${section.id}`]}))};
  const {dossier,bundle}=compileApprovedScriptDirector({productionId,script:imported,evidence,sources,storyboard});
  assert.equal(dossier.claims.length,3);
  assert.ok(dossier.claims.every(claim=>claim.status==="unverified"&&claim.sourceRefs.length===0));
  assert.match(dossier.evidence[0].passageLocator,/not a citation/u);
  assert.equal(bundle.plan.sound.length,3);
  assert.equal(compilePreproductionRenderJob(dossier,bundle).job.beats.length,3);
});

for(const count of [1,2])test(`${count}-section imported script becomes three non-repeated shots without losing narration`,()=>{
  const imported=structuredClone(script);
  imported.sections=imported.sections.slice(0,count).map((section,index)=>({...section,id:`section-${index}`,role:"custom",claimRefs:[],sourceRefs:[]}));
  const {dossier,bundle}=compileApprovedScriptDirector({productionId,script:imported,evidence,sources});
  assert.ok(bundle.plan.shots.length>=3);
  assert.equal(bundle.plan.sound.map(sound=>sound.narration).join(" "),imported.sections.map(section=>section.text).join(" "));
  assert.ok(dossier.claims.every(claim=>claim.sourceRefs.length===0));
  assert.equal(compilePreproductionRenderJob(dossier,bundle).job.beats.length,3);
});

test("keeps the actual answer before a promotion even with a two-section main story",()=>{
  const updated=structuredClone(script);updated.sections=updated.sections.slice(0,2);
  updated.sections[1].role="closing";
  updated.sections.push({id:"section-product",role:"promotion",heading:"FileQuell",purpose:"Invite the audience to review the product workflow.",
    text:"Review FileQuell with your accounting team and decide whether it fits your own document preparation workflow.",claimRefs:[],sourceRefs:[]});
  const {dossier,bundle}=compileApprovedScriptDirector({productionId,script:updated,evidence,sources});
  const payoff=bundle.plan.teachingSequences[0].phases.at(-1);
  const answer=bundle.plan.shots.find(shot=>shot.id===payoff.shotId);
  assert.equal(answer.explanationId,bundle.plan.story.answerExplanationId);
  assert.equal(answer.purpose,"answer");
  assert.equal(bundle.plan.shots.at(-1).purpose,"postscript");
  assert.equal(compilePreproductionRenderJob(dossier,bundle).job.beats.length,4);
});

test("short-outline splits never break decimal values or dotted tokens",()=>{
  const updated=structuredClone(script);
  updated.sections=[{...updated.sections[0],id:"section-only",role:"custom",
    text:"Before filing, the accountant reviews 125.50 and reconciles the entire client ledger."}];
  const {bundle}=compileApprovedScriptDirector({productionId,script:updated,evidence,sources});
  assert.equal(bundle.plan.sound.map(sound=>sound.narration).join(" "),updated.sections[0].text);
});

test("a sole main section keeps its answer before an appended promotion",()=>{
  const updated=structuredClone(script);
  updated.sections=[{...updated.sections[0],id:"section-main",role:"custom"},
    {...updated.sections[1],id:"section-product",heading:"FileQuell promotion",role:"promotion"}];
  const {dossier,bundle}=compileApprovedScriptDirector({productionId,script:updated,evidence,sources});
  const answer=bundle.plan.shots.find(shot=>shot.purpose==="answer");
  assert.equal(answer.onScreenText,updated.sections[0].heading);
  assert.equal(bundle.plan.shots.at(-1).purpose,"postscript");
  assert.equal(bundle.plan.sound.map(sound=>sound.narration).join(" "),updated.sections.map(section=>section.text).join(" "));
  assert.equal(compilePreproductionRenderJob(dossier,bundle).job.beats.length,4);
});
