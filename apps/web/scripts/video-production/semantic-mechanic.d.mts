export type VisualOperator = "split" | "assemble" | "transfer" | "accumulate" | "compare" | "reveal";
export type VisualActorRole = "subject" | "part" | "source" | "destination" | "result";
export interface VisualActorV1 {
  id:string;
  label:string;
  role:VisualActorRole;
  assetKey?:string;
  claimIds:string[];
}
export interface VisualMechanicV1 {
  version:1;
  operator:VisualOperator;
  subjectId:string;
  actors:VisualActorV1[];
  operands:string[];
  outcomeId:string;
}
export interface MechanicFinding {
  severity:"error";
  code:string;
  path:string;
  message:string;
}
export declare const VISUAL_OPERATORS:readonly VisualOperator[];
export declare function validateVisualMechanic(mechanic:unknown,context?:{
  technicalSubjectId?:string;
  knownClaimIds?:ReadonlySet<string>;
  knownAssetKeys?:ReadonlySet<string>;
}):{ok:boolean;findings:MechanicFinding[]};
