import { useEffect, useState } from "react";
import { BookOpen, FolderOpen, LoaderCircle, Plus } from "lucide-react";
import { api } from "../services/api";
import { useProjectStore } from "../stores/projectStore";
import type { ProjectSummary } from "../types/project";

export function ProjectLauncher({ onBrowse }: { onBrowse: () => void }) {
  const [name, setName] = useState("");
  const [outputFolder, setOutputFolder] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [recent, setRecent] = useState<ProjectSummary[]>([]);
  const { createProject, loadProject, openProject, busy, error, clearError } = useProjectStore();

  useEffect(() => {
    api.listProjects().then(setRecent).catch(() => setRecent([]));
  }, []);

  const openExisting = async () => {
    clearError();
    const result = await api.selectFolder();
    if (result.path) await openProject(result.path);
  };

  const chooseOutput = async () => {
    clearError();
    const result = await api.selectFolder("output");
    if (result.path) setOutputFolder(result.path);
  };

  return (
    <main className="launcher-shell">
      <section className="launcher-card">
        <div className="launcher-brand">
          <img className="launcher-mark" src="/brand-mark.svg" width={34} height={34} alt="" />
          <div>
            <h1>Panel Cropper</h1>
            <p>Read chapters, write scripts, and crop panels in one place.</p>
          </div>
        </div>

        <div className="launcher-form">
          <div className="launcher-actions">
            <button type="button" className="primary-button" disabled={busy} onClick={onBrowse}>
              <BookOpen size={18} /> Browse & read online
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={busy}
              aria-expanded={showCreateForm}
              aria-controls="create-project-form"
              onClick={() => { clearError(); setShowCreateForm((visible) => !visible); }}
            >
              <Plus size={18} /> Create project
            </button>
            <button type="button" className="secondary-button" disabled={busy} onClick={openExisting}>
              <FolderOpen size={17} /> Open existing project folder
            </button>
          </div>
          {showCreateForm && (
            <form
              id="create-project-form"
              className="launcher-create-form"
              onSubmit={(event) => { event.preventDefault(); void createProject(name, outputFolder || undefined); }}
            >
              <label>
                Project name <span>Optional</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Project 1"
                  autoFocus
                />
              </label>
              <div className="output-folder-choice">
                <button type="button" className="secondary-button" disabled={busy} onClick={chooseOutput}><FolderOpen size={16} /> Choose output folder</button>
                <span title={outputFolder}>{outputFolder || "Using the default output folder"}</span>
              </div>
              <button type="submit" className="primary-button launcher-submit" disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={18} /> : <Plus size={18} />}
                Create project
              </button>
            </form>
          )}
          {error && <div className="error-banner">{error}</div>}
        </div>

        {recent.length > 0 && (
          <div className="recent-projects">
            <div className="section-heading">
              <span>Recent projects</span>
              <span>{recent.length}</span>
            </div>
            {recent.slice(0, 6).map((item) => (
              <button key={item.id} className="recent-row" onClick={() => loadProject(item.id)}>
                <span className="recent-icon"><FolderOpen size={16} /></span>
                <span className="recent-copy">
                  <strong>{item.projectName}</strong>
                  <small>{item.outputFolder}</small>
                </span>
                <span className="recent-meta">{item.paragraphCount} panels</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
