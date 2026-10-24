import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { ArrowLeft, ArrowRight, BookOpen, ImageIcon, Maximize2, MousePointer2 } from "lucide-react";
import { api } from "../services/api";
import { useProjectStore } from "../stores/projectStore";
import { aspectValue } from "../utils/aspectRatios";
import { cropForRotation, cropRectInPreview, imagePointToPreview, naturalCropRatio,
  previewDeltaToImage, previewPointToImage, previewRectToImageCrop, rotatedPreviewSize } from "../utils/previewRotation";
import type { CropRect } from "../types/project";
import type { PreviewRotation } from "../utils/previewRotation";
import { StripPreview } from "./StripPreview";
import { cropItems } from "../utils/cropItems";
import type { OnlineChapterNavigation } from "../types/online";

type Corner = "nw" | "ne" | "sw" | "se";
type Drag = { kind: "move" | Corner; x: number; y: number; crop: CropRect };
type ViewPosition = { imageId: string; rotation: PreviewRotation; zoom: number;
  width: number; height: number; screenX: number; screenY: number };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function CropWorkspace({ onlineNavigation, onChapterList }: {
  onlineNavigation?: OnlineChapterNavigation | null; onChapterList?: () => void;
} = {}) {
  const { project, activeParagraphId, selectedImageId, workingCrop, workingViewZoom, previewRotation,
    workingAspectRatio, selectImage, setCropRect, setPanelFit } = useProjectStore();
  const paragraph = project && cropItems(project).find((item) => item.id === activeParagraphId);
  const reading = project?.cropMode === "read";
  const image = project?.images.find((item) => item.id === selectedImageId);
  const busy = useProjectStore((state) => state.busy);
  const chapterNavigation = image?.onlineOrigin?.wholeChapter && onlineNavigation &&
    image.onlineOrigin.chapterId === onlineNavigation.chapterId && image.onlineOrigin.serverUrl === onlineNavigation.serverUrl
    ? onlineNavigation : null;
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const viewPosition = useRef<ViewPosition | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, [Boolean(image)]);

  useEffect(() => {
    if (!image || !paragraph) return;
    const displayRatio = aspectValue(workingAspectRatio);
    const ratio = naturalCropRatio(displayRatio, previewRotation);
    if (workingCrop) {
      if (Math.abs(workingCrop.width / workingCrop.height - ratio) > ratio * 0.001) {
        setCropRect(paragraph.id, cropForRotation(workingCrop, image.width, image.height,
          displayRatio, previewRotation, previewRotation), false);
      }
      return;
    }
    const width = Math.min(image.width, image.height * ratio) * 0.9;
    const height = width / ratio;
    setCropRect(paragraph.id, {
      x: (image.width - width) / 2,
      y: image.stripPages ? 0 : (image.height - height) / 2,
      width,
      height,
    }, false);
  }, [image?.id, paragraph?.id, workingAspectRatio, workingCrop, previewRotation, setCropRect]);

  const fitScale = image && stageSize.width && stageSize.height
    ? Math.min(stageSize.width - 40, (stageSize.height - 40) * 9 / 16) / image.width
    : 0;

  useEffect(() => {
    if (image && fitScale > 0) setPanelFit(image.id, fitScale, stageSize.width, stageSize.height);
  }, [image?.id, fitScale, stageSize.width, stageSize.height, setPanelFit]);

  const scale = fitScale * workingViewZoom;
  const displayWidth = image ? image.width * scale : 0;
  const displayHeight = image ? image.height * scale : 0;
  const rotatedSize = image ? rotatedPreviewSize(image.width, image.height, scale, previewRotation)
    : { width: 0, height: 0, offsetX: 0, offsetY: 0 };
  const surfaceTransform = `translate(${rotatedSize.offsetX}px, ${rotatedSize.offsetY}px) rotate(${previewRotation}deg)`;

  useLayoutEffect(() => {
    if (!stage.current || !image || !scale) {
      if (!image) viewPosition.current = null;
      return;
    }
    if (!workingCrop) {
      viewPosition.current = { imageId: image.id, rotation: previewRotation, zoom: workingViewZoom,
        width: stageSize.width, height: stageSize.height, screenX: stageSize.width / 2, screenY: stageSize.height / 2 };
      return;
    }
    const stageElement = stage.current;
    const contentWidth = Math.max(stageSize.width, rotatedSize.width + 40);
    const contentHeight = Math.max(stageSize.height, rotatedSize.height + 40);
    const center = imagePointToPreview(workingCrop.x + workingCrop.width / 2,
      workingCrop.y + workingCrop.height / 2, image.width, image.height, scale, previewRotation);
    const previous = viewPosition.current;
    const rotatedSameImage = previous?.imageId === image.id && previous.rotation !== previewRotation;
    const viewportChanged = !previous || previous.imageId !== image.id || rotatedSameImage ||
      previous.zoom !== workingViewZoom;
    if (viewportChanged) {
      stageElement.scrollLeft = (contentWidth - rotatedSize.width) / 2 + center.x -
        (rotatedSameImage ? previous.screenX : stageSize.width / 2);
      stageElement.scrollTop = (contentHeight - rotatedSize.height) / 2 + center.y -
        (rotatedSameImage ? previous.screenY : stageSize.height / 2);
    }
    viewPosition.current = { imageId: image.id, rotation: previewRotation, zoom: workingViewZoom,
      width: stageSize.width, height: stageSize.height,
      screenX: (contentWidth - rotatedSize.width) / 2 + center.x - stageElement.scrollLeft,
      screenY: (contentHeight - rotatedSize.height) / 2 + center.y - stageElement.scrollTop };
    // Preserve the frame's screen position on rotation; follow crop edits without scrolling the stage.
  }, [workingCrop, workingViewZoom, previewRotation, image?.id, stageSize.width, stageSize.height]);

  const rememberScrollPosition = () => {
    if (!stage.current || !image || !workingCrop || !scale) return;
    const contentWidth = Math.max(stageSize.width, rotatedSize.width + 40);
    const contentHeight = Math.max(stageSize.height, rotatedSize.height + 40);
    const center = imagePointToPreview(workingCrop.x + workingCrop.width / 2,
      workingCrop.y + workingCrop.height / 2, image.width, image.height, scale, previewRotation);
    viewPosition.current = { imageId: image.id, rotation: previewRotation, zoom: workingViewZoom,
      width: stageSize.width, height: stageSize.height,
      screenX: (contentWidth - rotatedSize.width) / 2 + center.x - stage.current.scrollLeft,
      screenY: (contentHeight - rotatedSize.height) / 2 + center.y - stage.current.scrollTop };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>, kind: Drag["kind"]) => {
    if (!workingCrop) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { kind, x: event.clientX, y: event.clientY, crop: workingCrop };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || !image || !paragraph || !displayWidth || !displayHeight) return;
    const screenDx = event.clientX - start.x;
    const screenDy = event.clientY - start.y;
    if (start.kind === "move") {
      const { dx, dy } = previewDeltaToImage(screenDx, screenDy, scale, previewRotation);
      setCropRect(paragraph.id, {
        ...start.crop,
        x: clamp(start.crop.x + dx, 0, image.width - start.crop.width),
        y: clamp(start.crop.y + dy, 0, image.height - start.crop.height),
      });
      return;
    }
    const ratio = aspectValue(workingAspectRatio);
    const previewCrop = cropRectInPreview(start.crop, image.width, image.height, scale, previewRotation);
    const right = start.kind.endsWith("e");
    const bottom = start.kind.startsWith("s");
    const anchorX = right ? previewCrop.x : previewCrop.x + previewCrop.width;
    const anchorY = bottom ? previewCrop.y : previewCrop.y + previewCrop.height;
    const changeX = screenDx * (right ? 1 : -1);
    const changeY = screenDy * (bottom ? ratio : -ratio);
    const change = Math.abs(changeX) >= Math.abs(changeY) ? changeX : changeY;
    const maxWidth = Math.min(right ? rotatedSize.width - anchorX : anchorX,
      (bottom ? rotatedSize.height - anchorY : anchorY) * ratio);
    const width = clamp(previewCrop.width + change, Math.min(24 * scale, maxWidth), maxWidth);
    const height = width / ratio;
    setCropRect(paragraph.id, previewRectToImageCrop({
      x: right ? anchorX : anchorX - width,
      y: bottom ? anchorY : anchorY - height,
      width,
      height,
    }, image.width, image.height, scale, previewRotation));
  };

  const finishDrag = () => { drag.current = null; };
  const crop = workingCrop;
  const previewCrop = !reading && crop && image && scale > 0
    ? cropRectInPreview(crop, image.width, image.height, scale, previewRotation) : null;
  const outputSize = crop ? rotatedPreviewSize(crop.width, crop.height, 1, previewRotation) : null;

  const moveCropToClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !image || !paragraph || !crop || !scale) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const { x: imageX, y: imageY } = previewPointToImage(event.clientX - bounds.left,
      event.clientY - bounds.top, image.width, image.height, scale, previewRotation);
    setCropRect(paragraph.id, {
      ...crop,
      x: clamp(imageX - crop.width / 2, 0, image.width - crop.width),
      y: clamp(imageY - crop.height / 2, 0, image.height - crop.height),
    });
  };

  if (!project || (!paragraph && !image)) {
    return <section className="crop-workspace"><div className="workspace-empty">
      <MousePointer2 size={38} /><strong>{reading ? "Choose an image to read" : "Select a script paragraph"}</strong>
      <span>{reading ? "Select an image or chapter from the source tabs." : "Each script line gets its own crop."}</span>
    </div></section>;
  }

  return (
    <section className={`crop-workspace${chapterNavigation ? " has-chapter-toolbar" : ""}`}
      onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-panel-image")) event.preventDefault(); }}
      onDrop={(event) => {
        const imageId = event.dataTransfer.getData("application/x-panel-image");
        if (imageId) { event.preventDefault(); selectImage(imageId); }
      }}
    >
      {chapterNavigation && <div className="crop-chapter-toolbar">
        <button className="toolbar-button" onClick={onChapterList} disabled={busy}><BookOpen size={14} /> Chapters</button>
        <span title={chapterNavigation.label}>{chapterNavigation.label}</span>
        <button className="toolbar-button" aria-label="Previous chapter" title="Previous chapter" disabled={busy || !chapterNavigation.previous}
          onClick={chapterNavigation.previous}><ArrowLeft size={15} /></button>
        <button className="toolbar-button" aria-label="Next chapter" title="Next chapter" disabled={busy || !chapterNavigation.next}
          onClick={chapterNavigation.next}><ArrowRight size={15} /></button>
      </div>}
      {!image && <div className="workspace-empty"><ImageIcon size={42} />
        <strong>Choose an image to crop</strong>
        <span>Click an image or drag it here. The image and crop stay in place as you move through paragraphs.</span>
      </div>}
      {image && <div className="crop-stage" ref={stage} onScroll={rememberScrollPosition}
        role="region" aria-label="Image view" tabIndex={0}>
        {scale > 0 && <div className="crop-stage-content" style={{
          width: Math.max(stageSize.width, rotatedSize.width + 40),
          height: Math.max(stageSize.height, rotatedSize.height + 40),
        }}><div className="crop-rotation-frame" style={{ width: rotatedSize.width, height: rotatedSize.height }}
          onClick={reading ? undefined : moveCropToClick} title={reading ? "Scroll to read" : "Click to move the crop frame here"}>
          <div className="crop-image-surface" style={{ width: displayWidth, height: displayHeight, transform: surfaceTransform }}
          >
          {image.stripPages ? <StripPreview key={image.id} projectId={project.id} image={image} scale={scale} stage={stage} />
            : <img src={api.imageUrl(project.id, image.id)} alt={image.filename} draggable={false} />}
          </div>
          {previewCrop && <div className="crop-frame" style={{
            left: previewCrop.x, top: previewCrop.y,
            width: previewCrop.width, height: previewCrop.height,
          }} onPointerDown={(event) => onPointerDown(event, "move")}
          onClick={(event) => event.stopPropagation()}
          onPointerMove={onPointerMove} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
            <div className="crop-grid" />
            {(["nw", "ne", "sw", "se"] as const).map((corner) =>
              <div key={corner} className={`crop-handle ${corner}`}
                onPointerDown={(event) => onPointerDown(event, corner)}
                onPointerMove={onPointerMove} onPointerUp={finishDrag} onPointerCancel={finishDrag} />)}
          </div>}
        </div></div>}
      </div>}
      <div className="workspace-status">
        {image ? <><span><Maximize2 size={13} /> {image.width} × {image.height}</span>
          <span>{image.stripPages ? `${image.stripPages.length} pages · Continuous strip` : image.filename}</span>
          <span>{reading ? "Reading mode" : outputSize ? `${Math.round(outputSize.width)} × ${Math.round(outputSize.height)}${previewRotation ? ` · ${previewRotation}°` : ""}`
            : paragraph ? "Positioning…" : "Add a paragraph to crop"}</span></>
          : <><span>No image selected</span><span>{paragraph?.aspectRatio}</span></>}
      </div>
    </section>
  );
}
