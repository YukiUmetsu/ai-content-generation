import { Button } from "@/components/ui/button";
import type { BrandState, Locale } from "../model/types";
import { copy } from "../i18n";

interface BrandSwitcherProps {
  brands: BrandState[];
  activeBrandId: string;
  onChange: (id: string) => void;
  locale: Locale;
}

export function BrandSwitcher({
  brands,
  activeBrandId,
  onChange,
  locale,
}: BrandSwitcherProps) {
  const t = copy(locale);
  return (
    <div
      className="ba-brand-switcher"
      role="group"
      aria-label={t.brandSwitcherLabel}
    >
      {brands.map((brand) => (
        <Button
          key={brand.id}
          variant={brand.id === activeBrandId ? "secondary" : "subtle"}
          size="sm"
          aria-pressed={brand.id === activeBrandId}
          onClick={() => onChange(brand.id)}
          className="ba-brand-switcher-button"
        >
          <span className="ba-brand-switcher-name">{brand.name}</span>
          <span className="ba-brand-switcher-revision">
            {t.revision} {brand.revision}
          </span>
        </Button>
      ))}
    </div>
  );
}
