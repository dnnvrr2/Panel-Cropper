import { useProjectStore } from "../stores/projectStore";

export function CropModeSwitch() {
  const { project, busy, setCropMode } = useProjectStore();
  return <label className="crop-mode-switch">
    <span>Crop mode</span>
    <select aria-label="Crop mode" value={project?.cropMode ?? "script"} disabled={busy}
      onChange={(event) => setCropMode(event.target.value as "script" | "free" | "read")}>
      <option value="read" title="Reading mode">--</option>
      <option value="script">With script</option>
      <option value="free">Without script</option>
    </select>
  </label>;
}
