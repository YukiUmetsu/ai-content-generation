/** What an object story's art names resolve to. Shared by the film and its thumbnails.
 * Illustrated objects come from Kumiki. Everyday concepts use a Lucide icon on a tinted plate.
 */
import { icons } from "lucide-react";
import { FinanceObject2D } from "@/components/domains/finance-object-2d";
import { BusinessObject2D } from "@/components/domains/business-object-2d";
import { TechnologyObject2D } from "@/components/domains/technology-object-2d";
import type { FinanceObjectKind } from "@/components/domains/finance-object-model";
import type { BusinessObjectKind } from "@/components/domains/business-object-model";
import type { TechnologyObjectKind } from "@/components/domains/technology-object-model";

/** Plate and glyph colours. An icon keeps its colour wherever it appears. */
const ICON_TONES = [["#17473f", "#65dbc7"], ["#4a3a1c", "#f4b860"], ["#2f3a63", "#9db4ff"], ["#4c2a3a", "#f39ac0"], ["#1f4256", "#7fd0f2"]] as const;
const toneOf = (name: string) => ICON_TONES[[...name].reduce((sum, character) => sum + character.charCodeAt(0), 0) % ICON_TONES.length];

function IconArt({ name, width, height }: { name: string; width: number; height: number }) {
  const Icon = icons[name as keyof typeof icons];
  if (!Icon) throw new Error(`Unknown story icon "${name}".`);
  const size = Math.min(width, height) * .86, [plate, ink] = toneOf(name);
  return <svg xmlns="http://www.w3.org/2000/svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} data-story-icon={name}>
    <circle cx={width / 2} cy={height / 2} r={size / 2} fill={plate} />
    <Icon x={(width - size * .56) / 2} y={(height - size * .56) / 2} width={size * .56} height={size * .56} color={ink} strokeWidth={1.6} />
  </svg>;
}

export function StoryArt({ name, width, height }: { name: string; width: number; height: number }) {
  const [family, kind] = name.split(":");
  const size = { width, height, showTitle: false, reducedMotion: true } as const;
  if (family === "finance") return <FinanceObject2D spec={{ id: kind, kind: kind as FinanceObjectKind }} {...size} />;
  if (family === "business") return <BusinessObject2D spec={{ id: kind, kind: kind as BusinessObjectKind }} {...size} />;
  if (family === "technology") return <TechnologyObject2D spec={{ id: kind, kind: kind as TechnologyObjectKind }} {...size} />;
  if (family === "icon") return <IconArt name={kind} width={width} height={height} />;
  throw new Error(`Unknown story art "${name}".`);
}
