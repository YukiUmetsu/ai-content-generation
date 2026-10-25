export { PlatformOptimization } from "./PlatformOptimization";
export {
  PLATFORM_NAMES,
  PLATFORM_TARGETS,
  approvePlatformPackage,
  composedPlatformCaption,
  createPlatformOptimizationManifest,
  markPlatformReviewed,
  normalizeTarget,
  platformExportManifest,
  reconcilePlatformOptimizationManifest,
  resetPlatformField,
  reviewPlatformPackage,
  sourceSignature,
  updatePlatformAsset,
  updatePlatformField,
} from "./model";
export type {
  PlatformAsset,
  PlatformBrandColors,
  PlatformChapter,
  PlatformField,
  PlatformMetadataFields,
  PlatformOptimizationInput,
  PlatformOptimizationManifest,
  PlatformPackage,
  PlatformScriptSection,
  PlatformTarget,
} from "./model";
export { loadPlatformOptimization, savePlatformOptimization } from "./storage";
