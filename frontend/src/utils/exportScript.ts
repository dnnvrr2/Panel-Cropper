import type { Project } from "../types/project";

export function exportScript(project: Project): void {
  const contents = project.paragraphs.map((paragraph) => paragraph.text).join("\r\n");
  const filename = `${project.projectName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-") || "script"}-script.txt`;
  const url = URL.createObjectURL(new Blob([contents], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
