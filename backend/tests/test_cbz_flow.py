from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

from fastapi.testclient import TestClient
from PIL import Image
import pytest

from backend import main
from backend.services import project_manager


def comic(entries: list[tuple[str, tuple[int, int], str]], extras: dict[str, bytes] | None = None) -> bytes:
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        for name, size, color in entries:
            page = BytesIO()
            image_format = "AVIF" if Path(name).suffix.lower() == ".avif" else "PNG"
            Image.new("RGB", size, color).save(page, format=image_format)
            archive.writestr(name, page.getvalue())
        for name, content in (extras or {}).items():
            archive.writestr(name, content)
    return buffer.getvalue()


@pytest.fixture
def story(tmp_path, monkeypatch):
    monkeypatch.setattr(project_manager, "REGISTRY_FILE", tmp_path / "registry.json")
    manager = project_manager.ProjectManager()
    monkeypatch.setattr(main, "manager", manager)
    project = manager.create_project(str(tmp_path), "Comic")
    project["paragraphs"] = [{"id": "p1", "text": "First crop", "aspectRatio": "1:1", "zoom": 1,
                              "panX": 0, "panY": 0, "completed": False}]
    manager.save_project(project["id"], project)
    return manager, project, TestClient(main.app)


def test_cbz_import_orders_pages_normalizes_width_and_preserves_snapshot(story):
    manager, project, client = story
    archive = comic([("pages/10.png", (20, 20), "blue"), ("pages/2.png", (10, 10), "green"),
                     ("pages/1.png", (20, 20), "red")], {"ComicInfo.xml": b"metadata", "bad.png": b"broken"})
    response = client.post(f"/api/projects/{project['id']}/source-groups/cbz",
                           files={"file": ("Chapter.cbz", archive, "application/zip")})
    assert response.status_code == 200
    result = response.json()
    assert result["imported"] == 3 and result["skipped"] == 1
    strip = result["project"]["images"][0]
    assert strip["width"] == 20 and strip["height"] == 60
    assert [page["filename"] for page in strip["stripPages"]] == ["pages/1.png", "pages/2.png", "pages/10.png"]
    assert [page["top"] for page in strip["stripPages"]] == [0, 20, 40]
    assert [page["stripHeight"] for page in strip["stripPages"]] == [20, 20, 20]
    assert result["project"]["sourceGroups"][0]["kind"] == "cbz"
    for page in strip["stripPages"]:
        url = f"/api/projects/{project['id']}/images/{strip['id']}/pages/{page['id']}/content"
        with Image.open(BytesIO(client.get(url).content)) as image:
            assert image.size == (page["width"], page["height"])
    assert client.get(f"/api/projects/{project['id']}/images/{strip['id']}/thumbnail").status_code == 200
    saved = manager.save_project(project["id"], project)  # A stale autosave must keep an imported archive.
    assert saved["images"] == [strip]
    assert manager.open_project(project["outputFolder"])["images"] == [strip]


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
@pytest.mark.parametrize("mode", ["script", "free"])
def test_crop_spans_page_seam_and_exports_again_after_reopen(story, rotation, mode):
    manager, project, client = story
    if mode == "free":
        project["freeCrops"] = project["paragraphs"]
        project["paragraphs"] = []
        project["cropMode"] = "free"
        manager.save_project(project["id"], project)
    archive = comic([("1.png", (20, 20), "red"), ("2.png", (10, 10), "blue")])
    strip = client.post(f"/api/projects/{project['id']}/source-groups/cbz",
                        files={"file": ("Book.cbz", archive)}).json()["project"]["images"][0]
    response = client.post(f"/api/projects/{project['id']}/crop", json={"mode": mode, "paragraphId": "p1", "imageId": strip["id"],
                           "crop": {"x": 4, "y": 16, "width": 12, "height": 10},
                           "aspectRatio": "1:1", "zoom": 1, "panX": 0, "panY": 0, "rotation": rotation})
    assert response.status_code == 200
    paragraph = response.json()["freeCrops" if mode == "free" else "paragraphs"][0]
    assert paragraph["completed"] is True and paragraph["sourceImageId"] == strip["id"]
    destination = Path(project["outputFolder"]) / "crops" / ("free-001.png" if mode == "free" else "001.png")
    expected = Image.new("RGBA", (12, 10), "blue")
    expected.paste(Image.new("RGBA", (12, 4), "red"), (0, 0))
    if rotation:
        expected = expected.transpose({90: Image.Transpose.ROTATE_270, 180: Image.Transpose.ROTATE_180,
                                       270: Image.Transpose.ROTATE_90}[rotation])
    with Image.open(destination) as cropped:
        assert cropped.size == expected.size
        assert cropped.tobytes() == expected.tobytes()
    destination.unlink()
    manager.open_project(project["outputFolder"])
    result = client.post(f"/api/projects/{project['id']}/export").json()
    assert result["exported"] == 1 and result["errors"] == []
    with Image.open(destination) as cropped:
        assert cropped.tobytes() == expected.tobytes()
    assert client.delete(f"/api/projects/{project['id']}/images/{strip['id']}").status_code == 409


