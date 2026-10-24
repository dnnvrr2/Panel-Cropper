import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/utils/previewRotation.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { rotatedPreviewSize, imagePointToPreview, previewPointToImage, previewDeltaToImage,
  cropForRotation, cropRectInPreview, previewRectToImageCrop, naturalCropRatio } =
  await import(`data:text/javascript,${encodeURIComponent(javascript)}`);

const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9,
  `${actual} should be close to ${expected}`);

test("rotated preview bounds include the whole image at 90-degree steps", () => {
  assert.deepEqual(rotatedPreviewSize(800, 1000, 0.5, 0),
    { width: 400, height: 500, offsetX: 0, offsetY: 0 });
  assert.deepEqual(rotatedPreviewSize(800, 1000, 0.5, 90),
    { width: 500, height: 400, offsetX: 500, offsetY: 0 });
  for (const rotation of [0, 90, 180, 270]) {
    const bounds = rotatedPreviewSize(800, 1000, 0.5, rotation);
    for (const [x, y] of [[0, 0], [800, 0], [0, 1000], [800, 1000]]) {
      const point = imagePointToPreview(x, y, 800, 1000, 0.5, rotation);
      assert.ok(point.x >= -1e-9 && point.x <= bounds.width + 1e-9);
      assert.ok(point.y >= -1e-9 && point.y <= bounds.height + 1e-9);
    }
  }
});

test("clicks and pointer drags map back to natural image pixels at every angle", () => {
  for (const rotation of [0, 90, 180, 270]) {
    const preview = imagePointToPreview(120, 340, 800, 1000, 0.5, rotation);
    const image = previewPointToImage(preview.x, preview.y, 800, 1000, 0.5, rotation);
    closeTo(image.x, 120);
    closeTo(image.y, 340);
    const next = imagePointToPreview(140, 350, 800, 1000, 0.5, rotation);
    const delta = previewDeltaToImage(next.x - preview.x, next.y - preview.y, 0.5, rotation);
    closeTo(delta.dx, 20);
    closeTo(delta.dy, 10);
  }
});

test("rotating keeps the crop's chosen orientation and center when it fits", () => {
  for (const ratio of [9 / 16, 4 / 3]) {
    const initial = { x: 200, y: 300, width: 300 * ratio, height: 300 };
    for (const rotation of [0, 90, 180, 270]) {
      const next = (rotation + 90) % 360;
      const crop = cropForRotation(initial, 1200, 1200, ratio, rotation, next);
      closeTo(crop.x + crop.width / 2, initial.x + initial.width / 2);
      closeTo(crop.y + crop.height / 2, initial.y + initial.height / 2);
      closeTo(crop.width / crop.height, naturalCropRatio(ratio, next));
      const frame = cropRectInPreview(crop, 1200, 1200, 0.5, next);
      closeTo(frame.width / frame.height, ratio);
      const restored = previewRectToImageCrop(frame, 1200, 1200, 0.5, next);
      for (const key of ["x", "y", "width", "height"]) closeTo(restored[key], crop[key]);
    }
  }
});

test("a tall strip keeps a vertical 9:16 frame after a 90-degree rotation", () => {
  const crop = cropForRotation({ x: 36, y: 2000, width: 648, height: 1152 },
    720, 16470, 9 / 16, 0, 90);
  assert.ok(crop.x >= 0 && crop.x + crop.width <= 720);
  closeTo(crop.width / crop.height, 16 / 9);
  const frame = cropRectInPreview(crop, 720, 16470, 0.5, 90);
  closeTo(frame.width / frame.height, 9 / 16);
  closeTo(frame.x + frame.width / 2, (16470 - 2000 - 1152 / 2) * 0.5);
});
