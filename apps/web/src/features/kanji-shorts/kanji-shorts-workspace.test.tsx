import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanjiShortsWorkspace } from "./kanji-shorts-workspace";
import { cancelRun, loadPreviews, loadReleases, loadStatus, loadStudio, saveSettings, startRun, type KanjiSettings, type Run, type StudioState } from "./kanji-shorts-api";
import { changedSettings, draftFrom, settingsFromDraft } from "./kanji-settings-model";

vi.mock("./kanji-shorts-api", async (original) => ({
  ...(await original<typeof import("./kanji-shorts-api")>()),
  loadStudio: vi.fn(), loadStatus: vi.fn(), loadPreviews: vi.fn(), loadReleases: vi.fn(), saveSettings: vi.fn(), startRun: vi.fn(), cancelRun: vi.fn(),
}));

const SETTINGS: KanjiSettings = {
  "voice.voiceId": "34cfe2f12a8a4d9490e375fcb845642f", "voice.voiceIds": { ja: "34cfe2f12a8a4d9490e375fcb845642f", en: "59f85041c50240f08ba9b6fa2bff650d" },
  "voice.pace": "slow", "narration.reuse": { ひと: "kunyomi" }, "narration.retakes": null, "narration.speech": null, maxWords: null, "card.safeInset": null,
  "timing.write": 6.6, "timing.review": 6.6,
};
const STATE: StudioState = {
  configured: true, configPath: "/data/kanji-shorts/config.json", revision: "r1", provider: "fish", outputRoot: "/out", settings: SETTINGS, run: null,
  catalog: [
    { char: "人", jlpt: "N5", meanings: "PERSON", name: { kana: "ひと", romaji: "hito" }, versions: 2 },
    { char: "年", jlpt: "N5", meanings: "YEAR", name: { kana: "とし", romaji: "toshi" }, versions: 0 },
    { char: "費", jlpt: "N3", meanings: "EXPENSE", name: { kana: "ひ", romaji: "hi" }, versions: 0 },
  ],
};
const PREVIEW = {
  char: "人", found: true as const, meanings: "PERSON", jlpt: "N5", name: { kana: "ひと", romaji: "hito" }, dataProblems: [], strokeLinesLeftOut: false,
  words: [{ word: "人間", ruby: "にんげん", meaning: "human" }],
  lines: [
    { id: "question", locale: "en", at: "start", offset: .35, say: "Do you know how to write the kanji ひと?", caption: "Do you know how to write the kanji hito?", split: true,
      parts: [{ text: "Do you know how to write the kanji", locale: "en", voiceId: "59f85041c50240f08ba9b6fa2bff650d" },
        { text: "ひと", locale: "ja", voiceId: "34cfe2f12a8a4d9490e375fcb845642f", reuse: { from: "kunyomi", whole: false } }] },
    { id: "kunyomi", locale: "ja", at: "write.firstStroke", offset: 0, say: "くんよみ、ひと。", caption: "くんよみ、ひと。", split: false,
      parts: [{ text: "くんよみ、ひと。", locale: "ja", voiceId: "34cfe2f12a8a4d9490e375fcb845642f" }] },
  ],
};
const running = (state: Run["items"][number]["state"] = "running"): Run => ({ id: "run-1", state: "running", startedAt: "2026-11-22T00:00:00Z", finishedAt: null,
  items: [{ char: "人", state, phase: "rendering", message: "Rendering 744 frames…" }] });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadStudio).mockResolvedValue(STATE);
  vi.mocked(loadPreviews).mockResolvedValue({ previews: [PREVIEW] });
  vi.mocked(loadReleases).mockResolvedValue({ releases: [] });
  vi.mocked(loadStatus).mockResolvedValue({ run: null });
});

