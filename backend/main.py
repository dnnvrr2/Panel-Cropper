from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError

from backend.models.schemas import CreateProjectRequest, CropRect, CropRequest, OpenProjectRequest, FolderImportRequest
from backend.services.crop_service import InvalidCropError, export_crop
from backend.services.cbz_service import export_strip_crop
from backend.services.project_manager import ProjectManager, ProjectNotFoundError
from backend.services.online_service import OnlineService
from backend.online_routes import create_online_router


SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
manager = ProjectManager()
app = FastAPI(title="Panel Cropper API", version="1.0.0")
online_service = OnlineService()
app.include_router(create_online_router(online_service, lambda: manager))
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_project(project_id: str) -> dict[str, Any]:
    try:
        return manager.load_project(project_id)
    except ProjectNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/filesystem/select-folder")
def select_folder(purpose: str = "output") -> dict[str, str]:
    if purpose not in {"output", "source"}:
        raise HTTPException(status_code=400, detail="Invalid folder picker purpose")
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        folder = filedialog.askdirectory(title="Choose source image folder" if purpose == "source" else "Choose Panel Cropper output folder")
        root.destroy()
        return {"path": folder}
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Folder picker failed: {error}") from error


@app.get("/api/projects")
def list_projects() -> list[dict[str, Any]]:
    return manager.list_projects()


@app.post("/api/projects")
def create_project(request: CreateProjectRequest) -> dict[str, Any]:
    try:
        return manager.create_project(request.outputFolder, request.projectName)
    except OSError as error:
        raise HTTPException(status_code=400, detail=f"Could not create project: {error}") from error


@app.post("/api/projects/open")
def open_project(request: OpenProjectRequest) -> dict[str, Any]:
    try:
        return manager.open_project(request.folder)
    except ProjectNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (OSError, ValueError) as error:
        raise HTTPException(status_code=400, detail=f"Could not open project: {error}") from error


@app.get("/api/projects/{project_id}")
def load_project(project_id: str) -> dict[str, Any]:
    return get_project(project_id)


