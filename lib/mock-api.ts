import type { NailStyle, StyleBox, TargetNail } from "./types";

export async function detectNailsInStyleImage(_imageUrl: string): Promise<StyleBox[]> {
  await delay(200);
  return [];
}

export async function detectNailsInTargetHand(_imageUrl: string): Promise<TargetNail[]> {
  await delay(200);
  return [];
}

export async function extractStylesFromConfirmedBoxes(
  _imageUrl: string,
  boxes: StyleBox[],
): Promise<NailStyle[]> {
  await delay(300);
  return boxes.map((box, index) => ({
    id: `style_${box.id}`,
    label: `款式 ${index + 1}`,
    category: "全部",
    rotation: 0,
    flipVertical: false,
  }));
}

export async function generateTryOn(_payload: unknown): Promise<{ resultImageUrl: string }> {
  await delay(800);
  return { resultImageUrl: "/demo/quick-preview.png" };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
