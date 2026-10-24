from __future__ import annotations

import base64
import hashlib
import json
import os
import shutil
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
from uuid import uuid4

from PIL import Image, ImageOps

from backend.services.project_manager import APP_DATA, ProjectManager, ProjectNotFoundError


class OnlineError(ValueError):
    pass


class OnlineService:
    """Use the reader server as a source engine; keep crop snapshots in projects."""

    def __init__(self, data: Path = APP_DATA) -> None:
        self.data = data
        self._lock = threading.RLock()
        self._chapters: dict[tuple[str, int, int], dict[str, Any]] = {}
        self._asset_locks: dict[str, threading.Lock] = {}
        self._jobs: dict[str, dict[str, Any]] = {}
        self._job_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="chapter-strip")

    def settings(self) -> dict[str, Any]:
        path = self.data / "online-settings.json"
        with self._lock:
            config = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
        return {"serverUrl": config.get("serverUrl", os.environ.get("PANEL_CROPPER_SUWAYOMI_URL", "http://127.0.0.1:4567")).rstrip("/"),
                "username": config.get("username", ""), "password": config.get("password", "")}

    def public_settings(self) -> dict[str, Any]:
        config = self.settings()
        return {"serverUrl": config["serverUrl"], "username": config["username"], "hasPassword": bool(config["password"])}

    def configure(self, server_url: str, username: str = "", password: str | None = None) -> dict[str, Any]:
        server_url = server_url.strip().rstrip("/")
        parsed = urlsplit(server_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise OnlineError("Enter an HTTP or HTTPS server address without embedded credentials or query parameters.")
        try:
            parsed.port
        except ValueError as error:
            raise OnlineError("Invalid server port.") from error
        with self._lock:
            previous = self.settings()
            keep_password = previous["password"] if previous["serverUrl"] == server_url and previous["username"] == username else ""
            config = {"serverUrl": server_url, "username": username.strip(), "password": keep_password if password is None else password}
            self.data.mkdir(parents=True, exist_ok=True)
            ProjectManager._write_json(self.data / "online-settings.json", config)
            self._chapters.clear()
        return self.public_settings()

    def fetch(self, path: str, query: dict[str, Any] | None = None, *, image: bool = False, payload: Any = None) -> bytes:
        config = self.settings()
        url = config["serverUrl"] + "/api/v1/" + path
        if query:
            url += "?" + urlencode(query)
        headers = {"Accept": "image/*" if image else "application/json"}
        body = None
        if payload is not None:
            body = json.dumps(payload).encode()
            headers["Content-Type"] = "application/json"
        if config["username"]:
            credentials = base64.b64encode(f"{config['username']}:{config['password']}".encode()).decode()
            headers["Authorization"] = "Basic " + credentials
        try:
            with urlopen(Request(url, data=body, headers=headers), timeout=45) as response:
                limit = 64 * 1024 * 1024 if image else 8 * 1024 * 1024
                content = response.read(limit + 1)
                if len(content) > limit:
                    raise OnlineError("The source response exceeds the size limit.")
                return content
        except HTTPError as error:
            if error.code in {401, 403}:
                raise OnlineError("The reader server requires authentication. Check the connection username and password.") from error
            raise OnlineError(f"The source could not fulfill this request (HTTP {error.code}). Try again or choose another source.") from error
        except (URLError, TimeoutError, OSError) as error:
            raise OnlineError("Cannot reach the reader server. Start Suwayomi and check the connection address.") from error

    def json(self, path: str, query: dict[str, Any] | None = None) -> Any:
        try:
            return json.loads(self.fetch(path, query))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise OnlineError("The server did not return reader API data. Check the connection address.") from error

    def sources(self) -> list[dict[str, Any]]:
        sources = self.json("source/list")
        if not isinstance(sources, list):
            raise OnlineError("The server returned an invalid source list.")
        return sorted(sources, key=lambda item: (item.get("lang", ""), item.get("displayName", item["name"])))

    def categories(self) -> list[dict[str, Any]]:
        return sorted(self.json("category"), key=lambda item: item.get("order", 0))

    def genre_options(self, source_id: str, category: int | None = None) -> dict[str, Any]:
        if source_id == "all":
            return {"genres": [], "hints": ["Choose a source or My library to filter by genre."]}
        if source_id == "library":
            categories = self.categories() if category is None else [{"id": category}]
            names = {genre for item in categories for manga in self.json(f"category/{int(item['id'])}")
                     for genre in (manga.get("genre") or [])}
            return {"genres": [{"name": name} for name in sorted(names, key=str.casefold)], "hints": []}
        if not source_id.lstrip("-").isdigit():
            raise OnlineError("Invalid source identifier.")
        filters = self.json(f"source/{source_id}/filters")
        genres, hints = [], []
        for position, item in enumerate(filters):
            field = item["filter"]
            if item["type"] == "Header":
                hints.append(field["name"])
            if "genre" not in field.get("name", "").casefold():
                continue
            if item["type"] == "Select":
                for index, name in enumerate(field.get("displayValues", field.get("values", []))):
                    if str(name).casefold() in {"all", "any", "none", ""}:
                        continue
                    genres.append({"name": str(name), "change": {"position": position, "state": str(index)}})
            elif item["type"] == "Group":
                for index, child in enumerate(field["state"]):
                    if child["type"] in {"TriState", "CheckBox"}:
                        state = "1" if child["type"] == "TriState" else "true"
                        genres.append({"name": child["filter"]["name"], "change": {
                            "position": position, "state": json.dumps({"position": index, "state": state})}})
        if not genres:
            hints.append("This source does not provide genre filters.")
        return {"genres": genres, "hints": hints}

    def search(self, query: str, source_id: str, page: int, language: str = "en", *,
               mode: str = "popular", category: int | None = None, genre: str = "") -> dict[str, Any]:
        if source_id == "library":
            categories = self.categories() if category is None else [{"id": category}]
            series: dict[int, dict[str, Any]] = {}
            for category in categories:
                for manga in self.json(f"category/{int(category['id'])}"):
                    if query.casefold() in manga["title"].casefold() and (not genre or
                            genre.casefold() in {name.casefold() for name in (manga.get("genre") or [])}):
                        series[manga["id"]] = manga
            return {"mangaList": list(series.values()), "hasNextPage": False, "failures": []}
        if genre and (source_id == "all" or mode == "latest"):
            raise OnlineError("Choose one source and Browse to search by genre.")
        sources = self.sources() if source_id == "all" else [{"id": source_id, "name": source_id}]
        if source_id == "all" and language != "all":
            sources = [source for source in sources if source.get("lang", "").casefold() == language.casefold()]
        if mode == "latest":
            sources = [source for source in sources if source.get("supportsLatest", True)]
        # Source IDs are 64-bit identifiers and must stay strings in the browser.
        if any(not str(source["id"]).lstrip("-").isdigit() for source in sources):
            raise OnlineError("Invalid source identifier.")
        results, failures = [], []

        def search_source(source: dict[str, Any]) -> tuple[dict[str, Any], Any]:
            source_key = str(source["id"])
            if genre:
                option = next((item for item in self.genre_options(source_key)["genres"] if item["name"] == genre), None)
                if option is None:
                    raise OnlineError("This source does not support the selected genre.")
                content = self.fetch(f"source/{source_key}/quick-search", {"pageNum": page},
                                     payload={"searchTerm": query, "filter": [option["change"]]})
                return source, json.loads(content)
            if mode == "latest":
                return source, self.json(f"source/{source_key}/latest/{page}")
            path = f"source/{source_key}/search" if query else f"source/{source_key}/popular/{page}"
            return source, self.json(path, {"searchTerm": query, "pageNum": page} if query else None)

        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = [(source, executor.submit(search_source, source)) for source in sources]
            for source, future in futures:
                try:
                    _, result = future.result()
                    results.append(result)
                except OnlineError as error:
                    failures.append({"source": source.get("displayName", source["name"]), "message": str(error)})
        if failures and not results:
            raise OnlineError(failures[0]["message"])
        return {"mangaList": [manga for result in results for manga in result["mangaList"]],
                "hasNextPage": any(result["hasNextPage"] for result in results), "failures": failures}

    def chapter(self, manga_id: int, chapter_index: int, *, refresh: bool = False) -> dict[str, Any]:
        key = (self.settings()["serverUrl"], manga_id, chapter_index)
        with self._lock:
            cached = self._chapters.get(key)
        if cached is not None and not refresh:
            return cached
        chapter = self.json(f"manga/{manga_id}/chapter/{chapter_index}")
        if not isinstance(chapter.get("pageCount"), int) or not 0 < chapter["pageCount"] <= 10000:
            raise OnlineError("This chapter has no readable pages, or exceeds the 10,000 page limit.")
        with self._lock:
            self._chapters[key] = chapter
        return chapter

    def cache_folder(self) -> Path:
        config = self.settings()
        namespace = hashlib.sha256((config["serverUrl"] + "\n" + config["username"]).encode()).hexdigest()[:24]
        return self.data / "online-cache" / namespace

    def page_path(self, manga_id: int, chapter_index: int, page_index: int) -> Path:
        chapter = self.chapter(manga_id, chapter_index)
        if not 0 <= page_index < chapter["pageCount"]:
            raise OnlineError("Page is outside this chapter.")
        destination = self.cache_folder() / str(manga_id) / str(chapter["id"]) / f"{page_index}.image"
        self.cache_image(destination, f"manga/{manga_id}/chapter/{chapter_index}/page/{page_index}", {"updateProgress": "false"})
        return destination

    def cover_path(self, manga_id: int) -> Path:
        destination = self.cache_folder() / "covers" / f"{manga_id}.image"
        self.cache_image(destination, f"manga/{manga_id}/thumbnail")
        return destination

    def cache_image(self, destination: Path, path: str, query: dict[str, Any] | None = None) -> None:
        # The reader and crop action can ask for the same image at the same time.
        with self._lock:
            asset_lock = self._asset_locks.setdefault(str(destination), threading.Lock())
        with asset_lock:
            if destination.is_file():
                return
            content = self.fetch(path, query, image=True)
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_name(f"{destination.stem}-{uuid4().hex}.tmp")
            try:
                temporary.write_bytes(content)
                with Image.open(temporary) as opened:
                    opened.verify()
                temporary.replace(destination)
            except (OSError, ValueError, Image.DecompressionBombError) as error:
                raise OnlineError("The source returned an unreadable image. Retry this page.") from error
            finally:
                temporary.unlink(missing_ok=True)

    def start_chapter(self, manager: ProjectManager, project_id: str, manga_id: int,
                      chapter_index: int, chapter_id: int) -> dict[str, Any]:
        manager.load_project(project_id)
        key = (self.settings()["serverUrl"], project_id, manga_id, chapter_id)
        with self._lock:
            for job in self._jobs.values():
                if job["key"] == key and job["state"] in {"pending", "loading"}:
                    return self.chapter_job(job["jobId"])
            # Keep recent job results without retaining every project snapshot forever.
            finished = [job_id for job_id, job in self._jobs.items() if job["state"] in {"complete", "failed"}]
            for job_id in finished[:-15]:
                self._jobs.pop(job_id, None)
            job_id = str(uuid4())
            job = {"jobId": job_id, "key": key, "state": "pending", "completedPages": 0, "totalPages": 0}
            self._jobs[job_id] = job

        def progress(completed: int, total: int) -> None:
            with self._lock:
                job.update(state="loading", completedPages=completed, totalPages=total)

        def prepare() -> None:
            try:
                if self.settings()["serverUrl"] != key[0]:
                    raise OnlineError("The reader connection changed. Reopen the chapter to try again.")
                result = self.snapshot(manager, project_id, manga_id, chapter_index, 0, False,
                                       chapter_id, whole_chapter=True, progress=progress)
                with self._lock:
                    job.update(state="complete", result={name: result[name] for name in ("imageId", "groupId", "existing")})
            except Exception as error:
                with self._lock:
                    job.update(state="failed", error=str(error) if isinstance(error, (OnlineError, ProjectNotFoundError))
                               else "Could not prepare this chapter. Retry to reuse the pages already loaded.")

        self._job_executor.submit(prepare)
        return self.chapter_job(job_id)

    def chapter_job(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise ProjectNotFoundError("Chapter preparation was not found. Reopen the chapter to try again.")
            return {name: job[name] for name in ("jobId", "state", "completedPages", "totalPages", "result", "error") if name in job}

    def snapshot(self, manager: ProjectManager, project_id: str, manga_id: int, chapter_index: int,
                 page_index: int, include_next: bool, expected_chapter_id: int, *,
                 whole_chapter: bool = False, progress: Callable[[int, int], None] | None = None) -> dict[str, Any]:
        project = manager.load_project(project_id)
        chapter = self.chapter(manga_id, chapter_index, refresh=True)
        if chapter["id"] != expected_chapter_id:
            raise OnlineError("The chapter list has changed. Reopen the chapter before cropping.")
        indices = list(range(chapter["pageCount"])) if whole_chapter else [page_index, page_index + 1] if include_next else [page_index]
        if any(not 0 <= index < chapter["pageCount"] for index in indices):
            raise OnlineError("Page is outside this chapter.")
        server_url = self.settings()["serverUrl"]
        identity = f"{server_url}/{manga_id}/{chapter['id']}"
        group_id = "online-" + hashlib.sha256(identity.encode()).hexdigest()[:24]
        image_id = group_id + ("-chapter" if whole_chapter else "-" + "-".join(map(str, indices)))
        existing = next((image for image in project["images"] if image["id"] == image_id), None)
        if existing and all(Path(page["path"]).is_file() for page in existing.get("stripPages", [existing])):
            return {"project": project, "groupId": group_id, "imageId": image_id, "existing": True}
        if progress:
            progress(0, len(indices))
        completed = 0
        total_bytes = 0
        interrupted = threading.Event()
        first_error: Exception | None = None

        def load_page(index: int) -> Path:
            nonlocal completed, total_bytes, first_error
            if interrupted.is_set():
                raise first_error or OnlineError("Chapter preparation interrupted. Retry to reuse the pages already loaded.")
            try:
                path = self.page_path(manga_id, chapter_index, index)
                with self._lock:
                    total_bytes += path.stat().st_size
                    if total_bytes > 2 * 1024 ** 3:
                        raise OnlineError("Chapter exceeds the 2 GB source size limit.")
                    completed += 1
                    if progress:
                        progress(completed, len(indices))
                return path
            except Exception as error:
                with self._lock:
                    if first_error is None:
                        first_error = error
                    interrupted.set()
                raise

        # Measure every page before laying out the strip, so saved coordinates never
        # move when a later page has a different width or height. Display stays lazy.
        with ThreadPoolExecutor(max_workers=4) as executor:
            paths = list(executor.map(load_page, indices))
        if self.settings()["serverUrl"] != server_url:
            raise OnlineError("The reader connection changed. Reopen the chapter to try again.")
        manga = self.json(f"manga/{manga_id}")
        pages = []
        created = []
        try:
            for index, source in zip(indices, paths):
                with Image.open(source) as opened:
                    width, height = ImageOps.exif_transpose(opened).size
                    suffix = (Image.registered_extensions())
                    extension = next((ext for ext, fmt in suffix.items() if fmt == opened.format), ".png")
                destination = Path(project["outputFolder"]) / "sources" / f"{image_id}-{index}-{uuid4().hex}{extension}"
                created.append(destination)
                shutil.copyfile(source, destination)
                pages.append({"id": f"page-{index}", "filename": f"Page {index + 1}", "path": str(destination.resolve()),
                              "width": width, "height": height})
            strip_width = max(page["width"] for page in pages)
            top = 0
            for page in pages:
                page["top"] = top
                page["stripHeight"] = max(1, round(page["height"] * strip_width / page["width"]))
                top += page["stripHeight"]
            label = chapter["name"] if whole_chapter else f"{chapter['name']} · Page {page_index + 1}" + (f"–{page_index + 2}" if include_next else "")
            image = {"id": image_id, "filename": label, "path": pages[0]["path"], "width": strip_width,
                     "height": top, "sourceGroupId": group_id,
                     "onlineOrigin": {"serverUrl": server_url, "mangaId": manga_id, "chapterId": chapter["id"],
                                      "chapterIndex": chapter_index, "pageIndices": indices, "wholeChapter": whole_chapter}}
            if include_next or whole_chapter:
                image["stripPages"] = pages
            with manager._lock:
                if self.settings()["serverUrl"] != server_url:
                    raise OnlineError("The reader connection changed. Reopen the chapter to try again.")
                project = manager.load_project(project_id)
                project["images"] = [item for item in project["images"] if item["id"] != image_id] + [image]
                if not any(group["id"] == group_id for group in project["sourceGroups"]):
                    project["sourceGroups"].append({"id": group_id, "name": f"{manga['title']} · {chapter['name']}",
                                                   "kind": "online", "createdAt": manager._timestamp()})
                saved = manager.save_project(project_id, project)
            return {"project": saved, "groupId": group_id, "imageId": image_id, "existing": False}
        except Exception:
            for path in created:
                path.unlink(missing_ok=True)
            raise
