from pathlib import Path

from PIL import Image
import pytest

from backend.models.schemas import CropRect
from backend.services.crop_service import export_crop


def test_export_crop_preserves_requested_resolution(tmp_path: Path) -> None:
    source = tmp_path / "source.jpg"
    destination = tmp_path / "crop.png"
    Image.new("RGB", (1200, 1600), "red").save(source)

    size = export_crop(source, destination, CropRect(x=100, y=200, width=900, height=1200))

    assert size == (900, 1200)
    with Image.open(destination) as cropped:
        assert cropped.size == (900, 1200)


@pytest.mark.parametrize("rotation,size,red_position", [
    (90, (2, 3), (1, 0)),
    (180, (3, 2), (2, 1)),
    (270, (2, 3), (0, 2)),
])
def test_export_crop_rotates_clockwise(tmp_path: Path, rotation: int,
                                      size: tuple[int, int], red_position: tuple[int, int]) -> None:
    source = tmp_path / "source.png"
    destination = tmp_path / "crop.png"
    image = Image.new("RGB", (3, 2), "black")
    image.putpixel((0, 0), (255, 0, 0))
    image.save(source)

    assert export_crop(source, destination, CropRect(x=0, y=0, width=3, height=2), rotation) == size
    with Image.open(destination) as cropped:
        assert cropped.size == size
        assert cropped.getpixel(red_position) == (255, 0, 0)
