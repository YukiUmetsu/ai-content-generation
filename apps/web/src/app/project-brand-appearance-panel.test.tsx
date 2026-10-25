import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectBrandAppearancePanel } from "./project-brand-appearance-panel";
import type { LocalProject } from "./catalog-model";
import type { ProjectAppearanceDraft } from "./project-brand-appearance";

const project: LocalProject = {id:"project-atlas",name:"Margin Atlas",notes:"",createdAt:"2026-10-25T00:00:00.000Z"};

describe("Project Brand & Appearance", () => {
  it("edits each main color in a single control and previews thumbnail, motion and blog", async () => {
    const onSave = vi.fn<(draft:ProjectAppearanceDraft) => boolean>(() => true);
    const user = userEvent.setup();
    render(<ProjectBrandAppearancePanel project={project} locale="en" onSave={onSave}/>);
    expect(screen.getAllByRole("group",{name:/Primary color|Secondary color|Accent color|Background color|Text color/})).toHaveLength(5);
    expect(screen.getAllByRole("textbox",{name:/HEX/})).toHaveLength(5);
    expect(screen.getByText("Thumbnail preview")).toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Video"}));
    expect(screen.getByText("Motion graphic preview")).toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Blog"}));
    expect(screen.getByText("Blog header preview")).toBeInTheDocument();
    expect(screen.queryByText("Active color palette")).not.toBeInTheDocument();
  });

  it("saves a custom color with a persistent project-scoped draft and allows restoring revisions", async () => {
    const onSave=vi.fn<(draft:ProjectAppearanceDraft) => boolean>(() => true);
    const user=userEvent.setup();
    const {rerender}=render(<ProjectBrandAppearancePanel project={project} locale="en" onSave={onSave}/>);
    await user.click(screen.getByRole("button",{name:"Add custom color"}));
    await user.type(screen.getByRole("textbox",{name:"Custom color name"}),"Chart line");
    await user.click(screen.getByRole("button",{name:"Save changes"}));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].palette.custom[0]).toEqual({name:"Chart line",hex:"#758CA3"});
    const current={...project,brandAppearance:{...onSave.mock.calls[0][0],revision:2,updatedAt:"2026-10-25T01:00:00.000Z"},
      brandAppearanceHistory:[{...onSave.mock.calls[0][0],revision:1,updatedAt:"2026-10-25T00:00:00.000Z"}]};
    rerender(<ProjectBrandAppearancePanel key="saved" project={current} locale="en" onSave={onSave}/>);
    await user.click(screen.getByRole("button",{name:"Restore revision 1"}));
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1][0].palette.custom).toHaveLength(1);
  });

  it("blocks invalid colors and reports contrast without discarding typed input", async () => {
    const onSave=vi.fn<(draft:ProjectAppearanceDraft) => boolean>(() => true);
    const user=userEvent.setup();
    render(<ProjectBrandAppearancePanel project={project} locale="en" onSave={onSave}/>);
    const field=within(screen.getByRole("group",{name:"Accent color"}));
    await user.clear(field.getByRole("textbox",{name:"Accent HEX"}));
    await user.type(field.getByRole("textbox",{name:"Accent HEX"}),"bad-color");
    expect(screen.getByRole("button",{name:"Save changes"})).toBeDisabled();
    expect(field.getByRole("textbox",{name:"Accent HEX"})).toHaveValue("bad-color");
    expect(screen.getByRole("status")).toHaveTextContent(/contrast|color/i);
    expect(onSave).not.toHaveBeenCalled();
  });
});

