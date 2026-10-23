import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/App";
import { CATALOG_KEY } from "./catalog-model";

describe("Studio menu workspaces", () => {
  beforeEach(() => localStorage.clear());

  it("opens all six formerly blank menu sections and persists author-entered catalog entries", async () => {
    const user = userEvent.setup();
    render(<App />);
    const navigate = async (name:string) => user.click(screen.getByRole("link",{name,exact:true}));
    await navigate("Projects");
    expect(screen.queryByText(/outside this foundation/i)).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox",{name:"Name",exact:true}),"Short documentaries");
    await user.click(screen.getByRole("button",{name:"Create project"}));
    expect(screen.getByText("Short documentaries",{selector:"strong"})).toBeInTheDocument();

    await navigate("Content");
    await user.type(screen.getByRole("textbox",{name:"Title / label"}),"Why data travels in packets");
    await user.selectOptions(screen.getByRole("combobox",{name:"Kind"}),"short");
    await user.click(screen.getByRole("button",{name:"Add entry"}));
    expect(screen.getByText("Why data travels in packets")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox",{name:"Stage for Why data travels in packets"}),"review");

    await navigate("Assets");
    await user.type(screen.getByRole("textbox",{name:"Title / label"}),"Narrator recording");
    await user.selectOptions(screen.getByRole("combobox",{name:"Kind"}),"audio");
    await user.selectOptions(screen.getByRole("combobox",{name:"Rights"}),"cleared");
    await user.click(screen.getByRole("button",{name:"Add entry"}));
    expect(screen.getByText("Narrator recording")).toBeInTheDocument();

    await navigate("Products");
    await user.type(screen.getByRole("textbox",{name:"Title / label"}),"Narration editing course");
    await user.selectOptions(screen.getByRole("combobox",{name:"Kind"}),"course");
    await user.click(screen.getByRole("button",{name:"Add entry"}));
    expect(screen.getByText("Narration editing course")).toBeInTheDocument();

    await navigate("Insights");
    const main = screen.getByRole("main");
    expect(within(main).getByText("Content plans")).toBeInTheDocument();
    expect(within(main).getByText("Rights to review")).toBeInTheDocument();
    expect(within(main).getByText("Product ideas")).toBeInTheDocument();

    await navigate("Settings");
    expect(screen.getByRole("combobox",{name:"Theme"})).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Download catalog JSON"})).toBeInTheDocument();
    expect(screen.getByLabelText("Import catalog JSON")).toBeInTheDocument();

    const stored = localStorage.getItem(CATALOG_KEY);
    expect(stored).toContain("Short documentaries");
    expect(stored).toContain("Why data travels in packets");
    expect(stored).toContain("Narrator recording");
    expect(stored).toContain("Narration editing course");
    expect(stored).not.toContain("apiKey");
    expect(stored).not.toContain("voiceId");
  });
});
