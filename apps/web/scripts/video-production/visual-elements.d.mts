export interface VisualElement {label:string;detail:string}
export declare function isVisualElements(value:unknown):value is VisualElement[];
export declare function normalizeVisualElements(value:VisualElement[]):VisualElement[];
