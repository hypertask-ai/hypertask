import uuid

import requests

BASE_URL = "https://app.hypertask.ai/api/mcp"
BOARD_ID = 5592


def test_task_update_title_and_labels() -> None:
    headers = {**__AUTH_HEADERS__}
    projects = requests.get(f"{BASE_URL}/projects", headers=headers, params={"limit": 100}, timeout=30)
    assert projects.status_code == 200
    board = next((item for item in projects.json().get("projects", []) if item.get("id") == BOARD_ID), None)
    assert board is not None and board.get("title") == "TestSprite QA" and board.get("ownerId") == 985
    label = next(item for item in board.get("labels", []) if item.get("name") == "testsprite")
    sections = requests.get(f"{BASE_URL}/projects/{BOARD_ID}/sections", headers=headers, timeout=30).json()["sections"]
    backlog = next(item for item in sections if item.get("section_title") == "Backlog")
    original = f"TestSprite update {uuid.uuid4()}"
    updated_title = f"{original} renamed"
    task_id = None
    try:
        created = requests.post(
            f"{BASE_URL}/tasks/create",
            headers={**headers, "Content-Type": "application/json"},
            json={"project_id": BOARD_ID, "section_id": backlog["id"], "title": original},
            timeout=30,
        )
        assert created.status_code == 200
        task_id = created.json()["task"]["id"]
        updated = requests.post(
            f"{BASE_URL}/tasks/update",
            headers={**headers, "Content-Type": "application/json"},
            json={"task_id": task_id, "title": updated_title, "labels": [label["id"]]},
            timeout=30,
        )
        assert updated.status_code == 200
        task = updated.json().get("task", {})
        assert task.get("title") == updated_title
        assert any(item.get("id") == label["id"] for item in task.get("labels", []))
    finally:
        if task_id is not None:
            archived = requests.post(
                f"{BASE_URL}/tasks/update",
                headers={**headers, "Content-Type": "application/json"},
                json={"task_id": task_id, "status": "Archive"},
                timeout=30,
            )
            assert archived.status_code == 200


test_task_update_title_and_labels()
