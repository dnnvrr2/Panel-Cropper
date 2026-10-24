from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image
from pytest import MonkeyPatch

from backend import main
from backend.services import project_manager


def manager_at(tmp_path: Path, monkeypatch: MonkeyPatch) -> project_manager.ProjectManager:
    monkeypatch.setattr(project_manager, "REGISTRY_FILE", tmp_path / "registry.json")
    manager = project_manager.ProjectManager()
    monkeypatch.setattr(main, "manager", manager)
    return manager


def test_legacy_images_migrate_once_and_keep_crop_references(tmp_path: Path, monkeypatch: MonkeyPatch) -> None:
    manager = manager_at(tmp_path, monkeypatch)
    project = manager.create_project(str(tmp_path), "Legacy")
    source = Path(project["outputFolder"]) / "sources" / "old.png"
    Image.new("RGB", (20, 30)).save(source)
    project["images"] = [{"id": "old", "filename": "old.png", "path": str(source), "width": 20, "height": 30}]
    project["paragraphs"] = [{"id": "p1", "text": "Line", "sourceImageId": "old", "completed": True,
                              "crop": {"x": 0, "y": 0, "width": 10, "height": 20}, "outputFile": "crops/001.png"}]
    project.pop("sourceGroups")
    manager._write_project(project)

    first = manager.open_project(project["outputFolder"])
    second = manager.load_project(project["id"])
    assert len(first["sourceGroups"]) == len(second["sourceGroups"]) == 1
    assert first["sourceGroups"][0]["kind"] == "project-files"
    assert first["images"][0]["sourceGroupId"] == second["images"][0]["sourceGroupId"]
    assert second["paragraphs"] == project["paragraphs"]
    assert manager.image_path(project["id"], "old") == source


def test_folder_snapshots_nested_files_and_duplicate_import(tmp_path: Path, monkeypatch: MonkeyPatch) -> None:
    manager = manager_at(tmp_path, monkeypatch)
    project = manager.create_project(str(tmp_path), "Story")
    chapter = tmp_path / "a" / "Chapter"
    (chapter / "nested").mkdir(parents=True)
    Image.new("RGB", (10, 20)).save(chapter / "2.png")
    Image.new("RGB", (30, 40)).save(chapter / "nested" / "2.png")
    (chapter / "bad.png").write_text("broken")
    (chapter / "note.txt").write_text("ignore")

    first = manager.import_source_folder(project["id"], str(chapter))
    assert first["imported"] == 2
    assert first["skipped"] == 2
    assert {image["relativePath"] for image in first["project"]["images"]} == {"2.png", "nested/2.png"}
    assert len({image["path"] for image in first["project"]["images"]}) == 2
    assert all(manager.image_path(project["id"], image["id"]).is_file() for image in first["project"]["images"])
    again = manager.import_source_folder(project["id"], str(chapter))
    assert again["existing"] is True
    assert again["imported"] == 0
    assert len(again["project"]["images"]) == 2

    other = tmp_path / "b" / "Chapter"
    other.mkdir(parents=True)
    Image.new("RGB", (50, 60)).save(other / "10.png")
    second = manager.import_source_folder(project["id"], str(other))
    assert second["groupId"] != first["groupId"]
    assert [group["name"] for group in second["project"]["sourceGroups"]] == ["Chapter", "Chapter"]


def test_import_rejects_project_descendants_and_empty_folder(tmp_path: Path, monkeypatch: MonkeyPatch) -> None:
    manager = manager_at(tmp_path, monkeypatch)
    project = manager.create_project(str(tmp_path), "Story")
    client = TestClient(main.app)
    response = client.post(f"/api/projects/{project['id']}/source-groups/folder", json={"path": project["outputFolder"]})
    assert response.status_code == 400
    empty = tmp_path / "empty"
    empty.mkdir()
    result = manager.import_source_folder(project["id"], str(empty))
    assert result["groupId"] is None
    assert result["project"]["sourceGroups"] == []


def test_stale_save_keeps_new_imported_groups(tmp_path: Path, monkeypatch: MonkeyPatch) -> None:
    manager = manager_at(tmp_path, monkeypatch)
    project = manager.create_project(str(tmp_path), "Story")
    folder = tmp_path / "Chapter"
    folder.mkdir()
    Image.new("RGB", (10, 10)).save(folder / "1.png")
    manager.import_source_folder(project["id"], str(folder))
    saved = manager.save_project(project["id"], project)
    assert len(saved["sourceGroups"]) == len(saved["images"]) == 1


def test_individual_uploads_reuse_project_files_group(tmp_path: Path, monkeypatch: MonkeyPatch) -> None:
    manager = manager_at(tmp_path, monkeypatch)
    project = manager.create_project(str(tmp_path), "Story")
    client = TestClient(main.app)
    buffer = BytesIO()
    Image.new("RGB", (20, 30)).save(buffer, format="PNG")
    for name in ("one.png", "two.png"):
        response = client.post(f"/api/projects/{project['id']}/images",
                               files={"files": (name, buffer.getvalue(), "image/png")})
        assert response.status_code == 200
    saved = manager.load_project(project["id"])
    assert len(saved["sourceGroups"]) == 1
    assert saved["sourceGroups"][0]["kind"] == "project-files"
    assert {image["sourceGroupId"] for image in saved["images"]} == {saved["sourceGroups"][0]["id"]}


def test_thumbnails_are_small_cached_and_removed_with_source(tmp_path: Path, monkeypatch: MonkeyPatch) -> None:
    manager = manager_at(tmp_path, monkeypatch)
    project = manager.create_project(str(tmp_path), "Story")
    source = Path(project["outputFolder"]) / "sources" / "large.png"
    Image.new("RGB", (1200, 1800), "#765b84").save(source)
    project["images"] = [{"id": "large", "filename": "large.png", "path": str(source),
                          "width": 1200, "height": 1800}]
    manager.save_project(project["id"], project)
    client = TestClient(main.app)
    url = f"/api/projects/{project['id']}/images/large"

    response = client.get(f"{url}/thumbnail")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/webp"
    with Image.open(BytesIO(response.content)) as thumbnail:
        assert thumbnail.size == (107, 160)
    cache = manager.thumbnail_path(project["id"], "large")
    created_at = cache.stat().st_mtime_ns
    assert client.get(f"{url}/thumbnail").status_code == 200
    assert cache.stat().st_mtime_ns == created_at
    with Image.open(BytesIO(client.get(f"{url}/content").content)) as original:
        assert original.size == (1200, 1800)

    assert client.delete(url).status_code == 200
    assert not cache.exists()
