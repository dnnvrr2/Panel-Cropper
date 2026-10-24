import type { Paragraph } from "../types/project";

export function queueParagraphs(paragraphs: Paragraph[]): Paragraph[] {
  return [
    ...paragraphs.filter((paragraph) => !paragraph.completed),
    ...paragraphs.filter((paragraph) => paragraph.completed),
  ];
}
