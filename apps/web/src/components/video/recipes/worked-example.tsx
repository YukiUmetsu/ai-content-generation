/** Semantic template: worked-example. Reuses the shared deterministic scene stage. */
import { forwardRef } from "react";
import { SceneTemplateView } from "../scene-templates-react";
import type { SceneTemplateViewProps } from "../scene-templates-react";

export type WorkedExampleSceneProps = SceneTemplateViewProps<"worked-example">;
export const WorkedExampleScene = forwardRef<HTMLDivElement,WorkedExampleSceneProps>(
  function WorkedExampleScene({spec,...props},ref) {
    return <SceneTemplateView {...props} spec={spec} ref={ref}/>;
  }
);
