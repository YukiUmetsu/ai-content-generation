/** The Studio's client for the local kanji shorts API (scripts/kanji-studio-vite.mjs). */
export const KANJI_API = "/api/contentgen-kanji";

export type KanjiName = { kana: string; romaji: string };
/** A kanji of the data; `problem` says why the producer cannot make it. */
export type CatalogKanji = { char: string; jlpt: string | null; meanings: string; name: KanjiName; versions: number; problem?: string;
  /** The name set for it is not one of its readings (the data changed): shown with its default name, fixable on its preview. */
  nameProblem?: string };

/** The settings the page edits, by their path in the config file; null leaves a setting to its default. */
export type KanjiSettings = {
  "voice.voiceId": string | null;
  "voice.voiceIds": Record<string, string> | null;
  "voice.pace": "slow" | "measured" | "fast" | null;
  /** A text read with another line's recording: a line, or lines tried in order. */
  "narration.reuse": Record<string, string | string[]> | null;
  "narration.retakes": Record<string, number> | null;
  "narration.speech": Record<string, string> | null;
  maxWords: number | null;
  "card.safeInset": Partial<Record<"left" | "right" | "top" | "bottom", number>> | null;
  "timing.write": number | null;
  "timing.review": number | null;
};

export type QaSummary = {
  seconds: number | null; lufs: number | null; truePeak: number | null; longestStill: number | null;
  warnings: string[]; technicalPass: boolean; reviewStatus: string; nameReusedFrom?: string;
};
export type RunItem = {
  /** "unknown": the page lost the run while this short was queued or running (shown without progress). */
  char: string; state: "queued" | "running" | "done" | "failed" | "cancelled" | "unknown"; phase: string | null; message: string | null;
  folder?: string; version?: number; tracked?: boolean; jobId?: string; error?: string; note?: string; qa?: QaSummary | null;
};
/** "lost": the page knew a running run the server no longer has (it restarted). */
export type Run = { id: string; state: "running" | "finished" | "cancelled" | "lost"; startedAt: string; finishedAt: string | null; items: RunItem[]; error?: string };

export type StudioState =
  | { configured: false; configPath: string; problem: string; run: Run | null }
  | { configured: true; configPath: string; revision: string; provider: "fish" | "local"; outputRoot: string;
      settings: KanjiSettings; catalog: CatalogKanji[]; run: Run | null };

/** The recording a part is heard from: its text as the voice reads it, its language and the take in use. */
export type Recording = { text: string; locale: string; take: number; /** The part as its line says it: where a "read as" is saved. */ written: string };
export type PreviewPart = {
  text: string; locale: string; voiceId: string; reuse?: { from: string; whole?: boolean; skipped?: string; source?: string }; retake?: number;
  /** Said in every short: one recording, made once. */
  phrase: boolean;
  /** The text the voice reads instead (narration.speech), when it differs. */
  spoken?: string;
  recording: Recording;
};

/** One take of a recording, measured: its pitch every few hundredths of a second (Hz, null unvoiced) and its shape. */
export type Take = { take: number; seconds: number; pitch: (number | null)[]; shape: "rises" | "falls" | "level" | null; rise: number | null; fall: number | null;
  /** The voice returned no speech; or the take could not be measured. */
  silent?: boolean; unreadable?: boolean };
export type PreviewLine = { id: string; locale: string; at: string; offset: number; say: string; caption: string; split: boolean; parts: PreviewPart[] };
export type KanjiPreview =
  | { char: string; found: false }
  | { char: string; found: true; problem: string;
      /** When the problem is a name it does not have: the names it can be called by, and the one set. */
      nameChoices?: NameChoice[]; badName?: string }
  | { char: string; found: true; meanings: string; jlpt: string | null; name: KanjiName; dataProblems: string[]; strokeLinesLeftOut: boolean;
      words: { word: string; ruby: string; meaning: string }[]; lines: PreviewLine[];
      /** The readings it can be called by: its own word's and its on'yomi (a kun'yomi only when it has neither). */
      nameChoices: NameChoice[] };
export type NameChoice = { kana: string; romaji: string; kind: "word" | "on" | "kun" };

export type ReleaseVersion = { version: number; releaseDir: string; createdAt: string; qa?: QaSummary | null };
export type KanjiRelease = { char: string; folder: string; versions: ReleaseVersion[] };

/**
 * A failed call. `kind` lets the page word it in the person's language: "server" carries the
 * server's own message (English); the others are the page's.
 */
