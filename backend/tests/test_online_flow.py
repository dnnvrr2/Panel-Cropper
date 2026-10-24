from io import BytesIO
from pathlib import Path
from urllib.error import HTTPError
from concurrent.futures import ThreadPoolExecutor
import json
import time
from threading import Event

from fastapi.testclient import TestClient
from PIL import Image
import pytest

from backend import main
from backend.services import online_service, project_manager


SOURCE_ID = "1234567890123456789"


def png(color: str, size=(20, 20)) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", size, color).save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture
def online(tmp_path, monkeypatch):
    monkeypatch.setattr(project_manager, "REGISTRY_FILE", tmp_path / "registry.json")
    manager = project_manager.ProjectManager()
    monkeypatch.setattr(main, "manager", manager)
    service = main.online_service
    monkeypatch.setattr(service, "data", tmp_path / "online")
    monkeypatch.setattr(service, "_chapters", {})
    monkeypatch.setattr(service, "_asset_locks", {})
    monkeypatch.setattr(service, "_jobs", {})
    service.configure("http://reader.test:4567")
    requests = []
    series = {"id": 42, "title": "Test Series", "sourceId": SOURCE_ID, "author": "Author",
              "description": "Series description", "genre": ["Action"], "status": "ONGOING"}
    chapter = {"id": 101, "index": 7, "mangaId": 42, "name": "Chapter 1", "pageCount": 3, "chapterNumber": 1,
               "uploadDate": 0, "read": False, "downloaded": False}

    def fetch(path, query=None, *, image=False, payload=None):
        requests.append((path, query, image))
        if path == "source/list":
            value = [{"id": SOURCE_ID, "name": "Test Source", "displayName": "Test Source (EN)", "lang": "en"},
                     {"id": "-99", "name": "Unavailable", "displayName": "Unavailable", "lang": "en"},
                     {"id": "88", "name": "Foreign Source", "displayName": "Foreign Source", "lang": "de"}]
        elif path.startswith("source/-99/"):
            raise online_service.OnlineError("Source unavailable")
        elif path == f"source/{SOURCE_ID}/filters":
            value = [{"type": "Group", "filter": {"name": "Genres", "state": [
                {"type": "TriState", "filter": {"name": "Action", "state": 0}}]}}]
        elif path == f"source/{SOURCE_ID}/quick-search":
            assert payload == {"searchTerm": "test", "filter": [{"position": 0,
                "state": json.dumps({"position": 0, "state": "1"})}]}
            value = {"mangaList": [series], "hasNextPage": True}
        elif path.startswith(f"source/{SOURCE_ID}/"):
            value = {"mangaList": [series], "hasNextPage": query is not None and query.get("pageNum") == 1}
        elif path.startswith("source/88/"):
            value = {"mangaList": [{**series, "id": 43}], "hasNextPage": False}
        elif path == "category":
            value = [{"id": 0, "name": "Default", "order": 0}, {"id": 1, "name": "Favs", "order": 1}]
        elif path.startswith("category/"):
            value = [series]
        elif path == "manga/42":
            value = series
        elif path == "manga/42/chapters":
            value = [chapter]
        elif path == "manga/42/chapter/7":
            value = chapter
        elif path == "manga/42/thumbnail":
            return png("green")
        elif path.startswith("manga/42/chapter/7/page/"):
            index = int(path.rsplit("/", 1)[1])
            return png(["red", "blue", "green"][index], (10, 10) if index == 1 else (20, 20))
        else:
            raise AssertionError(path)
        return json.dumps(value).encode()

    monkeypatch.setattr(service, "fetch", fetch)
    project = manager.create_project(str(tmp_path), "Online crops")
    project["cropMode"] = "free"
    project["freeCrops"] = [{"id": "p1", "text": "", "aspectRatio": "1:1", "zoom": 1,
                             "panX": 0, "panY": 0, "completed": False}]
    manager.save_project(project["id"], project)
    return TestClient(main.app), service, manager, project, requests


