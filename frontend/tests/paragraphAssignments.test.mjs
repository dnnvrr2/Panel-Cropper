import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/utils/paragraphAssignments.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { clearParagraphImage } = await import(`data:text/javascript,${encodeURIComponent(javascript)}`);

test("removing an image clears saved and draft references but keeps paragraph text", () => {
  const paragraph = {
    id: "one", text: "Keep this line", sourceImageId: "saved", draftImageId: "draft",
    crop: { x: 1, y: 2, width: 30, height: 40 }, zoom: 2, viewZoom: 1.5,
    panX: 4, panY: 5, completed: true, outputFile: "crops/001.png",
    outputWidth: 720, outputHeight: 1280, aspectRatio: "9:16",
  };
  const cleared = clearParagraphImage(paragraph);
  assert.equal(cleared.text, paragraph.text);
  assert.equal(cleared.aspectRatio, paragraph.aspectRatio);
  assert.equal(cleared.sourceImageId, undefined);
  assert.equal(cleared.draftImageId, null);
  assert.equal(cleared.crop, undefined);
  assert.equal(cleared.outputFile, undefined);
  assert.equal(cleared.completed, false);
  assert.equal(paragraph.sourceImageId, "saved");
});
