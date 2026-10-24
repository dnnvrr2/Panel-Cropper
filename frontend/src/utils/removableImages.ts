import type { Project } from "../types/project";

export function removableImageIds(project: Pick<Project, "images" | "paragraphs" | "freeCrops">, selectedIds: string[]): string[] {
  const availableIds = new Set(project.images.map((image) => image.id));
  const usedIds = new Set([...project.paragraphs, ...(project.freeCrops ?? [])].flatMap((paragraph) =>
    [paragraph.sourceImageId, paragraph.draftImageId].filter((id): id is string => Boolean(id))));
  return selectedIds.filter((id) => availableIds.has(id) && !usedIds.has(id));
}
