import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/utils/normalizeProject.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { normalizeProject } = await import(`data:text/javascript,${encodeURIComponent(javascript)}`);

test("legacy images get one stable Project files group", () => {
  const legacy = {
    id: "story", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z",
    images: [{ id: "first", filename: "1.png" }, { id: "second", filename: "2.png" }],
    paragraphs: [{ id: "paragraph", sourceImageId: "first", completed: true }],
  };
  const normalized = normalizeProject(legacy);
  const again = normalizeProject(normalized);
  assert.equal(normalized.sourceGroups.length, 1);
  assert.equal(normalized.sourceGroups[0].kind, "project-files");
  assert.deepEqual(normalized.images.map((image) => image.sourceGroupId), [normalized.sourceGroups[0].id, normalized.sourceGroups[0].id]);
  assert.deepEqual(again.sourceGroups, normalized.sourceGroups);
  assert.deepEqual(again.paragraphs, legacy.paragraphs);
});

test("empty legacy projects stay group-free", () => {
  const project = normalizeProject({ id: "empty", images: [], paragraphs: [] });
  assert.deepEqual(project.sourceGroups, []);
});

test("existing folder assignments stay intact while loose files join Project files", () => {
  const project = normalizeProject({
    id: "mixed", createdAt: "2026-01-01T00:00:00Z",
    sourceGroups: [{ id: "folder", kind: "folder", name: "Chapter" }],
    images: [{ id: "a", sourceGroupId: "folder" }, { id: "b" }], paragraphs: [],
  });
  assert.equal(project.images[0].sourceGroupId, "folder");
  assert.equal(project.images[1].sourceGroupId, project.sourceGroups[1].id);
  assert.equal(project.sourceGroups[1].kind, "project-files");
});
