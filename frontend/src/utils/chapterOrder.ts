import type { OnlineChapter } from "../types/online";

export function chapterOrder(chapters: OnlineChapter[], scanlator?: string | null): OnlineChapter[] {
  return chapters.filter((item) => scanlator === undefined || (item.scanlator ?? null) === scanlator)
    .sort((a, b) => a.chapterNumber - b.chapterNumber || b.index - a.index);
}
