import type { Preset } from "./types";

export const PRESETS: Record<Preset["id"], Preset> = {
  "modern-analytical": {
    id: "modern-analytical",
    name: "Modern Analytical",
    description: {
      en: "Architectural grid, serif headlines, amber signal.",
      ja: "建築的グリッド、セリフ見出し、アンバーのシグナル。",
    },
    traits: ["architectural", "calm", "precise"],
    materialLanguage: {
      en: "architectural linework and understated paper",
      ja: "建築的な線と控えめな紙肌",
    },
    palette: {
      canvas: "#101A22",
      surface: "#1D2A33",
      textPrimary: "#F2F5F6",
      textSecondary: "#BED0D6",
      accent: "#E8A95B",
      positive: "#8BC4A1",
      negative: "#D97777",
    },
    typography: {
      display: { family: "Newsreader", weight: 600 },
      body: { family: "Geist", weight: 450 },
      numbers: { family: "Geist", weight: 650 },
    },
    texture: "subtle architectural drafting lines",
    spacing: "spacious",
    cornerRadius: "low",
  },
  "calm-editorial": {
    id: "calm-editorial",
    name: "Calm Editorial",
    description: {
      en: "Paper warmth, generous margins, quiet green.",
      ja: "温かみのある紙、寛いだ余白、静かなグリーン。",
    },
    traits: ["ample whitespace", "readable serif headlines", "quiet diagram fills"],
    materialLanguage: {
      en: "warm paper and hairline rules",
      ja: "温かい紙と細い罫線",
    },
    palette: {
      canvas: "#F3EEE5",
      surface: "#FBF8F1",
      textPrimary: "#23241F",
      textSecondary: "#5F6157",
      accent: "#2F6350",
      positive: "#3F7A5B",
      negative: "#A64F3C",
    },
    typography: {
      display: { family: "Newsreader", weight: 500 },
      body: { family: "Geist", weight: 400 },
      numbers: { family: "Newsreader", weight: 600 },
    },
    texture: "none",
    spacing: "spacious",
    cornerRadius: "low",
  },
  "cinematic-investigative": {
    id: "cinematic-investigative",
    name: "Cinematic Investigative",
    description: {
      en: "Near-black frame, restrained red, long holds.",
      ja: "近似黒のフレーム、抑えた赤、長いホールド。",
    },
    traits: ["strong contrast", "evidence-first storytelling", "controlled suspense"],
    materialLanguage: {
      en: "near-black frame and restrained red accent",
      ja: "近似黒のフレームと控えめな赤のアクセント",
    },
    palette: {
      canvas: "#0A0A0C",
      surface: "#17171B",
      textPrimary: "#F5F1E8",
      textSecondary: "#B8B1A4",
      accent: "#CC4B3F",
      positive: "#79A98C",
      negative: "#E06054",
    },
    typography: {
      display: { family: "Geist", weight: 700 },
      body: { family: "Geist", weight: 400 },
      numbers: { family: "Geist", weight: 600 },
    },
    texture: "letterbox bars",
    spacing: "comfortable",
    cornerRadius: "low",
  },
};

export const PRESET_ORDER = Object.keys(PRESETS) as Array<Preset["id"]>;
