import type { PreviewRotation } from "../utils/previewRotation";

export type AspectRatio = "9:16" | "4:5" | "4:3" | "1:1";

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StripPage {
  id: string;
  filename: string;
  path: string;
  width: number;
  height: number;
  top: number;
  stripHeight: number;
}

export interface SourceImage {
  id: string;
  filename: string;
  path: string;
  width: number;
  height: number;
  sourceGroupId: string;
  relativePath?: string;
  stripPages?: StripPage[];
  onlineOrigin?: { serverUrl: string; mangaId: number; chapterId: number; chapterIndex: number; pageIndices: number[]; wholeChapter?: boolean };
}

export interface SourceGroup {
  id: string;
  name: string;
  kind: "folder" | "project-files" | "cbz" | "online";
  originalPath?: string;
  createdAt: string;
}

export interface Paragraph {
  id: string;
  text: string;
  sourceImageId?: string;
  draftImageId?: string | null;
  aspectRatio: AspectRatio;
  crop?: CropRect;
  zoom: number;
  viewZoom?: number;
  rotation?: PreviewRotation;
  panX: number;
  panY: number;
  completed: boolean;
  outputFile?: string;
  outputWidth?: number;
  outputHeight?: number;
}

export interface Project {
  id: string;
  projectName: string;
  outputFolder: string;
  defaultAspectRatio: AspectRatio;
  images: SourceImage[];
  sourceGroups: SourceGroup[];
  paragraphs: Paragraph[];
  cropMode?: "script" | "free" | "read";
  freeCrops?: Paragraph[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary {
  id: string;
  projectName: string;
  outputFolder: string;
  updatedAt?: string;
  imageCount: number;
  paragraphCount: number;
}
