import { createContext } from "react";
import type { Locale } from "@/features/registry";

type Appearance = "light" | "dark";
type Density = "compact" | "spacious";

export interface Preferences {
  appearance: Appearance;
  density: Density;
  locale: Locale;
}

export interface PreferencesContextValue extends Preferences {
  setAppearance: (appearance: Appearance) => void;
  setDensity: (density: Density) => void;
  setLocale: (locale: Locale) => void;
}

export const PreferencesContext = createContext<PreferencesContextValue | null>(null);
