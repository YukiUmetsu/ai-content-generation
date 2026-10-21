import type { FeatureId, FeatureSlot } from "./registry";
import BrandAppearance from "./brand-appearance";
import ThumbnailComposer from "./thumbnail-composer";
import StoryboardPlanner from "./storyboard-planner";
import MotionGallery from "./motion-gallery";
import PlatformComposer from "./platform-composer";

export const FEATURE_SLOTS: Record<FeatureId, FeatureSlot> = {
  "brand-appearance": BrandAppearance,
  "thumbnail-composer": ThumbnailComposer,
  "storyboard-planner": StoryboardPlanner,
  "motion-gallery": MotionGallery,
  "platform-composer": PlatformComposer,
};