describe("KanjiShortsWorkspace", () => {
  it("explains how to start when there is no settings file", async () => {
    vi.mocked(loadStudio).mockResolvedValue({ configured: false, configPath: "/data/kanji-shorts/config.json", problem: "There is no settings file yet.", run: null });
    render(<KanjiShortsWorkspace locale="en" />);
    expect(await screen.findByText("There is no settings file yet.")).toBeInTheDocument();
    expect(screen.getByText("/data/kanji-shorts/config.json")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Make/u })).not.toBeInTheDocument();
  });

  it("previews a picked kanji's lines with the voice of each part and the reused name", async () => {
    const user = userEvent.setup();
    render(<KanjiShortsWorkspace locale="en" />);
    await user.click(await screen.findByRole("button", { name: /^人 hito, PERSON, made 2 times/u }));
    expect(screen.getByRole("button", { name: /^人 hito/u })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("Do you know how to write the kanji hito?")).toBeInTheDocument();
    expect(screen.getByText(/English voice · 59f85041…/u)).toBeInTheDocument();
    expect(screen.getByText(/audio from Kun'yomi/u)).toBeInTheDocument();
    expect(loadPreviews).toHaveBeenCalledWith("人");
    // The level filter hides N3 kanji until All is chosen.
    expect(screen.queryByRole("button", { name: /^費/u })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByRole("button", { name: /^費/u })).toBeInTheDocument();
  });

  it("makes the chosen shorts with the consents, follows their real steps, and cancels", async () => {
    const user = userEvent.setup();
    vi.mocked(startRun).mockResolvedValue({ run: running() });
    vi.mocked(cancelRun).mockResolvedValue({ run: running("cancelled") });
    render(<KanjiShortsWorkspace locale="en" />);
    const input = await screen.findByLabelText("Kanji to make");
    await user.type(input, "人年");
    await user.click(screen.getByRole("button", { name: "Make 2 shorts" }));
    expect(startRun).toHaveBeenCalledWith("人年", "fish");
    const bar = await screen.findByRole("progressbar", { name: "人 progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "7");
    expect(bar).toHaveAttribute("aria-valuetext", "Step 7 of 10: Rendering frames");
    expect(screen.getByRole("button", { name: "Make 2 shorts" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancelRun).toHaveBeenCalled();
  });

  it("refuses more than ten kanji before anything is sent", async () => {
    const user = userEvent.setup();
    render(<KanjiShortsWorkspace locale="en" />);
    await user.type(await screen.findByLabelText("Kanji to make"), "一二三四五六七八九十百");
    expect(screen.getByText(/at most 10 kanji; 11 are chosen/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make 11 shorts" })).toBeDisabled();
  });

  it("saves only the changed settings with the file's revision, and shows a refusal", async () => {
    const user = userEvent.setup();
    vi.mocked(saveSettings).mockRejectedValueOnce(new Error("config: maxWords must be 1 to 6"))
      .mockResolvedValueOnce({ revision: "r2", settings: { ...SETTINGS, "narration.reuse": { ひと: "kunyomi", "{name.kana}": "kunyomi" } } });
    render(<KanjiShortsWorkspace locale="en" />);
    const settings = within((await screen.findByRole("heading", { name: "Settings" })).closest("[data-km-surface=root]") as HTMLElement);
    await user.click(settings.getByRole("checkbox", { name: /name with the audio of its kun'yomi line/u }));
    await user.click(settings.getByRole("button", { name: "Save settings" }));
    expect(saveSettings).toHaveBeenCalledWith("r1", { "narration.reuse": { ひと: "kunyomi", "{name.kana}": "kunyomi" } });
    expect(await settings.findByRole("alert")).toHaveTextContent("maxWords must be 1 to 6");
    await user.click(settings.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(settings.getByRole("status")).toHaveTextContent("Settings saved."));
  });

  it("speaks Japanese", async () => {
    render(<KanjiShortsWorkspace locale="ja" />);
    expect(await screen.findByRole("heading", { name: "漢字ショート" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "設定" })).toBeInTheDocument();
  });
});

describe("settings draft", () => {
  it("keeps settings the form does not show, and leaves out blank entries", () => {
    const saved: KanjiSettings = { ...SETTINGS, "voice.voiceIds": { ...SETTINGS["voice.voiceIds"], ko: "aaaaaaaaaaaaaaaa" }, "card.safeInset": { left: .05 } };
    const draft = draftFrom(saved);
    expect(changedSettings(saved, settingsFromDraft(draft))).toEqual({});
    const next = settingsFromDraft({ ...draft, en: "", aboveCaptions: true, retakes: [["ひと", "5"], ["", ""]], write: "" });
    expect(changedSettings(saved, next)).toEqual({
      "voice.voiceIds": { ja: SETTINGS["voice.voiceIds"]!.ja, ko: "aaaaaaaaaaaaaaaa" }, "card.safeInset": { left: .05, bottom: .19 },
      "narration.retakes": { ひと: 5 }, "timing.write": null,
    });
  });
});