@app.put("/api/projects/{project_id}")
def save_project(project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return manager.save_project(project_id, payload)
    except ProjectNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except OSError as error:
        raise HTTPException(status_code=400, detail=f"Could not save project: {error}") from error


@app.post("/api/projects/{project_id}/images")
def upload_images(project_id: str, files: list[UploadFile] = File(...)) -> dict[str, Any]:
    project = get_project(project_id)
    sources_folder = Path(project["outputFolder"]) / "sources"
    imported: list[dict[str, Any]] = []
    group = None
    for upload in files:
        original_name = Path(upload.filename or "image").name
        extension = Path(original_name).suffix.lower()
        if extension not in SUPPORTED_EXTENSIONS:
            continue
        image_id = str(uuid4())
        safe_name = "".join(character for character in original_name if character not in '<>:"/\\|?*')
        destination = sources_folder / f"{image_id}_{safe_name}"
        try:
            with destination.open("wb") as output:
                shutil.copyfileobj(upload.file, output)
            with Image.open(destination) as image:
                image.verify()
            with Image.open(destination) as image:
                width, height = ImageOps.exif_transpose(image).size
        except (OSError, UnidentifiedImageError):
            destination.unlink(missing_ok=True)
            continue
        imported.append(
            {
                "id": image_id,
                "filename": original_name,
                "path": str(destination.resolve()),
                "width": width,
                "height": height,
                "sourceGroupId": (group := group or manager.ensure_project_files_group(project))["id"],
            }
        )
    project["images"].extend(imported)
    saved = manager.save_project(project_id, project)
    return {"project": saved, "imported": len(imported)}


@app.post("/api/projects/{project_id}/source-groups/folder")
def import_source_folder(project_id: str, request: FolderImportRequest) -> dict[str, Any]:
    try:
        return manager.import_source_folder(project_id, request.path)
    except ProjectNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (OSError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.get("/api/projects/{project_id}/images/{image_id}/content")
def image_content(project_id: str, image_id: str) -> FileResponse:
    try:
        path = manager.image_path(project_id, image_id)
    except ProjectNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return FileResponse(path)


@app.post("/api/projects/{project_id}/source-groups/cbz")
def import_cbz(project_id: str, file: UploadFile = File(...)) -> dict[str, Any]:
    try:
        return manager.import_cbz(project_id, file.filename or "", file.file)
    except ProjectNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (OSError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.get("/api/projects/{project_id}/images/{image_id}/pages/{page_id}/content")
def strip_page_content(project_id: str, image_id: str, page_id: str) -> FileResponse:
    try:
        return FileResponse(manager.strip_page_path(project_id, image_id, page_id))
    except ProjectNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.get("/api/projects/{project_id}/images/{image_id}/thumbnail")
def image_thumbnail(project_id: str, image_id: str) -> FileResponse:
    try:
        path = manager.thumbnail_path(project_id, image_id)
    except ProjectNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (OSError, UnidentifiedImageError, ValueError) as error:
        raise HTTPException(status_code=400, detail=f"Could not make thumbnail: {error}") from error
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "private, max-age=604800"})


@app.delete("/api/projects/{project_id}/images/{image_id}")
def remove_image(project_id: str, image_id: str) -> dict[str, Any]:
    project = get_project(project_id)
    if any(item.get("sourceImageId") == image_id or item.get("draftImageId") == image_id
           for item in project["paragraphs"] + project.get("freeCrops", [])):
        raise HTTPException(status_code=409, detail="Image is used by one or more saved crops or assignments")
    image = next((item for item in project["images"] if item["id"] == image_id), None)
    if image is None:
        raise HTTPException(status_code=404, detail="Image not found")
    for page in image.get("stripPages", [image]):
        try:
            path = (manager.strip_page_path(project_id, image_id, page["id"])
                    if image.get("stripPages") else manager.image_path(project_id, image_id))
            path.unlink(missing_ok=True)
        except ProjectNotFoundError:
            pass
    manager.discard_thumbnail(project_id, image_id)
    project["images"] = [item for item in project["images"] if item["id"] != image_id]
    return manager.save_project(project_id, project, preserve_imports=False)


def export_source_crop(project: dict[str, Any], image_id: str, destination: Path,
                       crop: CropRect, rotation: int) -> tuple[int, int]:
    image = next((item for item in project["images"] if item["id"] == image_id), None)
    if image is None:
        raise ProjectNotFoundError("Source not found")
    if image.get("stripPages"):
        return export_strip_crop(image, lambda page_id: manager.strip_page_path(project["id"], image_id, page_id),
                                 destination, crop, rotation)
    return export_crop(manager.image_path(project["id"], image_id), destination, crop, rotation)


@app.post("/api/projects/{project_id}/crop")
def crop_image(project_id: str, request: CropRequest) -> dict[str, Any]:
    project = get_project(project_id)
    items = project.get("freeCrops", []) if request.mode == "free" else project["paragraphs"]
    paragraph_index = next(
        (index for index, item in enumerate(items) if item["id"] == request.paragraphId),
        None,
    )
    if paragraph_index is None:
        raise HTTPException(status_code=404, detail="Paragraph not found")
    paragraph = items[paragraph_index]
    source_image_id = request.imageId or paragraph.get("sourceImageId")
    if not source_image_id:
        raise HTTPException(status_code=400, detail="Choose an image before saving a crop")
    output_name = f"{'free-' if request.mode == 'free' else ''}{paragraph_index + 1:03d}.png"
    output_path = Path(project["outputFolder"]) / "crops" / output_name
    try:
        width, height = export_source_crop(project, source_image_id, output_path, request.crop, request.rotation)
    except ProjectNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (InvalidCropError, OSError) as error:
        raise HTTPException(status_code=400, detail=f"Could not export crop: {error}") from error

    paragraph.update(
        {
            "sourceImageId": source_image_id,
            "aspectRatio": request.aspectRatio,
            "crop": request.crop.model_dump(),
            "zoom": request.zoom,
            "rotation": request.rotation,
            "panX": request.panX,
            "panY": request.panY,
            "completed": True,
            "outputFile": f"crops/{output_name}",
            "outputWidth": width,
            "outputHeight": height,
        }
    )
    return manager.save_project(project_id, project)


@app.post("/api/projects/{project_id}/export")
def export_project(project_id: str) -> dict[str, Any]:
    project = get_project(project_id)
    exported = 0
    errors: list[str] = []
    export_items = [(index, item, "") for index, item in enumerate(project["paragraphs"])]
    export_items += [(index, item, "free-") for index, item in enumerate(project.get("freeCrops", []))]
    for index, paragraph, prefix in export_items:
        if not paragraph.get("completed"):
            continue
        image_id = paragraph.get("sourceImageId")
        crop_data = paragraph.get("crop")
        if not image_id or not crop_data:
            continue
        try:
            request_crop = CropRequest(
                paragraphId=paragraph["id"],
                crop=crop_data,
                aspectRatio=paragraph.get("aspectRatio", "9:16"),
                zoom=paragraph.get("zoom", 1),
                panX=paragraph.get("panX", 0),
                panY=paragraph.get("panY", 0),
                rotation=paragraph.get("rotation", 0),
            )
            output_name = f"{prefix}{index + 1:03d}.png"
            destination = Path(project["outputFolder"]) / "crops" / output_name
            width, height = export_source_crop(project, image_id, destination, request_crop.crop, request_crop.rotation)
            paragraph.update(
                {
                    "completed": True,
                    "outputFile": f"crops/{output_name}",
                    "outputWidth": width,
                    "outputHeight": height,
                }
            )
            exported += 1
        except (ProjectNotFoundError, InvalidCropError, OSError, ValueError) as error:
            errors.append(f"{'Crop' if prefix else 'Paragraph'} {index + 1}: {error}")
    saved = manager.save_project(project_id, project)
    return {"project": saved, "exported": exported, "errors": errors}
