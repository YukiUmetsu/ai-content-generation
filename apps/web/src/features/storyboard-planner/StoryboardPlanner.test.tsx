import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StoryboardPlanner } from "./StoryboardPlanner";
import type { StoryboardBeat } from "./model/types";

function lastPreview(spy: ReturnType<typeof vi.fn>): ReactElement<{ beat: StoryboardBeat }> | null {
  const calls = spy.mock.calls;
  return (calls[calls.length - 1]?.[0] ?? null) as ReactElement<{ beat: StoryboardBeat }> | null;
}

async function previewView(spy: ReturnType<typeof vi.fn>) {
  await waitFor(() => expect(spy).toHaveBeenCalled());
  const element = lastPreview(spy);
  expect(element).not.toBeNull();
  return render(element as ReactElement);
}

describe("StoryboardPlanner", () => {
  it("loads the HVAC example with a coherent sequence and runtime", () => {
    const spy = vi.fn();
    render(<StoryboardPlanner locale="en" onPreviewChange={spy} />);

    expect(
      screen.getByRole("heading", { name: "Why Replacing an HVAC System Costs So Much" })
    ).toBeInTheDocument();
    expect(screen.getByText(/Runtime: 38\.0 s/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Select beat/ })).toHaveLength(5);
    expect(screen.getByText("0 blocking issues")).toBeInTheDocument();
    expect(screen.getByText("0 advisory warnings")).toBeInTheDocument();
    expect(screen.getByText(/A \$12,400 quote/)).toBeInTheDocument();
  });

  it("publishes the selected scene and updates the shared preview", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<StoryboardPlanner locale="en" onPreviewChange={spy} />);

    const first = await previewView(spy);
    const initial = within(first.container).getByTestId("scene-preview");
    expect(initial).toHaveAttribute("data-intent", "question");
    expect(within(first.container).getByText("Planning preview — not a rendered animation")).toBeInTheDocument();
    first.unmount();

    await user.click(screen.getByRole("button", { name: /^Select beat 3:/ }));
    await waitFor(() => expect(lastPreview(spy)?.props.beat.id).toBe("beat-installation"));
    const third = await previewView(spy);
    expect(within(third.container).getByTestId("scene-preview")).toHaveAttribute(
      "data-intent",
      "cost-accumulation"
    );
    expect(within(third.container).getAllByText("Labor + ductwork + permits").length).toBeGreaterThan(0);
  });

  it("responds to narration and on-screen copy edits", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<StoryboardPlanner locale="en" onPreviewChange={spy} />);
    await previewView(spy);

    const narration = screen.getByLabelText("Narration");
    await user.clear(narration);
    await user.type(narration, "A new explanation of where the money goes.");
    await waitFor(() =>
      expect(lastPreview(spy)?.props.beat.narration).toBe("A new explanation of where the money goes.")
    );

    const onScreen = screen.getByLabelText("On-screen text");
    await user.clear(onScreen);
    await user.type(onScreen, "Where does the money go?");
    await waitFor(() => expect(lastPreview(spy)?.props.beat.onScreenText).toBe("Where does the money go?"));

    const view = await previewView(spy);
    expect(within(view.container).getAllByText("Where does the money go?").length).toBeGreaterThan(0);
    expect(
      within(view.container).getByText("A new explanation of where the money goes.")
    ).toBeInTheDocument();
  });

  it("recalculates total runtime and downstream starts from an integer frame edit", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<StoryboardPlanner locale="en" onPreviewChange={spy} />);

    const duration = screen.getByRole("spinbutton", { name: "Duration (frames)" });
    await user.clear(duration);
    await user.type(duration, "300");
    await waitFor(() => expect(screen.getByText(/Runtime: 40\.0 s/)).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /^Select beat 2:/ }));
    expect(screen.getByText(/10\.0 s – 17\.0 s/)).toBeInTheDocument();
  });

  it("adds, deletes and reorders beats while preserving selection", async () => {
    const user = userEvent.setup();
    render(<StoryboardPlanner locale="en" />);

    await user.click(screen.getByRole("button", { name: "Add beat" }));
    expect(screen.getAllByRole("button", { name: /^Select beat/ })).toHaveLength(6);
    const editor = screen.getByRole("region", { name: "Scene editor" });
    expect(within(editor).getByText("beat-1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete beat 6" }));
    expect(screen.getAllByRole("button", { name: /^Select beat/ })).toHaveLength(5);

    await user.click(screen.getByRole("button", { name: /^Select beat 2:/ }));
    await user.click(screen.getByRole("button", { name: "Move beat 2 earlier" }));
    const firstBeat = screen.getAllByRole("button", { name: /^Select beat/ })[0];
    expect(firstBeat).toHaveAccessibleName("Select beat 1: Equipment ≈ $7,100 of the quote");
  });

  it("exports deterministic JSON and imports it back without drift", async () => {
    const user = userEvent.setup();
    render(<StoryboardPlanner locale="en" />);

    await user.click(screen.getByRole("button", { name: "Export" }));
    const exportArea = screen.getByLabelText("Semantic storyboard JSON") as HTMLTextAreaElement;
    const exported = exportArea.value;
    expect(exported).toContain('"kind": "contentgen-semantic-storyboard"');
    expect(exported.endsWith("\n")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Close" }));

    await user.click(screen.getByRole("button", { name: "Import" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Import" }));
    const importArea = within(dialog).getByLabelText("Import");
    await user.click(importArea);
    await user.paste(exported);
    await user.click(within(dialog).getByRole("button", { name: "Import storyboard" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: /^Select beat/ })).toHaveLength(5);
    expect(
      screen.getByRole("heading", { name: "Why Replacing an HVAC System Costs So Much" })
    ).toBeInTheDocument();
  });

  it("rejects malformed JSON safely and keeps the current board", async () => {
    const user = userEvent.setup();
    render(<StoryboardPlanner locale="en" />);

    await user.click(screen.getByRole("button", { name: "Import" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Import" }));
    const importArea = within(dialog).getByLabelText("Import");
    await user.click(importArea);
    await user.paste("{not json");
    await user.click(within(dialog).getByRole("button", { name: "Import storyboard" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Import failed. Nothing was changed.");
    expect(screen.getByRole("alert")).toHaveTextContent("The text is not valid JSON.");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: /^Select beat/ })).toHaveLength(5);
  });

  it("renders Japanese copy and a local planning preview", () => {
    render(<StoryboardPlanner locale="ja" />);

    expect(
      screen.getByRole("region", { name: "ストーリーボードのビート" })
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "チェック" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ビートを追加" })).toBeInTheDocument();
    expect(screen.getByText("制作プレビュー")).toBeInTheDocument();
    expect(screen.getByText(/再生時間: 38\.0 秒/)).toBeInTheDocument();
    expect(screen.getByText("0 件の構造エラー")).toBeInTheDocument();
  });

  it("cleans up the shared preview on unmount", async () => {
    const spy = vi.fn();
    const { unmount } = render(<StoryboardPlanner locale="en" onPreviewChange={spy} />);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    unmount();
    expect(spy).toHaveBeenLastCalledWith(null);
  });

  it("keeps edited storyboards in their own local project without saving untouched examples", async () => {
    const user = userEvent.setup();
    const alpha = { projectId: "project-alpha" };
    const beta = { projectId: "project-beta" };
    const storageKey = "contentgen:project-storyboard:v1:project-alpha";

    const first = render(<StoryboardPlanner locale="en" {...alpha} />);
    expect(localStorage.getItem(storageKey)).toBeNull();
    const narration = screen.getByLabelText("Narration");
    await user.clear(narration);
    await user.type(narration, "A custom opening for the Alpha project.");
    await waitFor(() => expect(localStorage.getItem(storageKey)).toContain("A custom opening for the Alpha project."));
    first.unmount();

    const second = render(<StoryboardPlanner locale="en" {...beta} />);
    expect(screen.getByLabelText("Narration")).not.toHaveValue("A custom opening for the Alpha project.");
    second.unmount();

    const restored = render(<StoryboardPlanner locale="en" {...alpha} />);
    expect(screen.getByLabelText("Narration")).toHaveValue("A custom opening for the Alpha project.");
    await user.click(screen.getByRole("button", { name: "Reset example" }));
    await user.click(screen.getByRole("button", { name: "Confirm reset" }));
    await waitFor(() => expect(localStorage.getItem(storageKey)).toBeNull());
    restored.unmount();
    render(<StoryboardPlanner locale="en" {...alpha} />);
    expect(screen.getByLabelText("Narration")).not.toHaveValue("A custom opening for the Alpha project.");
  });

  it("recovers a deliberately empty beat list after deleting the last scene", async () => {
    const user = userEvent.setup();
    const project = { projectId: "project-empty" };
    const key = "contentgen:project-storyboard:v1:project-empty";
    const first = render(<StoryboardPlanner locale="en" {...project} />);
    for (let index = 5; index >= 1; index -= 1) {
      await user.click(screen.getByRole("button", { name: new RegExp(`^Select beat ${index}:`) }));
      await user.click(screen.getByRole("button", { name: `Delete beat ${index}` }));
    }
    expect(screen.queryAllByRole("button", { name: /^Select beat/ })).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(key) ?? "null")).toHaveProperty("beats", []);
    first.unmount();
    render(<StoryboardPlanner locale="en" {...project} />);
    expect(screen.queryAllByRole("button", { name: /^Select beat/ })).toHaveLength(0);
  });

  it("restores an incomplete duration edit rather than an older storyboard", async () => {
    const user = userEvent.setup();
    const project = { projectId: "project-duration" };
    const key = "contentgen:project-storyboard:v1:project-duration";
    const first = render(<StoryboardPlanner locale="en" {...project} />);
    await user.clear(screen.getByRole("spinbutton", { name: "Duration (frames)" }));
    expect(JSON.parse(localStorage.getItem(key) ?? "null").beats[0].durationFrames).toBe(0);
    first.unmount();
    render(<StoryboardPlanner locale="en" {...project} />);
    expect(screen.getByRole("spinbutton", { name: "Duration (frames)" })).toHaveValue(0);
  });

  it("surfaces a corrupt local draft and preserves it even if the editor is changed", async () => {
    const user = userEvent.setup();
    const key = "contentgen:project-storyboard:v1:project-corrupt";
    const original = '{"kind":"not-a-storyboard","apiKey":"keep-original"}';
    localStorage.setItem(key, original);
    render(<StoryboardPlanner locale="en" {...{ projectId: "project-corrupt" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/stored storyboard.*could not be loaded/i);
    await user.clear(screen.getByLabelText("Narration"));
    await user.type(screen.getByLabelText("Narration"), "Unsaved because the stored draft is damaged.");
    expect(localStorage.getItem(key)).toBe(original);
  });
});
