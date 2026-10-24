import type { Paragraph } from "../types/project";

export interface ImageUsage {
  cropped: string[];
  assigned: string[];
}

export function imageUsage(paragraphs: Paragraph[], prefix = ""): Map<string, ImageUsage> {
  const result = new Map<string, ImageUsage>();
  paragraphs.forEach((paragraph, index) => {
    const imageId = paragraph.completed ? paragraph.sourceImageId
      : paragraph.draftImageId !== undefined ? paragraph.draftImageId : paragraph.sourceImageId;
    if (!imageId) return;
    const usage = result.get(imageId) ?? { cropped: [], assigned: [] };
    (paragraph.completed ? usage.cropped : usage.assigned).push(prefix + String(index + 1).padStart(3, "0"));
    result.set(imageId, usage);
  });
  return result;
}
