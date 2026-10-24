import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, GitMerge, Scissors, Trash2, X } from "lucide-react";
import { useProjectStore } from "../stores/projectStore";
import type { Paragraph, SourceImage } from "../types/project";

interface Props {
  paragraph: Paragraph;
  image?: SourceImage;
  sourceTabName?: string;
  index: number;
  total: number;
  active: boolean;
  selected: boolean;
}

export function ParagraphCard({ paragraph, image, sourceTabName, index, total, active, selected }: Props) {
  const [caret, setCaret] = useState<number>();
  const [dragOver, setDragOver] = useState(false);
  const textArea = useRef<HTMLTextAreaElement>(null);
  const {
    setActiveParagraph,
    clearItemSelection,
    updateParagraphText,
    insertParagraphBreak,
    deleteParagraph,
    splitParagraph,
    mergeWithPrevious,
    moveParagraph,
    moveParagraphTo,
    assignImage,
    removeAssignment,
  } = useProjectStore();

  const hasImageAssignment = Boolean(paragraph.draftImageId !== undefined ? paragraph.draftImageId : paragraph.sourceImageId);
  const state = paragraph.completed ? "complete" : hasImageAssignment ? "assigned" : "empty";
  const continuous = Boolean(image?.stripPages);

  return (
    <article
      id={`paragraph-card-${paragraph.id}`}
      className={`paragraph-card ${active ? "active" : ""} ${selected ? "item-selected" : ""} ${dragOver ? "drag-over" : ""}`}
      aria-label={`Paragraph ${index + 1}${selected ? ", selected" : ""}`}
      onClick={() => { clearItemSelection(); setActiveParagraph(paragraph.id); }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("application/x-panel-image") ||
            event.dataTransfer.types.includes("application/x-panel-paragraph")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = event.dataTransfer.types.includes("application/x-panel-paragraph") ? "move" : "copy";
          setDragOver(true);
        }
      }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(false); }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("application/x-panel-paragraph") &&
            !event.dataTransfer.types.includes("application/x-panel-image")) return;
        event.preventDefault();
        event.stopPropagation();
        setDragOver(false);
        const sourceParagraphId = event.dataTransfer.getData("application/x-panel-paragraph");
        if (sourceParagraphId) { moveParagraphTo(sourceParagraphId, paragraph.id); return; }
        const imageId = event.dataTransfer.getData("application/x-panel-image");
        if (imageId) assignImage(paragraph.id, imageId);
      }}
    >
      <div className="paragraph-card-header" draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-panel-paragraph", paragraph.id);
        }} title="Drag to reorder this paragraph">
        <div className="paragraph-number">{String(index + 1).padStart(3, "0")}</div>
        <div className={`paragraph-state ${state}`}>
          {state === "complete" && <Check size={12} />}
          {continuous && state === "complete" ? "completed" : state}
        </div>
        <div className="paragraph-order">
          <button disabled={index === 0} onClick={(event) => { event.stopPropagation(); moveParagraph(paragraph.id, -1); }} title="Move up">
            <ArrowUp size={14} />
          </button>
          <button disabled={index === total - 1} onClick={(event) => { event.stopPropagation(); moveParagraph(paragraph.id, 1); }} title="Move down">
            <ArrowDown size={14} />
          </button>
        </div>
      </div>
      <textarea
        id={`paragraph-text-${paragraph.id}`}
        ref={textArea}
        value={paragraph.text}
        rows={Math.min(5, Math.max(2, paragraph.text.split("\n").length + 1))}
        placeholder="Write paragraph text…"
        onClick={(event) => event.stopPropagation()}
        onFocus={() => { clearItemSelection(); setActiveParagraph(paragraph.id); }}
        onSelect={() => setCaret(textArea.current?.selectionStart)}
        onChange={(event) => updateParagraphText(paragraph.id, event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.ctrlKey || event.metaKey) return;
          event.preventDefault();
          const createdId = insertParagraphBreak(paragraph.id, event.currentTarget.selectionStart);
          if (createdId) requestAnimationFrame(() => document.getElementById(`paragraph-text-${createdId}`)?.focus());
        }}
      />
      <div className="paragraph-assignment">
        <span className="assignment-details" title={image && !continuous ? `${sourceTabName ?? "Unknown tab"} / ${image.filename}` : undefined}>
          {image && !continuous && <span className="assignment-tab" title={`Source tab: ${sourceTabName ?? "Unknown tab"}`}>
            {sourceTabName ?? "Unknown tab"}
          </span>}
          <span className="assignment-filename">{continuous ? (paragraph.completed ? "Completed" : "Position crop in strip")
            : image?.filename ?? (hasImageAssignment ? "Image unavailable" : "Click an image to crop")}</span>
        </span>
        <b title={paragraph.rotation ? `Crop rotated ${paragraph.rotation}° clockwise` : undefined}>
          {paragraph.aspectRatio}{paragraph.rotation ? ` · ${paragraph.rotation}°` : ""}
        </b>
        {hasImageAssignment && <button type="button" onClick={(event) => { event.stopPropagation(); removeAssignment(paragraph.id); }}
          title={continuous ? "Clear this crop" : "Remove image from this paragraph"} aria-label={`Remove crop from paragraph ${index + 1}`}>
          <X size={14} />
        </button>}
      </div>
      <div className="paragraph-tools">
        <button onClick={(event) => { event.stopPropagation(); splitParagraph(paragraph.id, caret); }} title="Split at text cursor">
          <Scissors size={13} /> Split
        </button>
        <button disabled={index === 0} onClick={(event) => { event.stopPropagation(); mergeWithPrevious(paragraph.id); }} title="Merge with previous paragraph">
          <GitMerge size={13} /> Merge
        </button>
        <button
          className="danger"
          onClick={(event) => {
            event.stopPropagation();
            if (window.confirm(`Delete paragraph ${index + 1}?`)) deleteParagraph(paragraph.id);
          }}
          title="Delete paragraph"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </article>
  );
}
