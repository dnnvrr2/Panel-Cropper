from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image
from pytest import MonkeyPatch

from backend import main
from backend.services import project_manager


def test_crop_saves_selected_image_without_prior_assignment(tmp_path: Path, monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setattr(project_manager, "REGISTRY_FILE", tmp_path / "registry.json")
    monkeypatch.setattr(main, "manager", project_manager.ProjectManager())
    project = main.manager.create_project(str(tmp_path), "Story")
    image_id = str(uuid4())
    source = Path(project["outputFolder"]) / "sources" / "source.png"
    Image.new("RGB", (1600, 1200), "blue").save(source)
    project["images"] = [{"id": image_id, "filename": "source.png", "path": str(source), "width": 1600, "height": 1200}]
    project["paragraphs"] = [{"id": "line-1", "text": "First line", "draftImageId": image_id, "aspectRatio": "9:16", "zoom": 1,
                              "panX": 0, "panY": 0, "completed": False}]
    main.manager.save_project(project["id"], project)

    client = TestClient(main.app)
    assert client.delete(f"/api/projects/{project['id']}/images/{image_id}").status_code == 409

    response = client.post(f"/api/projects/{project['id']}/crop", json={
        "paragraphId": "line-1", "imageId": image_id,
        "crop": {"x": 100, "y": 100, "width": 1280, "height": 720},
        "aspectRatio": "9:16", "zoom": 1, "panX": 0, "panY": 0, "rotation": 90,
    })

    assert response.status_code == 200
    saved = response.json()["paragraphs"][0]
    assert saved["sourceImageId"] == image_id
    assert saved["completed"] is True
    assert saved["rotation"] == 90
    assert (saved["outputWidth"], saved["outputHeight"]) == (720, 1280)
    output = Path(project["outputFolder"], saved["outputFile"])
    assert output.is_file()
    with Image.open(output) as cropped:
        assert cropped.size == (720, 1280)

    exported = client.post(f"/api/projects/{project['id']}/export").json()
    assert exported["exported"] == 1
    assert exported["project"]["paragraphs"][0]["rotation"] == 90
    with Image.open(output) as cropped:
        assert cropped.size == (720, 1280)

    pending = main.manager.load_project(project["id"])
    pending["paragraphs"][0]["completed"] = False
    main.manager.save_project(project["id"], pending)
    assert client.post(f"/api/projects/{project['id']}/export").json()["exported"] == 0