def test_search_details_chapters_cover_and_library(online):
    client, _, _, _, requests = online
    sources = client.get("/api/online/sources").json()
    assert any(source["id"] == SOURCE_ID for source in sources)
    result = client.get("/api/online/search", params={"q": "test & title", "source": SOURCE_ID}).json()
    assert result["mangaList"][0]["title"] == "Test Series" and result["hasNextPage"]
    assert (f"source/{SOURCE_ID}/search", {"searchTerm": "test & title", "pageNum": 1}, False) in requests
    all_result = client.get("/api/online/search", params={"q": "Test", "source": "all"}).json()
    assert len(all_result["mangaList"]) == 1 and all_result["failures"][0]["source"] == "Unavailable"
    assert not any(path.startswith("source/88/") for path, _, _ in requests)
    all_languages = client.get("/api/online/search", params={"q": "Test", "source": "all", "language": "all"}).json()
    assert len(all_languages["mangaList"]) == 2
    library = client.get("/api/online/search", params={"source": "library", "q": "test"}).json()
    assert len(library["mangaList"]) == 1
    assert not client.get("/api/online/search", params={"source": "library", "q": "missing"}).json()["mangaList"]
    assert client.get("/api/online/series/42").json()["author"] == "Author"
    assert client.get("/api/online/series/42/chapters?refresh=true").json()[0]["index"] == 7
    assert client.get("/api/online/series/42/chapters/7").json()["pageCount"] == 3
    cover = client.get("/api/online/series/42/cover")
    assert cover.status_code == 200 and cover.headers["content-type"] == "image/png"


def test_category_scope_genres_and_latest_pagination(online, monkeypatch):
    client, service, _, _, requests = online
    assert [item["name"] for item in client.get("/api/online/categories").json()] == ["Default", "Favs"]
    client.get("/api/online/search", params={"source": "library", "category": 1}).raise_for_status()
    assert [path for path, _, _ in requests if path.startswith("category/")] == ["category/1"]
    genres = client.get("/api/online/genres", params={"source": "library", "category": 1}).json()
    assert genres["genres"] == ["Action"]
    assert not client.get("/api/online/search", params={"source": "library", "category": 1, "genre": "Romance"}).json()["mangaList"]
    assert len(client.get("/api/online/search", params={"source": "library", "genre": "Action"}).json()["mangaList"]) == 1
    result = client.get("/api/online/search", params={"source": SOURCE_ID, "mode": "latest", "page": 2})
    assert result.status_code == 200
    assert (f"source/{SOURCE_ID}/latest/2", None, False) in requests
    assert client.get("/api/online/search", params={"mode": "invalid"}).status_code == 422
    assert client.get("/api/online/genres", params={"source": SOURCE_ID}).json()["genres"] == ["Action"]
    filtered = client.get("/api/online/search", params={"source": SOURCE_ID, "genre": "Action", "q": "test", "page": 2})
    assert filtered.status_code == 200 and filtered.json()["hasNextPage"]
    assert (f"source/{SOURCE_ID}/quick-search", {"pageNum": 2}, False) in requests
    assert client.get("/api/online/search", params={"source": "all", "genre": "Action"}).status_code == 502
    assert client.get("/api/online/search", params={"source": SOURCE_ID, "mode": "latest", "genre": "Action"}).status_code == 502


def test_source_select_genre_uses_original_option_index(online, monkeypatch):
    _, service, _, _, _ = online
    monkeypatch.setattr(service, "json", lambda *args: [
        {"type": "Header", "filter": {"name": "Text searches ignore filters."}},
        {"type": "Select", "filter": {"name": "Genres", "values": ["All", "Romance", "Action"]}}])
    options = service.genre_options(SOURCE_ID)
    assert options["genres"][1] == {"name": "Action", "change": {"position": 1, "state": "2"}}
    assert options["hints"] == ["Text searches ignore filters."]


def test_reader_loads_only_requested_pages_and_reuses_cache(online):
    client, _, _, _, requests = online
    url = "/api/online/series/42/chapters/7/pages/1"
    response = client.get(url)
    assert response.status_code == 200
    with Image.open(BytesIO(response.content)) as page:
        assert page.size == (10, 10)
    assert client.get(url).content == response.content
    fetched = [path for path, _, image in requests if image and "/page/" in path]
    assert fetched == ["manga/42/chapter/7/page/1"]
    assert client.get("/api/online/series/42/chapters/7/pages/3").status_code == 502


def test_concurrent_reader_and_crop_page_requests_share_one_download(online):
    _, service, _, _, requests = online
    service.chapter(42, 7)
    with ThreadPoolExecutor(max_workers=2) as executor:
        paths = list(executor.map(lambda _: service.page_path(42, 7, 0), range(2)))
    assert paths[0] == paths[1]
    assert len([path for path, _, image in requests if image and "/page/" in path]) == 1


