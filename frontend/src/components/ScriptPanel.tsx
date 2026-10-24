import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileText, Plus, RotateCcw, Undo2, Upload } from "lucide-react";
import { useProjectStore } from "../stores/projectStore";
import { exportScript } from "../utils/exportScript";
import { ParagraphCard } from "./ParagraphCard";
import { CropModeSwitch } from "./CropModeSwitch";

export function ScriptPanel() {
  const { project, activeParagraphId, selectedParagraphIds, replaceScript, addParagraph, setLastItemPane,
    undo, undoDepth, busy } = useProjectStore();
  const [scriptDraft, setScriptDraft] = useState("");
  const [showImporter, setShowImporter] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedIds = useMemo(() => new Set(selectedParagraphIds), [selectedParagraphIds]);

  useEffect(() => {
    if (project) setScriptDraft(project.paragraphs.map((item) => item.text).join("\n"));
    setImportError(null);
  }, [project?.id]);

  const firstPendingId = project?.paragraphs.find((paragraph) => !paragraph.completed)?.id;
  useEffect(() => {
    const list = listRef.current;
    if (!list || !activeParagraphId) return;
    if (activeParagraphId === firstPendingId) { list.scrollTo({ top: 0 }); return; }
    const card = document.getElementById(`paragraph-card-${activeParagraphId}`);
    if (card) list.scrollTop += card.getBoundingClientRect().top - list.getBoundingClientRect().top;
  }, [activeParagraphId, firstPendingId]);

  if (!project) return null;

  const pending = project.paragraphs.filter((paragraph) => !paragraph.completed);
  const completed = project.paragraphs.filter((paragraph) => paragraph.completed);
  const renderCard = (paragraph: typeof project.paragraphs[number]) => {
    const index = project.paragraphs.findIndex((item) => item.id === paragraph.id);
    const imageId = paragraph.draftImageId !== undefined ? paragraph.draftImageId : paragraph.sourceImageId;
    const image = project.images.find((item) => item.id === imageId);
    const sourceTabName = project.sourceGroups.find((group) => group.id === image?.sourceGroupId)?.name;
    return <ParagraphCard
      key={paragraph.id}
      paragraph={paragraph}
      image={image}
      sourceTabName={sourceTabName}
      index={index}
      total={project.paragraphs.length}
      active={paragraph.id === activeParagraphId}
      selected={selectedIds.has(paragraph.id)}
    />;
  };

  const applyScript = () => {
    if (project.paragraphs.length && !window.confirm("Replace paragraph text from this script? Existing assignments are preserved by position where possible.")) return;
    replaceScript(scriptDraft);
    setShowImporter(false);
  };

  const importScriptFile = async (file: File) => {
    setShowImporter(true);
    setImportError(null);
    if (!/\.(txt|md)$/i.test(file.name)) {
      setImportError("Choose a .txt or .md script file.");
      return;
    }
    try {
      const text = await file.text();
      if (!text.trim()) {
        setImportError("The script file is empty.");
        return;
      }
      if (useProjectStore.getState().project?.id !== project.id) return;
      setScriptDraft(text);
    } catch {
      setImportError("Could not read the script file. Try choosing it again.");
    }
  };

  return (
    <aside className="script-panel panel"
      onPointerEnter={() => setLastItemPane("script")}
      onClickCapture={() => setLastItemPane("script")}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("application/x-panel-paragraph") &&
            !event.dataTransfer.types.includes("application/x-panel-image")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.dataTransfer.types.includes("application/x-panel-paragraph") ||
            event.dataTransfer.types.includes("application/x-panel-image")) return;
        event.preventDefault();
        const files = Array.from(event.dataTransfer.files);
        if (files.length) {
          void importScriptFile(files.find((item) => /\.(txt|md)$/i.test(item.name)) ?? files[0]);
          return;
        }
        const text = event.dataTransfer.getData("text/plain");
        if (text) { setScriptDraft(text); setImportError(null); setShowImporter(true); }
      }}>
      <CropModeSwitch />
      <input ref={fileInputRef} type="file" accept=".txt,.md" hidden aria-label="Choose script file"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void importScriptFile(file);
        }} />
      <div className="panel-title">
        <div>
          <span>Script</span>
          <small>{project.paragraphs.length} paragraphs{selectedParagraphIds.length > 0 && ` · ${selectedParagraphIds.length} selected`}</small>
        </div>
        <div className="script-actions">
          <button className="icon-button" onClick={() => fileInputRef.current?.click()} disabled={busy}
            title="Import script (.txt or .md)" aria-label="Import script (.txt or .md)">
            <Upload size={17} />
          </button>
          <button className="icon-button" onClick={undo} disabled={!undoDepth || busy}
            title="Undo last project edit (Ctrl+Z)" aria-label="Undo last project edit">
            <Undo2 size={17} />
          </button>
          <button className="icon-button" onClick={() => exportScript(project)} title="Export edited script (Ctrl+Shift+E)" disabled={!project.paragraphs.length}>
            <Download size={17} />
          </button>
          <button className="icon-button" onClick={() => {
            if (!showImporter) setScriptDraft(project.paragraphs.map((item) => item.text).join("\n"));
            setShowImporter(!showImporter);
          }} title="Paste or replace script">
            <FileText size={18} />
          </button>
        </div>
      </div>
      {showImporter && (
        <div className="script-importer">
          <textarea
            value={scriptDraft}
            onChange={(event) => { setScriptDraft(event.target.value); setImportError(null); }}
            placeholder="Paste a script or import a .txt file. Each line creates a paragraph."
            rows={8}
          />
          {importError && <p className="script-import-error" role="alert">{importError}</p>}
          <div>
            <button className="secondary-button compact" onClick={() => fileInputRef.current?.click()} disabled={busy}>
              <Upload size={14} /> Import file
            </button>
            <button className="secondary-button compact" onClick={() => setScriptDraft(project.paragraphs.map((item) => item.text).join("\n"))}>
              <RotateCcw size={14} /> Reset
            </button>
            <button className="primary-button compact" onClick={applyScript}>Apply script</button>
          </div>
        </div>
      )}
      <div className="paragraph-list" ref={listRef}>
        {pending.length > 0 && <div className="queue-heading">Up next <span>{pending.length} remaining</span></div>}
        {pending.map(renderCard)}
        {completed.length > 0 && <div className="queue-heading completed-heading">Completed <span>{completed.length}</span></div>}
        {completed.map(renderCard)}
        {project.paragraphs.length === 0 && (
          <div className="empty-script">
            <FileText size={30} />
            <strong>Add your script</strong>
            <span>Use Import script or drag a .txt file here, paste text, or start one line at a time.</span>
          </div>
        )}
      </div>
      <button className="add-paragraph" onClick={() => addParagraph(activeParagraphId ?? undefined)}>
        <Plus size={16} /> Add paragraph
      </button>
    </aside>
  );
}
