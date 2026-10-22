import { PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sectionLabel, type SectionId } from "./navigation";
import { usePreferences } from "./use-preferences";

interface HeaderProps {
  activeSection: SectionId;
  onOpenNav: () => void;
}

/** Secondary-section header only. Create uses the full workspace canvas. */
export function Header({ activeSection, onOpenNav }: HeaderProps) {
  const { locale } = usePreferences();

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-3 py-2 lg:px-4">
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
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1 text-sm">
        <span className="font-medium text-foreground">{sectionLabel(activeSection, locale)}</span>
      </nav>
    </header>
  );
}
