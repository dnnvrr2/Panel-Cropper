import { useEffect, useState, type CSSProperties } from "react";
import { AlertCircle, X } from "lucide-react";
import { BottomControls } from "./components/BottomControls";
import { CropWorkspace } from "./components/CropWorkspace";
import { ImageLibrary } from "./components/ImageLibrary";
import { ProjectHeader } from "./components/ProjectHeader";
import { ProjectLauncher } from "./components/ProjectLauncher";
import { ScriptPanel } from "./components/ScriptPanel";
import { FreeCropPanel } from "./components/FreeCropPanel";
import { CropModeSwitch } from "./components/CropModeSwitch";
import { cropItems } from "./utils/cropItems";
import { useProjectStore } from "./stores/projectStore";
import { ASPECT_RATIOS } from "./utils/aspectRatios";
import { exportScript } from "./utils/exportScript";
import { queueParagraphs } from "./utils/queue";
import { OnlineLibrary } from "./components/OnlineLibrary";
import type { OnlineChapterNavigation } from "./types/online";

export default function App() {
  const { project, activeParagraphId, error, busy, clearError } = useProjectStore();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [sourceWidth, setSourceWidth] = useState(340);
  const [showOnline, setShowOnline] = useState(false);
  const [onlineNavigation, setOnlineNavigation] = useState<OnlineChapterNavigation | null>(null);

  useEffect(() => {
    const fitPane = () => setSourceWidth((width) => Math.min(width, window.innerWidth <= 1100 ? 280 : 430));
    fitPane();
    window.addEventListener("resize", fitPane);
    return () => window.removeEventListener("resize", fitPane);
  }, []);

  useEffect(() => {
    type ItemPane = "images" | "script";
    const paneFor = (target: EventTarget | null): ItemPane | null => {
      if (!(target instanceof Element)) return null;
      if (target.closest(".image-library")) return "images";
      if (target.closest(".script-panel")) return "script";
      return null;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('.online-screen:not([hidden])')) return;
      const state = useProjectStore.getState();
      const currentProject = state.project;
      if (!currentProject) return;
      const isTextEditor = (target: EventTarget | null) =>
        target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable);
      const editingText = isTextEditor(event.target) || isTextEditor(document.activeElement);

      if (event.key === "Escape") { setShowShortcuts(false); state.clearItemSelection(); return; }
      if (event.key === "?" && !editingText) { event.preventDefault(); setShowShortcuts((open) => !open); return; }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "z") {
        if (editingText && !(event.target instanceof HTMLElement && event.target.matches(".paragraph-card textarea"))) return;
        event.preventDefault();
        state.undo();
        return;
      }
      if (document.querySelector(".shortcuts-dialog")) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void state.saveNow();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void state.saveCrop(true);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "e") {
        event.preventDefault();
        if ((currentProject.cropMode ?? "script") === "script") exportScript(currentProject);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a") {
        if (editingText) return;
        const hoveredPane: ItemPane | null = document.querySelector(".image-library:hover") ? "images"
          : document.querySelector(".script-panel:hover") ? "script" : null;
        const pane = hoveredPane ?? paneFor(document.activeElement) ?? state.lastItemPane;
        event.preventDefault();
        if (pane) {
          window.getSelection()?.removeAllRanges();
          if (pane === "images") state.selectAllVisibleImages();
          else state.selectAllParagraphs();
        }
        return;
      }
      if (event.key === "Delete" && !event.ctrlKey && !event.metaKey && !event.altKey && !editingText && state.selectedImageIds.length) {
        event.preventDefault();
        if (state.busy || event.repeat) return;
        const count = state.selectedImageIds.length;
        if (count === 1 || window.confirm(`Delete ${count} highlighted source images from this project? This cannot be undone. Images used by paragraphs will be kept.`)) {
          void state.removeSelectedImages();
        }
        return;
      }
      if (editingText) return;
      if (currentProject.cropMode === "read") {
        if (event.key === "+" || event.key === "=") { event.preventDefault(); state.setViewZoom("", state.workingViewZoom + 0.1); }
        if (event.key === "-") { event.preventDefault(); state.setViewZoom("", state.workingViewZoom - 0.1); }
        if (event.key === "0") { event.preventDefault(); state.setViewZoom("", 1); }
        return;
      }
      if (!state.activeParagraphId) return;

      const queue = currentProject.cropMode === "free" ? cropItems(currentProject) : queueParagraphs(currentProject.paragraphs);
      const index = queue.findIndex((item) => item.id === state.activeParagraphId);
      const paragraph = queue[index];
      if (!paragraph) return;
      if (event.altKey && event.key.startsWith("Arrow")) {
        event.preventDefault();
        const step = event.shiftKey ? 50 : 10;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        state.nudgeCrop(paragraph.id, dx, dy);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "[" || event.key === "ArrowLeft") {
        if (index > 0) { event.preventDefault(); state.setActiveParagraph(queue[index - 1].id); }
        return;
      }
      if (event.key === "]" || event.key === "ArrowRight") {
        if (index < queue.length - 1) { event.preventDefault(); state.setActiveParagraph(queue[index + 1].id); }
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        state.setViewZoom(paragraph.id, state.workingViewZoom + 0.1);
        return;
      }
      if (event.key === "-") {
        event.preventDefault();
        state.setViewZoom(paragraph.id, state.workingViewZoom - 0.1);
        return;
      }
      if (event.key === "0") { event.preventDefault(); state.setViewZoom(paragraph.id, 1); return; }
      const ratio = ASPECT_RATIOS.find((item) => item.shortcut === event.key);
      if (ratio) { event.preventDefault(); state.setAspectRatio(paragraph.id, ratio.label); }
      if (event.key.toLowerCase() === "r" || event.key.toLowerCase() === "f") { event.preventDefault(); state.resetCrop(paragraph.id); }
      if (event.key === "Delete" && state.selectedImageId) { event.preventDefault(); state.removeAssignment(paragraph.id); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const onlineLibrary = <OnlineLibrary hidden={!showOnline} onClose={() => setShowOnline(false)} onNavigationChange={setOnlineNavigation} />;
  if (!project) return <>{onlineLibrary}<div className="cropper-view" hidden={showOnline}>
    <ProjectLauncher onBrowse={() => setShowOnline(true)} /></div></>;

  return (
    <>{onlineLibrary}<div className="cropper-view" hidden={showOnline}><div className="app-shell">
      <ProjectHeader onShowShortcuts={() => setShowShortcuts(true)} onBrowse={() => setShowOnline(true)} />
      <main className="editor-grid" style={{ "--source-width": `${sourceWidth}px` } as CSSProperties}>
        <ImageLibrary />
        <div className="pane-divider" role="separator" tabIndex={0} aria-label="Resize source images pane"
          aria-orientation="vertical" aria-valuemin={220} aria-valuemax={430} aria-valuenow={sourceWidth}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            event.stopPropagation();
            setSourceWidth((width) => Math.max(220, Math.min(430, width + (event.key === "ArrowRight" ? 20 : -20))));
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            const startX = event.clientX;
            const startWidth = sourceWidth;
            const divider = event.currentTarget;
            const move = (moveEvent: globalThis.PointerEvent) => setSourceWidth(Math.max(220,
              Math.min(430, window.innerWidth - 665, startWidth + moveEvent.clientX - startX)));
            const stop = () => {
              divider.removeEventListener("pointermove", move);
              divider.removeEventListener("pointerup", stop);
              divider.removeEventListener("pointercancel", stop);
            };
            divider.addEventListener("pointermove", move);
            divider.addEventListener("pointerup", stop);
            divider.addEventListener("pointercancel", stop);
          }} />
        <CropWorkspace onlineNavigation={onlineNavigation} onChapterList={() => setShowOnline(true)} />
        {project.cropMode === "read" ? <aside className="reading-panel panel"><CropModeSwitch />
          <div className="panel-title"><span>Reading mode</span></div>
          <p className="panel-hint">Scroll to read. Switch crop mode when you want to save a panel.</p>
        </aside> : project.cropMode === "free" ? <FreeCropPanel /> : <ScriptPanel />}
      </main>
      <BottomControls />
      {error && (
        <div className="toast error-toast">
          <AlertCircle size={18} />
          <span>{error}</span>
          <button onClick={clearError}><X size={15} /></button>
        </div>
      )}
      {busy && <div className="busy-line" />}
      {showShortcuts && <div className="shortcuts-backdrop" onClick={() => setShowShortcuts(false)}>
        <section className="shortcuts-dialog" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(event) => event.stopPropagation()}>
          <div className="shortcuts-title"><strong>Keyboard shortcuts</strong><button onClick={() => setShowShortcuts(false)} aria-label="Close shortcuts"><X size={17} /></button></div>
          <dl>
            <dt>[ / ] or ← / →</dt><dd>Previous / next {project.cropMode === "free" ? "crop" : "paragraph in the queue"}</dd>
            <dt>1 / 2 / 3 / 4</dt><dd>Aspect ratio: 9:16 / 4:5 / 4:3 / 1:1</dd>
            <dt>Alt + arrows</dt><dd>Move crop frame 10 pixels (Shift: 50)</dd>
            <dt>+ / − / 0</dt><dd>Panel preview zoom in / out / reset</dd>
            <dt>R</dt><dd>Reset crop frame</dd>
            <dt>Delete</dt><dd>Delete highlighted source images, or clear the current assignment</dd>
            <dt>Ctrl + Enter</dt><dd>Save crop and advance</dd>
            <dt>Ctrl + S</dt><dd>Save project</dd>
            <dt>Ctrl + Z</dt><dd>Undo the last project edit</dd>
            <dt>Ctrl + Shift + E</dt><dd>Export edited script</dd>
            <dt>Ctrl + A</dt><dd>Select all items in the hovered or last-used side pane</dd>
            <dt>?</dt><dd>Show or hide shortcuts</dd>
          </dl>
        </section>
      </div>}
    </div></div></>
  );
}
