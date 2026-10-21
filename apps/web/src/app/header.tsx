import { Eye, Keyboard, Moon, PanelLeft, Search, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FEATURE_METADATA, type FeatureId, type Locale } from "@/features/registry";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { sectionLabel, type SectionId } from "./navigation";
import { usePreferences } from "./use-preferences";
import { useState } from "react";

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
  const { appearance, setAppearance, density, setDensity, locale, setLocale } = usePreferences();

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
    <header className="flex shrink-0 flex-col gap-3 border-b border-border bg-surface px-3 py-3 lg:px-4">
      <div className="flex items-start gap-2">
        <Button
          variant="outline"
          size="icon"
          className="mt-0.5 lg:hidden"
          aria-label={locale === "ja" ? "ナビゲーションを開く" : "Open navigation"}
          title={locale === "ja" ? "ナビゲーションを開く" : "Open navigation"}
          onClick={onOpenNav}
        >
          <PanelLeft aria-hidden className="size-4" />
        </Button>

        <nav
          aria-label="Breadcrumb"
          className="flex min-w-[140px] flex-1 items-center text-sm"
        >
          <span className="shrink-0 whitespace-nowrap font-medium text-foreground">
            {sectionLabel(activeSection, locale)}
          </span>
          {activeSection === "create" && (
            <>
              <span className="mx-2 shrink-0 text-muted-foreground" aria-hidden="true">
                /
              </span>
              <span
                className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]"
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
          {/* Compact toolbar on smaller screens */}
          <div className="flex items-center gap-0.5 xl:hidden">
            <Button
              variant="subtle"
              size="icon"
              aria-label={appearanceLabel}
              title={appearanceLabel}
              onClick={() => setAppearance(nextAppearance)}
              icon={
                nextAppearance === "dark" ? (
                  <Moon aria-hidden className="size-4" />
                ) : (
                  <Sun aria-hidden className="size-4" />
                )
              }
            />
          </div>

          <div className="flex items-center gap-0.5 border-l border-border pl-1 xl:hidden">
            <ViewPreferencesDialog locale={locale} />
          </div>

          {/* Full toolbar on xl+ */}
          <div className="hidden items-center gap-0.5 xl:flex">
            <Button
              variant={appearance === "light" ? "primary" : "subtle"}
              size="sm"
              aria-pressed={appearance === "light"}
              aria-label="Light"
              title="Light"
              onClick={() => setAppearance("light")}
              icon={<Sun aria-hidden className="size-4" />}
            >
              Light
            </Button>
            <Button
              variant={appearance === "dark" ? "primary" : "subtle"}
              size="sm"
              aria-pressed={appearance === "dark"}
              aria-label="Dark"
              title="Dark"
              onClick={() => setAppearance("dark")}
              icon={<Moon aria-hidden className="size-4" />}
            >
              Dark
            </Button>
          </div>

          <div className="hidden items-center gap-0.5 border-l border-border pl-1 xl:flex">
            <Button
              variant={density === "compact" ? "primary" : "subtle"}
              size="sm"
              aria-pressed={density === "compact"}
              aria-label="Compact"
              title="Compact"
              onClick={() => setDensity("compact")}
            >
              Compact
            </Button>
            <Button
              variant={density === "spacious" ? "primary" : "subtle"}
              size="sm"
              aria-pressed={density === "spacious"}
              aria-label="Spacious"
              title="Spacious"
              onClick={() => setDensity("spacious")}
            >
              Spacious
            </Button>
          </div>

          <div className="hidden items-center gap-0.5 border-l border-border pl-1 xl:flex">
            <Button
              variant={locale === "en" ? "primary" : "subtle"}
              size="sm"
              aria-pressed={locale === "en"}
              aria-label="English"
              title="English"
              onClick={() => setLocale("en")}
            >
              EN
            </Button>
            <Button
              variant={locale === "ja" ? "primary" : "subtle"}
              size="sm"
              aria-pressed={locale === "ja"}
              aria-label="日本語"
              title="日本語"
              onClick={() => setLocale("ja")}
            >
              日本語
            </Button>
          </div>

          <div className="hidden items-center gap-0.5 border-l border-border pl-1 lg:flex">
            <Button
              variant="outline"
              size="sm"
              aria-label={locale === "ja" ? "ショートカット" : "Shortcuts"}
              title={locale === "ja" ? "ショートカット" : "Shortcuts"}
              icon={<Keyboard aria-hidden className="size-4" />}
              onClick={() => onShortcutsOpenChange?.(true)}
            >
              {locale === "ja" ? "ショートカット" : "Shortcuts"}
            </Button>
          </div>

          {/* Dialog remains mounted so the ? keyboard shortcut works at every size. */}
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
