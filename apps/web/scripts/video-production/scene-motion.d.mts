export interface SceneMotion {
  revealDelayPercent:number;
  revealPace:"snappy"|"balanced"|"deliberate";
  camera:"locked"|"subtle"|"cinematic";
  transition:"cut"|"fade";
}
export declare const DEFAULT_SCENE_MOTION:Readonly<SceneMotion>;
export declare function isSceneMotion(value:unknown):value is SceneMotion;
export declare function normalizedSceneMotion(value?:SceneMotion):SceneMotion;
export declare function motionRevealState(input:{frame:number;frames:number;itemCount:number;intent:string;motion?:SceneMotion}):{
  visibleItems:number;revealStartFrame:number;revealStepFrames:number;
};
export declare function entryFadeOpacity(frame:number,frames:number,motion?:SceneMotion):number;
