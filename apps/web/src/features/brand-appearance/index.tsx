import type { FeatureSlotProps } from "@/features/registry";
import { FEATURE_METADATA } from "@/features/registry";
import { FeatureSlotShell } from "@/app/feature-slot-shell";

export default function BrandAppearanceSlot(props: FeatureSlotProps) {
  return (
    <FeatureSlotShell
      meta={FEATURE_METADATA["brand-appearance"]}
      locale={props.locale}
      className={props.className}
    />
  );
}
