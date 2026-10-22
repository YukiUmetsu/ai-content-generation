import type { FeatureSlotProps } from "@/features/registry";
import { MotionMediaShowcase } from "./MotionMediaShowcase";

export { MotionMediaShowcase } from "./MotionMediaShowcase";

export default function MotionGallerySlot(props: FeatureSlotProps) {
  return (
    <MotionMediaShowcase
      locale={props.locale}
      className={props.className}
    />
  );
}
