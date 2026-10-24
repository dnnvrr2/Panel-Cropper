from typing import Callable

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from PIL import Image
from pydantic import BaseModel, Field

from backend.services.online_service import OnlineError, OnlineService
from backend.services.project_manager import ProjectManager, ProjectNotFoundError


class ConnectionRequest(BaseModel):
    serverUrl: str = Field(min_length=1, max_length=2048)
    username: str = Field(default="", max_length=256)
    password: str | None = Field(default=None, max_length=1024)


class OnlineChapterRequest(BaseModel):
    mangaId: int = Field(ge=0)
    chapterIndex: int = Field(ge=0)
    chapterId: int = Field(ge=0)


class OnlinePageRequest(OnlineChapterRequest):
    pageIndex: int = Field(ge=0)
    includeNext: bool = False


def image_response(path) -> FileResponse:
    with Image.open(path) as image:
        media_type = Image.MIME.get(image.format, "application/octet-stream")
    return FileResponse(path, media_type=media_type, headers={"Cache-Control": "private, max-age=3600"})


def create_online_router(service: OnlineService, get_manager: Callable[[], ProjectManager]) -> APIRouter:
    router = APIRouter()

    def call(action):
        try:
            return action()
        except ProjectNotFoundError as error:
            raise HTTPException(404, detail=str(error)) from error
        except OnlineError as error:
            raise HTTPException(502, detail=str(error)) from error

    @router.get("/api/online/connection")
    def connection():
        return service.public_settings()

    @router.put("/api/online/connection")
    def configure(request: ConnectionRequest):
        try:
            return service.configure(request.serverUrl, request.username, request.password)
        except OnlineError as error:
            raise HTTPException(400, detail=str(error)) from error

    @router.get("/api/online/sources")
    def sources():
        return call(service.sources)

    @router.get("/api/online/search")
    def search(q: str = Query(default="", max_length=500), source: str = Query(default="all", max_length=80),
               page: int = Query(default=1, ge=1, le=1000), language: str = Query(default="en", max_length=30),
               mode: str = Query(default="popular", pattern="^(popular|latest)$"), category: int | None = None,
               genre: str = Query(default="", max_length=200)):
        return call(lambda: service.search(q.strip(), source, page, language, mode=mode, category=category, genre=genre))

    @router.get("/api/online/categories")
    def categories():
        return call(service.categories)

    @router.get("/api/online/genres")
    def genres(source: str = Query(max_length=80), category: int | None = None):
        def load():
            options = service.genre_options(source, category)
            return {"genres": [item["name"] for item in options["genres"]], "hints": options["hints"]}
        return call(load)

    @router.get("/api/online/series/{manga_id}")
    def series(manga_id: int):
        return call(lambda: service.json(f"manga/{manga_id}", {"onlineFetch": "true"}))

    @router.get("/api/online/series/{manga_id}/chapters")
    def chapters(manga_id: int, refresh: bool = False):
        return call(lambda: service.json(f"manga/{manga_id}/chapters", {"onlineFetch": str(refresh).lower()}))

    @router.get("/api/online/series/{manga_id}/cover")
    def cover(manga_id: int):
        return call(lambda: image_response(service.cover_path(manga_id)))

    @router.get("/api/online/series/{manga_id}/chapters/{chapter_index}")
    def chapter(manga_id: int, chapter_index: int):
        return call(lambda: service.chapter(manga_id, chapter_index, refresh=True))

    @router.get("/api/online/series/{manga_id}/chapters/{chapter_index}/pages/{page_index}")
    def page_content(manga_id: int, chapter_index: int, page_index: int):
        return call(lambda: image_response(service.page_path(manga_id, chapter_index, page_index)))

    @router.post("/api/projects/{project_id}/source-groups/online")
    def snapshot(project_id: str, request: OnlinePageRequest):
        return call(lambda: service.snapshot(get_manager(), project_id, request.mangaId, request.chapterIndex,
                                             request.pageIndex, request.includeNext, request.chapterId))

    @router.post("/api/projects/{project_id}/source-groups/online-chapter", status_code=202)
    def prepare_chapter(project_id: str, request: OnlineChapterRequest):
        return call(lambda: service.start_chapter(get_manager(), project_id, request.mangaId,
                                                  request.chapterIndex, request.chapterId))

    @router.get("/api/online/chapter-jobs/{job_id}")
    def chapter_job(job_id: str):
        return call(lambda: service.chapter_job(job_id))

    return router