@pytest.mark.parametrize("second_extension", ["avif", "png"])
def test_cbz_avif_pages_preview_crop_and_export_after_reopen(story, second_extension):
    manager, project, client = story
    archive = comic([("pages/10." + second_extension, (10, 10), "blue"),
                     ("pages/2.AVIF", (20, 20), "red")],
                    {"pages/bad.avif": b"broken", "__MACOSX/ignored.avif": b"metadata"})
    response = client.post(f"/api/projects/{project['id']}/source-groups/cbz",
                           files={"file": ("Avif.cbz", archive, "application/zip")})
    assert response.status_code == 200
    result = response.json()
    assert result["imported"] == 2 and result["skipped"] == 1
    strip = result["project"]["images"][0]
    assert (strip["width"], strip["height"]) == (20, 40)
    assert [page["filename"] for page in strip["stripPages"]] == [
        "pages/2.AVIF", "pages/10." + second_extension]
    colors = []
    for page in strip["stripPages"]:
        page_response = client.get(
            f"/api/projects/{project['id']}/images/{strip['id']}/pages/{page['id']}/content")
        assert page_response.status_code == 200
        if page["filename"].lower().endswith(".avif"):
            assert page_response.headers["content-type"] == "image/avif"
        with Image.open(BytesIO(page_response.content)) as image:
            assert image.size == (page["width"], page["height"])
            assert image.format == ("AVIF" if page["filename"].lower().endswith(".avif") else "PNG")
            # Compare with decoded pixels because AVIF encoding can be lossy.
            colors.append(image.convert("RGBA").getpixel((0, 0)))
    thumbnail = client.get(f"/api/projects/{project['id']}/images/{strip['id']}/thumbnail")
    assert thumbnail.status_code == 200
    with Image.open(BytesIO(thumbnail.content)) as image:
        assert image.size == (20, 20)
    response = client.post(f"/api/projects/{project['id']}/crop", json={
        "paragraphId": "p1", "imageId": strip["id"],
        "crop": {"x": 4, "y": 16, "width": 12, "height": 10},
        "aspectRatio": "1:1", "zoom": 1, "panX": 0, "panY": 0})
    assert response.status_code == 200
    destination = Path(project["outputFolder"]) / "crops" / "001.png"
    expected = Image.new("RGBA", (12, 10), colors[1])
    expected.paste(colors[0], (0, 0, 12, 4))
    with Image.open(destination) as cropped:
        assert cropped.size == expected.size
        assert cropped.tobytes() == expected.tobytes()
    destination.unlink()
    assert manager.open_project(project["outputFolder"])["images"] == [strip]
    exported = client.post(f"/api/projects/{project['id']}/export").json()
    assert exported["exported"] == 1 and exported["errors"] == []
    with Image.open(destination) as cropped:
        assert cropped.tobytes() == expected.tobytes()


def test_cbz_bad_archive_cleanup_safe_names_and_removal(story, tmp_path):
    manager, project, client = story
    url = f"/api/projects/{project['id']}/source-groups/cbz"
    sources = Path(project["outputFolder"]) / "sources"
    for filename, archive in [("Bad.cbz", b"not zip"), ("Empty.cbz", comic([], {"bad.png": b"broken"})),
                              ("Bad.zip", comic([("1.png", (20, 20), "red")]))]:
        assert client.post(url, files={"file": (filename, archive)}).status_code == 400
        assert list(sources.iterdir()) == []
        assert manager.load_project(project["id"])["images"] == []
    archive = comic([("../../escape.png", (20, 20), "red"), ("2.png", (20, 20), "blue")])
    strip = client.post(url, files={"file": ("Safe.cbz", archive)}).json()["project"]["images"][0]
    assert not (tmp_path / "escape.png").exists()
    for page in strip["stripPages"]:
        assert sources.resolve() in Path(page["path"]).resolve().parents
    source_url = f"/api/projects/{project['id']}/images/{strip['id']}"
    assert client.get(f"{source_url}/pages/missing/content").status_code == 404
    assert client.get(f"{source_url}/thumbnail").status_code == 200
    cache = manager.thumbnail_path(project["id"], strip["id"])
    assert client.delete(source_url).status_code == 200
    assert not cache.exists()
    assert all(not Path(page["path"]).exists() for page in strip["stripPages"])


def test_cbz_crop_decodes_only_intersecting_pages_and_rejects_out_of_bounds(story):
    manager, project, client = story
    strip = client.post(f"/api/projects/{project['id']}/source-groups/cbz",
                        files={"file": ("Book.cbz", comic([("1.png", (20, 20), "red"),
                                                            ("2.png", (20, 20), "blue")]))}).json()["project"]["images"][0]
    Path(strip["stripPages"][1]["path"]).unlink()
    payload = {"paragraphId": "p1", "imageId": strip["id"], "crop": {"x": 0, "y": 0, "width": 10, "height": 10},
               "aspectRatio": "1:1", "zoom": 1, "panX": 0, "panY": 0}
    assert client.post(f"/api/projects/{project['id']}/crop", json=payload).status_code == 200
    payload["crop"]["y"] = 35
    assert client.post(f"/api/projects/{project['id']}/crop", json=payload).status_code == 400
    payload["crop"]["y"] = 20
    assert client.post(f"/api/projects/{project['id']}/crop", json=payload).status_code == 404
