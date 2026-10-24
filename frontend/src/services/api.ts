import type { Paragraph, Project, ProjectSummary } from "../types/project";
import { normalizeProject } from "../utils/normalizeProject";
import type { OnlineChapterJob, OnlineChapterRequest, OnlinePageRequest } from "../types/online";

const API_ROOT = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, options);
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: string };
      detail = body.detail ?? detail;
    } catch {}
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

const jsonOptions = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const projectRequest = async (path: string, options?: RequestInit) =>
  normalizeProject(await request<Project>(path, options));

const responseWithProject = async <T extends { project: Project }>(path: string, options?: RequestInit): Promise<T> => {
  const result = await request<T>(path, options);
  return { ...result, project: normalizeProject(result.project) };
};

export const api = {
  prepareOnlineChapter: (projectId: string, body: OnlineChapterRequest) =>
    request<OnlineChapterJob>(`/projects/${projectId}/source-groups/online-chapter`, jsonOptions("POST", body)).catch((error: unknown) => {
      if (error instanceof Error && error.message === "Not Found") throw new Error("Restart Panel Cropper to enable continuous online chapters.");
      throw error;
    }),
  onlineChapterJob: (jobId: string) => request<OnlineChapterJob>(`/online/chapter-jobs/${encodeURIComponent(jobId)}`),
  importOnlinePage: (projectId: string, body: OnlinePageRequest) =>
    responseWithProject<{ project: Project; groupId: string; imageId: string; existing: boolean }>(
      `/projects/${projectId}/source-groups/online`, jsonOptions("POST", body)),
  listProjects: () => request<ProjectSummary[]>("/projects"),
  loadProject: (id: string) => projectRequest(`/projects/${id}`),
  createProject: (projectName: string, outputFolder?: string) =>
    projectRequest("/projects", jsonOptions("POST", { projectName, ...(outputFolder ? { outputFolder } : {}) })),
  openProject: (folder: string) =>
    projectRequest("/projects/open", jsonOptions("POST", { folder })),
  selectFolder: (purpose: "output" | "source" = "output") =>
    request<{ path: string }>(`/filesystem/select-folder?purpose=${purpose}`, { method: "POST" }),
  importFolder: (projectId: string, path: string) =>
    responseWithProject<{ project: Project; groupId: string | null; imported: number; skipped: number; skippedReasons: string[]; existing: boolean }>(
      `/projects/${projectId}/source-groups/folder`, jsonOptions("POST", { path })).catch((error: unknown) => {
        if (error instanceof Error && error.message === "Not Found") {
          throw new Error("The running backend does not support folder imports yet. Restart Panel Cropper and try again.");
        }
        throw error;
      }),
  saveProject: (project: Project) =>
    projectRequest(`/projects/${project.id}`, jsonOptions("PUT", project)),
  uploadImages: async (projectId: string, files: File[]) => {
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    return responseWithProject<{ project: Project; imported: number }>(`/projects/${projectId}/images`, {
      method: "POST",
      body: form,
    });
  },
  removeImage: (projectId: string, imageId: string) =>
    projectRequest(`/projects/${projectId}/images/${imageId}`, { method: "DELETE" }),
  importCbz: async (projectId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return responseWithProject<{ project: Project; groupId: string; imageId: string; imported: number; skipped: number }>(
      `/projects/${projectId}/source-groups/cbz`, { method: "POST", body: form }).catch((error: unknown) => {
        if (error instanceof Error && error.message === "Not Found") {
          throw new Error("Restart Panel Cropper to enable CBZ imports.");
        }
        throw error;
      });
  },
  saveCrop: (projectId: string, paragraph: Paragraph, imageId: string, mode: "script" | "free" = "script") =>
    projectRequest(
      `/projects/${projectId}/crop`,
      jsonOptions("POST", {
        paragraphId: paragraph.id,
        mode,
        imageId,
        crop: paragraph.crop,
        aspectRatio: paragraph.aspectRatio,
        zoom: paragraph.zoom,
        rotation: paragraph.rotation ?? 0,
        panX: paragraph.panX,
        panY: paragraph.panY,
      }),
    ),
  exportAll: (projectId: string) =>
    responseWithProject<{ project: Project; exported: number; errors: string[] }>(
      `/projects/${projectId}/export`,
      { method: "POST" },
    ),
  imageUrl: (projectId: string, imageId: string) =>
    `${API_ROOT}/projects/${projectId}/images/${imageId}/content`,
  thumbnailUrl: (projectId: string, imageId: string) =>
    `${API_ROOT}/projects/${projectId}/images/${imageId}/thumbnail`,
  stripPageUrl: (projectId: string, imageId: string, pageId: string) =>
    `${API_ROOT}/projects/${projectId}/images/${imageId}/pages/${pageId}/content`,
};
