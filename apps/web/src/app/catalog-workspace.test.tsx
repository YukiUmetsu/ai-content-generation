import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/App";
import { CATALOG_KEY } from "./catalog-model";

describe("Studio menu workspaces", () => {
  beforeEach(() => localStorage.clear());

  it("opens all six formerly blank menu sections and persists author-entered catalog entries", async () => {
    const user = userEvent.setup();
    render(<App />);
    const navigate = async (name:string) => user.click(screen.getByRole("link",{name}));
    await navigate("Projects");
    expect(screen.queryByText(/outside this foundation/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox",{name:"Name"}),{target:{value:"Short documentaries"}});
    await user.click(screen.getByRole("button",{name:"Create project"}));
    expect(screen.getByText("Short documentaries")).toBeInTheDocument();

    await navigate("Content");
    fireEvent.change(screen.getByRole("textbox",{name:"Title / label"}),{target:{value:"Why data travels in packets"}});
    await user.selectOptions(screen.getByRole("combobox",{name:"Kind"}),"short");
    await user.click(screen.getByRole("button",{name:"Add entry"}));
    expect(screen.getByText("Why data travels in packets")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox",{name:"Stage for Why data travels in packets"}),"review");

    await navigate("Assets");
    fireEvent.change(screen.getByRole("textbox",{name:"Title / label"}),{target:{value:"Narrator recording"}});
    await user.selectOptions(screen.getByRole("combobox",{name:"Kind"}),"audio");
    await user.selectOptions(screen.getByRole("combobox",{name:"Rights"}),"cleared");
    await user.click(screen.getByRole("button",{name:"Add entry"}));
    expect(screen.getByText("Narrator recording")).toBeInTheDocument();

    await navigate("Products");
    fireEvent.change(screen.getByRole("textbox",{name:"Title / label"}),{target:{value:"Narration editing course"}});
    await user.selectOptions(screen.getByRole("combobox",{name:"Kind"}),"course");
    await user.click(screen.getByRole("button",{name:"Add entry"}));
    expect(screen.getByText("Narration editing course")).toBeInTheDocument();

    await navigate("Insights");
    const main = screen.getByRole("main");
    expect(within(main).getByText("Content plans")).toBeInTheDocument();
    expect(within(main).getByText("Rights to review")).toBeInTheDocument();
    expect(within(main).getByText("Product ideas")).toBeInTheDocument();

    await navigate("Settings");
    expect(screen.getByRole("tablist",{name:"Settings sections"})).toBeInTheDocument();
    expect(screen.getByRole("tab",{name:"AI models"})).toHaveAttribute("aria-selected","true");
    await user.click(screen.getByRole("tab",{name:"Appearance"}));
    expect(screen.getByRole("combobox",{name:"Theme"})).toBeInTheDocument();
    await user.click(screen.getByRole("tab",{name:"Data & privacy"}));
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

  it("edits and reloads a project-owned brand palette without repeating the section heading", async () => {
    const user=userEvent.setup();
    render(<App/>);
    await user.click(screen.getByRole("link",{name:"Projects"}));
    expect(screen.getAllByRole("heading",{name:"My project"})).toHaveLength(1);
    await user.click(screen.getByRole("tab",{name:"Brand & appearance"}));
    expect(screen.getByRole("heading",{name:"Brand color palette"})).toBeInTheDocument();
    expect(screen.queryByRole("heading",{name:"Brand & appearance"})).not.toBeInTheDocument();
    const primary=screen.getByRole("textbox",{name:"Primary HEX"});
    await user.clear(primary);
    await user.type(primary,"#265E81");
    await user.click(screen.getByRole("button",{name:"Save changes"}));
    const stored=JSON.parse(localStorage.getItem(CATALOG_KEY)??"null");
    expect(stored.projects[0].brandAppearance).toMatchObject({revision:1,palette:{primary:"#265E81"}});
    await user.click(screen.getByRole("link",{name:"Settings"}));
    await user.click(screen.getByRole("link",{name:"Projects"}));
    await user.click(screen.getByRole("tab",{name:"Brand & appearance"}));
    expect(screen.getByRole("textbox",{name:"Primary HEX"})).toHaveValue("#265E81");
  });
});

describe("Settings navigation", () => {
  it("groups model assignments, connections, appearance, prompt templates and local data in five keyboard tabs", async () => {
    const user=userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("link",{name:"Settings"}));
    const tabs=within(screen.getByRole("tablist",{name:"Settings sections"}));
    expect(tabs.getAllByRole("tab")).toHaveLength(5);
    expect(screen.getByRole("tab",{name:"AI models"})).toHaveAttribute("aria-selected","true");
    await user.click(screen.getByRole("tab",{name:"Connections"}));
    expect(screen.getByRole("tab",{name:"Connections"})).toHaveAttribute("aria-selected","true");
    await user.click(screen.getByRole("tab",{name:"Prompts"}));
    expect(screen.getByRole("tab",{name:"Prompts"})).toHaveAttribute("aria-selected","true");
    await user.click(screen.getByRole("tab",{name:"AI models"}));
    expect(screen.getByRole("tab",{name:"AI models"})).toHaveAttribute("aria-selected","true");
  });
});

describe("Research model setup in Settings", () => {
  it("discovers installed local models and saves the selected model with the shared Settings API", async () => {
    const calls: Array<{ path:string; body:unknown }> = [];
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path=String(input);
      const body=init?.body ? JSON.parse(String(init.body)) as unknown : null;
      calls.push({ path, body });
      if (path.endsWith("/models")) return new Response(JSON.stringify({models:["qwen3:8b","gemma:4b"]}),{status:200});
      if (path.endsWith("/profiles/save")) return new Response(JSON.stringify({saved:true,profiles:body}),{status:200});
      return new Response(JSON.stringify({
        searchEndpoint:"http://127.0.0.1:49273/search",
        profiles:{version:1,defaultProfileId:"local-default",assignments:{},profiles:[{
          id:"local-default",name:"Local model",provider:"ollama",endpoint:"http://127.0.0.1:11434/v1/chat/completions",model:""}]}
      }),{status:200});
    });
    try {
      const user=userEvent.setup();
      render(<App />);
      await user.click(screen.getByRole("link",{name:"Settings"}));
      expect(await screen.findByText(/SearXNG configured at/)).toHaveTextContent("49273");
      await user.click(screen.getByRole("button",{name:"Find installed models"}));
      expect(await screen.findByRole("combobox",{name:"Detected installed models"})).toBeInTheDocument();
      await user.selectOptions(screen.getByRole("combobox",{name:"Detected installed models"}),"gemma:4b");
      expect(screen.getByRole("textbox",{name:"Model ID"})).toHaveValue("gemma:4b");
      await user.click(screen.getByRole("button",{name:"Save AI settings"}));
      expect(await screen.findByText(/Saved\. New Research/)).toBeInTheDocument();
      const saved=calls.find(call=>call.path.endsWith("/profiles/save"));
      // Legacy stored profiles omit generation; saving them persists the explicit safe defaults.
      expect(saved?.body).toEqual({version:1,defaultProfileId:"local-default",assignments:{},
        generation:{outlineTokens:2048,sceneTokens:4096,timeoutSeconds:240},profiles:[{
        id:"local-default",name:"Local model",provider:"ollama",endpoint:"http://127.0.0.1:11434/v1/chat/completions",model:"gemma:4b"}]});
      expect(localStorage.getItem(CATALOG_KEY)).not.toContain("gemma:4b");
    } finally {
      request.mockRestore();
    }
  });
});
