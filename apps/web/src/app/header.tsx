import { Eye, Keyboard, Moon, PanelLeft, Search, Sun } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FEATURE_METADATA, type FeatureId, type Locale } from "@/features/registry";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { sectionLabel, type SectionId } from "./navigation";
import { usePreferences } from "./use-preferences";

interface HeaderProps {
  activeSection: SectionId;
  activeFeatureId: FeatureId;
  filter: string;
  onFilterChange: (value: string) => void;
  onOpenNav: () => void;
  shortcutsOpen?: boolean;
  onShortcutsOpenChange?: (open: boolean) => void;
}

function featureLabel(id: FeatureId, locale: Locale): string {
  return locale === "ja" ? FEATURE_METADATA[id].titleJa : FEATURE_METADATA[id].title;
}

function ViewPreferencesDialog({ locale }: { locale: Locale }) {
  const { density, setDensity, setLocale } = usePreferences();
  const [open, setOpen] = useState(false);
  const title = locale === "ja" ? "表示設定" : "View settings";

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        aria-label={title}
        title={title}
        icon={<Eye aria-hidden className="size-4" />}
        onClick={() => setOpen(true)}
      />
      <Dialog open={open} onOpenChange={setOpen} title={title} size="sm">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
              {locale === "ja" ? "密度" : "Density"}
            </span>
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
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
              {locale === "ja" ? "言語" : "Language"}
            </span>
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
          </div>
        </div>
      </Dialog>
    </>
  );
}

export function Header({
  activeSection,
  activeFeatureId,
  filter,
  onFilterChange,
  onOpenNav,
  shortcutsOpen,
  onShortcutsOpenChange,
}: HeaderProps) {
  const { appearance, setAppearance, locale } = usePreferences();

  const nextAppearance = appearance === "light" ? "dark" : "light";
  const appearanceLabel =
    locale === "ja"
      ? nextAppearance === "dark"
        ? "ダークモードに切り替え"
        : "ライトモードに切り替え"
      : nextAppearance === "dark"
        ? "Switch to dark mode"
        : "Switch to light mode";

  return (
    <header className="flex shrink-0 flex-col gap-3 border-b border-border bg-surface px-3 py-2 lg:px-4">
      <div className="flex min-w-0 items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          className="lg:hidden"
          aria-label={locale === "ja" ? "ナビゲーションを開く" : "Open navigation"}
          title={locale === "ja" ? "ナビゲーションを開く" : "Open navigation"}
          onClick={onOpenNav}
        >
          <PanelLeft aria-hidden className="size-4" />
        </Button>

        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center text-sm">
          <span className="shrink-0 whitespace-nowrap font-medium text-foreground">
            {sectionLabel(activeSection, locale)}
          </span>
          {activeSection === "create" && (
            <>
              <span className="mx-2 shrink-0 text-muted-foreground" aria-hidden="true">/</span>
              <span
                className="min-w-0 truncate text-muted-foreground"
                title={featureLabel(activeFeatureId, locale)}
              >
                {featureLabel(activeFeatureId, locale)}
              </span>
            </>
          )}
        </nav>

        <div
          className="flex shrink-0 items-center gap-1 rounded-control border border-border bg-surface p-1"
          role="toolbar"
          aria-label={locale === "ja" ? "スタジオツールバー" : "Studio toolbar"}
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
          <ViewPreferencesDialog locale={locale} />
          <div className="border-l border-border pl-1">
            <Button
              variant="outline"
              size="icon"
              aria-label={locale === "ja" ? "ショートカット" : "Shortcuts"}
              title={locale === "ja" ? "ショートカット" : "Shortcuts"}
              icon={<Keyboard aria-hidden className="size-4" />}
              onClick={() => onShortcutsOpenChange?.(true)}
            />
          </div>
          <ShortcutsDialog
            open={shortcutsOpen}
            onOpenChange={onShortcutsOpenChange}
            showTrigger={false}
          />
        </div>
      </div>

      {activeSection === "create" && (
        <div className="flex items-center gap-2">
          <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <Input
            type="search"
            value={filter}
            onChange={(event) => onFilterChange(event.target.value)}
            placeholder={locale === "ja" ? "ツールを検索..." : "Find tools..."}
            className="w-full"
            aria-label={locale === "ja" ? "ツールを検索" : "Find tools"}
            data-shortcut="filter"
          />
        </div>
      )}
    </header>
  );
}
