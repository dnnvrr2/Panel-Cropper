from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any, BinaryIO, Callable
from uuid import uuid4
from zipfile import BadZipFile, ZipFile

from PIL import Image, ImageOps, UnidentifiedImageError

from backend.models.schemas import CropRect
from backend.services.crop_service import InvalidCropError


EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"}


def page_order(name: str) -> tuple:
    # Tagged parts keep numbers comparable even in mixed filename conventions.
    return tuple((1, int(part)) if part.isdigit() else (0, part.casefold())
                 for part in re.split(r"(\d+)", name.replace("\\", "/")))


def import_cbz_pages(archive_file: BinaryIO, sources: Path, strip_id: str) -> tuple[list[dict[str, Any]], int]:
    pages: list[dict[str, Any]] = []
    created: list[Path] = []
    skipped = 0
    try:
        with ZipFile(archive_file) as archive:
            entries = sorted((entry for entry in archive.infolist() if not entry.is_dir()
                              and Path(entry.filename).suffix.lower() in EXTENSIONS
                              and not entry.filename.startswith("__MACOSX/")
                              and not Path(entry.filename).name.startswith("._")),
                             key=lambda entry: (page_order(entry.filename), entry.filename))
            if len(entries) > 10000 or sum(entry.file_size for entry in entries) > 2 * 1024 ** 3:
                raise ValueError("CBZ exceeds the import limit (10,000 pages or 2 GB unpacked)")
            for entry in entries:
                page_id = str(uuid4())
                # Archive filenames are labels only; never use them as extraction paths.
                destination = sources / f"{strip_id}_{page_id}{Path(entry.filename).suffix.lower()}"
                created.append(destination)
                with archive.open(entry) as source, destination.open("wb") as output:
                    shutil.copyfileobj(source, output)
                try:
                    with Image.open(destination) as image:
                        image.verify()
                    with Image.open(destination) as image:
                        width, height = ImageOps.exif_transpose(image).size
                except (OSError, UnidentifiedImageError, Image.DecompressionBombError):
                    destination.unlink(missing_ok=True)
                    skipped += 1
                    continue
                pages.append({"id": page_id, "filename": entry.filename, "path": str(destination.resolve()),
                              "width": width, "height": height})
        if not pages:
            raise ValueError("CBZ contains no readable image pages")
        strip_width = max(page["width"] for page in pages)
        top = 0
        for page in pages:
            page["top"] = top
            page["stripHeight"] = max(1, round(page["height"] * strip_width / page["width"]))
            top += page["stripHeight"]
        return pages, skipped
    except Exception as error:
        for path in created:
            path.unlink(missing_ok=True)
        if isinstance(error, (BadZipFile, RuntimeError, NotImplementedError)):
            raise ValueError("Could not read CBZ. Choose an unencrypted ZIP comic archive.") from error
        raise


def export_strip_crop(strip: dict[str, Any], page_path: Callable[[str], Path], destination: Path,
                      crop: CropRect, rotation: int = 0) -> tuple[int, int]:
    if rotation not in {0, 90, 180, 270}:
        raise InvalidCropError("Rotation must be 0, 90, 180, or 270 degrees")
    left, top = round(crop.x), round(crop.y)
    right, bottom = round(crop.x + crop.width), round(crop.y + crop.height)
    if left < 0 or top < 0 or right > strip["width"] or bottom > strip["height"]:
        raise InvalidCropError("Crop exceeds the continuous strip size")
    if right <= left or bottom <= top:
        raise InvalidCropError("Crop has no usable area")
    # Compose only the requested crop, not one enormous bitmap of the entire book.
    with Image.new("RGBA", (right - left, bottom - top)) as cropped:
        for page in strip["stripPages"]:
            overlap_top = max(top, page["top"])
            overlap_bottom = min(bottom, page["top"] + page["stripHeight"])
            if overlap_top >= overlap_bottom:
                continue
            with Image.open(page_path(page["id"])) as opened:
                with ImageOps.exif_transpose(opened).convert("RGBA") as image:
                    scale_x = image.width / strip["width"]
                    scale_y = image.height / page["stripHeight"]
                    box = (left * scale_x, (overlap_top - page["top"]) * scale_y,
                           right * scale_x, (overlap_bottom - page["top"]) * scale_y)
                    with image.transform((right - left, overlap_bottom - overlap_top),
                                         Image.Transform.EXTENT, box, Image.Resampling.BICUBIC) as part:
                        cropped.paste(part, (0, overlap_top - top))
        result = cropped
        if rotation:
            result = cropped.transpose({90: Image.Transpose.ROTATE_270, 180: Image.Transpose.ROTATE_180,
                                        270: Image.Transpose.ROTATE_90}[rotation])
        try:
            destination.parent.mkdir(parents=True, exist_ok=True)
            result.save(destination, format="PNG", optimize=True)
            return result.size
        finally:
            if result is not cropped:
                result.close()
