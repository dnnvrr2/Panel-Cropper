from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image
from pytest import MonkeyPatch

from backend import main
from backend.services import project_manager


def test_free_crops_persist_export_and_do_not_overwrite_script_crops(tmp_path: Path, monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setattr(project_manager, "REGISTRY_FILE", tmp_path / "registry.json")
    monkeypatch.setattr(main, "manager", project_manager.ProjectManager())
    project = main.manager.create_project(str(tmp_path), "Free crops")
    source = Path(project["outputFolder"]) / "sources" / "page.png"
    Image.new("RGB", (800, 3000), "blue").save(source)
    project["images"] = [{"id": "image", "filename": "page.png", "path": str(source), "width": 800, "height": 3000}]
    project["cropMode"] = "free"
    project["freeCrops"] = [{"id": "free1", "completed": False}, {"id": "free2", "completed": False}]
    main.manager.save_project(project["id"], project)
    client = TestClient(main.app)
    crop_request = {"mode": "free", "paragraphId": "free1", "imageId": "image",
                    "crop": {"x": 40, "y": 100, "width": 720, "height": 1280},
                    "aspectRatio": "9:16", "zoom": 1, "panX": 0, "panY": 0}
    response = client.post(f"/api/projects/{project['id']}/crop", json=crop_request)
    assert response.status_code == 200
    assert response.json()["paragraphs"] == []
    assert response.json()["freeCrops"][0]["outputFile"] == "crops/free-001.png"
    crop_request.update(paragraphId="free2", rotation=90)
    response = client.post(f"/api/projects/{project['id']}/crop", json=crop_request)
    assert response.status_code == 200
    assert response.json()["freeCrops"][1]["outputFile"] == "crops/free-002.png"
    assert (response.json()["freeCrops"][1]["outputWidth"], response.json()["freeCrops"][1]["outputHeight"]) == (1280, 720)
    assert client.delete(f"/api/projects/{project['id']}/images/image").status_code == 409
    loaded = client.get(f"/api/projects/{project['id']}").json()
    assert loaded["cropMode"] == "free"
    assert len(loaded["freeCrops"]) == 2
    loaded["paragraphs"] = [{"id": "script1", "text": "Script stays separate", "completed": False}]
    main.manager.save_project(project["id"], loaded)
    crop_request.update(mode="script", paragraphId="script1", rotation=0)
    assert client.post(f"/api/projects/{project['id']}/crop", json=crop_request).status_code == 200
    exported = client.post(f"/api/projects/{project['id']}/export").json()
    assert exported["exported"] == 3
    assert exported["errors"] == []
    for filename, size in [("001.png", (720, 1280)), ("free-001.png", (720, 1280)), ("free-002.png", (1280, 720))]:
        with Image.open(Path(project["outputFolder"]) / "crops" / filename) as cropped:
            assert cropped.size == size
    crop_request.update(mode="free", paragraphId="missing")
    assert client.post(f"/api/projects/{project['id']}/crop", json=crop_request).status_code == 404
