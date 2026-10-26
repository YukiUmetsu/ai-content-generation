import {afterEach,expect,it,vi} from "vitest";
import {render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {SoundAuditionControls} from "./sound-audition-controls";

const SHA="a".repeat(64);
const bank=[{assetId:"sound",sha256:SHA,title:"Paper turn",durationSeconds:1,
  license:"cc0" as const,rightsStatus:"user-reviewed" as const}];
const choice={shotId:"shot1",mode:"pin" as const,assetId:"sound",sha256:SHA,
  trigger:"shot-start" as const};

afterEach(()=>vi.unstubAllGlobals());

it("explains that the local sound audition does not generate narration or render video",()=>{
  render(<SoundAuditionControls shotId="shot1" choice={null} layers={[]} ambience={null} library={[]}/>);
  expect(screen.getByText("Sound sketch")).toBeInTheDocument();
  expect(screen.getByRole("button",{name:/play sound sketch/i})).toBeDisabled();
  expect(screen.getByText(/no narration is generated/i)).toBeInTheDocument();
});

it("shows real cue lanes and offers an optional browser-local narration WAV",()=>{
  render(<SoundAuditionControls shotId="shot1" choice={choice} layers={[]} ambience={null} library={bank}/>);
  expect(screen.getByText("Paper turn")).toBeInTheDocument();
  expect(screen.getByLabelText(/narration wav for audition/i)).toBeInTheDocument();
  expect(screen.getByText(/does not enter the exported video/i)).toBeInTheDocument();
});

it("never requests approved audio until Play is explicitly clicked",async()=>{
  const fetched=vi.fn();vi.stubGlobal("fetch",fetched);
  render(<SoundAuditionControls shotId="shot1" choice={choice} layers={[]} ambience={null} library={bank}/>);
  expect(fetched).not.toHaveBeenCalled();
  const user=userEvent.setup();
  await user.click(screen.getByRole("button",{name:/play sound sketch/i}));
  expect(screen.getByRole("status")).toHaveTextContent(/browser|audio/i);
});
