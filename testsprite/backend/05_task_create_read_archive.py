import uuid

import requests

BASE_URL = "https://app.hypertask.ai/api/mcp"
BOARD_ID = 5592


def test_task_create_read_archive() -> None:
    headers = {**__AUTH_HEADERS__}
    projects = requests.get(f"{BASE_URL}/projects", headers=headers, params={"limit": 100}, timeout=30)
    assert projects.status_code == 200
    board = next((item for item in projects.json().get("projects", []) if item.get("id") == BOARD_ID), None)
    assert board is not None and board.get("title") == "TestSprite QA" and board.get("ownerId") == 985
    sections = requests.get(f"{BASE_URL}/projects/{BOARD_ID}/sections", headers=headers, timeout=30)
    assert sections.status_code == 200
    backlog = next(item for item in sections.json()["sections"] if item.get("section_title") == "Backlog")
    title = f"TestSprite create {uuid.uuid4()}"
    task_id = None
    try:
        created = requests.post(
            f"{BASE_URL}/tasks/create",
            headers={**headers, "Content-Type": "application/json"},
            json={"project_id": BOARD_ID, "section_id": backlog["id"], "title": title},
            timeout=30,
        )
        assert created.status_code == 200, f"POST /tasks/create expected 200, got {created.status_code}"
        task = created.json().get("task", {})
        task_id = task.get("id")
        assert isinstance(task_id, int) and task.get("title") == title and task.get("projectId") == BOARD_ID
        detail = requests.get(
            f"{BASE_URL}/tasks", headers=headers, params={"task_id": task_id, "project_id": BOARD_ID}, timeout=30
        )
        assert detail.status_code == 200
        tasks = detail.json().get("tasks", [])
        assert len(tasks) == 1 and tasks[0].get("id") == task_id
    finally:
        if task_id is not None:
            archived = requests.post(
                f"{BASE_URL}/tasks/update",
                headers={**headers, "Content-Type": "application/json"},
                json={"task_id": task_id, "status": "Archive"},
                timeout=30,
            )
            assert archived.status_code == 200


test_task_create_read_archive()
