import { memo, useMemo, useRef, type KeyboardEvent } from "react";
import { FileArchive, FolderPlus, ImageIcon, Plus, Trash2, UploadCloud } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { api } from "../services/api";
import { useProjectStore } from "../stores/projectStore";
import type { SourceGroup, SourceImage } from "../types/project";
import { imageUsage, type ImageUsage } from "../utils/imageUsage";

const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function UsageLine({ label, numbers }: { label: string; numbers: string[] }) {
  if (!numbers.length) return null;
  return <span className="usage-line" title={`${label} ${numbers.join(", ")}`} tabIndex={numbers.length > 3 ? 0 : undefined}>
    {label} {numbers.slice(0, 3).join(", ")}{numbers.length > 3 && <em> +{numbers.length - 3} more</em>}
  </span>;
}

const ImageThumbnail = memo(function ImageThumbnail({ image, usage, active, selected }: { image: SourceImage; usage?: ImageUsage; active: boolean; selected: boolean }) {
  const projectId = useProjectStore((state) => state.project?.id);
  const selectImage = useProjectStore((state) => state.selectImage);
  const clearItemSelection = useProjectStore((state) => state.clearItemSelection);
  const removeImage = useProjectStore((state) => state.removeImage);
  if (!projectId) return null;
  const referenced = Boolean(usage?.cropped.length || usage?.assigned.length);
  const label = image.relativePath ?? image.filename;
  return <div
    className={`image-thumbnail ${active ? "active" : ""} ${selected ? "item-selected" : ""}`}
    draggable
    role="button"
    tabIndex={0}
    aria-label={`${selected ? "Selected image: " : "Select "}${label}`}
    onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); clearItemSelection(); selectImage(image.id); } }}
    onDragStart={(event) => {
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("application/x-panel-image", image.id);
      event.dataTransfer.setData("text/plain", image.id);
    }}
    onClick={() => { clearItemSelection(); selectImage(image.id); }}
    title="Click to crop this image for the selected paragraph"
  >
    <img src={api.thumbnailUrl(projectId, image.id)} alt="" draggable={false} loading="lazy" decoding="async"
      onError={(event) => {
        // An older backend can still serve the source image until it is restarted.
        if (event.currentTarget.dataset.sourceFallback) return;
        event.currentTarget.dataset.sourceFallback = "true";
        event.currentTarget.src = api.imageUrl(projectId, image.id);
      }} />
    <div className="thumbnail-copy">
      <strong title={label}>{label}</strong>
      <UsageLine label="Cropped for" numbers={usage?.cropped ?? []} />
      <UsageLine label="Assigned to" numbers={usage?.assigned ?? []} />
      <span className="image-dimensions">{image.stripPages ? `${image.stripPages.length} pages · Continuous strip` : `${image.width} × ${image.height}`}</span>
    </div>
    {!referenced && <button className="thumbnail-delete" title="Remove image" aria-label={`Remove ${label}`}
      onClick={(event) => { event.stopPropagation(); void removeImage(image.id); }}><Trash2 size={15} /></button>}
  </div>;
});