@pytest.mark.parametrize("include_next", [False, True])
def test_online_snapshot_crop_and_offline_reexport(online, monkeypatch, include_next):
    client, service, manager, project, requests = online
    payload = {"mangaId": 42, "chapterIndex": 7, "chapterId": 101, "pageIndex": 0, "includeNext": include_next}
    url = f"/api/projects/{project['id']}/source-groups/online"
    response = client.post(url, json=payload)
    assert response.status_code == 200
    result = response.json()
    image = result["project"]["images"][0]
    assert image["onlineOrigin"]["pageIndices"] == ([0, 1] if include_next else [0])
    assert image["height"] == (40 if include_next else 20)
    assert result["project"]["sourceGroups"][0]["kind"] == "online"
    assert client.post(url, json=payload).json()["existing"] is True
    assert len(manager.load_project(project["id"])["images"]) == 1
    # Saving an older project must preserve imported online sources.
    assert len(manager.save_project(project["id"], project)["images"]) == 1
    assert client.get(f"/api/projects/{project['id']}/images/{image['id']}/thumbnail").status_code == 200
    crop = {"x": 4, "y": 16 if include_next else 4, "width": 12, "height": 10}
    cropped = client.post(f"/api/projects/{project['id']}/crop", json={"mode": "free", "paragraphId": "p1", "imageId": image["id"],
                         "crop": crop, "aspectRatio": "1:1", "zoom": 1, "panX": 0, "panY": 0, "rotation": 0})
    assert cropped.status_code == 200
    destination = Path(project["outputFolder"]) / "crops" / "free-001.png"
    with Image.open(destination) as output:
        assert output.size == (12, 10)
        assert output.getpixel((0, 0))[:3] == (255, 0, 0)
        if include_next:
            assert output.getpixel((0, 9))[:3] == (0, 0, 255)
    destination.unlink()
    monkeypatch.setattr(service, "fetch", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("Offline")))
    manager.open_project(project["outputFolder"])
    exported = client.post(f"/api/projects/{project['id']}/export").json()
    assert exported["exported"] == 1 and exported["errors"] == []
    assert destination.is_file()
    assert client.delete(f"/api/projects/{project['id']}/images/{image['id']}").status_code == 409


def test_invalid_snapshot_does_not_add_sources(online):
    client, _, manager, project, _ = online
    url = f"/api/projects/{project['id']}/source-groups/online"
    body = {"mangaId": 42, "chapterIndex": 7, "chapterId": 999, "pageIndex": 0}
    assert client.post(url, json=body).status_code == 502
    body.update(chapterId=101, pageIndex=2, includeNext=True)
    assert client.post(url, json=body).status_code == 502
    body["pageIndex"] = -1
    assert client.post(url, json=body).status_code == 422
    assert manager.load_project(project["id"])["images"] == []


def test_connection_validation_password_retention_and_server_cache_isolation(online):
    client, service, _, _, _ = online
    for url in ["file:///etc/passwd", "http://user:pass@host", "http://host?q=1", "http://host:wrong"]:
        assert client.put("/api/online/connection", json={"serverUrl": url}).status_code == 400
    result = client.put("/api/online/connection", json={"serverUrl": "http://one.test", "username": "reader", "password": "secret"}).json()
    assert result["hasPassword"] and "password" not in result
    assert "secret" not in client.get("/api/online/connection").text
    old_cache = service.cache_folder()
    client.put("/api/online/connection", json={"serverUrl": "http://one.test", "username": "reader"})
    assert service.settings()["password"] == "secret"
    client.put("/api/online/connection", json={"serverUrl": "http://two.test", "username": "reader"})
    assert service.settings()["password"] == "" and service.cache_folder() != old_cache


def test_upstream_authentication_error_is_clear(tmp_path, monkeypatch):
    service = online_service.OnlineService(tmp_path)
    service.configure("http://reader.test")
    def unauthorized(*args, **kwargs):
        raise HTTPError("http://reader.test", 401, "Unauthorized", {}, BytesIO())
    monkeypatch.setattr(online_service, "urlopen", unauthorized)
    with pytest.raises(online_service.OnlineError, match="authentication"):
        service.sources()


def finish_chapter(client, job):
    deadline = time.monotonic() + 5
    while job["state"] not in {"complete", "failed"} and time.monotonic() < deadline:
        time.sleep(0.01)
        response = client.get(f"/api/online/chapter-jobs/{job['jobId']}")
        assert response.status_code == 200
        job = response.json()
    assert job["state"] in {"complete", "failed"}, job
    return job


