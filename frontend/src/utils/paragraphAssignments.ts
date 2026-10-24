import type { Paragraph } from "../types/project";

export function clearParagraphImage(paragraph: Paragraph): Paragraph {
  return {
    ...paragraph,
    sourceImageId: undefined,
    draftImageId: null,
    crop: undefined,
    zoom: 1,
    viewZoom: 1,
    rotation: 0,
    panX: 0,
    panY: 0,
    completed: false,
    outputFile: undefined,
    outputWidth: undefined,
    outputHeight: undefined,
  };
}
