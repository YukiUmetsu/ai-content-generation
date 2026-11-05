/** Offline shot bake: JSON in, ShotBake JSON out. Runs in Node, never in the export page.
 * CC1 uses Three.js math. Keeping this entry separate keeps Three.js out of the video export bundle.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { compileInteraction } from "@/components/motion/interaction-choreography";
import type { InteractionSpec } from "@/components/motion/interaction-choreography";
import { bakeShot, serializeShotBake } from "@/components/motion/shot-bake";
import type { LightKey, ShotBakeActor } from "@/components/motion/shot-bake";
import type { CameraSequenceSpec, CameraTarget } from "@/components/motion/cinematic-camera-types";

export interface ShotBakeRequest {
  id: string;
  width: number;
  height: number;
  interaction: InteractionSpec;
  actors: ShotBakeActor[];
  camera: CameraSequenceSpec;
  targets?: CameraTarget[];
  lights?: Record<string, LightKey[]>;
  viewAngleExempt?: { startFrame: number; endFrame: number }[];
}

export function bakeRequest(request: ShotBakeRequest) {
  const interaction = compileInteraction(request.interaction);
  if (!interaction.ok) return { ok: false as const, diagnostics: interaction.diagnostics };
  return bakeShot({ ...request, interaction: interaction.plan });
}

const [input, output] = process.argv.slice(2);
if (input && output) {
  const result = bakeRequest(JSON.parse(readFileSync(input, "utf8")) as ShotBakeRequest);
  if (!result.ok) {
    process.stderr.write(`${JSON.stringify(result.diagnostics)}\n`);
    process.exitCode = 2;
  } else {
    writeFileSync(output, serializeShotBake(result.bake));
    process.stdout.write(`${JSON.stringify({ frames: result.bake.duration_frames, contacts: result.bake.contacts })}\n`);
  }
}
