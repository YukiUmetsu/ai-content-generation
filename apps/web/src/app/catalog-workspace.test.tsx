import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
    await user.type(screen.getByRole("textbox",{name:"Name"}),"Short documentaries");
    await user.click(screen.getByRole("button",{name:"Create project"}));
    expect(screen.getByText("Short documentaries")).toBeInTheDocument();

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
      expect(saved?.body).toEqual({version:1,defaultProfileId:"local-default",assignments:{},profiles:[{
        id:"local-default",name:"Local model",provider:"ollama",endpoint:"http://127.0.0.1:11434/v1/chat/completions",model:"gemma:4b"}]});
      expect(localStorage.getItem(CATALOG_KEY)).not.toContain("gemma:4b");
    } finally {
      request.mockRestore();
    }
  });
});
