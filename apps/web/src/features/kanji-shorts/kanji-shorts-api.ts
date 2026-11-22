/** The Studio's client for the local kanji shorts API (scripts/kanji-studio-vite.mjs). */
export const KANJI_API = "/api/contentgen-kanji";

export type KanjiName = { kana: string; romaji: string };
export type CatalogKanji = { char: string; jlpt: string | null; meanings: string; name: KanjiName; versions: number };

/** The settings the page edits, by their path in the config file; null leaves a setting to its default. */
export type KanjiSettings = {
  "voice.voiceId": string | null;
  "voice.voiceIds": Record<string, string> | null;
  "voice.pace": "slow" | "measured" | "fast" | null;
  "narration.reuse": Record<string, string> | null;
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
  char: string; state: "queued" | "running" | "done" | "failed" | "cancelled"; phase: string | null; message: string | null;
  folder?: string; version?: number; tracked?: boolean; jobId?: string; error?: string; note?: string; qa?: QaSummary | null;
};
export type Run = { id: string; state: "running" | "finished" | "cancelled"; startedAt: string; finishedAt: string | null; items: RunItem[]; error?: string };

export type StudioState =
  | { configured: false; configPath: string; problem: string; run: Run | null }
  | { configured: true; configPath: string; revision: string; provider: "fish" | "local"; outputRoot: string;
      settings: KanjiSettings; catalog: CatalogKanji[]; run: Run | null };

export type PreviewPart = { text: string; locale: string; voiceId: string; reuse?: { from: string; whole?: boolean; skipped?: string }; retake?: number };
export type PreviewLine = { id: string; locale: string; at: string; offset: number; say: string; caption: string; split: boolean; parts: PreviewPart[] };
export type KanjiPreview =
  | { char: string; found: false }
  | { char: string; found: true; meanings: string; jlpt: string | null; name: KanjiName; dataProblems: string[]; strokeLinesLeftOut: boolean;
      words: { word: string; ruby: string; meaning: string }[]; lines: PreviewLine[] };

export type ReleaseVersion = { version: number; releaseDir: string; createdAt: string; qa?: QaSummary | null };
export type KanjiRelease = { char: string; folder: string; versions: ReleaseVersion[] };

async function call<T>(path: string, body?: unknown, timeoutMs = 15000): Promise<T> {
  let response: Response;
  try {
    response = await fetch(KANJI_API + path, {
      method: body === undefined ? "GET" : "POST", cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json", "X-Contentgen-Kanji": "local-only" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(error instanceof Error && error.name === "TimeoutError"
      ? "The local Studio server did not answer in time. Check its terminal, then try again."
      : "Cannot reach the local Studio server. Start it (pnpm dev) and try again.");
  }
  let data: Record<string, unknown>;
  try { data = await response.json() as Record<string, unknown>; } catch { throw new Error(`The local Studio server answered HTTP ${response.status} without details.`); }
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `The local Studio server answered HTTP ${response.status}.`);
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
  // Pressing Make is the consent for this run, as the CLI's flags are.
  consent: provider === "fish" ? { allowNetwork: true, voiceConsent: true, transmitText: true } : { localVoice: true },
}, 60000);
export const cancelRun = () => call<{ run: Run }>("/cancel", {});

/** The URL of a release's video or poster still. */
export const releaseMedia = (folder: string, version: number, file: "video.mp4" | "poster.png") =>
  `${KANJI_API}/media/${encodeURIComponent(folder)}/v${version}/${file}`;

/** The producer's steps in order, so a short's progress is the step it is on, never an invented percentage. */
export const RUN_PHASES = ["preflight", "strokes", "narration", "timing", "music", "mix", "rendering", "mux", "qa", "done"] as const;

/** The kanji in a text, as the CLI reads them: each once, without spaces and commas. */
export const kanjiIn = (text: string) => [...new Set([...text].filter(char => char.trim() && char !== "," && char !== "、"))];