export function ImageLibrary() {
  const project = useProjectStore((state) => state.project);
  const selectedImageId = useProjectStore((state) => state.selectedImageId);
  const selectedImageIds = useProjectStore((state) => state.selectedImageIds);
  const activeSourceGroupId = useProjectStore((state) => state.activeSourceGroupId);
  const setActiveSourceGroup = useProjectStore((state) => state.setActiveSourceGroup);
  const setLastItemPane = useProjectStore((state) => state.setLastItemPane);
  const importFolder = useProjectStore((state) => state.importFolder);
  const uploadImages = useProjectStore((state) => state.uploadImages);
  const importCbz = useProjectStore((state) => state.importCbz);
  const importFeedback = useProjectStore((state) => state.importFeedback);
  const busy = useProjectStore((state) => state.busy);
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const cbzInput = useRef<HTMLInputElement>(null);
  const onDrop = (files: File[]) => void uploadImages(files);
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop, noClick: true, noKeyboard: true,
    accept: { "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"], "image/webp": [".webp"] },
  });
  const groups = project?.sourceGroups ?? [];
  const activeId = groups.some((group) => group.id === activeSourceGroupId) ? activeSourceGroupId : groups[0]?.id;
  const usageKey = JSON.stringify([project?.paragraphs, project?.freeCrops]);
  const usage = useMemo(() => {
    const result = imageUsage(project?.paragraphs ?? []);
    for (const [id, freeUsage] of imageUsage(project?.freeCrops ?? [], "free-")) {
      const existing = result.get(id) ?? { cropped: [], assigned: [] };
      result.set(id, { cropped: [...existing.cropped, ...freeUsage.cropped], assigned: [...existing.assigned, ...freeUsage.assigned] });
    }
    return result;
  }, [usageKey]);
  const images = useMemo(() => (project?.images ?? []).filter((image) => image.sourceGroupId === activeId)
    .sort((a, b) => natural.compare(a.relativePath ?? a.filename, b.relativePath ?? b.filename)),
  [project?.images, activeId]);
  const selectedIds = useMemo(() => new Set(selectedImageIds), [selectedImageIds]);
  const counts = useMemo(() => {
    const result = new Map(groups.map((group) => [group.id, 0]));
    project?.images.forEach((image) => result.set(image.sourceGroupId, (result.get(image.sourceGroupId) ?? 0) + 1));
    return result;
  }, [project?.images, project?.sourceGroups]);
  if (!project) return null;
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % groups.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + groups.length) % groups.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = groups.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    setActiveSourceGroup(groups[next].id);
    tabsRef.current[next]?.focus();
  };
  const groupTitle = (group: SourceGroup) => group.kind === "cbz" ? "CBZ pages in one continuous strip"
    : group.kind === "online" ? "Original pages saved from an online chapter" : group.originalPath ?? "Files imported individually into this project";
  return <aside className="image-library panel" {...getRootProps()}
    onPointerEnter={() => setLastItemPane("images")}
    onClickCapture={() => setLastItemPane("images")}>
    <input {...getInputProps()} />
    <input ref={cbzInput} type="file" accept=".cbz" hidden aria-label="Import CBZ archive"
      onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) void importCbz(file);
      }} />
    <div className="panel-title library-title">
      <div><span>Source images ({project.images.length})</span>{selectedImageIds.length > 0 && <small>{selectedImageIds.length} selected</small>}</div>
      <div className="library-actions">
        <button className="library-add-folder" onClick={() => void importFolder()} disabled={busy} title="Import a source folder">
          <FolderPlus size={16} /> Add folder
        </button>
        <button className="library-add-files" onClick={open} disabled={busy} title="Import individual files">
          <Plus size={16} /> Add files
        </button>
        <button className="library-add-files" onClick={() => cbzInput.current?.click()} disabled={busy} title="Import a CBZ as one continuous strip">
          <FileArchive size={16} /> CBZ
        </button>
      </div>
    </div>
    {groups.length > 0 && <div className="source-tabs" role="tablist" aria-label="Source image groups">
      {groups.map((group, index) => <button key={group.id} ref={(element) => { tabsRef.current[index] = element; }}
        role="tab" id={`source-tab-${group.id}`} aria-selected={activeId === group.id}
        aria-controls="source-image-list" tabIndex={activeId === group.id ? 0 : -1}
        className={`source-tab ${activeId === group.id ? "active" : ""}`}
        title={groupTitle(group)} onClick={() => setActiveSourceGroup(group.id)}
        onKeyDown={(event) => onTabKeyDown(event, index)}>
        <span>{group.name}</span><small>{counts.get(group.id)}</small>
      </button>)}
    </div>}
    {isDragActive && <div className="drop-overlay"><UploadCloud size={30} /><strong>Drop images into Project files</strong></div>}
    <div className="image-list" id="source-image-list" role="tabpanel" aria-labelledby={activeId ? `source-tab-${activeId}` : undefined}>
      {images.length ? images.map((image) => <ImageThumbnail key={image.id} image={image}
        usage={usage.get(image.id)} active={selectedImageId === image.id} selected={selectedIds.has(image.id)} />) :
        <div className="empty-library"><ImageIcon size={30} /><strong>{groups.length ? "No images in this group" : "Start with a source folder"}</strong>
          <span>JPG, PNG, and WebP images, or import a CBZ as a continuous strip.</span>
          {!groups.length && <button className="library-add-folder" onClick={() => void importFolder()} disabled={busy}><FolderPlus size={16} /> Add folder</button>}
        </div>}
    </div>
    {importFeedback && <div className="import-feedback" role="status">{importFeedback}</div>}
    <div className="panel-hint">{project.cropMode === "read" ? "Click an image or chapter tab to read it." : project.cropMode === "free" ? "Click an image to crop it without a script." : "Click an image to crop it, or drag it onto a paragraph."}</div>
  </aside>;
}
