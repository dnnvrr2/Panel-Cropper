import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTs } from "./loadTs.mjs";

const { api } = await import(await loadTs(new URL("../src/services/api.ts", import.meta.url)));
const { useProjectStore: store } = await import(await loadTs(new URL("../src/stores/projectStore.ts", import.meta.url)));
const { ParagraphCard } = await import(await loadTs(new URL("../src/components/ParagraphCard.tsx", import.meta.url)));
const strip = { id: "strip", filename: "Book.cbz", path: "first.png", width: 800, height: 3000,
  sourceGroupId: "comic", stripPages: [{ id: "page1", filename: "1.png", path: "first.png", width: 800,
    height: 1500, top: 0, stripHeight: 1500 }, { id: "page2", filename: "2.png", path: "second.png",
    width: 800, height: 1500, top: 1500, stripHeight: 1500 }] };
const paragraph = { id: "p1", text: "First paragraph", aspectRatio: "9:16", zoom: 1, panX: 0, panY: 0, completed: false };
const project = { id: "project", projectName: "Comic", outputFolder: "test", defaultAspectRatio: "9:16",
  images: [strip], sourceGroups: [{ id: "comic", name: "Book", kind: "cbz", createdAt: "today" }],
  paragraphs: [paragraph, { ...paragraph, id: "p2", text: "Second paragraph" }] };

api.saveProject = async (project) => project;

test("CBZ can open before adding script; reopening selects the continuous strip", async () => {
  store.getState().setProject({ ...project, paragraphs: [] });
  assert.equal(store.getState().selectedImageId, strip.id);
  store.getState().addParagraph();
  assert.equal(store.getState().selectedImageId, strip.id);
  await store.getState().saveNow();
  store.getState().setProject(project);
  assert.equal(store.getState().selectedImageId, strip.id);
  assert.equal(store.getState().activeSourceGroupId, "comic");
});

test("saving a crop across a seam completes a paragraph and keeps the strip and zoom for the next", async () => {
  store.getState().setProject(project);
  const crop = { x: 40, y: 1400, width: 720, height: 1280 };
  store.getState().setCropRect("p1", crop);
  store.getState().setViewZoom("p1", 0.25);
  let savedImage;
  api.saveCrop = async (_id, prepared, imageId) => {
    savedImage = imageId;
    return { ...store.getState().project, paragraphs: [
      { ...prepared, sourceImageId: imageId, completed: true }, project.paragraphs[1],
    ] };
  };
  await store.getState().saveCrop(true);
  const state = store.getState();
  assert.equal(savedImage, "strip");
  assert.equal(state.project.paragraphs[0].completed, true);
  assert.equal(state.activeParagraphId, "p2");
  assert.equal(state.selectedImageId, "strip");
  assert.equal(state.workingViewZoom, 0.25);
  assert.deepEqual(state.workingCrop, crop);
});

test("CBZ script cards render Completed without a filename or source tab", () => {
  const html = renderToStaticMarkup(createElement(ParagraphCard, {
    paragraph: { ...paragraph, sourceImageId: "strip", completed: true }, image: strip,
    sourceTabName: "Comic tab", index: 0, total: 1, active: true, selected: false,
  }));
  assert.ok(html.includes("Completed"));
  assert.ok(!html.includes("Book.cbz"));
  assert.ok(!html.includes("Comic tab"));
  const normal = renderToStaticMarkup(createElement(ParagraphCard, {
    paragraph: { ...paragraph, sourceImageId: "image", completed: true },
    image: { ...strip, stripPages: undefined, filename: "original.png" },
    sourceTabName: "Folder tab", index: 0, total: 1, active: true, selected: false,
  }));
  assert.ok(normal.includes("original.png") && normal.includes("Folder tab"));
});
