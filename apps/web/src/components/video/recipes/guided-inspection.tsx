/** Semantic template: guided-inspection. Reuses the shared deterministic scene stage. */
import { forwardRef } from "react";
import { SceneTemplateView } from "../scene-templates-react";
import type { SceneTemplateViewProps } from "../scene-templates-react";

export type GuidedInspectionSceneProps = SceneTemplateViewProps<"guided-inspection">;
export const GuidedInspectionScene = forwardRef<HTMLDivElement,GuidedInspectionSceneProps>(
  function GuidedInspectionScene({spec,...props},ref) {
    return <SceneTemplateView {...props} spec={spec} ref={ref}/>;
  }
);
