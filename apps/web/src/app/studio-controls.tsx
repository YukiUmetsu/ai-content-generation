import { Eye, Keyboard, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { usePreferences } from "./use-preferences";

interface StudioControlsProps {
  collapsed: boolean;
  onOpenShortcuts: () => void;
}

export function StudioControls({ collapsed, onOpenShortcuts }: StudioControlsProps) {
  const { appearance, setAppearance, density, setDensity, locale, setLocale } = usePreferences();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const nextAppearance = appearance === "light" ? "dark" : "light";
  const appearanceLabel =
    locale === "ja"
      ? nextAppearance === "dark" ? "ダークモードに切り替え" : "ライトモードに切り替え"
      : nextAppearance === "dark" ? "Switch to dark mode" : "Switch to light mode";
  const settingsLabel = locale === "ja" ? "表示設定" : "View settings";
  const shortcutsLabel = locale === "ja" ? "ショートカット" : "Shortcuts";

  return (
    <>
      <div
        role="toolbar"
        aria-label={locale === "ja" ? "スタジオ設定" : "Studio settings"}
        className={"flex gap-1 " + (collapsed ? "flex-col items-center" : "items-center justify-between")}
      >
        <Button
          variant="subtle"
          size="icon"
          aria-label={appearanceLabel}
          title={appearanceLabel}
          onClick={() => setAppearance(nextAppearance)}
          icon={nextAppearance === "dark"
            ? <Moon aria-hidden className="size-4" />
            : <Sun aria-hidden className="size-4" />}
        />
        <Button
          variant="outline"
          size="icon"
          aria-label={settingsLabel}
          title={settingsLabel}
          icon={<Eye aria-hidden className="size-4" />}
          onClick={() => setSettingsOpen(true)}
        />
        <Button
          variant="outline"
          size="icon"
          aria-label={shortcutsLabel}
          title={shortcutsLabel}
          icon={<Keyboard aria-hidden className="size-4" />}
          onClick={onOpenShortcuts}
        />
      </div>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen} title={settingsLabel} size="sm">
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
              {locale === "ja" ? "密度" : "Density"}
            </legend>
            <div className="flex items-center rounded-control border border-border p-0.5">
              <Button
                variant={density === "compact" ? "primary" : "subtle"}
                size="sm"
                aria-pressed={density === "compact"}
                className="flex-1"
                onClick={() => setDensity("compact")}
              >
                {locale === "ja" ? "コンパクト" : "Compact"}
              </Button>
              <Button
                variant={density === "spacious" ? "primary" : "subtle"}
                size="sm"
                aria-pressed={density === "spacious"}
                className="flex-1"
                onClick={() => setDensity("spacious")}
              >
                {locale === "ja" ? "スペース広め" : "Spacious"}
              </Button>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
              {locale === "ja" ? "言語" : "Language"}
            </legend>
            <div className="flex items-center rounded-control border border-border p-0.5">
              <Button
                variant={locale === "en" ? "primary" : "subtle"}
                size="sm"
                aria-pressed={locale === "en"}
                className="flex-1"
                onClick={() => setLocale("en")}
              >
                English
              </Button>
              <Button
                variant={locale === "ja" ? "primary" : "subtle"}
                size="sm"
                aria-pressed={locale === "ja"}
                className="flex-1"
                onClick={() => setLocale("ja")}
              >
                日本語
              </Button>
            </div>
          </fieldset>
        </div>
      </Dialog>
    </>
  );
}
