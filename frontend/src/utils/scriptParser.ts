import type { Paragraph } from "../types/project";

export function newParagraph(text = ""): Paragraph {
  return {
    id: crypto.randomUUID(),
    text,
    aspectRatio: "9:16",
    zoom: 1,
    viewZoom: 1,
    rotation: 0,
    panX: 0,
    panY: 0,
    completed: false,
  };
}

export function parseScript(script: string, existing: Paragraph[] = []): Paragraph[] {
  const sections = script
    .split(/\r?\n/g)
    .map((text) => text.trim())
    .filter(Boolean);
  return sections.map((text, index) =>
    existing[index] ? { ...existing[index], text } : newParagraph(text),
  );
}
