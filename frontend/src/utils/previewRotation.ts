export type PreviewRotation = 0 | 90 | 180 | 270;

type Rect = { x: number; y: number; width: number; height: number };

const swapsAxes = (rotation: PreviewRotation) => rotation === 90 || rotation === 270;

export function naturalCropRatio(displayRatio: number, rotation: PreviewRotation) {
  return swapsAxes(rotation) ? 1 / displayRatio : displayRatio;
}

export function cropForRotation(crop: Rect, imageWidth: number, imageHeight: number,
  displayRatio: number, fromRotation: PreviewRotation, toRotation: PreviewRotation): Rect {
  const displayWidth = swapsAxes(fromRotation) ? crop.height : crop.width;
  const displayHeight = swapsAxes(fromRotation) ? crop.width : crop.height;
  const targetDisplayWidth = Math.min(displayWidth, displayHeight * displayRatio);
  const targetDisplayHeight = targetDisplayWidth / displayRatio;
  const wantedWidth = swapsAxes(toRotation) ? targetDisplayHeight : targetDisplayWidth;
  const wantedHeight = swapsAxes(toRotation) ? targetDisplayWidth : targetDisplayHeight;
  const fit = Math.min(1, imageWidth / wantedWidth, imageHeight / wantedHeight);
  const width = wantedWidth * fit;
  const height = wantedHeight * fit;
  return {
    x: Math.max(0, Math.min(imageWidth - width, crop.x + crop.width / 2 - width / 2)),
    y: Math.max(0, Math.min(imageHeight - height, crop.y + crop.height / 2 - height / 2)),
    width, height,
  };
}

const axes: Record<PreviewRotation, readonly [cosine: number, sine: number]> = {
  0: [1, 0],
  90: [0, 1],
  180: [-1, 0],
  270: [0, -1],
};

export function rotatedPreviewSize(width: number, height: number, scale: number, rotation: PreviewRotation) {
  const [cosine, sine] = axes[rotation];
  const scaledWidth = width * scale;
  const scaledHeight = height * scale;
  const xs = [0, scaledWidth * cosine, -scaledHeight * sine, scaledWidth * cosine - scaledHeight * sine];
  const ys = [0, scaledWidth * sine, scaledHeight * cosine, scaledWidth * sine + scaledHeight * cosine];
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
    offsetX: Math.max(0, -minX),
    offsetY: Math.max(0, -minY),
  };
}

export function imagePointToPreview(x: number, y: number, width: number, height: number,
  scale: number, rotation: PreviewRotation) {
  const [cosine, sine] = axes[rotation];
  const { offsetX, offsetY } = rotatedPreviewSize(width, height, scale, rotation);
  return {
    x: (x * cosine - y * sine) * scale + offsetX,
    y: (x * sine + y * cosine) * scale + offsetY,
  };
}

export function cropRectInPreview(crop: Rect, imageWidth: number, imageHeight: number,
  scale: number, rotation: PreviewRotation): Rect {
  const a = imagePointToPreview(crop.x, crop.y, imageWidth, imageHeight, scale, rotation);
  const b = imagePointToPreview(crop.x + crop.width, crop.y + crop.height,
    imageWidth, imageHeight, scale, rotation);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

export function previewPointToImage(x: number, y: number, width: number, height: number,
  scale: number, rotation: PreviewRotation) {
  const [cosine, sine] = axes[rotation];
  const { offsetX, offsetY } = rotatedPreviewSize(width, height, scale, rotation);
  const localX = x - offsetX;
  const localY = y - offsetY;
  return {
    x: (localX * cosine + localY * sine) / scale,
    y: (-localX * sine + localY * cosine) / scale,
  };
}

export function previewRectToImageCrop(rect: Rect, imageWidth: number, imageHeight: number,
  scale: number, rotation: PreviewRotation): Rect {
  const a = previewPointToImage(rect.x, rect.y, imageWidth, imageHeight, scale, rotation);
  const b = previewPointToImage(rect.x + rect.width, rect.y + rect.height,
    imageWidth, imageHeight, scale, rotation);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

export function previewDeltaToImage(dx: number, dy: number, scale: number, rotation: PreviewRotation) {
  const [cosine, sine] = axes[rotation];
  return {
    dx: (dx * cosine + dy * sine) / scale,
    dy: (-dx * sine + dy * cosine) / scale,
  };
}
