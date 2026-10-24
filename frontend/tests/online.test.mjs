import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTs } from "./loadTs.mjs";

const { api } = await import(await loadTs(new URL("../src/services/api.ts", import.meta.url)));
const { useProjectStore: store } = await import(await loadTs(new URL("../src/stores/projectStore.ts", import.meta.url)));
const base = { id: "online-project", projectName: "Series", outputFolder: "test", defaultAspectRatio: "9:16",
  images: [], sourceGroups: [], paragraphs: [] };
const request = { mangaId: 42, chapterIndex: 7, chapterId: 101, pageIndex: 0, includeNext: false };
const image = { id: "online-image", filename: "Chapter 1 · Page 1", path: "page.png", width: 800, height: 2000,
  sourceGroupId: "online-chapter", onlineOrigin: { serverUrl: "http://reader", mangaId: 42, chapterId: 101, chapterIndex: 7, pageIndices: [0] } };

const { chapterOrder } = await import(await loadTs(new URL("../src/utils/chapterOrder.ts", import.meta.url)));
test("chapter navigation keeps a translation group and follows story order instead of the server index", () => {
  const chapters = [{ id: 3, index: 1, chapterNumber: 2, scanlator: "Alpha" },
    { id: 2, index: 2, chapterNumber: 1, scanlator: "Beta" },
    { id: 1, index: 3, chapterNumber: 1, scanlator: "Alpha" },
    { id: 4, index: 4, chapterNumber: 0.5, scanlator: null }];
  assert.deepEqual(chapterOrder(chapters, "Alpha").map((item) => item.id), [1, 3]);
  assert.deepEqual(chapterOrder(chapters).map((item) => item.id), [4, 1, 2, 3]);
  assert.deepEqual(chapterOrder(chapters, null).map((item) => item.id), [4]);
  assert.equal(chapters[0].id, 3);
});

test("opening another chapter preserves reading mode without creating a free crop", async () => {
  const original = { saveProject: api.saveProject, prepareOnlineChapter: api.prepareOnlineChapter, loadProject: api.loadProject };
  try {
    store.getState().setProject({ ...base, cropMode: "read" });
    api.saveProject = async (project) => { assert.equal(project.cropMode, "read"); return project; };
    api.prepareOnlineChapter = async () => ({ jobId: "reader", state: "complete", result: {
      imageId: image.id, groupId: image.sourceGroupId, existing: false } });
    api.loadProject = async () => ({ ...base, cropMode: "read", images: [image],
      sourceGroups: [{ id: image.sourceGroupId, kind: "online", name: "Chapter" }] });
    assert.equal(await store.getState().importOnlineChapter({ mangaId: 42, chapterIndex: 7, chapterId: 101 }, "Series"), true);
    assert.equal(store.getState().project.cropMode, "read");
    assert.equal(store.getState().activeParagraphId, null);
    assert.equal(store.getState().selectedImageId, image.id);
    assert.equal(store.getState().project.freeCrops?.length ?? 0, 0);
  } finally {
    store.getState().setProject(null);
    Object.assign(api, original);
  }
});

test("opening an online chapter selects one complete strip and keeps the crop when saving advances", async () => {
  const original = { saveProject: api.saveProject, prepareOnlineChapter: api.prepareOnlineChapter,
    onlineChapterJob: api.onlineChapterJob, loadProject: api.loadProject, saveCrop: api.saveCrop };
  try {
    const paragraph = { id: "p1", text: "First line", aspectRatio: "9:16", zoom: 1, panX: 0, panY: 0, completed: false };
    const core = { mangaId: 42, chapterIndex: 7, chapterId: 101 };
    const strip = { ...image, id: "whole-chapter", height: 6000,
      onlineOrigin: { ...image.onlineOrigin, wholeChapter: true, pageIndices: [0, 1, 2] },
      stripPages: [0, 1, 2].map((index) => ({ id: String(index), top: index * 2000, stripHeight: 2000, width: 800, height: 2000 })) };
    store.getState().setProject({ ...base, paragraphs: [paragraph, { ...paragraph, id: "p2", text: "Next line" }] });
    api.saveProject = async (project) => project;
    api.prepareOnlineChapter = async (projectId, request) => {
      assert.equal(projectId, base.id); assert.deepEqual(request, core);
      return { jobId: "job", state: "loading", completedPages: 1, totalPages: 3 };
    };
    api.onlineChapterJob = async (id) => {
      assert.equal(id, "job");
      assert.equal(store.getState().busy, true);
      assert.match(store.getState().importFeedback, /1 \/ 3/);
      return { jobId: "job", state: "complete", completedPages: 3, totalPages: 3, result: { imageId: strip.id, groupId: image.sourceGroupId, existing: false } };
    };
    api.loadProject = async () => ({ ...store.getState().project, images: [strip], sourceGroups: [{ id: image.sourceGroupId, name: "Chapter", kind: "online" }] });
    assert.equal(await store.getState().importOnlineChapter(core, "Series"), true);
    assert.equal(store.getState().selectedImageId, strip.id);
    assert.equal(store.getState().project.paragraphs[0].text, paragraph.text);
    const crop = { x: 40, y: 3600, width: 720, height: 1280 };
    store.getState().setCropRect("p1", crop);
    api.saveCrop = async (_id, prepared, imageId) => ({ ...store.getState().project,
      paragraphs: [{ ...prepared, sourceImageId: imageId, completed: true }, store.getState().project.paragraphs[1]] });
    await store.getState().saveCrop(true);
    assert.equal(store.getState().selectedImageId, strip.id);
    assert.equal(store.getState().activeParagraphId, "p2");
    assert.deepEqual(store.getState().workingCrop, crop);
    await store.getState().saveNow();
    const before = store.getState().project;
    api.prepareOnlineChapter = async () => ({ jobId: "failed", state: "failed", error: "Page failed", completedPages: 1, totalPages: 3 });
    assert.equal(await store.getState().importOnlineChapter(core, "Series"), false);
    assert.equal(store.getState().project, before);
    assert.equal(store.getState().selectedImageId, strip.id);
    assert.equal(store.getState().busy, false);
  } finally {
    store.getState().setProject(null);
    Object.assign(api, original);
  }
});

