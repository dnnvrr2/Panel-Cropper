import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/utils/undoHistory.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { pushUndoEntry } = await import(`data:text/javascript,${encodeURIComponent(javascript)}`);

test("one typing burst restores the state before the burst", () => {
  let entries = pushUndoEntry([], "before typing", "text:one", 1000);
  entries = pushUndoEntry(entries, "after first key", "text:one", 1200);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].snapshot, "before typing");
  entries = pushUndoEntry(entries, "after pause", "text:one", 2100);
  assert.deepEqual(entries.map((entry) => entry.snapshot), ["before typing", "after pause"]);
});

test("different actions remain separate undo steps and history is bounded", () => {
  let entries = pushUndoEntry([], 0, "text:one", 1000, 3);
  entries = pushUndoEntry(entries, 1, null, 1100, 3);
  entries = pushUndoEntry(entries, 2, "text:one", 1200, 3);
  entries = pushUndoEntry(entries, 3, null, 1300, 3);
  assert.deepEqual(entries.map((entry) => entry.snapshot), [1, 2, 3]);
});
