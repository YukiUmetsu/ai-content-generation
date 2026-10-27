import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlatformOptimization } from "./PlatformOptimization";
import { sourceSignature, type PlatformOptimizationInput } from "./model";

const input: PlatformOptimizationInput = {
  productionId: "production-test",
  projectId: "project-test",
  title: "The real cost of a $500,000 house",
  summary: "A mortgage is only one part of the cost of owning a house.",
  platforms: ["youtube", "tiktok", "blog"],
  sourceRevision: "script-1",
  scriptSections: [{ id: "one", heading: "Taxes and upkeep", text: "Property taxes and repairs add to cost.", startSeconds: 0 }],
  assets: [{ id: "video-1", kind: "video", platform: "youtube", filename: "master.mp4" }],
};

describe("PlatformOptimization", () => {
  const entries = new Map<string, string>();
  beforeEach(() => {
    entries.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => { entries.set(key, value); },
      removeItem: (key: string) => { entries.delete(key); },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("auto-prepares metadata per destination and preserves manual edits across tabs and reopen", () => {
    const view = render(<PlatformOptimization input={input} />);
    const title = screen.getByLabelText("Upload title") as HTMLInputElement;
    expect(title.value).toContain("$500,000 house");
    fireEvent.change(title, { target: { value: "The Hidden Cost of Homeownership" } });
    fireEvent.click(screen.getByRole("tab", { name: /TikTok/ }));
    expect((screen.getByRole("textbox", { name: "Post caption" }) as HTMLTextAreaElement).value).toContain("mortgage is only one part");
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /^YouTube\b/ }));
    expect((screen.getByLabelText("Upload title") as HTMLInputElement).value).toBe("The Hidden Cost of Homeownership");
    view.unmount();
    render(<PlatformOptimization input={input} />);
    expect((screen.getByLabelText("Upload title") as HTMLInputElement).value).toBe("The Hidden Cost of Homeownership");
  });

  it("approves reviewed metadata without media while keeping upload readiness blocked", () => {
    render(<PlatformOptimization input={{ ...input, assets: [] }} />);
    expect(screen.getByText(/attach a rendered destination-ready video/i)).toBeInTheDocument();
    const approve = screen.getByRole("button", { name: "Approve metadata" });
    expect(approve).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Made for children?" }), { target: { value: "false" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked this platform's current requirements/i }));
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    expect(screen.getByText("Metadata approved", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText(/cannot be uploaded yet/i)).toBeInTheDocument();
    expect(screen.getByText(/No upload, scheduling, or publishing/i)).toBeInTheDocument();
  });

  it("keeps each field's label separate from its restore and copy actions", () => {
    render(<PlatformOptimization input={input} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Upload title" }), { target: { value: "A human title" } });
    expect(screen.getByRole("textbox", { name: "Upload title" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore suggestion" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Video description" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("keeps a failed local save editable without reporting it as persisted approval", () => {
    const onManifestChange = vi.fn();
    render(<PlatformOptimization input={input} onManifestChange={onManifestChange} />);
    const initialNotifications = onManifestChange.mock.calls.length;
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw Error("Browser quota exceeded"); });
    fireEvent.change(screen.getByRole("textbox", { name: "Upload title" }),
      { target: { value: "My unsaved local title" } });
    expect(screen.getByRole("textbox", { name: "Upload title" })).toHaveValue("My unsaved local title");
    expect(screen.getByText(/Browser quota exceeded/i)).toBeInTheDocument();
    expect(onManifestChange).toHaveBeenCalledTimes(initialNotifications);
  });

  it("never confirms a saved approval when browser storage rejects the write", () => {
    const onManifestChange = vi.fn();
    render(<PlatformOptimization input={input} onManifestChange={onManifestChange} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Made for children?" }),
      { target: { value: "false" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked this platform's current requirements/i }));
    const notificationsBeforeApproval = onManifestChange.mock.calls.length;
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw Error("Storage disabled"); });
    fireEvent.click(screen.getByRole("button", { name: "Approve metadata" }));
    expect(screen.getByText(/was not saved/i)).toBeInTheDocument();
    expect(screen.getByText(/Storage disabled/i)).toBeInTheDocument();
    expect(onManifestChange).toHaveBeenCalledTimes(notificationsBeforeApproval);
  });

  it("does not silently overwrite manually reviewed titles when the source script changes", () => {
    const view = render(<PlatformOptimization input={input} />);
    fireEvent.change(screen.getByLabelText("Upload title"), { target: { value: "Human title" } });
    view.rerender(<PlatformOptimization input={{ ...input, title: "Changed AI script title", sourceRevision: "script-2" }} />);
    expect((screen.getByLabelText("Upload title") as HTMLInputElement).value).toBe("Human title");
    expect(screen.getByText(/script, palette or assets changed/i)).toBeInTheDocument();
  });

  it("allows private illustrated blog exports without approval while publication stays gated", () => {
    render(<PlatformOptimization input={{ ...input, approvedPlatforms: ["youtube"] }} />);
    fireEvent.click(screen.getByRole("tab", { name: "Blog / Website" }));
    expect(screen.getByRole("button", { name: "Download illustrated HTML" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Download Markdown" })).toBeEnabled();
    expect(screen.getByText(/private illustrated article draft/i)).toBeInTheDocument();
  });

  it("lets a creator change the thumbnail headline and choose distinct layouts, saved per script revision", () => {
    const approved = {...input, approvedPlatforms:["youtube"]};
    const view = render(<PlatformOptimization input={approved}/>);
    expect(screen.getByRole("heading",{name:"Design your thumbnail"})).toBeInTheDocument();
    const cover = screen.getByRole("img",{name:"Selected thumbnail preview"});
    const first = cover.getAttribute("src");
    fireEvent.change(screen.getByRole("textbox",{name:"Thumbnail headline"}),{target:{value:"The Hidden Costs"}});
    expect(cover.getAttribute("src")).not.toBe(first);
    const edited = cover.getAttribute("src");
    fireEvent.click(screen.getByRole("button",{name:"Tile layout"}));
    expect(cover.getAttribute("src")).not.toBe(edited);
    const beforeColor=cover.getAttribute("src");
    fireEvent.change(screen.getByLabelText("Thumbnail accent color"),{target:{value:"#ffcc44"}});
    expect(cover.getAttribute("src")).not.toBe(beforeColor);
    expect(screen.getByRole("button",{name:"Download selected thumbnail"})).toBeEnabled();
    view.unmount();
    const reopened = render(<PlatformOptimization input={approved}/>);
    expect(screen.getByRole("textbox",{name:"Thumbnail headline"})).toHaveValue("The Hidden Costs");
    expect(screen.getByRole("button",{name:"Tile layout"})).toHaveAttribute("aria-pressed","true");
    expect(screen.getByLabelText("Thumbnail accent color")).toHaveValue("#ffcc44");
    reopened.rerender(<PlatformOptimization input={{...approved,assets:[
      ...(approved.assets ?? []),{id:"video-2",kind:"video",platform:"youtube",filename:"final.mp4"}],
      sourceEvidence:[{sourceId:"source-new",sourceUrl:"https://example.org/",reviewStatus:"verified"}],
      brandColors:{primary:"#145E58",secondary:"#164B49",accent:"#EDAA46",background:"#FFF7E8",text:"#182C2B"}}}/>);
    expect(screen.getByRole("textbox",{name:"Thumbnail headline"})).toHaveValue("The Hidden Costs");
    expect(screen.getByRole("button",{name:"Tile layout"})).toHaveAttribute("aria-pressed","true");
  });

  it("retains a manually designed thumbnail when its source script is rewritten", () => {
    const view=render(<PlatformOptimization input={input}/>);
    fireEvent.change(screen.getByRole("textbox",{name:"Thumbnail headline"}),
      {target:{value:"The hidden maintenance bill"}});
    fireEvent.click(screen.getByRole("button",{name:"Editorial layout"}));
    const updated={...input,title:"A completely rewritten video title",sourceRevision:"script-2",
      scriptSections:[{id:"new-1",heading:"Replacement section",text:"A totally new script.",startSeconds:0}]};
    view.rerender(<PlatformOptimization input={updated}/>);
    expect(screen.getByRole("textbox",{name:"Thumbnail headline"})).toHaveValue("The hidden maintenance bill");
    expect(screen.getByRole("button",{name:"Editorial layout"})).toHaveAttribute("aria-pressed","true");
    view.unmount();
    render(<PlatformOptimization input={updated}/>);
    expect(screen.getByRole("textbox",{name:"Thumbnail headline"})).toHaveValue("The hidden maintenance bill");
    expect(screen.getByRole("button",{name:"Editorial layout"})).toHaveAttribute("aria-pressed","true");
  });

  it("refreshes untouched cover copy when the script title changes", () => {
    const view=render(<PlatformOptimization input={input}/>);
    expect(screen.getByRole("textbox",{name:"Thumbnail headline"})).toHaveValue(input.title);
    fireEvent.click(screen.getByRole("button",{name:"Forest"}));
    view.rerender(<PlatformOptimization input={{...input,title:"Why roofs cost more than you think",
      sourceRevision:"next-revision"}}/>);
    expect(screen.getByRole("textbox",{name:"Thumbnail headline"})).toHaveValue("Why roofs cost more than you think");
    expect(screen.getByRole("button",{name:"Forest"})).toHaveAttribute("aria-pressed","true");
  });

  it("migrates an existing revision-specific thumbnail without deleting its backup", () => {
    const signature=sourceSignature({...input,assets:[],sourceEvidence:[],sourceRevision:undefined,
      summary:undefined,audience:undefined,primaryKeyword:undefined,brandColors:undefined,
      approvedPlatforms:["youtube"]},"youtube");
    const oldKey=`contentgen:cover-draft:v1:${input.productionId}:youtube:${signature}`;
    entries.set(oldKey,JSON.stringify({headline:"My existing cover",layout:"tiles",
      colors:{primary:"#172C42",background:"#F7F2E9",accent:"#F8B951"}}));
    const view=render(<PlatformOptimization input={input}/>);
    expect(screen.getByRole("textbox",{name:"Thumbnail headline"})).toHaveValue("My existing cover");
    expect(entries.has(`contentgen:cover-draft:v2:${input.productionId}:youtube`)).toBe(true);
    view.unmount();
    render(<PlatformOptimization input={{...input,title:"A new script",sourceRevision:"new"}}/>);
    expect(screen.getByRole("textbox",{name:"Thumbnail headline"})).toHaveValue("My existing cover");
    expect(entries.has(oldKey)).toBe(true);
  });

  it("never silently replaces a corrupt saved thumbnail without an explicit backup", () => {
    const key=`contentgen:cover-draft:v2:${input.productionId}:youtube`;
    entries.set(key,"{unreadable");
    render(<PlatformOptimization input={input}/>);
    expect(screen.getByRole("alert")).toHaveTextContent(/saved thumbnail.*unreadable/i);
    expect(screen.getByRole("button",{name:"Forest"})).toBeDisabled();
    expect(entries.get(key)).toBe("{unreadable");
    fireEvent.click(screen.getByRole("button",{name:/back up.*start fresh/i}));
    expect(screen.getByRole("button",{name:"Forest"})).toBeEnabled();
    expect([...entries.values()]).toContain("{unreadable");
    fireEvent.change(screen.getByRole("textbox",{name:"Thumbnail headline"}),
      {target:{value:"New cover after recovery"}});
    expect(entries.get(key)).toContain("New cover after recovery");
  });

  it("accepts a local image replacement, preserves it, and rejects disguised nonimages",async()=>{
    const view=render(<PlatformOptimization input={input}/>);
    const preview=screen.getByRole("img",{name:"Selected thumbnail preview"});
    const initial=preview.getAttribute("src");
    const invalid=new File(["<script>not an image</script>"],"fake.png",{type:"image/png"});
    fireEvent.change(screen.getByLabelText("Upload thumbnail image"),{target:{files:[invalid]}});
    expect(await screen.findByText(/not a valid PNG/i)).toBeInTheDocument();
    expect(preview.getAttribute("src")).toBe(initial);
    const bytes=Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nlr8AAAAASUVORK5CYII="),c=>c.charCodeAt(0));
    const valid=new File([bytes],"photo.png",{type:"image/png"});
    fireEvent.change(screen.getByLabelText("Upload thumbnail image"),{target:{files:[valid]}});
    await waitFor(()=>expect(preview.getAttribute("src")).not.toBe(initial));
    expect(decodeURIComponent(preview.getAttribute("src")??"")).toContain("data:image/png;base64,");
    view.unmount();
    render(<PlatformOptimization input={input}/>);
    expect(screen.getByRole("button",{name:"Remove image"})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Remove image"}));
    expect(screen.queryByRole("button",{name:"Remove image"})).not.toBeInTheDocument();
  });
});