test("online navigation has no controls between strip pages", async () => {
  const { StripPreview } = await import(await loadTs(new URL("../src/components/StripPreview.tsx", import.meta.url)));
  const html = renderToStaticMarkup(createElement(StripPreview, { projectId: "test", scale: 0.5,
    stage: { current: null }, image: { ...image, stripPages: [
      { id: "one", top: 0, stripHeight: 2000 }, { id: "two", top: 2000, stripHeight: 2000 },
    ] } }));
  assert.ok(html.includes("top:1000px"));
  assert.ok(!html.includes("button"));
  const { OnlineLibrary } = await import(await loadTs(new URL("../src/components/OnlineLibrary.tsx", import.meta.url)));
  const screen = renderToStaticMarkup(createElement(OnlineLibrary, { hidden: false, onClose() {}, onNavigationChange() {} }));
  assert.ok(!screen.includes("Crop this page"));
  assert.ok(!screen.includes("With next page"));
  assert.ok(!screen.includes("online-reader-view"));
});

test("online cropping creates a free-crop project, and preserves the current script on subsequent pages", async () => {
  const original = { createProject: api.createProject, saveProject: api.saveProject, importOnlinePage: api.importOnlinePage };
  try {
    store.getState().setProject(null);
    api.createProject = async (title) => { assert.equal(title, "Series"); return base; };
    api.saveProject = async (project) => project;
    api.importOnlinePage = async (id, body) => {
      assert.equal(id, base.id); assert.deepEqual(body, request);
      return { project: { ...store.getState().project, images: [image], sourceGroups: [{ id: "online-chapter", name: "Series · Chapter 1", kind: "online" }] },
        groupId: "online-chapter", imageId: image.id, existing: false };
    };
    assert.equal(await store.getState().importOnlinePage(request, "Series"), true);
    assert.equal(store.getState().project.cropMode, "free");
    assert.ok(store.getState().activeParagraphId);
    assert.equal(store.getState().selectedImageId, image.id);
    assert.equal(store.getState().activeSourceGroupId, "online-chapter");
    const paragraph = { id: "script", text: "Keep my narration", aspectRatio: "9:16", zoom: 1, panX: 0, panY: 0, completed: false };
    store.getState().setProject({ ...base, paragraphs: [paragraph] });
    assert.equal(await store.getState().importOnlinePage(request, "Series"), true);
    assert.equal(store.getState().project.cropMode ?? "script", "script");
    assert.equal(store.getState().project.paragraphs[0].text, paragraph.text);
    assert.equal(store.getState().activeParagraphId, "script");
    store.getState().setProject({ ...store.getState().project, cropMode: "free", paragraphs: [],
      freeCrops: [{ ...paragraph, id: "saved", completed: true, sourceImageId: image.id, outputFile: "crops/free-001.png" }] });
    assert.equal(await store.getState().importOnlinePage(request, "Series"), true);
    assert.equal(store.getState().project.freeCrops[0].completed, true);
    assert.equal(store.getState().project.freeCrops[0].outputFile, "crops/free-001.png");
    assert.equal(store.getState().project.freeCrops.length, 2);
    assert.notEqual(store.getState().activeParagraphId, "saved");
    await store.getState().saveNow();
    api.importOnlinePage = async () => { throw new Error("Source offline"); };
    const before = store.getState().project;
    assert.equal(await store.getState().importOnlinePage(request, "Series"), false);
    assert.equal(store.getState().project, before);
    assert.equal(store.getState().error, "Source offline");
    assert.equal(store.getState().busy, false);
  } finally {
    store.getState().setProject(null);
    Object.assign(api, original);
  }
});
