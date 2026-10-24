import { ChevronLeft, ChevronRight, RotateCcw, RotateCw, Save, SkipForward } from "lucide-react";
import { useProjectStore } from "../stores/projectStore";
import { AspectRatioSelector } from "./AspectRatioSelector";
import { queueParagraphs } from "../utils/queue";
import { cropItems } from "../utils/cropItems";

export function BottomControls() {
  const {
    project,
    activeParagraphId,
    selectedImageId,
    workingCrop,
    workingZoom,
    workingViewZoom,
    previewRotation,
    panelFitScale,
    panelViewport,
    workingAspectRatio,
    busy,
    setActiveParagraph,
    setAspectRatio,
    setViewZoom,
    rotatePreview,
    resetCrop,
    saveCrop,
  } = useProjectStore();
  if (!project) return null;
  const queue = project.cropMode === "free" ? cropItems(project) : queueParagraphs(project.paragraphs);
  const index = queue.findIndex((item) => item.id === activeParagraphId);
  const paragraph = queue[index];
  if (project.cropMode === "read") return <footer className="bottom-controls">
    <span>Reading mode</span><div className="control-spacer" />
    <label className="zoom-control panel-zoom-control"><span>Panel</span>
      <input type="range" aria-label="Reading zoom" min="0.05" max="8" step="0.01" value={workingViewZoom}
        disabled={!selectedImageId} onChange={(event) => setViewZoom("", Number(event.target.value))} />
      <output>{panelFitScale ? `${Math.round(panelFitScale * workingViewZoom * 100)}%` : "Fit"}</output>
    </label>
    <button className="toolbar-button" disabled={!selectedImageId} onClick={() => setViewZoom("", 1)} title="Reset reading zoom (0)">
      <RotateCcw size={16} /> Reset zoom
    </button>
  </footer>;
  if (!paragraph) return <footer className="bottom-controls"><span>Add a paragraph to begin.</span></footer>;

  const canSave = Boolean(selectedImageId && workingCrop) && !busy;
  const panelScale = panelFitScale || 1;
  const panelPercent = panelFitScale * workingViewZoom * 100;
  const panelPercentLabel = panelPercent < 10 ? panelPercent.toFixed(1) : String(Math.round(panelPercent));

  return (
    <footer className="bottom-controls">
      <AspectRatioSelector value={workingAspectRatio} onChange={(ratio) => setAspectRatio(paragraph.id, ratio)} />
      <div className="control-divider" />
      <label className="zoom-control">
        <span>Crop</span>
        <input
          type="range"
          min="0.5"
          max="5"
          step="0.01"
          value={workingZoom}
          onChange={(event) => useProjectStore.getState().setZoom(paragraph.id, Number(event.target.value))}
          disabled={!selectedImageId}
        />
        <output>{Math.round(workingZoom * 100)}%</output>
      </label>
      <label className="zoom-control panel-zoom-control" title={panelFitScale
        ? `Panel ${Math.round(panelViewport.width)} × ${Math.round(panelViewport.height)} px; image shown at ${panelPercentLabel}% of its original size. Exported crop is unchanged.`
        : "Panel zoom adjusts to fit the available space; exported crop is unchanged."}>
        <span>Panel</span>
        <input
          type="range"
          min={panelScale * 0.05}
          max={panelScale * 8}
          step={panelScale * 0.01}
          value={panelScale * workingViewZoom}
          aria-valuetext={panelFitScale ? `${panelPercentLabel}% of original image size` : "Fit to panel"}
          onChange={(event) => setViewZoom(paragraph.id, Number(event.target.value) / panelScale)}
          disabled={!selectedImageId}
        />
        <output>{panelFitScale ? `${panelPercentLabel}%` : "Fit"}</output>
      </label>
      <button className="toolbar-button" onClick={() => resetCrop(paragraph.id)} disabled={!selectedImageId} title="Reset crop (R)">
        <RotateCcw size={16} /> Reset
      </button>
      <button className="toolbar-button icon-button" onClick={rotatePreview} disabled={!selectedImageId}
        title={`Rotate image 90° clockwise while keeping the crop ratio (currently ${previewRotation}°). Save crop to export this rotation.`}
        aria-label="Rotate image 90 degrees clockwise and keep crop orientation">
        <RotateCw size={17} />
      </button>
      <div className="control-spacer" />
      <button className="nav-button" disabled={busy || index <= 0} onClick={() => setActiveParagraph(queue[index - 1].id)} title={project.cropMode === "free" ? "Previous crop ([)" : "Previous paragraph ([)"}>
        <ChevronLeft size={18} />
      </button>
      <span className="panel-counter">{index + 1} / {queue.length}</span>
      <button className="nav-button" disabled={busy || index >= queue.length - 1} onClick={() => setActiveParagraph(queue[index + 1].id)} title={project.cropMode === "free" ? "Next crop (])" : "Next paragraph (])"}>
        <ChevronRight size={18} />
      </button>
      <button className="primary-button save-next" disabled={!canSave} onClick={() => saveCrop(true)} title="Save crop and advance (Ctrl+Enter)">
        <Save size={16} /> Save crop <SkipForward size={17} />
      </button>
    </footer>
  );
}
