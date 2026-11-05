/** A directed object story on the film's frame clock. Art names resolve to Kumiki's illustrated objects. */
import { useMemo } from "react";
import { compileObjectStory } from "@/components/video/object-story";
import type { ObjectStorySpec } from "@/components/video/object-story";
import { ObjectStory, createStoryTextMeasure } from "@/components/video/object-story-react";
import { FinanceObject2D } from "@/components/domains/finance-object-2d";
import { BusinessObject2D } from "@/components/domains/business-object-2d";
import { TechnologyObject2D } from "@/components/domains/technology-object-2d";
import type { FinanceObjectKind } from "@/components/domains/finance-object-model";
import type { BusinessObjectKind } from "@/components/domains/business-object-model";
import type { TechnologyObjectKind } from "@/components/domains/technology-object-model";

const CAPTION_FONT = "700 {size}px 'Geist Variable', Geist, Arial, sans-serif";

function StoryArt({ name, width, height }: { name: string; width: number; height: number }) {
  const [family, kind] = name.split(":");
  const size = { width, height, showTitle: false, reducedMotion: true } as const;
  if (family === "finance") return <FinanceObject2D spec={{ id: kind, kind: kind as FinanceObjectKind }} {...size} />;
  if (family === "business") return <BusinessObject2D spec={{ id: kind, kind: kind as BusinessObjectKind }} {...size} />;
  if (family === "technology") return <TechnologyObject2D spec={{ id: kind, kind: kind as TechnologyObjectKind }} {...size} />;
  throw new Error(`Unknown story art "${name}".`);
}

export function StoryScene({ spec, localFrame }: { spec: ObjectStorySpec; localFrame: number }) {
  const plan = useMemo(() => {
    const compiled = compileObjectStory(spec, { measure: createStoryTextMeasure(), captionFont: CAPTION_FONT });
    if (!compiled.ok) throw new Error(`Story ${spec.id}: ${compiled.diagnostics.filter(item => item.severity === "error").map(item => item.message).join(" ")}`);
    return compiled.plan;
  }, [spec]);
  return <ObjectStory plan={plan} frame={localFrame} style={{ fontFamily: "'Geist Variable', Geist, Arial, sans-serif" }}
    renderObject={(object, size) => (object.art ? <StoryArt name={object.art} {...size} /> : null)} />;
}
