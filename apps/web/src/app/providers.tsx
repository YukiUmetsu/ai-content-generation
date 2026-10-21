import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Locale } from "@/features/registry";
import { PreferencesContext, type Preferences } from "./preferences-context";

type Appearance = Preferences["appearance"];
type Density = Preferences["density"];

const STORAGE_KEY = "content-gen:studio-preferences";

function readStoredPreferences(): Partial<Preferences> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Preferences>) : {};
  } catch {
    return {};
  }
}

function writeStoredPreferences(preferences: Preferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Storage may be unavailable in private mode or tests.
  }
}

function systemAppearance(): Appearance {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const stored = useMemo(() => readStoredPreferences(), []);
  const [appearance, setAppearance] = useState<Appearance>(stored.appearance ?? systemAppearance());
  const [density, setDensity] = useState<Density>(stored.density ?? "spacious");
  const [locale, setLocale] = useState<Locale>(stored.locale ?? "en");

  useEffect(() => {
    document.documentElement.setAttribute("data-km-appearance", appearance);
    document.documentElement.setAttribute("data-km-density", density);
    document.documentElement.lang = locale;
    writeStoredPreferences({ appearance, density, locale });
  }, [appearance, density, locale]);

  const value = useMemo(
    () => ({
      appearance,
      setAppearance,
      density,
      setDensity,
      locale,
      setLocale,
    }),
    [appearance, density, locale],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
