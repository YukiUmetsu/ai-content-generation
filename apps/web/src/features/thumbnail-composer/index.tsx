import type { FeatureSlotProps } from "@/features/registry";
import { FEATURE_METADATA } from "@/features/registry";
import { FeatureSlotShell } from "@/app/feature-slot-shell";

export default function ThumbnailComposerSlot(props: FeatureSlotProps) {
  return (
    <FeatureSlotShell
      meta={FEATURE_METADATA["thumbnail-composer"]}
      locale={props.locale}
      className={props.className}
    />
  );
}
