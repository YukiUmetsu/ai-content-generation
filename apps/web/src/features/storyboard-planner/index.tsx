import type { FeatureSlotProps } from "@/features/registry";
import { StoryboardPlanner } from "./StoryboardPlanner";

export { StoryboardPlanner };
export type { StoryboardPlannerProps } from "./StoryboardPlanner";

export default function StoryboardPlannerSlot(props: FeatureSlotProps) {
  return (
    <StoryboardPlanner
      locale={props.locale}
      className={props.className}
      onPreviewChange={props.onPreviewChange}
    />
  );
}
