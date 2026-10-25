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
});

test("unsupported passages, provenance or approval never become a renderable research dossier",()=>{
  assert.throws(()=>compileApprovedScriptDirector({productionId,script:{...script,status:"draft"},
    evidence,sources}),/approved/i);
  assert.throws(()=>compileApprovedScriptDirector({productionId,script,evidence:[],
    sources}),/captured evidence/i);
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
