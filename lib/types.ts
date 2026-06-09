export interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface StyleBox {
  id: string;
  confirmed: boolean;
  box: Box;
}

export interface NailStyle {
  id: string;
  label: string;
  category: string;
  sourceGroup?: "left" | "right";
  imageUrl?: string;
  pieceSrc?: string;
  previewSrc?: string;
  styleSrc?: string;
  rotation: number;
  flipVertical: boolean;
  // CSS 裁切方式，不依赖 canvas
  sourceImageUrl?: string;
  sourceBox?: { x: number; y: number; width: number; height: number };
}

export interface TargetNail {
  id: string;
  label: string;
  fingerName?: "thumb" | "index" | "middle" | "ring" | "pinky";
  originalBox: Box;
  currentBox: Box;
  longBox?: Box;
  directionVector: { x: number; y: number };
  lengthMultiplier?: number;
}

export interface Placement {
  id: string;
  targetNailId: string;
  styleId: string | null;
  rotation: number;
  flipVertical: boolean;
}

export type TryOnMode = "normal" | "long";

export interface TryOnPayload {
  mode: TryOnMode;
  styleImageUrl: string;
  targetImageUrl: string;
  confirmedStyleBoxes: StyleBox[];
  extractedStyles: NailStyle[];
  targetNails: TargetNail[];
  placements: Placement[];
}
