import { create } from "zustand";
import { api } from "../services/api";
import type { AspectRatio, CropRect, Paragraph, Project } from "../types/project";
import { newParagraph, parseScript } from "../utils/scriptParser";
import { aspectValue } from "../utils/aspectRatios";
import { removableImageIds } from "../utils/removableImages";
import { pushUndoEntry, type UndoEntry } from "../utils/undoHistory";
import { clearParagraphImage } from "../utils/paragraphAssignments";
import { cropForRotation, naturalCropRatio, type PreviewRotation } from "../utils/previewRotation";
import { cropCollection, cropItems } from "../utils/cropItems";
import type { OnlineChapterRequest, OnlinePageRequest } from "../types/online";

type SaveState = "idle" | "saving" | "saved" | "error";

interface ProjectState {
  project: Project | null;
  activeParagraphId: string | null;
  selectedImageId: string | null;
  activeSourceGroupId: string | null;
  selectedImageIds: string[];
  selectedParagraphIds: string[];
  lastItemPane: "images" | "script" | null;
  importFeedback: string | null;
  workingCrop: CropRect | null;
  workingZoom: number;
  workingViewZoom: number;
  previewRotation: PreviewRotation;
  panelFitScale: number;
  panelViewport: { width: number; height: number };
  workingAspectRatio: AspectRatio;
  saveState: SaveState;
  busy: boolean;
  error: string | null;
  undoDepth: number;
  undo: () => void;
  setProject: (project: Project | null) => void;
  loadProject: (id: string) => Promise<void>;
  createProject: (name: string, outputFolder?: string) => Promise<void>;
  openProject: (folder: string) => Promise<void>;
  setActiveParagraph: (id: string) => void;
  setCropMode: (mode: "script" | "free" | "read") => void;
  newFreeCrop: () => void;
  replaceScript: (script: string) => void;
  updateParagraphText: (id: string, text: string) => void;
  insertParagraphBreak: (id: string, offset: number) => string | null;
  addParagraph: (afterId?: string) => void;
  deleteParagraph: (id: string) => void;
  splitParagraph: (id: string, offset?: number) => void;
  mergeWithPrevious: (id: string) => void;
  moveParagraph: (id: string, direction: -1 | 1) => void;
  moveParagraphTo: (id: string, targetId: string) => void;
  selectImage: (imageId: string) => void;
  assignImage: (paragraphId: string, imageId: string) => void;
  removeAssignment: (paragraphId: string) => void;
  setAspectRatio: (id: string, ratio: AspectRatio) => void;
  setPan: (id: string, panX: number, panY: number) => void;
  setZoom: (id: string, zoom: number) => void;
  setViewZoom: (id: string, zoom: number) => void;
  rotatePreview: () => void;
  setPanelFit: (imageId: string, scale: number, width: number, height: number) => void;
  nudgeCrop: (id: string, dx: number, dy: number) => void;
  setCropRect: (id: string, crop: CropRect, historyGroup?: string | false) => void;
  resetCrop: (id: string) => void;
  uploadImages: (files: File[]) => Promise<number>;
  importFolder: () => Promise<void>;
  importCbz: (file: File) => Promise<void>;
  importOnlinePage: (request: OnlinePageRequest, seriesTitle: string) => Promise<boolean>;
  importOnlineChapter: (request: OnlineChapterRequest, seriesTitle: string) => Promise<boolean>;
  setActiveSourceGroup: (id: string) => void;
  selectAllVisibleImages: () => void;
  selectAllParagraphs: () => void;
  clearItemSelection: () => void;
  setLastItemPane: (pane: "images" | "script") => void;
  removeImage: (imageId: string) => Promise<void>;
  removeSelectedImages: () => Promise<void>;
  saveNow: () => Promise<void>;
  saveCrop: (advance: boolean) => Promise<void>;
  exportAll: () => Promise<number>;
  clearError: () => void;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let savePromise: Promise<void> | null = null;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Unknown error");
const clampZoom = (zoom: number) => Math.max(0.5, Math.min(5, zoom));
const imageForParagraph = (paragraph?: Paragraph | null) =>
  paragraph?.draftImageId !== undefined ? paragraph.draftImageId : paragraph?.sourceImageId ?? null;
const firstQueued = (project: Project) =>
  cropItems(project).find((paragraph) => !paragraph.completed) ?? cropItems(project)[0];
const initialImageId = (project: Project, paragraph?: Paragraph) =>
  imageForParagraph(paragraph) ?? project.images.find((image) => image.stripPages?.length)?.id ??
    (project.cropMode === "read" ? project.images[0]?.id : null) ?? null;

interface EditorSnapshot {
  projectId: string;
  paragraphs: Paragraph[];
  freeCrops: Paragraph[];
  cropMode: "script" | "free" | "read";
  activeParagraphId: string | null;
  selectedImageId: string | null;
  workingCrop: CropRect | null;
  workingZoom: number;
  workingViewZoom: number;
  previewRotation: PreviewRotation;
  workingAspectRatio: AspectRatio;
}

export const useProjectStore = create<ProjectState>((set, get) => {
  let undoEntries: UndoEntry<EditorSnapshot>[] = [];
  const clearUndo = () => {
    undoEntries = [];
    set({ undoDepth: 0 });
  };
  const recordUndo = (group: string | null = null) => {
    const state = get();
    if (!state.project) return;
    undoEntries = pushUndoEntry(undoEntries, {
      projectId: state.project.id,
      paragraphs: state.project.paragraphs,
      freeCrops: state.project.freeCrops ?? [],
      cropMode: state.project.cropMode ?? "script",
      activeParagraphId: state.activeParagraphId,
      selectedImageId: state.selectedImageId,
      workingCrop: state.workingCrop,
      workingZoom: state.workingZoom,
      workingViewZoom: state.workingViewZoom,
      previewRotation: state.previewRotation,
      workingAspectRatio: state.workingAspectRatio,
    }, group);
    set({ undoDepth: undoEntries.length });
  };
  const scheduleSave = (project: Project) => {
    if (saveTimer) clearTimeout(saveTimer);
    set({ saveState: "saving" });
    saveTimer = setTimeout(() => {
      const currentSave = (async () => {
      try {
        if (savePromise) await savePromise;
        await api.saveProject(project);
        if (get().project === project) set({ saveState: "saved" });
      } catch (error) {
        set({ saveState: "error", error: errorMessage(error) });
      }
      })();
      savePromise = currentSave;
      void currentSave.finally(() => { if (savePromise === currentSave) savePromise = null; });
    }, 500);
  };

  const mutateParagraph = (id: string, transform: (paragraph: Paragraph) => Paragraph) => {
    const project = get().project;
    if (!project) return;
    const updated = {
      ...project,
      [cropCollection(project)]: cropItems(project).map((paragraph) =>
        paragraph.id === id ? transform(paragraph) : paragraph,
      ),
    };
    set({ project: updated });
    scheduleSave(updated);
  };

  const runProjectAction = async (action: () => Promise<Project>) => {
    set({ busy: true, error: null });
    try {
      const project = await action();
      clearUndo();
      const first = firstQueued(project);
      set({
        project,
        activeParagraphId: first?.id ?? null,
        selectedImageId: initialImageId(project, first),
        selectedImageIds: [],
        selectedParagraphIds: [],
        lastItemPane: null,
        activeSourceGroupId: project.images.find((image) => image.id === initialImageId(project, first))?.sourceGroupId
          ?? project.sourceGroups[0]?.id ?? null,
        importFeedback: null,
        workingCrop: first?.crop ?? null,
        workingZoom: first?.zoom ?? 1,
        workingViewZoom: 1,
        previewRotation: first?.rotation ?? 0,
        panelFitScale: 0,
        panelViewport: { width: 0, height: 0 },
        workingAspectRatio: first?.aspectRatio ?? project.defaultAspectRatio,
        busy: false,
        saveState: "saved",
      });
    } catch (error) {
      set({ busy: false, error: errorMessage(error) });
    }
  };

  return {
    project: null,
    activeParagraphId: null,
    selectedImageId: null,
    selectedImageIds: [],
    selectedParagraphIds: [],
    lastItemPane: null,
    activeSourceGroupId: null,
    importFeedback: null,
    workingCrop: null,
    workingZoom: 1,
    workingViewZoom: 1,
    previewRotation: 0,
    panelFitScale: 0,
    panelViewport: { width: 0, height: 0 },
    workingAspectRatio: "9:16",
    saveState: "idle",
    busy: false,
    error: null,
    undoDepth: 0,
    undo: () => {
      const state = get();
      if (!state.project || state.busy || !undoEntries.length) return;
      const entry = undoEntries.at(-1)!;
      if (entry.snapshot.projectId !== state.project.id) { clearUndo(); return; }
      undoEntries = undoEntries.slice(0, -1);
      const snapshot = entry.snapshot;
      const project = { ...state.project, paragraphs: snapshot.paragraphs,
        freeCrops: snapshot.freeCrops, cropMode: snapshot.cropMode };
      const activeParagraphId = snapshot.activeParagraphId && cropItems(project).some((item) => item.id === snapshot.activeParagraphId)
        ? snapshot.activeParagraphId : firstQueued(project)?.id ?? null;
      const selectedImageId = snapshot.selectedImageId && project.images.some((item) => item.id === snapshot.selectedImageId)
        ? snapshot.selectedImageId : null;
      set({
        project,
        activeParagraphId,
        selectedImageId,
        selectedParagraphIds: [],
        workingCrop: snapshot.workingCrop,
        workingZoom: snapshot.workingZoom,
        workingViewZoom: snapshot.workingViewZoom,
        previewRotation: snapshot.previewRotation,
        workingAspectRatio: snapshot.workingAspectRatio,
        panelFitScale: selectedImageId === state.selectedImageId ? state.panelFitScale : 0,
        undoDepth: undoEntries.length,
        error: null,
      });
      if (project !== state.project) scheduleSave(project);
    },
    setProject: (project) => {
      if (saveTimer) clearTimeout(saveTimer);
      clearUndo();
      const first = project ? firstQueued(project) : undefined;
      set({
        project,
        activeParagraphId: first?.id ?? null,
        selectedImageId: project ? initialImageId(project, first) : null,
        selectedImageIds: [],
        selectedParagraphIds: [],
        lastItemPane: null,
        activeSourceGroupId: project?.images.find((image) => image.id === initialImageId(project, first))?.sourceGroupId
          ?? project?.sourceGroups[0]?.id ?? null,
        importFeedback: null,
        workingCrop: first?.crop ?? null,
        workingZoom: first?.zoom ?? 1,
        workingViewZoom: 1,
        previewRotation: first?.rotation ?? 0,
        panelFitScale: 0,
        panelViewport: { width: 0, height: 0 },
        workingAspectRatio: first?.aspectRatio ?? project?.defaultAspectRatio ?? "9:16",
        error: null,
      });
    },
    loadProject: (id) => runProjectAction(() => api.loadProject(id)),
    createProject: (name, outputFolder) => runProjectAction(() => api.createProject(name, outputFolder)),
    openProject: (folder) => runProjectAction(() => api.openProject(folder)),
    setActiveSourceGroup: (id) => {
      if (get().project?.sourceGroups.some((group) => group.id === id)) set({ activeSourceGroupId: id, selectedImageIds: [] });
      const strips = get().project?.images.filter((image) => image.sourceGroupId === id && image.stripPages?.length) ?? [];
      const strip = strips.find((image) => image.onlineOrigin?.wholeChapter) ?? strips[0];
      if (strip) get().selectImage(strip.id);
    },
    selectAllVisibleImages: () => {
      const { project, activeSourceGroupId } = get();
      const groupId = project?.sourceGroups.some((group) => group.id === activeSourceGroupId)
        ? activeSourceGroupId : project?.sourceGroups[0]?.id;
      set({
        selectedImageIds: project?.images.filter((image) => image.sourceGroupId === groupId).map((image) => image.id) ?? [],
        selectedParagraphIds: [],
      });
    },
    selectAllParagraphs: () => {
      set({ selectedParagraphIds: get().project?.paragraphs.map((paragraph) => paragraph.id) ?? [], selectedImageIds: [] });
    },
    clearItemSelection: () => {
      if (get().selectedImageIds.length || get().selectedParagraphIds.length) set({ selectedImageIds: [], selectedParagraphIds: [] });
    },
    setLastItemPane: (pane) => {
      if (get().lastItemPane !== pane) set({ lastItemPane: pane });
    },
    setActiveParagraph: (id) => {
      if (id === get().activeParagraphId) return;
      const project = get().project;
      const item = project && cropItems(project).find((item) => item.id === id);
      if (!item) return;
      if (project.cropMode === "free") {
        const imageId = imageForParagraph(item);
        set({ activeParagraphId: id, selectedImageId: imageId,
          workingCrop: item.crop ?? null, workingZoom: item.zoom, workingViewZoom: item.viewZoom ?? 1,
          previewRotation: item.rotation ?? 0, workingAspectRatio: item.aspectRatio, panelFitScale: 0 });
      } else set({ activeParagraphId: id });
    },
    setCropMode: (mode) => {
      const state = get();
      const project = state.project;
      if (!project || get().busy || (project.cropMode ?? "script") === mode) return;
      recordUndo();
      const freeCrops = project.freeCrops?.length ? project.freeCrops : [{ ...newParagraph(), aspectRatio: project.defaultAspectRatio }];
      const updated = { ...project, cropMode: mode, ...(mode === "free" ? { freeCrops } : {}) };
      const first = firstQueued(updated);
      const keepImage = project.images.some((image) => image.id === state.selectedImageId);
      const imageId = keepImage ? state.selectedImageId : initialImageId(updated, first);
      set({ project: updated, activeParagraphId: first?.id ?? null, selectedImageId: imageId,
        selectedParagraphIds: [], workingCrop: keepImage ? state.workingCrop : first?.crop ?? null,
        workingZoom: keepImage ? state.workingZoom : first?.zoom ?? 1,
        workingViewZoom: keepImage ? state.workingViewZoom : first?.viewZoom ?? 1,
        previewRotation: keepImage ? state.previewRotation : first?.rotation ?? 0,
        workingAspectRatio: keepImage ? state.workingAspectRatio : first?.aspectRatio ?? project.defaultAspectRatio,
        panelFitScale: keepImage ? state.panelFitScale : 0 });
      scheduleSave(updated);
    },
    newFreeCrop: () => {
      const state = get();
      if (!state.project || state.project.cropMode !== "free" || state.busy) return;
      const pending = cropItems(state.project).find((item) => !item.completed);
      if (pending) { get().setActiveParagraph(pending.id); return; }
      recordUndo();
      const created = { ...newParagraph(), aspectRatio: state.workingAspectRatio,
        draftImageId: state.selectedImageId, crop: state.workingCrop ?? undefined,
        zoom: state.workingZoom, viewZoom: state.workingViewZoom, rotation: state.previewRotation };
      const updated = { ...state.project, freeCrops: [...cropItems(state.project), created] };
      set({ project: updated, activeParagraphId: created.id });
      scheduleSave(updated);
    },
    replaceScript: (script) => {
      const project = get().project;
      if (!project) return;
      const paragraphs = parseScript(script, project.paragraphs);
      recordUndo();
      const updated = { ...project, paragraphs };
      const active = paragraphs.find((item) => item.id === get().activeParagraphId) ?? firstQueued(updated);
      set({
        project: updated,
        activeParagraphId: active?.id ?? null,
        selectedParagraphIds: [],
      });
      scheduleSave(updated);
    },
    updateParagraphText: (id, text) => {
      const project = get().project;
      if (!project) return;
      const index = project.paragraphs.findIndex((item) => item.id === id);
      if (index < 0) return;
      if (project.paragraphs[index].text === text) return;
      const lines = text.split(/\r?\n/);
      if (lines.length === 1) {
        recordUndo(`text:${id}`);
        mutateParagraph(id, (paragraph) => ({ ...paragraph, text }));
        return;
      }
      recordUndo(`text:${id}`);
      const inserted = lines.slice(1).filter((line) => line.trim()).map((line) => newParagraph(line));
      const paragraphs = [...project.paragraphs];
      paragraphs.splice(index, 1, { ...paragraphs[index], text: lines[0] }, ...inserted);
      const updated = { ...project, paragraphs };
      set({ project: updated, activeParagraphId: inserted.at(-1)?.id ?? id });
      scheduleSave(updated);
    },
    insertParagraphBreak: (id, offset) => {
      const project = get().project;
      if (!project) return null;
      const index = project.paragraphs.findIndex((item) => item.id === id);
      if (index < 0) return null;
      recordUndo();
      const original = project.paragraphs[index];
      const created = newParagraph(original.text.slice(offset));
      const paragraphs = [...project.paragraphs];
      paragraphs.splice(index, 1, { ...original, text: original.text.slice(0, offset) }, created);
      const updated = { ...project, paragraphs };
      set({ project: updated, activeParagraphId: created.id });
      scheduleSave(updated);
      return created.id;
    },
    addParagraph: (afterId) => {
      const project = get().project;
      if (!project) return;
      recordUndo();
      const paragraph = newParagraph();
      const index = afterId
        ? project.paragraphs.findIndex((item) => item.id === afterId) + 1
        : project.paragraphs.length;
      const paragraphs = [...project.paragraphs];
      paragraphs.splice(Math.max(0, index), 0, paragraph);
      const updated = { ...project, paragraphs };
      set({ project: updated, activeParagraphId: paragraph.id });
      scheduleSave(updated);
    },
    deleteParagraph: (id) => {
      const project = get().project;
      if (!project) return;
      const index = project.paragraphs.findIndex((item) => item.id === id);
      if (index < 0) return;
      recordUndo();
      const paragraphs = project.paragraphs.filter((item) => item.id !== id);
      const updated = { ...project, paragraphs };
      const next = paragraphs[Math.min(index, paragraphs.length - 1)];
      set({ project: updated, activeParagraphId: next?.id ?? null,
        selectedParagraphIds: get().selectedParagraphIds.filter((paragraphId) => paragraphId !== id) });
      scheduleSave(updated);
    },
    splitParagraph: (id, offset) => {
      const project = get().project;
      if (!project) return;
      const index = project.paragraphs.findIndex((item) => item.id === id);
      if (index < 0) return;
      const original = project.paragraphs[index];
      let splitAt = offset ?? Math.floor(original.text.length / 2);
      if (!offset) {
        const nextSpace = original.text.indexOf(" ", splitAt);
        if (nextSpace >= 0) splitAt = nextSpace;
      }
      const first = original.text.slice(0, splitAt).trim();
      const second = original.text.slice(splitAt).trim();
      if (!first || !second) return;
      recordUndo();
      const created = newParagraph(second);
      const paragraphs = [...project.paragraphs];
      paragraphs.splice(index, 1, { ...original, text: first }, created);
      const updated = { ...project, paragraphs };
      set({ project: updated, activeParagraphId: created.id });
      scheduleSave(updated);
    },
    mergeWithPrevious: (id) => {
      const project = get().project;
      if (!project) return;
      const index = project.paragraphs.findIndex((item) => item.id === id);
      if (index <= 0) return;
      recordUndo();
      const previous = project.paragraphs[index - 1];
      const current = project.paragraphs[index];
      const merged = {
        ...(previous.sourceImageId ? previous : current),
        id: previous.id,
        text: `${previous.text.trim()} ${current.text.trim()}`.trim(),
      };
      const paragraphs = [...project.paragraphs];
      paragraphs.splice(index - 1, 2, merged);
      const updated = { ...project, paragraphs };
      set({ project: updated, activeParagraphId: merged.id });
      scheduleSave(updated);
    },
    moveParagraph: (id, direction) => {
      const project = get().project;
      if (!project) return;
      const index = project.paragraphs.findIndex((item) => item.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= project.paragraphs.length) return;
      recordUndo();
      const paragraphs = [...project.paragraphs];
      [paragraphs[index], paragraphs[target]] = [paragraphs[target], paragraphs[index]];
      const updated = { ...project, paragraphs };
      set({ project: updated });
      scheduleSave(updated);
    },
    moveParagraphTo: (id, targetId) => {
      const project = get().project;
      if (!project || id === targetId) return;
      const paragraphs = [...project.paragraphs];
      const from = paragraphs.findIndex((item) => item.id === id);
      const to = paragraphs.findIndex((item) => item.id === targetId);
      if (from < 0 || to < 0) return;
      recordUndo();
      paragraphs.splice(to, 0, paragraphs.splice(from, 1)[0]);
      const updated = { ...project, paragraphs };
      set({ project: updated });
      scheduleSave(updated);
    },
    selectImage: (imageId) => {
      const project = get().project;
      const paragraph = project && cropItems(project).find((item) => item.id === get().activeParagraphId);
      if (!project || !project.images.some((item) => item.id === imageId)) return;
      if (get().selectedImageId === imageId) return;
      recordUndo();
      const previousImageId = imageForParagraph(paragraph);
      const restoring = previousImageId === imageId;
      set({
        selectedImageId: imageId,
        workingCrop: restoring ? paragraph?.crop ?? null : null,
        workingZoom: restoring ? paragraph?.zoom ?? 1 : 1,
        workingViewZoom: 1,
        previewRotation: restoring ? paragraph?.rotation ?? 0 : 0,
        panelFitScale: 0,
        workingAspectRatio: restoring ? paragraph?.aspectRatio ?? get().workingAspectRatio : get().workingAspectRatio,
      });
      if (!paragraph) return;
      mutateParagraph(paragraph.id, (item) => previousImageId === imageId
        ? { ...item, draftImageId: imageId }
        : { ...item, draftImageId: imageId, crop: undefined, zoom: 1, rotation: 0,
          completed: false, outputFile: undefined });
    },
    assignImage: (paragraphId, imageId) => {
      get().setActiveParagraph(paragraphId);
      get().selectImage(imageId);
    },
    removeAssignment: (paragraphId) => {
      const project = get().project;
      const paragraph = project && cropItems(project).find((item) => item.id === paragraphId);
      if (!paragraph || !imageForParagraph(paragraph)) return;
      recordUndo();
      if (paragraphId === get().activeParagraphId) set({ selectedImageId: null, workingCrop: null, workingZoom: 1,
        workingViewZoom: 1, previewRotation: 0, panelFitScale: 0 });
      mutateParagraph(paragraphId, clearParagraphImage);
    },
    setAspectRatio: (id, aspectRatio) => {
      if (id !== get().activeParagraphId) return;
      recordUndo();
      const image = get().project?.images.find((item) => item.id === get().selectedImageId);
      const current = get().workingCrop;
      let crop: CropRect | null = null;
      if (image && current) {
        const ratio = naturalCropRatio(aspectValue(aspectRatio), get().previewRotation);
        const width = Math.min(current.width, image.width, image.height * ratio);
        const height = width / ratio;
        crop = {
          x: Math.max(0, Math.min(image.width - width, current.x + (current.width - width) / 2)),
          y: Math.max(0, Math.min(image.height - height, current.y + (current.height - height) / 2)),
          width, height,
        };
      }
      const zoom = crop && image
        ? clampZoom(Math.min(image.width, image.height * naturalCropRatio(aspectValue(aspectRatio), get().previewRotation)) * 0.9 / crop.width)
        : 1;
      set({ workingAspectRatio: aspectRatio, workingCrop: crop, workingZoom: zoom });
      mutateParagraph(id, (paragraph) => ({
        ...paragraph, aspectRatio, crop: crop ?? undefined, zoom, draftImageId: get().selectedImageId,
        completed: false, outputFile: undefined,
      }));
    },
    setPan: (id, panX, panY) => {
      if (!get().project?.paragraphs.some((paragraph) => paragraph.id === id)) return;
      recordUndo(`pan:${id}`);
      mutateParagraph(id, (paragraph) => ({ ...paragraph, panX, panY, completed: false }));
    },
    setZoom: (id, zoom) => {
      if (id !== get().activeParagraphId) return;
      const image = get().project?.images.find((item) => item.id === get().selectedImageId);
      const current = get().workingCrop;
      if (!image || !current) return;
      const ratio = naturalCropRatio(aspectValue(get().workingAspectRatio), get().previewRotation);
      const width = Math.min(image.width, image.height * ratio, current.width * get().workingZoom / zoom);
      const height = width / ratio;
      get().setCropRect(id, {
        x: Math.max(0, Math.min(image.width - width, current.x + (current.width - width) / 2)),
        y: Math.max(0, Math.min(image.height - height, current.y + (current.height - height) / 2)),
        width, height,
      });
    },
    setViewZoom: (id, zoom) => {
      if (get().project?.cropMode === "read") {
        set({ workingViewZoom: Math.max(0.05, Math.min(8, zoom)) });
        return;
      }
      if (id !== get().activeParagraphId) return;
      const viewZoom = Math.max(0.05, Math.min(8, zoom));
      if (viewZoom === get().workingViewZoom) return;
      recordUndo(`view-zoom:${id}`);
      set({ workingViewZoom: viewZoom });
      mutateParagraph(id, (paragraph) => ({ ...paragraph, viewZoom }));
    },
    rotatePreview: () => {
      const state = get();
      if (!state.selectedImageId || !state.activeParagraphId) return;
      const rotation = ((state.previewRotation + 90) % 360) as PreviewRotation;
      const image = state.project?.images.find((item) => item.id === state.selectedImageId);
      const crop = image && state.workingCrop
        ? cropForRotation(state.workingCrop, image.width, image.height,
          aspectValue(state.workingAspectRatio), state.previewRotation, rotation)
        : state.workingCrop;
      const ratio = naturalCropRatio(aspectValue(state.workingAspectRatio), rotation);
      const zoom = image && crop
        ? clampZoom(Math.min(image.width, image.height * ratio) * 0.9 / crop.width)
        : state.workingZoom;
      recordUndo();
      set({ previewRotation: rotation, workingCrop: crop, workingZoom: zoom });
      mutateParagraph(state.activeParagraphId, (paragraph) => ({ ...paragraph, rotation,
        draftImageId: state.selectedImageId, crop: crop ?? undefined,
        zoom, viewZoom: state.workingViewZoom,
        aspectRatio: state.workingAspectRatio, completed: false, outputFile: undefined,
        outputWidth: undefined, outputHeight: undefined }));
    },
    setPanelFit: (imageId, scale, width, height) => {
      const state = get();
      if (state.selectedImageId !== imageId || !Number.isFinite(scale) || scale <= 0) return;
      if (state.panelFitScale === scale && state.panelViewport.width === width && state.panelViewport.height === height) return;
      set({ panelFitScale: scale, panelViewport: { width, height } });
    },
    nudgeCrop: (id, dx, dy) => {
      const image = get().project?.images.find((item) => item.id === get().selectedImageId);
      const crop = get().workingCrop;
      if (!image || !crop || id !== get().activeParagraphId) return;
      get().setCropRect(id, {
        ...crop,
        x: Math.max(0, Math.min(image.width - crop.width, crop.x + dx)),
        y: Math.max(0, Math.min(image.height - crop.height, crop.y + dy)),
      });
    },
    setCropRect: (id, crop, historyGroup) => {
      if (id !== get().activeParagraphId) return;
      const current = get().workingCrop;
      if (current && current.x === crop.x && current.y === crop.y && current.width === crop.width && current.height === crop.height) return;
      if (historyGroup !== false) recordUndo(historyGroup ?? `crop:${id}`);
      const image = get().project?.images.find((item) => item.id === get().selectedImageId);
      const ratio = naturalCropRatio(aspectValue(get().workingAspectRatio), get().previewRotation);
      const base = image ? Math.min(image.width, image.height * ratio) * 0.9 : crop.width;
      const zoom = clampZoom(base / crop.width);
      set({ workingCrop: crop, workingZoom: zoom });
      mutateParagraph(id, (paragraph) => ({
        ...paragraph, crop, zoom, aspectRatio: get().workingAspectRatio,
        draftImageId: get().selectedImageId, completed: false, outputFile: undefined,
      }));
    },
    resetCrop: (id) => {
      if (id !== get().activeParagraphId) return;
      recordUndo();
      set({ workingCrop: null, workingZoom: 1 });
      mutateParagraph(id, (paragraph) => ({
        ...paragraph,
        crop: undefined,
        zoom: 1,
        completed: false,
        outputFile: undefined,
      }));
    },
    uploadImages: async (files) => {
      const project = get().project;
      if (!project || !files.length) return 0;
      set({ busy: true, error: null });
      try {
        await get().saveNow();
        const result = await api.uploadImages(project.id, files);
        clearUndo();
        const group = result.project.sourceGroups.find((item) => item.kind === "project-files");
        set({ project: result.project, activeSourceGroupId: group?.id ?? get().activeSourceGroupId, selectedImageIds: [],
          importFeedback: `${result.imported} file${result.imported === 1 ? "" : "s"} imported`, busy: false, saveState: "saved" });
        return result.imported;
      } catch (error) {
        set({ busy: false, error: errorMessage(error) });
        return 0;
      }
    },
    importFolder: async () => {
      const project = get().project;
      if (!project) return;
      try {
        const selected = await api.selectFolder("source");
        if (!selected.path) return;
        set({ busy: true, error: null, importFeedback: null });
        await get().saveNow();
        const result = await api.importFolder(project.id, selected.path);
        clearUndo();
        const feedback = result.existing ? "Folder already imported; selected its tab."
          : result.imported ? `${result.imported} image${result.imported === 1 ? "" : "s"} imported${result.skipped ? `, ${result.skipped} skipped` : ""}.`
          : `No valid images found${result.skipped ? `; ${result.skipped} skipped` : ""}.`;
        set({ project: result.project, activeSourceGroupId: result.groupId ?? get().activeSourceGroupId, selectedImageIds: [],
          importFeedback: result.skippedReasons.length ? `${feedback} ${result.skippedReasons.join("; ")}` : feedback,
          busy: false, saveState: "saved" });
      } catch (error) {
        set({ busy: false, error: errorMessage(error) });
      }
    },
    importOnlineChapter: async (request, seriesTitle) => {
      if (get().busy) return false;
      set({ busy: true, error: null, importFeedback: "Preparing a continuous chapter strip…" });
      try {
        let project = get().project;
        if (!project) {
          project = await api.createProject(seriesTitle);
          project = await api.saveProject({ ...project, cropMode: "free", freeCrops: [newParagraph()] });
          get().setProject(project);
        } else {
          await get().saveNow();
          project = get().project!;
          if (project.cropMode !== "read" && !cropItems(project).length) {
            project = await api.saveProject({ ...project, cropMode: "free", freeCrops: [newParagraph()] });
            get().setProject(project);
          }
        }
        let job = await api.prepareOnlineChapter(project.id, request);
        while (job.state !== "complete" && job.state !== "failed") {
          set({ importFeedback: job.totalPages ? `Preparing chapter: ${job.completedPages} / ${job.totalPages} pages ready…`
            : "Preparing a continuous chapter strip…" });
          await new Promise((resolve) => setTimeout(resolve, 400));
          job = await api.onlineChapterJob(job.jobId);
        }
        if (job.state === "failed" || !job.result) throw new Error(job.error ?? "Could not prepare this chapter. Try again.");
        const loaded = await api.loadProject(project.id);
        clearUndo();
        set({ project: loaded, activeSourceGroupId: job.result.groupId, selectedImageIds: [],
          importFeedback: "Chapter ready. Read and crop anywhere on the continuous strip.", busy: false, saveState: "saved" });
        if (loaded.cropMode === "free" && cropItems(loaded).find((item) => item.id === get().activeParagraphId)?.completed) {
          get().newFreeCrop();
        }
        get().selectImage(job.result.imageId);
        return true;
      } catch (error) {
        set({ busy: false, importFeedback: null, error: errorMessage(error) });
        return false;
      }
    },
    importOnlinePage: async (request, seriesTitle) => {
      if (get().busy) return false;
      set({ busy: true, error: null, importFeedback: "Opening page for cropping…" });
      try {
        let project = get().project;
        if (!project) {
          project = await api.createProject(seriesTitle);
          project = await api.saveProject({ ...project, cropMode: "free", freeCrops: [newParagraph()] });
          get().setProject(project);
        } else {
          await get().saveNow();
          project = get().project!;
          if (project.cropMode !== "read" && !cropItems(project).length) {
            project = await api.saveProject({ ...project, cropMode: "free", freeCrops: [newParagraph()] });
            get().setProject(project);
          }
        }
        const result = await api.importOnlinePage(project.id, request);
        clearUndo();
        set({ project: result.project, activeSourceGroupId: result.groupId, selectedImageIds: [],
          importFeedback: result.existing ? "Opened the saved page snapshot." : "Original page saved in this project for cropping.",
          busy: false, saveState: "saved" });
        if (result.project.cropMode === "free" &&
            cropItems(result.project).find((item) => item.id === get().activeParagraphId)?.completed) {
          get().newFreeCrop();
        }
        get().selectImage(result.imageId);
        return true;
      } catch (error) {
        set({ busy: false, importFeedback: null, error: errorMessage(error) });
        return false;
      }
    },
    importCbz: async (file) => {
      const project = get().project;
      if (!project || get().busy) return;
      set({ busy: true, error: null, importFeedback: "Importing CBZ…" });
      try {
        await get().saveNow();
        const result = await api.importCbz(project.id, file);
        clearUndo();
        set({ project: result.project, activeSourceGroupId: result.groupId, selectedImageIds: [],
          importFeedback: `${result.imported} pages imported as a continuous strip${result.skipped ? `; ${result.skipped} unreadable pages skipped` : ""}.`,
          busy: false, saveState: "saved" });
        get().selectImage(result.imageId);
      } catch (error) {
        set({ busy: false, importFeedback: null, error: errorMessage(error) });
      }
    },
    removeImage: async (imageId) => {
      const project = get().project;
      if (!project) return;
      set({ busy: true, error: null });
      try {
        await get().saveNow();
        const updated = await api.removeImage(project.id, imageId);
        clearUndo();
        set({
          project: updated,
          selectedImageIds: get().selectedImageIds.filter((id) => id !== imageId),
          selectedImageId: get().selectedImageId === imageId ? null : get().selectedImageId,
          workingCrop: get().selectedImageId === imageId ? null : get().workingCrop,
          previewRotation: get().selectedImageId === imageId ? 0 : get().previewRotation,
          panelFitScale: get().selectedImageId === imageId ? 0 : get().panelFitScale,
          busy: false,
          saveState: "saved",
        });
      } catch (error) {
        set({ busy: false, error: errorMessage(error) });
      }
    },
    removeSelectedImages: async () => {
      const project = get().project;
      const selectedIds = [...get().selectedImageIds];
      if (!project || get().busy || !selectedIds.length) return;
      set({ busy: true, error: null, importFeedback: null });
      let latestProject = project;
      try {
        await get().saveNow();
        latestProject = get().project ?? project;
        const removableIds = removableImageIds(latestProject, selectedIds);
        for (const id of removableIds) latestProject = await api.removeImage(project.id, id);
        if (removableIds.length) clearUndo();
        const remainingIds = new Set(latestProject.images.map((image) => image.id));
        const keptIds = selectedIds.filter((id) => remainingIds.has(id));
        const deleted = removableIds.length;
        const previewId = get().selectedImageId;
        const previewDeleted = previewId != null && !remainingIds.has(previewId);
        set({
          project: latestProject,
          selectedImageIds: keptIds,
          selectedImageId: previewDeleted ? null : get().selectedImageId,
          workingCrop: previewDeleted ? null : get().workingCrop,
          workingZoom: previewDeleted ? 1 : get().workingZoom,
          workingViewZoom: previewDeleted ? 1 : get().workingViewZoom,
          previewRotation: previewDeleted ? 0 : get().previewRotation,
          panelFitScale: previewDeleted ? 0 : get().panelFitScale,
          importFeedback: deleted
            ? `Deleted ${deleted} source image${deleted === 1 ? "" : "s"}.${keptIds.length ? ` ${keptIds.length} image${keptIds.length === 1 ? "" : "s"} used by paragraphs kept.` : ""}`
            : "No selected images could be deleted. Images used by paragraphs are kept.",
          busy: false,
          saveState: "saved",
        });
      } catch (error) {
        try { latestProject = await api.loadProject(project.id); } catch { /* Keep the last confirmed project state. */ }
        clearUndo();
        const remainingIds = new Set(latestProject.images.map((image) => image.id));
        const previewId = get().selectedImageId;
        const previewDeleted = previewId != null && !remainingIds.has(previewId);
        set({
          project: latestProject,
          selectedImageIds: selectedIds.filter((id) => remainingIds.has(id)),
          selectedImageId: previewDeleted ? null : get().selectedImageId,
          workingCrop: previewDeleted ? null : get().workingCrop,
          workingZoom: previewDeleted ? 1 : get().workingZoom,
          workingViewZoom: previewDeleted ? 1 : get().workingViewZoom,
          previewRotation: previewDeleted ? 0 : get().previewRotation,
          panelFitScale: previewDeleted ? 0 : get().panelFitScale,
          busy: false,
          error: errorMessage(error),
          saveState: "error",
        });
      }
    },
    saveNow: async () => {
      if (saveTimer) clearTimeout(saveTimer);
      set({ saveState: "saving", error: null });
      try {
        if (savePromise) await savePromise;
        const project = get().project;
        if (!project) return;
        const saved = await api.saveProject(project);
        if (get().project === project) set({ project: saved, saveState: "saved" });
      } catch (error) {
        set({ saveState: "error", error: errorMessage(error) });
        throw error;
      }
    },
    saveCrop: async (advance) => {
      if (get().busy || get().project?.cropMode === "read") return;
      if (saveTimer) clearTimeout(saveTimer);
      const project = get().project;
      if (project?.cropMode === "read") return;
      const activeId = get().activeParagraphId;
      const paragraph = project && cropItems(project).find((item) => item.id === activeId);
      const imageId = get().selectedImageId;
      const crop = get().workingCrop;
      if (!project || !paragraph || !imageId || !crop) {
        set({ error: "Choose an image and position the crop before saving." });
        return;
      }
      const preparedParagraph: Paragraph = {
        ...paragraph,
        crop,
        zoom: get().workingZoom,
        viewZoom: get().workingViewZoom,
        rotation: get().previewRotation,
        aspectRatio: get().workingAspectRatio,
        draftImageId: imageId,
      };
      const preparedProject = {
        ...project,
        [cropCollection(project)]: cropItems(project).map((item) => item.id === activeId ? preparedParagraph : item),
      };
      set({ busy: true, saveState: "saving", error: null });
      try {
        if (savePromise) await savePromise;
        await api.saveProject(preparedProject);
        let saved = await api.saveCrop(project.id, preparedParagraph, imageId, project.cropMode ?? "script");
        clearUndo();
        let next = advance ? cropItems(saved).find((item) => !item.completed) : cropItems(saved).find((item) => item.id === activeId);
        if (advance && project.cropMode === "free" && !next) {
          next = { ...newParagraph(), aspectRatio: preparedParagraph.aspectRatio,
            draftImageId: imageId, crop, zoom: preparedParagraph.zoom,
            viewZoom: preparedParagraph.viewZoom, rotation: preparedParagraph.rotation };
          saved = { ...saved, freeCrops: [...cropItems(saved), next] };
        }
        set({
          project: saved,
          activeParagraphId: next?.id ?? activeId,
          busy: false,
          saveState: "saved",
        });
        if (project.cropMode === "free") scheduleSave(saved);
      } catch (error) {
        set({ busy: false, saveState: "error", error: errorMessage(error) });
      }
    },
    exportAll: async () => {
      const project = get().project;
      if (!project) return 0;
      set({ busy: true, error: null });
      try {
        await get().saveNow();
        const result = await api.exportAll(project.id);
        if (result.exported) clearUndo();
        set({
          project: result.project,
          busy: false,
          saveState: "saved",
          error: result.errors.length ? result.errors.join("\n") : null,
        });
        return result.exported;
      } catch (error) {
        set({ busy: false, error: errorMessage(error) });
        return 0;
      }
    },
    clearError: () => set({ error: null }),
  };
});
