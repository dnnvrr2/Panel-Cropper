import type { AspectRatio } from "../types/project";

export const ASPECT_RATIOS: Array<{ label: AspectRatio; value: number; shortcut: string }> = [
  { label: "9:16", value: 9 / 16, shortcut: "1" },
  { label: "4:5", value: 4 / 5, shortcut: "2" },
  { label: "4:3", value: 4 / 3, shortcut: "3" },
  { label: "1:1", value: 1, shortcut: "4" },
];

export function aspectValue(ratio: AspectRatio): number {
  return ASPECT_RATIOS.find((item) => item.label === ratio)?.value ?? 9 / 16;
}

