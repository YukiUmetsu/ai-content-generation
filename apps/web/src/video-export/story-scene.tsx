/** A directed object story on the film's frame clock. */
import { useMemo } from "react";
import type { CSSProperties } from "react";
import { compileObjectStory } from "@/components/video/object-story";
import type { ObjectStorySpec } from "@/components/video/object-story";
import { ObjectStory, createStoryTextMeasure } from "@/components/video/object-story-react";
import { StoryArt } from "./story-art";

const CAPTION_FONT = "700 {size}px 'Geist Variable', Geist, Arial, sans-serif";

/** Each section of a film has its own light, so a viewer feels the film move on. Edit to restyle. */
const SECTION_TONES = [["#1d3a52", "#65dbc7"], ["#3a2a52", "#b7a3ff"], ["#143f3c", "#7fe0a8"], ["#4a2f1f", "#f4b860"], ["#1f3560", "#7fb6ff"], ["#4a2238", "#f39ac0"]] as const;

export function StoryScene({ spec, localFrame, section = 0 }: { spec: ObjectStorySpec; localFrame: number; section?: number }) {
  const plan = useMemo(() => {
    const compiled = compileObjectStory(spec, { measure: createStoryTextMeasure(), captionFont: CAPTION_FONT });
    if (!compiled.ok) throw new Error(`Story ${spec.id}: ${compiled.diagnostics.filter(item => item.severity === "error").map(item => item.message).join(" ")}`);
    return compiled.plan;
  }, [spec]);
  const [glow, accent] = SECTION_TONES[section % SECTION_TONES.length];
  return <ObjectStory plan={plan} frame={localFrame} style={{ fontFamily: "'Geist Variable', Geist, Arial, sans-serif", "--km-shot-glow": glow, "--km-shot-accent": accent } as CSSProperties}
    renderObject={(object, size) => (object.art ? <StoryArt name={object.art} {...size} /> : null)} />;
}
