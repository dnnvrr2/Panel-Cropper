from pathlib import Path

from pytest import MonkeyPatch

from backend.services import project_manager


def test_unique_default_and_named_projects(tmp_path: Path, monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setattr(project_manager, "REGISTRY_FILE", tmp_path / "registry.json")
    manager = project_manager.ProjectManager()

    first = manager.create_project(str(tmp_path), None)
    second = manager.create_project(str(tmp_path), "")
    named = manager.create_project(str(tmp_path), "Story")
    duplicate = manager.create_project(str(tmp_path), "Story")

    assert first["projectName"] == "Project 1"
    assert second["projectName"] == "Project 2"
    assert named["projectName"] == "Story"
    assert duplicate["projectName"] == "Story 2"