@pytest.mark.parametrize("rotation", [0, 90])
@pytest.mark.parametrize("mode", ["script", "free"])
def test_complete_chapter_strip_crops_across_three_pages_and_reexports_offline(online, monkeypatch, rotation, mode):
    client, service, manager, project, requests = online
    if mode == "script":
        project.update(cropMode="script", paragraphs=project["freeCrops"], freeCrops=[])
        manager.save_project(project["id"], project)
    url = f"/api/projects/{project['id']}/source-groups/online-chapter"
    body = {"mangaId": 42, "chapterIndex": 7, "chapterId": 101}
    started = client.post(url, json=body)
    assert started.status_code == 202
    job = finish_chapter(client, started.json())
    assert job["state"] == "complete"
    assert job["completedPages"] == job["totalPages"] == 3
    image = manager.load_project(project["id"])["images"][0]
    assert image["onlineOrigin"]["wholeChapter"] is True
    assert image["onlineOrigin"]["pageIndices"] == [0, 1, 2]
    assert image["width"] == 20 and image["height"] == 60
    assert [page["top"] for page in image["stripPages"]] == [0, 20, 40]
    assert [page["stripHeight"] for page in image["stripPages"]] == [20, 20, 20]
    # Selecting the chapter again must preserve IDs, page geometry, and snapshots.
    again = finish_chapter(client, client.post(url, json=body).json())
    assert again["result"]["existing"] and again["result"]["imageId"] == image["id"]
    assert len(manager.save_project(project["id"], project)["images"]) == 1
    request = {"mode": mode, "paragraphId": "p1", "imageId": image["id"],
               "crop": {"x": 4, "y": 16, "width": 12, "height": 30},
               "aspectRatio": "1:1", "zoom": 1, "panX": 0, "panY": 0, "rotation": rotation}
    assert client.post(f"/api/projects/{project['id']}/crop", json=request).status_code == 200
    destination = Path(project["outputFolder"]) / "crops" / ("free-001.png" if mode == "free" else "001.png")
    expected = Image.new("RGBA", (12, 30), "green")
    expected.paste(Image.new("RGBA", (12, 4), "red"), (0, 0))
    expected.paste(Image.new("RGBA", (12, 20), "blue"), (0, 4))
    if rotation:
        expected = expected.transpose(Image.Transpose.ROTATE_270)
    with Image.open(destination) as cropped:
        assert cropped.tobytes() == expected.tobytes() and cropped.size == expected.size
    destination.unlink()
    monkeypatch.setattr(service, "fetch", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("Offline")))
    manager.open_project(project["outputFolder"])
    assert client.post(f"/api/projects/{project['id']}/export").json()["exported"] == 1
    with Image.open(destination) as cropped:
        assert cropped.tobytes() == expected.tobytes()


def test_chapter_jobs_deduplicate_active_preparation(online, monkeypatch):
    client, service, _, project, _ = online
    gate = Event()
    snapshot = service.snapshot
    def blocked(*args, **kwargs):
        assert gate.wait(5)
        return snapshot(*args, **kwargs)
    monkeypatch.setattr(service, "snapshot", blocked)
    url = f"/api/projects/{project['id']}/source-groups/online-chapter"
    body = {"mangaId": 42, "chapterIndex": 7, "chapterId": 101}
    try:
        first = client.post(url, json=body).json()
        second = client.post(url, json=body).json()
        assert second["jobId"] == first["jobId"]
    finally:
        gate.set()
    assert finish_chapter(client, first)["state"] == "complete"


def test_failed_full_chapter_can_retry_without_losing_pages_or_adding_partial_sources(online, monkeypatch):
    client, service, manager, project, requests = online
    fetch = service.fetch
    fail = True
    def flaky(path, query=None, **kwargs):
        if fail and path.endswith("/page/1"):
            raise online_service.OnlineError("Page temporarily unavailable")
        return fetch(path, query, **kwargs)
    monkeypatch.setattr(service, "fetch", flaky)
    url = f"/api/projects/{project['id']}/source-groups/online-chapter"
    body = {"mangaId": 42, "chapterIndex": 7, "chapterId": 101}
    failed = finish_chapter(client, client.post(url, json=body).json())
    assert failed["state"] == "failed" and "unavailable" in failed["error"]
    assert manager.load_project(project["id"])["images"] == []
    assert manager.load_project(project["id"])["sourceGroups"] == []
    fail = False
    retried = finish_chapter(client, client.post(url, json=body).json())
    assert retried["state"] == "complete"
    assert len([path for path, _, image in requests if image and path.endswith("/page/0")]) == 1
    assert len(manager.load_project(project["id"])["images"]) == 1
