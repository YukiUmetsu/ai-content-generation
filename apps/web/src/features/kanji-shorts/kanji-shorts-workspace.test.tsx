import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanjiShortsWorkspace } from "./kanji-shorts-workspace";
import { KanjiApiError, cancelRun, chooseTake, loadPreviews, loadReleases, loadStatus, loadStudio, loadTakes, recordTake, saveSettings, setName, speakAs, startRun, type KanjiSettings, type Run, type StudioState } from "./kanji-shorts-api";
import { changedSettings, draftFrom, draftProblems, editsOnto, settingsFromDraft } from "./kanji-settings-model";
import { forgetKanjiDrafts } from "./kanji-drafts";

vi.mock("./kanji-shorts-api", async (original) => ({
  ...(await original<typeof import("./kanji-shorts-api")>()),
  loadStudio: vi.fn(), loadStatus: vi.fn(), loadPreviews: vi.fn(), loadReleases: vi.fn(), saveSettings: vi.fn(), startRun: vi.fn(), cancelRun: vi.fn(),
  loadTakes: vi.fn(), recordTake: vi.fn(), chooseTake: vi.fn(), speakAs: vi.fn(), setName: vi.fn(),
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
  nameChoices: [{ kana: "ひと", romaji: "hito", kind: "word" as const }, { kana: "じん", romaji: "jin", kind: "on" as const }, { kana: "にん", romaji: "nin", kind: "on" as const }],
  words: [{ word: "人間", ruby: "にんげん", meaning: "human" }],
  lines: [
    { id: "question", locale: "en", at: "start", offset: .35, say: "Do you know how to write the kanji ひと?", caption: "Do you know how to write the kanji hito?", split: true,
      parts: [{ text: "Do you know how to write the kanji", locale: "en", voiceId: "59f85041c50240f08ba9b6fa2bff650d", phrase: true,
          recording: { text: "Do you know how to write the kanji", written: "Do you know how to write the kanji", locale: "en", take: 1 } },
        { text: "ひと", locale: "ja", voiceId: "34cfe2f12a8a4d9490e375fcb845642f", phrase: false, reuse: { from: "kunyomi", whole: true, source: "ひと。" },
          recording: { text: "ひと。", written: "ひと。", locale: "ja", take: 1 } }] },
    { id: "kunyomi", locale: "ja", at: "write.firstStroke", offset: 0, say: "くんよみ、ひと。", caption: "くんよみ、ひと。", split: true,
      parts: [{ text: "くんよみ、", locale: "ja", voiceId: "34cfe2f12a8a4d9490e375fcb845642f", phrase: true, recording: { text: "くんよみ、", written: "くんよみ、", locale: "ja", take: 3 } },
        { text: "ひと。", locale: "ja", voiceId: "34cfe2f12a8a4d9490e375fcb845642f", phrase: false, recording: { text: "ひと。", written: "ひと。", locale: "ja", take: 1 } }] },
  ],
};
const running = (state: Run["items"][number]["state"] = "running"): Run => ({ id: "run-1", state: "running", startedAt: "2026-11-22T00:00:00Z", finishedAt: null,
  items: [{ char: "人", state, phase: "rendering", message: "Rendering 744 frames…" }] });

beforeEach(() => {
  vi.clearAllMocks();
  forgetKanjiDrafts();
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
    // The first run's heading takes the focus once it is on screen.
    await waitFor(() => expect(screen.getByText("Making…")).toHaveFocus());
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
      .mockResolvedValueOnce({ revision: "r2", settings: { ...SETTINGS, "narration.reuse": { ひと: "kunyomi", "{name.kana}": ["kunyomi", "onyomi"] } } });
    render(<KanjiShortsWorkspace locale="en" />);
    const settings = within((await screen.findByRole("heading", { name: "Settings" })).closest("[data-km-surface=root]") as HTMLElement);
    await user.click(settings.getByRole("checkbox", { name: /name with the audio of its reading line/u }));
    await user.click(settings.getByRole("button", { name: "Save settings" }));
    expect(saveSettings).toHaveBeenCalledWith("r1", { "narration.reuse": { ひと: "kunyomi", "{name.kana}": ["kunyomi", "onyomi"] } });
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

describe("settings the form cannot show", () => {
  it("are kept as the file has them: a custom bottom band, a zero band, and {name.kana} read from another line", () => {
    for (const saved of [
      { ...SETTINGS, "card.safeInset": { bottom: .25 } }, { ...SETTINGS, "card.safeInset": { bottom: 0 } },
      { ...SETTINGS, "narration.reuse": { "{name.kana}": "onyomi" } }, { ...SETTINGS, "narration.reuse": { "{name.kana}": "kunyomi", ひと: "kunyomi" } },
      { ...SETTINGS, "narration.reuse": { " ひと": "kunyomi" }, "narration.speech": { 水泳: " すいえい" } },
    ] as KanjiSettings[]) expect(changedSettings(saved, settingsFromDraft(draftFrom(saved)))).toEqual({});
    // Switching the band on or off is a change; a typed {name.kana} → kunyomi row is kept with the switch off.
    const draft = draftFrom({ ...SETTINGS, "card.safeInset": { bottom: .25 } });
    expect(settingsFromDraft({ ...draft, aboveCaptions: false })["card.safeInset"]).toBeNull();
    const typed = settingsFromDraft({ ...draftFrom(SETTINGS), reuse: [["{name.kana}", "kunyomi"]] });
    expect(typed["narration.reuse"]).toEqual({ "{name.kana}": "kunyomi" });
  });

  it("names what stops a save instead of dropping a half-filled row", () => {
    const draft = draftFrom(SETTINGS);
    expect(draftProblems({ ...draft, retakes: [["ひと", ""]] })).toEqual(["retakes-row"]);
    expect(draftProblems({ ...draft, retakes: [["ひと", "0"]] })).toEqual(["retake-number"]);
    expect(draftProblems({ ...draft, retakes: [["くんよみ、", "1"]] })).toEqual([]);          // take 1, as choosing the first recording writes it
    expect(draftProblems({ ...draft, write: "six" })).toEqual(["number"]);
    expect(draftProblems(draft)).toEqual([]);
  });
});

describe("the page keeps the person's work and says what happens", () => {
  it("shows a half-filled row's problem and sends nothing", async () => {
    const user = userEvent.setup();
    render(<KanjiShortsWorkspace locale="en" />);
    const settings = within((await screen.findByRole("heading", { name: "Settings" })).closest("[data-km-surface=root]") as HTMLElement);
    await user.click(settings.getAllByRole("button", { name: "Add" })[1]);
    await user.type(settings.getByRole("textbox", { name: "Retakes 1: Text one voice reads" }), "ひと");
    expect(settings.getByText("Fill in both parts of each retake, or remove it.")).toBeInTheDocument();
    await user.click(settings.getByRole("button", { name: "Save settings" }));
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("keeps unsaved settings when the page is left and opened again, and blocks Make until they are saved", async () => {
    const user = userEvent.setup();
    const first = render(<KanjiShortsWorkspace locale="en" />);
    await user.selectOptions(await screen.findByRole("combobox", { name: "Pace" }), "fast");
    await user.type(screen.getByLabelText("Kanji to make"), "人");
    expect(screen.getByRole("button", { name: "Make 1 short" })).toBeDisabled();
    expect(screen.getByText(/Save or discard the settings changes first/u)).toBeInTheDocument();
    first.unmount();
    render(<KanjiShortsWorkspace locale="en" />);
    expect(await screen.findByRole("combobox", { name: "Pace" })).toHaveValue("fast");
    expect(screen.getByLabelText("Kanji to make")).toHaveValue("人");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("keeps unsaved edits when the file changed elsewhere, and saves only what was edited here", async () => {
    const user = userEvent.setup();
    vi.mocked(saveSettings).mockResolvedValue({ revision: "r3", settings: { ...SETTINGS, "voice.pace": "fast", maxWords: 4 } });
    render(<KanjiShortsWorkspace locale="en" />);
    await user.selectOptions(await screen.findByRole("combobox", { name: "Pace" }), "fast");
    vi.mocked(loadStudio).mockResolvedValue({ ...STATE, revision: "r2", settings: { ...SETTINGS, maxWords: 4 } } as StudioState);
    await user.click(screen.getByRole("button", { name: "Reload" }));
    expect(await screen.findByText(/changed elsewhere\. Your unsaved changes are kept/u)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Pace" })).toHaveValue("fast");
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(saveSettings).toHaveBeenCalledWith("r2", { "voice.pace": "fast" });
  });

  it("says Make downloads stroke data too", async () => {
    render(<KanjiShortsWorkspace locale="en" />);
    expect(await screen.findByText(/downloads KanjiVG stroke data \(from GitHub\)/u)).toBeInTheDocument();
  });

  it("says when a run's progress is lost, instead of hiding it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      vi.mocked(startRun).mockResolvedValue({ run: running() });
      vi.mocked(loadStatus).mockResolvedValue({ run: null });
      render(<KanjiShortsWorkspace locale="en" />);
      await user.type(await screen.findByLabelText("Kanji to make"), "人");
      await user.click(screen.getByRole("button", { name: "Make 1 short" }));
      await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
      expect(await screen.findByText(/no longer knows this run/u)).toBeInTheDocument();
      // Its short is unknown now: no spinner, no progress that looks live.
      expect(screen.getByText("Unknown: check Jobs and Watch")).toBeInTheDocument();
      expect(screen.queryByRole("progressbar", { name: "人 progress" })).not.toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it("warns after several missed status checks", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      vi.mocked(startRun).mockResolvedValue({ run: running() });
      vi.mocked(loadStatus).mockRejectedValue(new KanjiApiError("unreachable", "down"));
      render(<KanjiShortsWorkspace locale="en" />);
      await user.type(await screen.findByLabelText("Kanji to make"), "人");
      await user.click(screen.getByRole("button", { name: "Make 1 short" }));
      await act(async () => { await vi.advanceTimersByTimeAsync(4700); });
      expect(screen.getByText(/Cannot reach the Studio server to follow the run/u)).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it("shows a failed release load as an error, not as nothing made", async () => {
    const user = userEvent.setup();
    vi.mocked(loadReleases).mockRejectedValue(new KanjiApiError("timeout", "slow"));
    render(<KanjiShortsWorkspace locale="ja" />);
    await user.click(await screen.findByRole("button", { name: /^人 hito/u }));
    expect(await screen.findByText(/人 のショートを読み込めませんでした: ローカルの Studio サーバーが時間内に応答しませんでした/u)).toBeInTheDocument();
    expect(screen.queryByText(/ショートはまだありません/u)).not.toBeInTheDocument();
  });

  it("lists a kanji the producer cannot make as unavailable, with its reason", async () => {
    const catalog = STATE.configured ? STATE.catalog : [];
    vi.mocked(loadStudio).mockResolvedValue({ ...STATE, catalog: [...catalog,
      { char: "乙", jlpt: "N5", meanings: "SECOND", name: { kana: "", romaji: "" }, versions: 0, problem: "乙 has no useful word other than itself" }] } as StudioState);
    render(<KanjiShortsWorkspace locale="en" />);
    expect(await screen.findByRole("button", { name: /乙, cannot be made: 乙 has no useful word/u })).toBeDisabled();
  });
});

describe("edits made on a file changed elsewhere", () => {
  it("change only the entries edited here: another retake or the other voice changed elsewhere is kept", () => {
    const base = { ...SETTINGS, "narration.retakes": { "おんよみ、コン。": 2, "時間。": 2 } };
    const latest = { ...base, "narration.retakes": { "おんよみ、コン。": 2, "時間。": 3 }, "voice.voiceIds": { ...SETTINGS["voice.voiceIds"]!, en: "eeeeeeeeeeeeeeee" } };
    const next = { ...base, "narration.retakes": { "おんよみ、コン。": 3, "時間。": 2 }, "voice.voiceIds": { ...SETTINGS["voice.voiceIds"]!, ja: "jjjjjjjjjjjjjjjj" } };
    expect(editsOnto(base, next, latest)).toEqual({
      "narration.retakes": { "おんよみ、コン。": 3, "時間。": 3 },
      "voice.voiceIds": { ja: "jjjjjjjjjjjjjjjj", en: "eeeeeeeeeeeeeeee" },
    });
    // A removed entry is removed; an edit that the file already has sends nothing.
    expect(editsOnto(base, { ...base, "narration.retakes": { "時間。": 2 } }, latest)).toEqual({ "narration.retakes": { "時間。": 3 } });
    expect(editsOnto(base, { ...base, "voice.pace": "fast" }, { ...latest, "voice.pace": "fast" })).toEqual({});
  });

  it("an empty list in the file is the same as none: the page loads clean and Make is not blocked", async () => {
    vi.mocked(loadStudio).mockResolvedValue({ ...STATE, settings: { ...SETTINGS, "narration.speech": {}, "card.safeInset": {} } } as unknown as StudioState);
    const user = userEvent.setup();
    render(<KanjiShortsWorkspace locale="en" />);
    await user.type(await screen.findByLabelText("Kanji to make"), "人");
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make 1 short" })).toBeEnabled();
  });

  it("the name switch and a {name.kana} row cannot both be set", () => {
    const draft = draftFrom({ ...SETTINGS, "narration.reuse": { "{name.kana}": "onyomi" } });
    expect(draftProblems({ ...draft, nameFromKunyomi: true })).toEqual(["name-clash"]);
    expect(draftProblems({ ...draft, reuse: [["ひと", "kunyomi"], ["ひと", "onyomi"]] })).toEqual(["duplicate"]);
  });
});

describe("takes", () => {
  const take = (n: number, shape: "rises" | "falls" | "level") => ({ take: n, seconds: .5, pitch: [140, 150, 155, null, 120], shape, rise: shape === "rises" ? 2 : -2, fall: shape === "falls" ? -3 : 0 });

  it("open from a part: hear each take, see its pitch, choose one, record another, or read the part as another text", async () => {
    const user = userEvent.setup();
    vi.mocked(loadTakes).mockResolvedValue({ takes: [take(1, "rises"), take(2, "falls")] });
    vi.mocked(chooseTake).mockResolvedValue({ revision: "r2", settings: SETTINGS });
    vi.mocked(recordTake).mockResolvedValue(take(3, "level"));
    vi.mocked(speakAs).mockResolvedValue({ revision: "r3", settings: SETTINGS });
    render(<KanjiShortsWorkspace locale="en" />);
    await user.click(await screen.findByRole("button", { name: /^人 hito/u }));
    // The name is heard from the kun'yomi reading: its takes are that recording's.
    // The question's name part comes first; the kun'yomi line's own ひと。 part opens the same recording.
    await user.click(await screen.findByRole("button", { name: "Takes of ひと。 (Question, 人)" }));
    expect(await screen.findByText(/This part is heard from Kun'yomi's recording/u)).toBeInTheDocument();
    expect(loadTakes).toHaveBeenCalledWith({ text: "ひと。", written: "ひと。", locale: "ja", take: 1 });
    expect(await screen.findByText(/Pitch rises to the end, like a question/u)).toBeInTheDocument();
    expect(screen.getByLabelText("Play take 2")).toHaveAttribute("src", expect.stringContaining("take=2"));
    await user.click(screen.getByRole("button", { name: "Use this take (take 2)" }));
    expect(chooseTake).toHaveBeenCalledWith("ひと。", 2);
    expect(await screen.findByText("Take 2 is now used. Make the short again to hear it.")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Record a take" }));
    expect(recordTake).toHaveBeenCalledWith({ text: "ひと。", written: "ひと。", locale: "ja", take: 1 }, "fish");
    await user.type(screen.getByLabelText("Read “ひと。” as"), "人。");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(speakAs).toHaveBeenCalledWith("ひと。", "人。");
  });

  it("say a phrase's take is used in every short", async () => {
    const user = userEvent.setup();
    vi.mocked(loadTakes).mockResolvedValue({ takes: [take(1, "level"), take(3, "falls")] });
    render(<KanjiShortsWorkspace locale="en" />);
    await user.click(await screen.findByRole("button", { name: /^人 hito/u }));
    await user.click(await screen.findByRole("button", { name: "Takes of くんよみ、 (Kun'yomi, 人)" }));
    expect(await screen.findByText("A phrase: the take you choose is used in every short made from now on.")).toBeInTheDocument();
    expect(screen.getByText("In use")).toBeInTheDocument();          // take 3 is the one in use
  });
});

describe("takes panel, after review", () => {
  const take = (n: number) => ({ take: n, seconds: .5, pitch: [140, 150, 155, null, 120], shape: "falls" as const, rise: -2, fall: -3 });
  const reused = { ...PREVIEW, lines: PREVIEW.lines.map(line => line.id !== "question" ? line : { ...line, parts: [line.parts[0], {
    ...line.parts[1], reuse: { from: "kunyomi", whole: true, source: "人。" }, recording: { text: "人。", written: "ひと。", locale: "ja", take: 1 } }] }) };

  it("reads as under the part as its line says it, also from a reused name's panel, and shows the saved reading", async () => {
    const user = userEvent.setup();
    vi.mocked(loadPreviews).mockResolvedValue({ previews: [reused] });
    vi.mocked(loadTakes).mockResolvedValue({ takes: [take(1)] });
    vi.mocked(speakAs).mockResolvedValue({ revision: "r2", settings: SETTINGS });
    render(<KanjiShortsWorkspace locale="en" />);
    await user.click(await screen.findByRole("button", { name: /^人 hito/u }));
    await user.click(await screen.findByRole("button", { name: "Takes of 人。 (Question, 人)" }));
    const field = await screen.findByLabelText("Read “ひと。” as");
    expect(field).toHaveValue("人。");
    await user.clear(field);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(speakAs).toHaveBeenCalledWith("ひと。", "");
  });

  it("keeps a recording in progress visible while a take is chosen, and says a chosen take is not recorded yet", async () => {
    const user = userEvent.setup();
    vi.mocked(loadTakes).mockResolvedValue({ takes: [take(1), take(2)] });
    let finishRecording: (value: ReturnType<typeof take>) => void = () => {};
    vi.mocked(recordTake).mockReturnValue(new Promise(resolve => { finishRecording = resolve; }));
    vi.mocked(chooseTake).mockResolvedValue({ revision: "r2", settings: SETTINGS });
    render(<KanjiShortsWorkspace locale="en" />);
    await user.click(await screen.findByRole("button", { name: /^人 hito/u }));
    await user.click(await screen.findByRole("button", { name: "Takes of くんよみ、 (Kun'yomi, 人)" }));
    // The phrase's chosen take 3 has no recording yet.
    expect(await screen.findByText(/Take 3 is chosen but not recorded yet/u)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Record a take" }));
    await user.click(screen.getByRole("button", { name: "Use this take (take 1)" }));
    expect(screen.getByRole("button", { name: "Record a take" })).toBeDisabled();
    await act(async () => { finishRecording(take(4)); });
    expect(recordTake).toHaveBeenCalledTimes(1);
  });

  it("offers to try again when the takes cannot be loaded, instead of loading forever", async () => {
    const user = userEvent.setup();
    vi.mocked(loadTakes).mockRejectedValueOnce(new KanjiApiError("unreachable", "down")).mockResolvedValueOnce({ takes: [take(1)] });
    render(<KanjiShortsWorkspace locale="ja" />);
    await user.click(await screen.findByRole("button", { name: /^人 hito/u }));
    await user.click(await screen.findByRole("button", { name: "「くんよみ、」のテイク（人・訓読み）" }));
    expect(await screen.findByText(/ローカルの Studio サーバーに接続できません/u)).toBeInTheDocument();
    expect(screen.queryByText("テイクを読み込んでいます…")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "再試行" }));
    expect(await screen.findByText("テイク 1")).toBeInTheDocument();
  });
});

describe("takes panel, second review", () => {
  const take = (n: number) => ({ take: n, seconds: .5, pitch: [140, 150, 155, null, 120], shape: "falls" as const, rise: -2, fall: -3 });

  it("lists a take that could not be measured without breaking the page, and gives one note for an empty list", async () => {
    const user = userEvent.setup();
    vi.mocked(loadTakes).mockResolvedValueOnce({ takes: [take(1), { take: 2, seconds: 0, pitch: [], shape: null, rise: null, fall: null, unreadable: true }] })
      .mockResolvedValueOnce({ takes: [] });
    render(<KanjiShortsWorkspace locale="en" />);
    await user.click(await screen.findByRole("button", { name: /^人 hito/u }));
    await user.click(await screen.findByRole("button", { name: "Takes of ひと。 (Question, 人)" }));
    expect(await screen.findByText(/This take could not be measured/u)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Takes of ひと。 (Question, 人)" }));
    await user.click(screen.getByRole("button", { name: "Takes of Do you know how to write the kanji (Question, 人)" }));
    expect(await screen.findByText(/Not recorded yet/u)).toBeInTheDocument();
    expect(screen.queryByText(/is chosen but not recorded yet/u)).not.toBeInTheDocument();
  });

  it("follows the preview after a choice: a later change elsewhere shows, and a finished recording leaves the focus where the person is typing", async () => {
    const user = userEvent.setup();
    const withTake = (n: number) => ({ ...PREVIEW, lines: PREVIEW.lines.map(line => line.id !== "kunyomi" ? line : { ...line, parts: [line.parts[0], { ...line.parts[1], recording: { ...line.parts[1].recording, take: n } }] }) });
    vi.mocked(loadPreviews).mockResolvedValue({ previews: [withTake(1)] });
    vi.mocked(loadTakes).mockResolvedValue({ takes: [take(1), take(2)] });
    vi.mocked(chooseTake).mockImplementation(async () => { vi.mocked(loadPreviews).mockResolvedValue({ previews: [withTake(2)] }); return { revision: "r2", settings: SETTINGS }; });
    vi.mocked(loadStudio).mockImplementation(async () => ({ ...STATE, revision: `r${Math.random()}` }) as StudioState);
    render(<KanjiShortsWorkspace locale="en" />);
    await user.click(await screen.findByRole("button", { name: /^人 hito/u }));
    await user.click(await screen.findByRole("button", { name: "Takes of ひと。 (Kun'yomi, 人)" }));
    await user.click(await screen.findByRole("button", { name: "Use this take (take 2)" }));
    // The refreshed preview says take 2 too.
    expect(await screen.findByText("· take 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use this take (take 1)" })).toBeInTheDocument();
    // The retake is removed elsewhere: Reload shows take 1 in use again, and the old message goes.
    vi.mocked(loadPreviews).mockResolvedValue({ previews: [withTake(1)] });
    await user.click(screen.getByRole("button", { name: "Reload" }));
    expect(await screen.findByRole("button", { name: "Use this take (take 2)" })).toBeInTheDocument();
    expect(screen.queryByText(/Take 2 is now used/u)).not.toBeInTheDocument();
    // Recording while typing elsewhere in the panel: the focus stays in the field.
    let finish: (value: ReturnType<typeof take>) => void = () => {};
    vi.mocked(recordTake).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await user.click(screen.getByRole("button", { name: "Record a take" }));
    const field = screen.getByLabelText("Read “ひと。” as");
    await user.click(field);
    await act(async () => { finish(take(3)); });
    expect(await screen.findByText("Take 3 recorded.")).toBeInTheDocument();
    expect(field).toHaveFocus();
  });
});

describe("the name a kanji is called by", () => {
  it("is picked from its readings on its preview and applied with its button; its first reading is the default and clears the setting", async () => {
    const user = userEvent.setup();
    vi.mocked(setName).mockResolvedValue({ revision: "r2", settings: SETTINGS });
    render(<KanjiShortsWorkspace locale="en" />);
    await user.click(await screen.findByRole("button", { name: /^人 hito/u }));
    const called = await screen.findByRole("combobox", { name: "Called by" });
    expect(called).toHaveValue("ひと");
    expect(screen.getByRole("option", { name: "じん (jin) · on'yomi" })).toBeInTheDocument();
    await user.selectOptions(called, "にん");
    expect(setName).not.toHaveBeenCalled();                       // picking alone saves nothing
    expect(called).toHaveValue("にん");
    await user.click(screen.getByRole("button", { name: "Call it にん" }));
    expect(setName).toHaveBeenCalledWith("人", "にん");
    expect(called).toHaveFocus();
    expect(called).toHaveValue("にん");                            // shown until the refreshed preview says it
  });

  it("offers to go back to the default name when the set one is no longer a reading of the kanji", async () => {
    const user = userEvent.setup();
    vi.mocked(loadPreviews).mockResolvedValue({ previews: [{ char: "人", found: true, problem: "人 has no reading ぬ to name it by (its readings: ひと, じん, にん)",
      nameChoices: PREVIEW.nameChoices, badName: "ぬ" }] });
    vi.mocked(setName).mockResolvedValue({ revision: "r2", settings: SETTINGS });
    render(<KanjiShortsWorkspace locale="en" />);
    await user.click(await screen.findByRole("button", { name: /^人 hito/u }));
    await user.click(await screen.findByRole("button", { name: "Call it ひと again" }));
    expect(setName).toHaveBeenCalledWith("人", "");
  });

  it("reads a list of one line as that line, and a file's own \"kunyomi\" name entry as a row", () => {
    const saved: KanjiSettings = { ...SETTINGS, "narration.reuse": { "{name.kana}": "kunyomi", ひと: ["kunyomi"], いま: ["kunyomi", "onyomi"] } };
    const draft = draftFrom(saved);
    expect(draft.nameFromKunyomi).toBe(false);
    expect(draft.reuse).toEqual([["{name.kana}", "kunyomi"], ["ひと", "kunyomi"], ["いま", "kunyomi, onyomi"]]);
    expect(changedSettings(saved, settingsFromDraft(draft))).toEqual({});
    // Switched on from scratch: kun'yomi, else on'yomi.
    expect(settingsFromDraft({ ...draftFrom(SETTINGS), nameFromKunyomi: true })["narration.reuse"]).toEqual({ ひと: "kunyomi", "{name.kana}": ["kunyomi", "onyomi"] });
  });
});

describe("the name control keeps the focus", () => {
  it("puts the focus on the error when a name cannot be saved, and on the select after the reset card turns back into a preview", async () => {
    const user = userEvent.setup();
    vi.mocked(setName).mockRejectedValueOnce(new KanjiApiError("server", "settings: the config file changed since it was loaded"));
    render(<KanjiShortsWorkspace locale="en" />);
    await user.click(await screen.findByRole("button", { name: /^人 hito/u }));
    await user.selectOptions(await screen.findByRole("combobox", { name: "Called by" }), "じん");
    await user.click(screen.getByRole("button", { name: "Call it じん" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
  });

  it("after the reset, the select of the reloaded preview has the focus", async () => {
    const user = userEvent.setup();
    const bad = { char: "人", found: true as const, problem: "人 has no reading ぬ to name it by", nameChoices: PREVIEW.nameChoices, badName: "ぬ" };
    vi.mocked(loadPreviews).mockResolvedValue({ previews: [bad] });
    vi.mocked(setName).mockImplementation(async () => { vi.mocked(loadPreviews).mockResolvedValue({ previews: [PREVIEW] }); return { revision: "r2", settings: SETTINGS }; });
    vi.mocked(loadStudio).mockImplementation(async () => ({ ...STATE, revision: `r${Math.random()}` }) as StudioState);
    render(<KanjiShortsWorkspace locale="en" />);
    await user.click(await screen.findByRole("button", { name: /^人 hito/u }));
    await user.click(await screen.findByRole("button", { name: "Call it ひと again" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Called by" })).toHaveFocus());
  });

  it("marks a kanji whose set name needs fixing in the picker", async () => {
    vi.mocked(loadStudio).mockResolvedValue({ ...STATE, catalog: [{ char: "人", jlpt: "N5", meanings: "PERSON", name: { kana: "ひと", romaji: "hito" }, versions: 0,
      nameProblem: "人 has no reading ぬ to name it by" }] } as StudioState);
    render(<KanjiShortsWorkspace locale="en" />);
    expect(await screen.findByRole("button", { name: /its set name needs fixing: 人 has no reading ぬ/u })).toBeEnabled();
  });
});
