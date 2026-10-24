import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./loadTs.mjs";

const { api } = await import(await loadTs(new URL("../src/services/api.ts", import.meta.url)));
const { useProjectStore: store } = await import(await loadTs(new URL("../src/stores/projectStore.ts", import.meta.url)));
const project = { id: "free-project", projectName: "Panels", outputFolder: "test", defaultAspectRatio: "9:16",
  images: [{ id: "image", filename: "page.png", width: 800, height: 3000, sourceGroupId: "files" }],
  sourceGroups: [{ id: "files", kind: "project-files", name: "Project files" }], paragraphs: [] };
api.saveProject = async (project) => project;

test("crop without script saves repeatedly, restores crops, and survives mode switching and reopening", async () => {
  store.getState().setProject(project);
  store.getState().setCropMode("free");
  store.getState().selectImage("image");
  const firstId = store.getState().activeParagraphId;
  const firstCrop = { x: 40, y: 100, width: 720, height: 1280 };
  store.getState().setCropRect(firstId, firstCrop);
  api.saveCrop = async (_id, prepared, imageId, mode) => {
    assert.equal(mode, "free");
    return { ...store.getState().project, freeCrops: store.getState().project.freeCrops.map((item) =>
      item.id === prepared.id ? { ...prepared, sourceImageId: imageId, completed: true, outputWidth: 720, outputHeight: 1280 } : item) };
  };
  await store.getState().saveCrop(true);
  assert.equal(store.getState().project.paragraphs.length, 0);
  assert.equal(store.getState().project.freeCrops.length, 2);
  const secondId = store.getState().activeParagraphId;
  assert.notEqual(secondId, firstId);
  assert.deepEqual(store.getState().workingCrop, firstCrop);
  const secondCrop = { ...firstCrop, y: 1500 };
  store.getState().setCropRect(secondId, secondCrop);
  await store.getState().saveCrop(true);
  assert.equal(store.getState().project.freeCrops.filter((item) => item.completed).length, 2);
  store.getState().setActiveParagraph(firstId);
  assert.deepEqual(store.getState().workingCrop, firstCrop);
  await store.getState().saveCrop(true);
  assert.equal(store.getState().project.freeCrops.length, 3);
  const saved = store.getState().project;
  store.getState().setCropMode("script");
  assert.deepEqual(store.getState().project.paragraphs, []);
  store.getState().setCropMode("free");
  assert.equal(store.getState().project.freeCrops.length, 3);
  store.getState().setProject(saved);
  assert.equal(store.getState().project.cropMode, "free");
  assert.equal(store.getState().project.freeCrops.length, 3);
  await store.getState().saveNow();
});

test("undo restores the mode and free crop edits without losing script text", async () => {
  store.getState().setProject({ ...project, paragraphs: [{ id: "script", text: "Keep this script", completed: false }] });
  store.getState().setCropMode("free");
  store.getState().undo();
  assert.equal(store.getState().project.cropMode, "script");
  assert.equal(store.getState().project.paragraphs[0].text, "Keep this script");
  await store.getState().saveNow();
});

test("mode changes keep the current chapter tab, image and viewport instead of opening the first strip", async () => {
  const crop = { x: 20, y: 1400, width: 700, height: 1200 };
  const script = { id: "script", text: "Keep this script", completed: false, sourceImageId: "first", zoom: 1, aspectRatio: "9:16" };
  const free = { id: "free", text: "", completed: false, zoom: 1, aspectRatio: "9:16" };
  store.getState().setProject({ ...project, cropMode: "free", paragraphs: [script], freeCrops: [free],
    sourceGroups: [{ id: "one", name: "Chapter 1" }, { id: "two", name: "Chapter 2" }],
    images: ["first", "second"].map((id, index) => ({ ...project.images[0], id,
      sourceGroupId: index ? "two" : "one", stripPages: [{ id: "page" }] })) });
  store.setState({ selectedImageId: "second", activeSourceGroupId: "two", workingCrop: crop,
    workingZoom: 1.4, workingViewZoom: 2.3, previewRotation: 90, panelFitScale: 0.4 });
  for (const mode of ["script", "read", "free", "read", "script"]) {
    store.getState().setCropMode(mode);
    const state = store.getState();
    assert.equal(state.selectedImageId, "second");
    assert.equal(state.activeSourceGroupId, "two");
    assert.deepEqual(state.workingCrop, crop);
    assert.equal(state.workingViewZoom, 2.3);
    assert.equal(state.previewRotation, 90);
    assert.equal(state.panelFitScale, 0.4);
    assert.deepEqual(state.project.paragraphs, [script]);
    assert.deepEqual(state.project.freeCrops, [free]);
    if (mode === "read") assert.equal(state.activeParagraphId, null);
  }
  await store.getState().saveNow();
});

test("reading mode has no active crop and zoom never edits script data", async () => {
  const script = { id: "script", text: "Keep script", completed: true, crop: { x: 0, y: 100, width: 100, height: 100 } };
  store.getState().setProject({ ...project, cropMode: "read", paragraphs: [script] });
  assert.equal(store.getState().selectedImageId, "image");
  const before = store.getState().project;
  store.getState().setViewZoom("", 3);
  await store.getState().saveCrop(true);
  assert.equal(store.getState().project, before);
  assert.equal(store.getState().workingViewZoom, 3);
  assert.equal(store.getState().error, null);
  assert.equal(store.getState().activeParagraphId, null);
  await store.getState().saveNow();
});

