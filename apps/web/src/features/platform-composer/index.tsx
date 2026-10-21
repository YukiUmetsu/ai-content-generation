import type { FeatureSlotProps } from "@/features/registry";
import { FEATURE_METADATA } from "@/features/registry";
import { FeatureSlotShell } from "@/app/feature-slot-shell";

export default function PlatformComposerSlot(props: FeatureSlotProps) {
  return (
    <FeatureSlotShell
      meta={FEATURE_METADATA["platform-composer"]}
      locale={props.locale}
      className={props.className}
    />
  );
}
