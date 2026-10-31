/** Semantic template: before-after. Reuses the shared deterministic scene stage. */
import { forwardRef } from "react";
import { SceneTemplateView } from "../scene-templates-react";
import type { SceneTemplateViewProps } from "../scene-templates-react";

export type BeforeAfterSceneProps = SceneTemplateViewProps<"before-after">;
export const BeforeAfterScene = forwardRef<HTMLDivElement,BeforeAfterSceneProps>(
  function BeforeAfterScene({spec,...props},ref) {
    return <SceneTemplateView {...props} spec={spec} ref={ref}/>;
  }
);
