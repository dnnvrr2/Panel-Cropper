import { Check, Plus, Undo2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useProjectStore } from "../stores/projectStore";
import { CropModeSwitch } from "./CropModeSwitch";

export function FreeCropPanel() {
  const { project, activeParagraphId, busy, setActiveParagraph, newFreeCrop, undo, undoDepth } = useProjectStore();
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  }, [activeParagraphId]);
  if (!project) return null;
  const items = project.freeCrops ?? [];
  return <aside className="free-crop-panel panel">
    <CropModeSwitch />
    <div className="panel-title">
      <div><span>Crops</span><small>{items.filter((item) => item.completed).length} saved</small></div>
      <button className="icon-button" onClick={undo} disabled={!undoDepth || busy}
        title="Undo last project edit (Ctrl+Z)" aria-label="Undo last project edit"><Undo2 size={17} /></button>
    </div>
    <p className="panel-hint">Choose an image, position the frame, and save. Each save starts the next crop.</p>
    <div className="paragraph-list" ref={listRef}>
      {items.map((item, index) => <button key={item.id}
        className={`free-crop-card${item.id === activeParagraphId ? " active" : ""}`}
        disabled={busy} onClick={() => setActiveParagraph(item.id)}>
        <strong>Crop {String(index + 1).padStart(3, "0")}</strong>
        <span>{item.completed ? <><Check size={14} /> Saved · {item.outputWidth} × {item.outputHeight}</> : "Position crop and save"}</span>
        {item.completed && <small>{item.outputFile?.split("/").at(-1)}</small>}
      </button>)}
    </div>
    <button className="add-paragraph" onClick={newFreeCrop} disabled={busy}><Plus size={16} /> New crop</button>
  </aside>;
}
