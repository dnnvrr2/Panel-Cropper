from __future__ import annotations

import json
import hashlib
import os
import re
import shutil
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, BinaryIO
from uuid import uuid4

from PIL import Image, ImageOps, UnidentifiedImageError
from backend.services.cbz_service import import_cbz_pages


APP_DATA = Path(__file__).resolve().parents[1] / "data"
REGISTRY_FILE = APP_DATA / "projects.json"
INVALID_NAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


class ProjectNotFoundError(FileNotFoundError):
    pass


class ProjectManager:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        APP_DATA.mkdir(parents=True, exist_ok=True)

    def create_project(self, output_folder: str, requested_name: str | None) -> dict[str, Any]:
        base_folder = Path(output_folder).expanduser().resolve()
        base_folder.mkdir(parents=True, exist_ok=True)
        project_name = self._unique_project_name(base_folder, requested_name)
        project_folder = base_folder / project_name
        project_folder.mkdir()
        (project_folder / "sources").mkdir()
        (project_folder / "crops").mkdir()

        now = self._timestamp()
        project = {
            "id": str(uuid4()),
            "projectName": project_name,
            "outputFolder": str(project_folder),
            "defaultAspectRatio": "9:16",
            "images": [],
            "sourceGroups": [],
            "paragraphs": [],
            "createdAt": now,
            "updatedAt": now,
        }
        self._write_project(project)
        self._register(project)
        return project

    def list_projects(self) -> list[dict[str, Any]]:
        with self._lock:
            registry = self._read_registry()
            valid_entries: list[dict[str, str]] = []
            projects: list[dict[str, Any]] = []
            for entry in registry:
                project_file = Path(entry.get("path", "")) / "project.json"
                if not project_file.is_file():
                    continue
                try:
                    project = self._read_json(project_file)
                except (OSError, json.JSONDecodeError):
                    continue
                valid_entries.append({"id": project["id"], "path": str(project_file.parent)})
                projects.append(
                    {
                        "id": project["id"],
                        "projectName": project.get("projectName", project_file.parent.name),
                        "outputFolder": str(project_file.parent),
                        "updatedAt": project.get("updatedAt"),
                        "imageCount": len(project.get("images", [])),
                        "paragraphCount": len(project.get("paragraphs", [])),
                    }
                )
            if valid_entries != registry:
                self._write_json(REGISTRY_FILE, valid_entries)
            return sorted(projects, key=lambda item: item.get("updatedAt") or "", reverse=True)

    def open_project(self, folder: str) -> dict[str, Any]:
        project_file = Path(folder).expanduser().resolve() / "project.json"
        if not project_file.is_file():
            raise ProjectNotFoundError(f"No project.json found in {project_file.parent}")
        project = self._read_json(project_file)
        project.setdefault("id", str(uuid4()))
        project["outputFolder"] = str(project_file.parent)
        project.setdefault("defaultAspectRatio", "9:16")
        self._normalize_project(project)
        self._write_project(project)
        self._register(project)
        return project

    def load_project(self, project_id: str) -> dict[str, Any]:
        project_folder = self.project_directory(project_id)
        project_file = project_folder / "project.json"
        if not project_file.is_file():
            raise ProjectNotFoundError(f"Project {project_id} was not found")
        with self._lock:
            project = self._read_json(project_file)
            if self._normalize_project(project):
                self._write_project(project)
            return project

    def save_project(self, project_id: str, payload: dict[str, Any], preserve_imports: bool = True) -> dict[str, Any]:
        with self._lock:
            existing = self.load_project(project_id)
            project = dict(payload)
            project["id"] = project_id
            project["outputFolder"] = existing["outputFolder"]
            project["projectName"] = existing["projectName"]
            project["createdAt"] = existing.get("createdAt", self._timestamp())
            project["updatedAt"] = self._timestamp()
            project.setdefault("defaultAspectRatio", "9:16")
            project.setdefault("images", [])
            project.setdefault("paragraphs", [])
            self._normalize_project(project)
            if preserve_imports:
                known_groups = {group["id"] for group in project["sourceGroups"]}
                project["sourceGroups"].extend(group for group in existing["sourceGroups"] if group["id"] not in known_groups)
                known_images = {image["id"] for image in project["images"]}
                project["images"].extend(image for image in existing["images"] if image["id"] not in known_images)
            self._write_project(project)
            return project

    def ensure_project_files_group(self, project: dict[str, Any]) -> dict[str, Any]:
        group = next((item for item in project["sourceGroups"] if item["kind"] == "project-files"), None)
        if group is None:
            group = {"id": str(uuid4()), "name": "Project files", "kind": "project-files", "createdAt": self._timestamp()}
            project["sourceGroups"].append(group)
        return group

    def import_source_folder(self, project_id: str, folder: str) -> dict[str, Any]:
        with self._lock:
            project = self.load_project(project_id)
            source = Path(folder).expanduser().resolve()
            if not source.is_dir():
                raise ValueError("Choose an existing source folder")
            project_folder = Path(project["outputFolder"]).resolve()
            if source == project_folder or project_folder in source.parents:
                raise ValueError("The project folder and its subfolders cannot be imported")
            source_key = os.path.normcase(str(source)).casefold()
            existing = next((group for group in project["sourceGroups"] if group["kind"] == "folder" and
                             os.path.normcase(group.get("originalPath", "")).casefold() == source_key), None)
            if existing:
                return {"project": project, "groupId": existing["id"], "imported": 0, "skipped": 0,
                        "skippedReasons": [], "existing": True}
            group_id = str(uuid4())
            imported = []
            skipped_reasons: list[str] = []
            skipped = 0
            sources_folder = project_folder / "sources"
            unsupported = 0
            for root, dirs, files in os.walk(source, followlinks=False):
                dirs[:] = [name for name in dirs if not (Path(root) / name).is_symlink()
                           and (Path(root) / name).resolve() != project_folder]
                for name in files:
                    original = Path(root) / name
                    if original.is_symlink():
                        skipped += 1
                        skipped_reasons.append(f"{original.relative_to(source)}: symbolic link")
                        continue
                    if original.suffix.lower() not in SUPPORTED_EXTENSIONS:
                        skipped += 1
                        unsupported += 1
                        continue
                    image_id = str(uuid4())
                    destination = sources_folder / f"{group_id}_{image_id}{original.suffix.lower()}"
                    try:
                        shutil.copyfile(original, destination)
                        with Image.open(destination) as image:
                            image.verify()
                        with Image.open(destination) as image:
                            width, height = ImageOps.exif_transpose(image).size
                    except (OSError, UnidentifiedImageError, ValueError):
                        destination.unlink(missing_ok=True)
                        skipped += 1
                        skipped_reasons.append(f"{original.relative_to(source)}: unreadable image")
                        continue
                    imported.append({"id": image_id, "filename": name, "path": str(destination.resolve()),
                                     "width": width, "height": height, "sourceGroupId": group_id,
                                     "relativePath": original.relative_to(source).as_posix()})
            if unsupported:
                skipped_reasons.append(f"{unsupported} unsupported file{'' if unsupported == 1 else 's'}")
            if not imported:
                return {"project": project, "groupId": None, "imported": 0, "skipped": skipped,
                        "skippedReasons": skipped_reasons[:5], "existing": False}
            project["sourceGroups"].append({"id": group_id, "name": source.name, "kind": "folder",
                                            "originalPath": str(source), "createdAt": self._timestamp()})
            project["images"].extend(imported)
            saved = self.save_project(project_id, project)
            return {"project": saved, "groupId": group_id, "imported": len(imported), "skipped": skipped,
                    "skippedReasons": skipped_reasons[:5], "existing": False}

    def import_cbz(self, project_id: str, filename: str, archive: BinaryIO) -> dict[str, Any]:
        with self._lock:
            project = self.load_project(project_id)
            if Path(filename).suffix.lower() != ".cbz":
                raise ValueError("Choose a .cbz comic archive")
            strip_id, group_id = str(uuid4()), str(uuid4())
            pages, skipped = import_cbz_pages(archive, Path(project["outputFolder"]) / "sources", strip_id)
            group = {"id": group_id, "name": Path(filename).stem, "kind": "cbz", "createdAt": self._timestamp()}
            strip = {"id": strip_id, "filename": Path(filename).name, "path": pages[0]["path"],
                     "width": max(page["width"] for page in pages),
                     "height": sum(page["stripHeight"] for page in pages),
                     "sourceGroupId": group_id, "stripPages": pages}
            project["sourceGroups"].append(group)
            project["images"].append(strip)
            try:
                saved = self.save_project(project_id, project)
            except Exception:
                for page in pages:
                    Path(page["path"]).unlink(missing_ok=True)
                raise
            return {"project": saved, "groupId": group_id, "imageId": strip_id,
                    "imported": len(pages), "skipped": skipped}

    def _normalize_project(self, project: dict[str, Any]) -> bool:
        changed = False
        for key in ("images", "paragraphs", "sourceGroups", "freeCrops"):
            if key not in project:
                project[key] = []
                changed = True
        groups = project["sourceGroups"]
        valid_ids = {group["id"] for group in groups}
        ungrouped = [image for image in project["images"] if image.get("sourceGroupId") not in valid_ids]
        if ungrouped:
            existing = next((group for group in groups if group.get("kind") == "project-files"), None)
            if existing is None:
                existing = self.ensure_project_files_group(project)
            for image in ungrouped:
                image["sourceGroupId"] = existing["id"]
            changed = True
        return changed

    def project_directory(self, project_id: str) -> Path:
        for entry in self._read_registry():
            if entry.get("id") == project_id:
                return Path(entry["path"]).resolve()
        raise ProjectNotFoundError(f"Project {project_id} was not found")

    def image_path(self, project_id: str, image_id: str) -> Path:
        project = self.load_project(project_id)
        image = next((item for item in project["images"] if item["id"] == image_id), None)
        if image is None:
            raise ProjectNotFoundError(f"Image {image_id} was not found")
        return self._source_path(project_id, image["path"])

    def strip_page_path(self, project_id: str, image_id: str, page_id: str) -> Path:
        project = self.load_project(project_id)
        strip = next((item for item in project["images"] if item["id"] == image_id), None)
        page = next((item for item in (strip or {}).get("stripPages", []) if item["id"] == page_id), None)
        if page is None:
            raise ProjectNotFoundError("Strip page not found")
        return self._source_path(project_id, page["path"])

    def _source_path(self, project_id: str, filename: str) -> Path:
        path = Path(filename).resolve()
        sources = (self.project_directory(project_id) / "sources").resolve()
        if sources not in path.parents or not path.is_file():
            raise ProjectNotFoundError("Source image is missing")
        return path

    def thumbnail_path(self, project_id: str, image_id: str) -> Path:
        source = self.image_path(project_id, image_id)
        destination = self._thumbnail_file(project_id, image_id)
        if destination.is_file() and destination.stat().st_mtime_ns >= source.stat().st_mtime_ns:
            return destination
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(f"{destination.stem}.{uuid4().hex}.tmp")
        try:
            with Image.open(source) as original:
                thumbnail = ImageOps.exif_transpose(original)
                thumbnail.thumbnail((160, 160), Image.Resampling.LANCZOS)
                if thumbnail.mode not in ("RGB", "RGBA"):
                    thumbnail = thumbnail.convert("RGB")
                thumbnail.save(temporary, format="WEBP", quality=76, method=3)
            temporary.replace(destination)
        except Exception:
            temporary.unlink(missing_ok=True)
            raise
        return destination

    def discard_thumbnail(self, project_id: str, image_id: str) -> None:
        self._thumbnail_file(project_id, image_id).unlink(missing_ok=True)

    def _thumbnail_file(self, project_id: str, image_id: str) -> Path:
        safe_id = hashlib.sha256(image_id.encode("utf-8")).hexdigest()
        return self.project_directory(project_id) / "sources" / ".thumbnails" / f"{safe_id}.webp"

    def _unique_project_name(self, base_folder: Path, requested_name: str | None) -> str:
        cleaned = self._clean_name(requested_name or "")
        if not cleaned:
            number = 1
            while (base_folder / f"Project {number}").exists():
                number += 1
            return f"Project {number}"
        if not (base_folder / cleaned).exists():
            return cleaned
        number = 2
        while (base_folder / f"{cleaned} {number}").exists():
            number += 1
        return f"{cleaned} {number}"

    @staticmethod
    def _clean_name(name: str) -> str:
        cleaned = INVALID_NAME_CHARS.sub("-", name).strip().rstrip(".")
        return re.sub(r"\s+", " ", cleaned)

    def _write_project(self, project: dict[str, Any]) -> None:
        project_folder = Path(project["outputFolder"])
        project_folder.mkdir(parents=True, exist_ok=True)
        (project_folder / "sources").mkdir(exist_ok=True)
        (project_folder / "crops").mkdir(exist_ok=True)
        self._write_json(project_folder / "project.json", project)
        script = "\n\n".join(item.get("text", "") for item in project.get("paragraphs", []))
        self._atomic_write(project_folder / "script.txt", script)

    def _register(self, project: dict[str, Any]) -> None:
        with self._lock:
            registry = [item for item in self._read_registry() if item.get("id") != project["id"]]
            registry.append({"id": project["id"], "path": project["outputFolder"]})
            self._write_json(REGISTRY_FILE, registry)

    def _read_registry(self) -> list[dict[str, str]]:
        if not REGISTRY_FILE.is_file():
            return []
        try:
            data = self._read_json(REGISTRY_FILE)
            return data if isinstance(data, list) else []
        except (OSError, json.JSONDecodeError):
            return []

    @staticmethod
    def _read_json(path: Path) -> Any:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    @staticmethod
    def _write_json(path: Path, value: Any) -> None:
        serialized = json.dumps(value, ensure_ascii=False, indent=2)
        ProjectManager._atomic_write(path, serialized + "\n")

    @staticmethod
    def _atomic_write(path: Path, content: str) -> None:
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(content, encoding="utf-8")
        temporary.replace(path)

    @staticmethod
    def _timestamp() -> str:
        return datetime.now(UTC).isoformat()
