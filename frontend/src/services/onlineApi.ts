import type { OnlineBrowseSpec, OnlineCategory, OnlineChapter, OnlineConnection, OnlineSearchResult, OnlineSeries, OnlineSource } from "../types/online";

async function request<T>(path: string, signal?: AbortSignal, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/online${path}`, { ...options, signal });
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try { detail = (await response.json()).detail ?? detail; } catch {}
    if (response.status === 404 && path === "/connection") detail = "Restart Panel Cropper to enable online reading.";
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export const onlineApi = {
  connection: (signal?: AbortSignal) => request<OnlineConnection>("/connection", signal),
  configure: (serverUrl: string, username: string, password?: string) => request<OnlineConnection>("/connection", undefined, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverUrl, username, ...(password !== undefined ? { password } : {}) }),
  }),
  sources: (signal?: AbortSignal) => request<OnlineSource[]>("/sources", signal),
  categories: (signal?: AbortSignal) => request<OnlineCategory[]>("/categories", signal),
  genres: (source: string, category: string, signal?: AbortSignal) =>
    request<{ genres: string[]; hints: string[] }>(`/genres?${new URLSearchParams({ source, ...(category ? { category } : {}) })}`, signal),
  search: (spec: OnlineBrowseSpec, page: number, signal?: AbortSignal) =>
    request<OnlineSearchResult>(`/search?${new URLSearchParams({ q: spec.query, source: spec.source,
      page: String(page), language: spec.language, mode: spec.mode, genre: spec.genre,
      ...(spec.source === "library" && spec.category ? { category: spec.category } : {}) })}`, signal),
  series: (id: number, signal?: AbortSignal) => request<OnlineSeries>(`/series/${id}`, signal),
  chapters: (id: number, refresh = false, signal?: AbortSignal) =>
    request<OnlineChapter[]>(`/series/${id}/chapters?refresh=${refresh}`, signal),
  chapter: (mangaId: number, chapterIndex: number, signal?: AbortSignal) =>
    request<OnlineChapter>(`/series/${mangaId}/chapters/${chapterIndex}`, signal),
  coverUrl: (id: number, serverUrl: string) => `/api/online/series/${id}/cover?server=${encodeURIComponent(serverUrl)}`,
  pageUrl: (mangaId: number, chapterIndex: number, pageIndex: number, serverUrl: string) =>
    `/api/online/series/${mangaId}/chapters/${chapterIndex}/pages/${pageIndex}?server=${encodeURIComponent(serverUrl)}`,
};
