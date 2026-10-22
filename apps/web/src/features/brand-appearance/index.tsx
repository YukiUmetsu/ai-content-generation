import type { FeatureSlotProps } from "@/features/registry";
import { BrandAppearanceStudio } from "./BrandAppearanceStudio";

export { BrandAppearanceStudio } from "./BrandAppearanceStudio";

export default function BrandAppearanceSlot(props: FeatureSlotProps) {
  return (
    <BrandAppearanceStudio
      locale={props.locale}
      className={props.className}
      onPreviewChange={props.onPreviewChange}
    />
  );
}
