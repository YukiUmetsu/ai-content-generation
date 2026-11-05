/** A directed object story on the film's frame clock. */
import { useMemo } from "react";
import { compileObjectStory } from "@/components/video/object-story";
import type { ObjectStorySpec } from "@/components/video/object-story";
import { ObjectStory, createStoryTextMeasure } from "@/components/video/object-story-react";
import { StoryArt } from "./story-art";

const CAPTION_FONT = "700 {size}px 'Geist Variable', Geist, Arial, sans-serif";

export function StoryScene({ spec, localFrame }: { spec: ObjectStorySpec; localFrame: number }) {
  const plan = useMemo(() => {
    const compiled = compileObjectStory(spec, { measure: createStoryTextMeasure(), captionFont: CAPTION_FONT });
    if (!compiled.ok) throw new Error(`Story ${spec.id}: ${compiled.diagnostics.filter(item => item.severity === "error").map(item => item.message).join(" ")}`);
    return compiled.plan;
  }, [spec]);
  return <ObjectStory plan={plan} frame={localFrame} style={{ fontFamily: "'Geist Variable', Geist, Arial, sans-serif" }}
    renderObject={(object, size) => (object.art ? <StoryArt name={object.art} {...size} /> : null)} />;
}
