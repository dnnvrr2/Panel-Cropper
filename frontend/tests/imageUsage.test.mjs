import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/utils/imageUsage.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { imageUsage } = await import(`data:text/javascript,${encodeURIComponent(javascript)}`);

test("completed crops and draft assignments use script positions", () => {
  const paragraphs = [
    { id: "a", completed: false, draftImageId: "draft" },
    { id: "b", completed: true, sourceImageId: "saved", draftImageId: "draft" },
    { id: "c", completed: false, sourceImageId: "saved" },
    { id: "d", completed: false, sourceImageId: "saved", draftImageId: null },
  ];
  assert.deepEqual(imageUsage(paragraphs).get("draft"), { cropped: [], assigned: ["001"] });
  assert.deepEqual(imageUsage(paragraphs).get("saved"), { cropped: ["002"], assigned: ["003"] });
});

test("reordering renumbers image labels", () => {
  const a = { id: "a", completed: true, sourceImageId: "image" };
  const b = { id: "b", completed: false, draftImageId: "image" };
  assert.deepEqual(imageUsage([a, b]).get("image"), { cropped: ["001"], assigned: ["002"] });
  assert.deepEqual(imageUsage([b, a]).get("image"), { cropped: ["002"], assigned: ["001"] });
});
