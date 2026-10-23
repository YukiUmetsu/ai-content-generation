import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResearchModelSettings } from "./research-model-settings";

const preset={version:1,profiles:[{id:"one",name:"Research",provider:"ollama",endpoint:"http://127.0.0.1:11434/v1/chat/completions",model:"qwen3:8b"},
  {id:"two",name:"Planning",provider:"magnitude",endpoint:"http://127.0.0.1:10100/inference/v1/chat/completions",model:"qwen3.6"}],defaultProfileId:"one",assignments:{story:"two"}};

afterEach(()=>vi.restoreAllMocks());
describe("local AI task profiles",()=>{
  it("persists explicit Custom provider even when endpoint equals an Ollama preset; reloads assignments",async()=>{
    let saved=structuredClone(preset);
    const fetcher=vi.spyOn(globalThis,"fetch").mockImplementation(async(url,init)=>{
      const path=String(url);
      if(path.endsWith("/profiles"))return Response.json({profiles:saved,searchEndpoint:null});
      if(path.endsWith("/profiles/save")){saved=JSON.parse(String(init?.body));return Response.json({profiles:saved,saved:true});}
      throw Error("Unexpected endpoint " + path);
    });
    const user=userEvent.setup();
    const view=render(<ResearchModelSettings locale="en"/>);
    await waitFor(()=>expect(screen.getByRole("textbox",{name:"Profile name"})).toHaveValue("Research"));
    await user.selectOptions(screen.getByRole("combobox",{name:"Provider"}),"custom");
    expect(screen.getByRole("combobox",{name:"Provider"})).toHaveValue("custom");
    await user.selectOptions(screen.getByRole("combobox",{name:"Story planning model"}),"two");
    await user.click(screen.getByRole("button",{name:"Save AI settings"}));
    await waitFor(()=>expect(saved.profiles[0].provider).toBe("custom"));
    expect(saved.assignments.story).toBe("two");
    view.unmount();
    render(<ResearchModelSettings locale="en"/>);
    await waitFor(()=>expect(screen.getByRole("textbox",{name:"Profile name"})).toHaveValue("Research"));
    expect(screen.getByRole("combobox",{name:"Provider"})).toHaveValue("custom");
    expect(screen.getByRole("combobox",{name:"Story planning model"})).toHaveValue("two");
    expect(fetcher).toHaveBeenCalled();
  });
  it("selects Magnitude and calls its exact endpoint for installed model discovery",async()=>{
    let checkedEndpoint="";
    vi.spyOn(globalThis,"fetch").mockImplementation(async(url,init)=>{
      if(String(url).endsWith("/profiles"))return Response.json({profiles:preset,searchEndpoint:null});
      if(String(url).endsWith("/models")){
        checkedEndpoint=JSON.parse(String(init?.body)).endpoint;
        return Response.json({models:["qwen3.6"]});
      }
      throw Error("Unexpected request");
    });
    const user=userEvent.setup();render(<ResearchModelSettings locale="en"/>);
    await waitFor(()=>expect(screen.getByRole("textbox",{name:"Profile name"})).toHaveValue("Research"));
    await user.selectOptions(screen.getByRole("combobox",{name:"Provider"}),"magnitude");
    await user.click(screen.getByRole("button",{name:"Find installed models"}));
    await waitFor(()=>expect(checkedEndpoint).toBe("http://127.0.0.1:10100/inference/v1/chat/completions"));
    expect(screen.getByRole("textbox",{name:"Local API endpoint"})).toHaveValue(checkedEndpoint);
  });
});
