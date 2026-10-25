export type DirectorWorkflowStage = "storyboard" | "assets" | "sound" | "preview";

export declare const directorStages: readonly Readonly<{
  id: DirectorWorkflowStage;
  number: string;
  label: string;
  detail: string;
}>[];

export declare function nextDirectorStage(current: DirectorWorkflowStage): DirectorWorkflowStage | null;
export declare function shouldInvalidateDirectorReadiness(
  current: DirectorWorkflowStage,
  target: DirectorWorkflowStage,
): boolean;
export declare function resolveDirectorNavigation(input: {
  current: DirectorWorkflowStage;
  target: DirectorWorkflowStage;
  unsaved?: boolean;
}): { stage: DirectorWorkflowStage; blocked: boolean; message: string };