export class KanjiApiError extends Error {
  readonly kind: "timeout" | "unreachable" | "unreadable" | "server";
  readonly status: number;
  constructor(kind: KanjiApiError["kind"], message: string, status = 0) { super(message); this.kind = kind; this.status = status; }
}

async function call<T>(path: string, body?: unknown, timeoutMs = 15000): Promise<T> {
  let response: Response;
  try {
    response = await fetch(KANJI_API + path, {
      method: body === undefined ? "GET" : "POST", cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json", "X-Contentgen-Kanji": "local-only" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw error instanceof Error && error.name === "TimeoutError"
      ? new KanjiApiError("timeout", "The local Studio server did not answer in time. Check its terminal, then try again.")
      : new KanjiApiError("unreachable", "Cannot reach the local Studio server. Start it (pnpm dev) and try again.");
  }
  let data: Record<string, unknown>;
  try { data = await response.json() as Record<string, unknown>; }
  catch { throw new KanjiApiError("unreadable", `The local Studio server answered HTTP ${response.status} without details.`, response.status); }
  if (!response.ok) throw new KanjiApiError("server", typeof data.error === "string" ? data.error : `The local Studio server answered HTTP ${response.status}.`, response.status);
  return data as T;
}

export const loadStudio = () => call<StudioState>("/state");
export const loadStatus = () => call<{ run: Run | null }>("/status");
export const loadPreviews = (kanji: string) => call<{ previews: KanjiPreview[] }>("/preview", { kanji }, 30000);
export const loadReleases = (kanji: string) => call<{ releases: KanjiRelease[] }>(`/releases?kanji=${encodeURIComponent(kanji)}`);
export const saveSettings = (revision: string, changes: Partial<KanjiSettings>) =>
  call<{ revision: string; settings: KanjiSettings }>("/settings", { revision, changes });
export const startRun = (kanji: string, provider: "fish" | "local") => call<{ run: Run }>("/start", {
  kanji, confirm: true,
  // Pressing Make is the consent for this run, as the CLI's flags are. The page says what it allows:
  // the narration text to Fish Audio (Fish), and KanjiVG stroke data not yet cached (both).
  consent: provider === "fish" ? { allowNetwork: true, voiceConsent: true, transmitText: true } : { allowNetwork: true, localVoice: true },
}, 60000);
export const cancelRun = () => call<{ run: Run }>("/cancel", {});
/** Call a kanji by one of its readings (empty: its default name). */
export const setName = (char: string, kana: string) => call<{ revision: string; settings: KanjiSettings }>("/name", { char, kana });

export const loadTakes = (recording: Pick<Recording, "text" | "locale">) =>
  call<{ takes: Take[] }>(`/takes?text=${encodeURIComponent(recording.text)}&locale=${encodeURIComponent(recording.locale)}`, undefined, 30000);
/** Record one more take. Pressing the button is the consent to send this text to the voice. */
export const recordTake = (recording: Pick<Recording, "text" | "locale">, provider: "fish" | "local") => call<Take>("/takes", {
  ...recording, consent: provider === "fish" ? { allowNetwork: true, voiceConsent: true, transmitText: true } : { localVoice: true },
}, 120000);
export const chooseTake = (text: string, take: number) => call<{ revision: string; settings: KanjiSettings }>("/takes/use", { text, take });
/** Read a part as another text (narration.speech), or as itself again (`as` empty). */
export const speakAs = (text: string, as: string) => call<{ revision: string; settings: KanjiSettings }>("/speech", { text, as });
export const takeAudio = (recording: Pick<Recording, "text" | "locale">, take: number) =>
  `${KANJI_API}/take-audio?text=${encodeURIComponent(recording.text)}&locale=${encodeURIComponent(recording.locale)}&take=${take}`;

/** A run the server no longer knows: its unfinished shorts are unknown, never shown as still progressing. */
export const lostRun = (run: Run): Run => ({ ...run, state: "lost",
  items: run.items.map(item => item.state === "running" || item.state === "queued" ? { ...item, state: "unknown" } : item) });

/** The URL of a release's video or poster still. */
export const releaseMedia = (folder: string, version: number, file: "video.mp4" | "poster.png") =>
  `${KANJI_API}/media/${encodeURIComponent(folder)}/v${version}/${file}`;

/** The producer's steps in order, so a short's progress is the step it is on, never an invented percentage. */
export const RUN_PHASES = ["preflight", "strokes", "narration", "timing", "music", "mix", "rendering", "mux", "qa", "done"] as const;

/** The kanji in a text, as the CLI reads them: each once, without spaces and commas. */
export const kanjiIn = (text: string) => [...new Set([...text].filter(char => char.trim() && char !== "," && char !== "、"))];
