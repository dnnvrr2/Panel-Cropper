import type { Paragraph, Project } from "../types/project";

export const cropCollection = (project: Project) => project.cropMode === "free" ? "freeCrops" : "paragraphs";
export const cropItems = (project: Project): Paragraph[] => project.cropMode === "read" ? [] : project[cropCollection(project)] ?? [];
