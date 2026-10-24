import { BookOpen, Download, Folder, Keyboard, Plus, Save } from "lucide-react";
import { useProjectStore } from "../stores/projectStore";
import { cropItems } from "../utils/cropItems";

export function ProjectHeader({ onShowShortcuts, onBrowse }: { onShowShortcuts: () => void; onBrowse: () => void }) {
  const { project, saveState, busy, saveNow, exportAll, setProject } = useProjectStore();
  if (!project) return null;

  const items = cropItems(project);
  const completed = items.filter((item) => item.completed).length;

  return (
    <header className="project-header">
      <button type="button" className="header-brand" onClick={() => setProject(null)} disabled={busy} title="Back to projects" aria-label="Back to projects">
        <img className="header-mark" src="/brand-mark.svg" width={22} height={22} alt="" />
        <div>
          <strong>Panel Cropper</strong>
          <span>{project.projectName}</span>
        </div>
      </button>
      <div className="header-location" title={project.outputFolder}>
        <Folder size={15} />
        <span>{project.outputFolder}</span>
      </div>
      <div className="header-progress">
        <span>{project.cropMode === "read" ? "Reading mode" : project.cropMode === "free" ? `${completed} crops saved` : `${completed}/${items.length} complete`}</span>
        <div className="progress-track">
          <div
            className="progress-value"
            style={{ width: `${items.length ? (completed / items.length) * 100 : 0}%` }}
          />
        </div>
      </div>
      <span className={`save-state ${saveState}`}>{saveState === "saving" ? "Saving…" : saveState}</span>
      <div className="header-actions">
        <button className="toolbar-button" onClick={onBrowse} disabled={busy} title="Search series and read online chapters">
          <BookOpen size={16} /> Browse & read
        </button>
        <button className="toolbar-button" onClick={onShowShortcuts} title="Keyboard shortcuts (?)">
          <Keyboard size={16} /> Keys
        </button>
        <button className="toolbar-button" onClick={() => setProject(null)} disabled={busy} title="New project">
          <Plus size={16} /> New
        </button>
        <button className="toolbar-button" onClick={() => saveNow()} disabled={busy} title="Save project (Ctrl+S)">
          <Save size={16} /> Save
        </button>
        <button className="toolbar-button accent" onClick={() => exportAll()} disabled={busy}>
          <Download size={16} /> Export all
        </button>
      </div>
    </header>
  );
}
