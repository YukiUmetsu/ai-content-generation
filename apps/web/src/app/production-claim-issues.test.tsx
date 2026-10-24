import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProductionClaimIssues } from "./production-claim-issues";
import type { ClaimEvidenceIssue } from "./claim-evidence";
import type { ResearchDraftResult } from "./researched-storyboard";

const issues:ClaimEvidenceIssue[] = [
  {claimId:"claim_02",claimText:"Permits increase the project cost.",
    kind:"needs_factual_review",beatIds:["beat_1","beat_2","beat_3"],sourceRefs:["source_01"]},
  {claimId:"claim_04",claimText:"Ductwork may require modification.",
    kind:"needs_factual_review",beatIds:["beat_1","beat_2","beat_3"],sourceRefs:["source_01"]},
  {claimId:"claim_08",claimText:"Installation labor contributes to upfront cost.",
    kind:"source_missing",beatIds:["beat_1","beat_2","beat_3"],sourceRefs:[]},
];

describe("Production claim issues",()=>{
  it("groups three claims with nine beat links instead of nine issue cards",()=>{
    render(<ProductionClaimIssues issues={issues} onOpenBeat={()=>{}} onFindEvidence={()=>{}}/>);
    expect(screen.getAllByTestId("claim-issue")).toHaveLength(3);
    expect(screen.getAllByTestId("claim-beat-link")).toHaveLength(9);
    expect(screen.getByText("Permits increase the project cost.")).toBeTruthy();
    expect(screen.getByText("Ductwork may require modification.")).toBeTruthy();
  });
  it("distinguishes linked factual review and actual missing sources",()=>{
    render(<ProductionClaimIssues issues={issues} onOpenBeat={()=>{}} onFindEvidence={()=>{}}/>);
    expect(screen.getAllByText(/factual review/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/missing source/i).length).toBeGreaterThan(0);
  });
  it("lets a person explicitly record and undo review without hiding the claim",()=>{
    const onMarkReviewed=vi.fn(),onUndoReviewed=vi.fn();
    const draft={quotes:[{claimId:"claim_02",sourceId:"source_01",
      quote:"A saved report excerpt confirms what the source said."}],dossier:{evidence:[]}} as unknown as ResearchDraftResult;
    const props={issues:[issues[0]],draft,onOpenBeat:()=>{},onFindEvidence:()=>{},
      onMarkReviewed,onUndoReviewed};
    const view=render(<ProductionClaimIssues {...props} reviewedClaims={new Set<string>()}/>);
    fireEvent.click(screen.getByRole("button",{name:/I reviewed this claim and its sources/i}));
    expect(onMarkReviewed).toHaveBeenCalledWith("claim_02");
    view.rerender(<ProductionClaimIssues {...props} reviewedClaims={new Set(["claim_02"])}/>);
    expect(screen.getByText("Reviewed locally")).toBeTruthy();
    expect(screen.getByText("Permits increase the project cost.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:/undo review/i}));
    expect(onUndoReviewed).toHaveBeenCalledWith("claim_02");
  });
  it("navigates to the affected storyboard beat and offers source search",()=>{
    const onOpenBeat=vi.fn(),onFindEvidence=vi.fn();
    render(<ProductionClaimIssues issues={[issues[2]]} onOpenBeat={onOpenBeat} onFindEvidence={onFindEvidence}/>);
    fireEvent.click(screen.getAllByTestId("claim-beat-link")[0]);
    expect(onOpenBeat).toHaveBeenCalledWith("beat_1");
    fireEvent.click(screen.getByRole("button",{name:/find more evidence/i}));
    expect(onFindEvidence).toHaveBeenCalledOnce();
  });
});
