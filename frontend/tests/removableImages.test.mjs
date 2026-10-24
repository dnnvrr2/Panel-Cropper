import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/utils/removableImages.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { removableImageIds } = await import(`data:text/javascript,${encodeURIComponent(javascript)}`);

test("batch image deletion excludes both saved and draft paragraph references", () => {
  const project = {
    images: ["free", "saved", "draft", "free-2"].map((id) => ({ id })),
    paragraphs: [{ sourceImageId: "saved" }, { draftImageId: "draft" }],
  };
  assert.deepEqual(removableImageIds(project, ["free", "saved", "draft", "free-2", "missing"]), ["free", "free-2"]);
});

test("images used by script-free crops are protected from batch deletion", () => {
  const project = { images: ["saved", "draft", "unused"].map((id) => ({ id })), paragraphs: [],
    freeCrops: [{ sourceImageId: "saved", completed: true }, { draftImageId: "draft", completed: false }] };
  assert.deepEqual(removableImageIds(project, ["saved", "draft", "unused"]), ["unused"]);
});
