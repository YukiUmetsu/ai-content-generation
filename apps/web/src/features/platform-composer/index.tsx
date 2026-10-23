import type { FeatureSlotProps } from "@/features/registry";
import { PlatformComposer } from "./PlatformComposer";
export default function PlatformComposerSlot(props:FeatureSlotProps) {
  return <PlatformComposer {...props}/>;
}
