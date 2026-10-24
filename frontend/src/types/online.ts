export interface OnlineConnection {
  serverUrl: string;
  username: string;
  hasPassword: boolean;
}

export interface OnlineSource {
  id: string;
  name: string;
  displayName: string;
  lang: string;
  supportsLatest?: boolean;
}

export interface OnlineCategory { id: number; name: string; order: number; size?: number }
export interface OnlineBrowseSpec {
  query: string; source: string; language: string; mode: "popular" | "latest";
  category: string; genre: string;
}

export interface OnlineSeries {
  id: number;
  title: string;
  sourceId: string;
  author?: string | null;
  artist?: string | null;
  description?: string | null;
  genre?: string[];
  status?: string;
  source?: OnlineSource | null;
}

export interface OnlineChapter {
  id: number;
  index: number;
  mangaId: number;
  name: string;
  chapterNumber: number;
  uploadDate: number;
  scanlator?: string | null;
  pageCount: number;
  read: boolean;
  downloaded: boolean;
}

export interface OnlineSearchResult {
  mangaList: OnlineSeries[];
  hasNextPage: boolean;
  failures: { source: string; message: string }[];
}

export interface OnlineChapterRequest {
  mangaId: number;
  chapterIndex: number;
  chapterId: number;
}

export interface OnlinePageRequest extends OnlineChapterRequest {
  pageIndex: number;
  includeNext: boolean;
}

export interface OnlineChapterJob {
  jobId: string;
  state: "pending" | "loading" | "complete" | "failed";
  completedPages: number;
  totalPages: number;
  result?: { imageId: string; groupId: string; existing: boolean };
  error?: string;
}

export interface OnlineChapterNavigation {
  serverUrl: string;
  mangaId: number;
  chapterId: number;
  label: string;
  previous?: () => void;
  next?: () => void;
}
