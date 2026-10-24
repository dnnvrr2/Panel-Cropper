from pathlib import Path

from PIL import Image, ImageOps

from backend.models.schemas import CropRect


class InvalidCropError(ValueError):
    pass


def export_crop(source: Path, destination: Path, crop: CropRect, rotation: int = 0) -> tuple[int, int]:
    if rotation not in {0, 90, 180, 270}:
        raise InvalidCropError("Rotation must be 0, 90, 180, or 270 degrees")
    with Image.open(source) as opened_image:
        image = ImageOps.exif_transpose(opened_image)
        left = round(crop.x)
        top = round(crop.y)
        right = round(crop.x + crop.width)
        bottom = round(crop.y + crop.height)
        if left < 0 or top < 0 or right > image.width or bottom > image.height:
            raise InvalidCropError(
                f"Crop ({left}, {top}, {right}, {bottom}) exceeds image size "
                f"{image.width}x{image.height}"
            )
        if right <= left or bottom <= top:
            raise InvalidCropError("Crop has no usable area")
        cropped = image.crop((left, top, right, bottom))
        if rotation:
            clockwise = {90: Image.Transpose.ROTATE_270, 180: Image.Transpose.ROTATE_180,
                         270: Image.Transpose.ROTATE_90}
            cropped = cropped.transpose(clockwise[rotation])
        destination.parent.mkdir(parents=True, exist_ok=True)
        cropped.save(destination, format="PNG", optimize=True)
        return cropped.size
