import {describe,it,expect} from 'vitest';
import {scriptClaimSnapshot} from './script-claim-evidence';
import {createScriptDraft,fillScriptSection,approveScriptDraft,scriptEvidenceFingerprint} from './script-review-model';
import {scriptToStoryboard} from './script-storyboard-handoff';
import {inspectClaimEvidence} from './claim-evidence';
import {createClaimReviewReceipt,isClaimReviewCurrent} from './production-claim-reviews';
const evidence=[{claimId:'claim-one',claimText:'Insurance premiums reflect local risks.',sourceId:'source-one',
  sourceUrl:'https://example.org/insurance',quote:'Insurance premiums reflect local risks.',reviewStatus:'unverified' as const}];
const sources=[{id:'source-one',url:evidence[0].sourceUrl,title:'Insurance risk',provider:'captured-web',observedAt:1792929600}];
function draft(){
  let script=createScriptDraft({productionId:'production-one',projectId:'brand-one',platform:'youtube',locale:'en',
    title:'Insurance premiums',viewerQuestion:'Why do insurance premiums change?',audience:'Homeowners',angle:'Risk',brandVoice:'Calm',evidenceSnapshotId:scriptEvidenceFingerprint(evidence)});
  for(const section of script.sections)script=fillScriptSection(script,section.id,{narration:'Insurance premiums can change when local risks and rebuilding costs change.',claimRefs:['claim-one'],sourceRefs:['source-one']},0);
  return approveScriptDraft(script);
}
describe('script evidence in Storyboard review',()=>{
  it('shows actual captured quotations and permits a review receipt without a legacy research plan',async()=>{
    const script=draft(),board=scriptToStoryboard(script,evidence);
    const snapshot=await scriptClaimSnapshot(script,evidence,sources);
    const issues=inspectClaimEvidence(board,snapshot);
    expect(issues[0].kind).toBe('needs_factual_review');
    const receipt=createClaimReviewReceipt(issues[0],snapshot);
    expect(isClaimReviewCurrent(issues[0],snapshot,receipt)).toBe(true);
    expect(snapshot.quotes[0].quote).toBe(evidence[0].quote);
  });
  it('refuses changed or mismatched evidence instead of reviewing another snapshot',async()=>{
    await expect(scriptClaimSnapshot(draft(),[{...evidence[0],quote:'Changed source passage.'}],sources)).rejects.toThrow(/context|evidence/i);
  });
});
