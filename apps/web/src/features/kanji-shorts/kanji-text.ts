/** The page's words in English and Japanese, and the labels it derives from the data. */
import type { Locale } from "@/features/registry";

export type Say = (en: string, ja: string) => string;
export const sayer = (locale: Locale): Say => (en, ja) => locale === "ja" ? ja : en;

const LANGUAGES: Record<string, [string, string]> = { ja: ["Japanese", "日本語"], en: ["English", "英語"] };
/** A language code's name: Japanese / 日本語, or the code itself. */
export const languageName = (code: string, say: Say) => {
  const known = LANGUAGES[code.split("-")[0]];
  return known ? say(known[0], known[1]) : code;
};

/** A script line's name from its id: question, onyomi, kunyomi, words-intro, word-2, stroke-3, or the id itself. */
export function lineName(id: string, say: Say) {
  const numbered = /^(word|stroke)-(\d+)$/u.exec(id);
  if (numbered) return numbered[1] === "word" ? say(`Word ${numbered[2]}`, `ことば ${numbered[2]}`) : say(`Stroke ${numbered[2]}`, `${numbered[2]}画目`);
  const names: Record<string, [string, string]> = {
    question: ["Question", "問いかけ"], onyomi: ["On'yomi", "音読み"], kunyomi: ["Kun'yomi", "訓読み"], "words-intro": ["Words intro", "ことばの紹介"],
  };
  return names[id] ? say(...names[id]) : id;
}

/** The producer's step names. */
export function phaseName(phase: string | null, say: Say) {
  const names: Record<string, [string, string]> = {
    preflight: ["Checking", "確認"], strokes: ["Stroke data", "筆順データ"], narration: ["Voices", "音声"], timing: ["Timing", "タイミング"],
    music: ["Music", "音楽"], mix: ["Mixing", "ミックス"], rendering: ["Rendering frames", "フレーム描画"], mux: ["Combining", "結合"],
    qa: ["Measuring", "計測"], done: ["Ready", "完成"],
  };
  return phase && names[phase] ? say(...names[phase]) : say("Waiting", "待機中");
}
