import type { FeatureSlotProps } from "@/features/registry";
import { FEATURE_METADATA } from "@/features/registry";
import { FeatureSlotShell } from "@/app/feature-slot-shell";

export default function MotionGallerySlot(props: FeatureSlotProps) {
  return (
    <FeatureSlotShell
      meta={FEATURE_METADATA["motion-gallery"]}
      locale={props.locale}
      className={props.className}
    />
  );
}
