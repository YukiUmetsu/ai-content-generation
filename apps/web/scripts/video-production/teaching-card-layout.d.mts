export interface TeachingCardLayoutInput {
  label: string;
  note: string;
  width: number;
  height: number;
}
export interface TeachingCardLineLayout {
  lines: string[];
  fontSize: number;
  baselines: number[];
  leading: number;
}
export interface TeachingCardLayout {
  title: TeachingCardLineLayout;
  detail: TeachingCardLineLayout;
  maxWidth: number;
  titleBottom: number;
  detailTop: number;
  contentBottom: number;
}
export declare function layoutTeachingCard(input: TeachingCardLayoutInput): TeachingCardLayout;
