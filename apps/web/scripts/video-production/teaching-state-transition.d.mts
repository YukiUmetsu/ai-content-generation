export interface TeachingTransition {
  beforeVisible:boolean;
  actionVisible:boolean;
  afterVisible:boolean;
  beforeOpacity:number;
  actionOpacity:number;
  afterOpacity:number;
  travelProgress:number;
}
export declare function sampleTeachingTransition(input:{
  phase:"problem"|"mechanism"|"payoff";
  progress:number;
  payoffLocked?:boolean;
}):TeachingTransition;
