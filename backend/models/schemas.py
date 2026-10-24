from typing import Literal

from pydantic import BaseModel, Field


AspectRatio = Literal["9:16", "4:5", "4:3", "1:1"]
DEFAULT_OUTPUT_FOLDER = r"C:\Users\Admin\Desktop\CBZ\images"


class CreateProjectRequest(BaseModel):
    projectName: str | None = None
    outputFolder: str = Field(default=DEFAULT_OUTPUT_FOLDER, min_length=1)


class OpenProjectRequest(BaseModel):
    folder: str = Field(min_length=1)


class FolderImportRequest(BaseModel):
    path: str = Field(min_length=1)


class CropRect(BaseModel):
    x: float
    y: float
    width: float = Field(gt=0)
    height: float = Field(gt=0)


class CropRequest(BaseModel):
    paragraphId: str
    mode: Literal["script", "free"] = "script"
    imageId: str | None = None
    crop: CropRect
    aspectRatio: AspectRatio
    zoom: float = Field(ge=0.5)
    panX: float
    panY: float
    rotation: Literal[0, 90, 180, 270] = 0
