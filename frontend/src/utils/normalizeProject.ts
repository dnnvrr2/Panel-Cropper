import type { Project, SourceGroup } from "../types/project";

// Older backend processes can still return projects written before source groups existed.
export function normalizeProject(project: Project): Project {
  const groups = Array.isArray(project.sourceGroups) ? [...project.sourceGroups] : [];
  const validIds = new Set(groups.map((group) => group.id));
  const ungrouped = project.images.some((image) => !validIds.has(image.sourceGroupId));
  if (!ungrouped) return { ...project, sourceGroups: groups };

  let projectFiles = groups.find((group) => group.kind === "project-files");
  if (!projectFiles) {
    projectFiles = {
      id: `legacy-project-files-${project.id}`,
      name: "Project files",
      kind: "project-files",
      createdAt: project.createdAt ?? project.updatedAt,
    } satisfies SourceGroup;
    groups.push(projectFiles);
  }
  const groupId = projectFiles.id;
  return {
    ...project,
    sourceGroups: groups,
    images: project.images.map((image) => validIds.has(image.sourceGroupId)
      ? image : { ...image, sourceGroupId: groupId }),
  };
}
