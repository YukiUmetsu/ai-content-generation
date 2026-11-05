import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VisualQualityReview, type VisualQualityReport } from "./visual-quality-review";

const report:VisualQualityReport={
  schemaVersion:1,kind:"rendered-scene-quality/v1",status:"needs-review",
  basis:"compiled-renderer-static-preflight",
  summary:{errors:1,warnings:1,affectedShots:2,totalShots:3},
  findings:[
    {code:"renderer-text-overflow",severity:"error",shotId:"s1",relatedShotIds:[],
      message:"Text does not fit",suggestion:"Shorten the description"},
    {code:"repeated-schematic",severity:"warning",shotId:"s3",relatedShotIds:["s1","s2"],
      message:"Repeated diagram structure",suggestion:"Change the visual composition"},
  ],
  limitation:"Static checks cannot certify browser clipping.",
};

it("shows contextual findings, expands review and seeks the selected actual-renderer shot",async()=>{
  const user=userEvent.setup(),inspect=vi.fn(),edit=vi.fn();
  const view=render(<VisualQualityReview report={report} activeShotId="s1" shotIds={["s1","s2","s3"]}
    onInspectShot={inspect} onEditShot={edit}/>);
  expect(screen.getByRole("region",{name:"Visual quality review"})).toBeInTheDocument();
  expect(screen.getByText("Text does not fit")).toBeInTheDocument();
  expect(screen.getByText("Shorten the description")).toBeInTheDocument();
  await user.click(screen.getByRole("button",{name:"Edit this shot"}));
  expect(edit).toHaveBeenCalledWith("s1");
  await user.click(screen.getByRole("button",{name:/Review all 2 findings/}));
  await user.click(screen.getByRole("button",{name:/Inspect Shot 3: Repeated diagram structure/}));
  expect(inspect).toHaveBeenCalledWith("s3");
  view.rerender(<VisualQualityReview report={report} activeShotId="s3" shotIds={["s1","s2","s3"]}
    onInspectShot={inspect} onEditShot={edit}/>);
  expect(screen.getByText("Change the visual composition")).toBeInTheDocument();
});

it("prompts to refresh old preview responses with no quality report",()=>{
  render(<VisualQualityReview activeShotId="s1" shotIds={["s1"]} onInspectShot={vi.fn()}/>);
  expect(screen.getByText(/Refresh the actual scene preview/)).toBeInTheDocument();
});

it("names each finding by its kind, so a text leak is not called a text-fit problem",async()=>{
  const user=userEvent.setup();
  const leak:VisualQualityReport={...report,summary:{errors:2,warnings:1,affectedShots:3,totalShots:3},
    findings:[...report.findings,{code:"editorial-copy-leak",severity:"error",shotId:"s2",relatedShotIds:[],
      message:"The headline shows an outline label",suggestion:"Write the title for the viewer"}]};
  render(<VisualQualityReview report={leak} activeShotId="s1" shotIds={["s1","s2","s3"]} onInspectShot={vi.fn()}/>);
  await user.click(screen.getByRole("button",{name:/Review all 3 findings/}));
  expect(screen.getByText("Shot 1 · Text fit")).toBeInTheDocument();
  expect(screen.getByText("Shot 2 · Screen text")).toBeInTheDocument();
  expect(screen.getByText("Shot 3 · Storytelling")).toBeInTheDocument();
});
