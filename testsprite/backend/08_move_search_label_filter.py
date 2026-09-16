import time
import uuid

import requests

BASE_URL = "https://app.hypertask.ai/api/mcp"
BOARD_ID = 5592


def test_move_search_and_label_filter() -> None:
    headers = {**__AUTH_HEADERS__}
    projects = requests.get(f"{BASE_URL}/projects", headers=headers, params={"limit": 100}, timeout=30)
    assert projects.status_code == 200
    board = next((item for item in projects.json().get("projects", []) if item.get("id") == BOARD_ID), None)
    assert board is not None and board.get("title") == "TestSprite QA" and board.get("ownerId") == 985
    label = next(item for item in board.get("labels", []) if item.get("name") == "testsprite")
    sections = requests.get(f"{BASE_URL}/projects/{BOARD_ID}/sections", headers=headers, timeout=30).json()["sections"]
    backlog = next(item for item in sections if item.get("section_title") == "Backlog")
    done = next(item for item in sections if item.get("section_title") == "Done")
    title = f"TestSprite search {uuid.uuid4()}"
    task_id = None
    try:
        created = requests.post(
            f"{BASE_URL}/tasks/create",
            headers={**headers, "Content-Type": "application/json"},
            json={"project_id": BOARD_ID, "section_id": backlog["id"], "title": title},
            timeout=30,
        )
        assert created.status_code == 200
        task_id = created.json()["task"]["id"]
        labeled = requests.post(
            f"{BASE_URL}/tasks/update",
            headers={**headers, "Content-Type": "application/json"},
            json={"task_id": task_id, "labels": [label["id"]]},
            timeout=30,
        )
        assert labeled.status_code == 200
        moved = requests.post(
            f"{BASE_URL}/tasks/move",
            headers={**headers, "Content-Type": "application/json"},
            json={"task_id": task_id, "target_project_id": BOARD_ID, "target_section_id": done["id"]},
            timeout=30,
        )
        assert moved.status_code == 200 and moved.json().get("task", {}).get("sectionId") == done["id"]
        found = False
        for _ in range(6):
            searched = requests.get(f"{BASE_URL}/tasks/search", headers=headers, params={"query": title}, timeout=30)
            assert searched.status_code == 200
            if any(item.get("id") == task_id for item in searched.json().get("tasks", [])):
                found = True
                break
            time.sleep(2)
        assert found, "New task was not indexed for search within 12 seconds"
        filtered = requests.get(
            f"{BASE_URL}/tasks",
            headers=headers,
            params=[("project_id", BOARD_ID), ("labels", label["id"]), ("status", "Normal")],
            timeout=30,
        )
        assert filtered.status_code == 200
        assert any(item.get("id") == task_id for item in filtered.json().get("tasks", [])), (
            "label filter regression: https://app.hypertask.ai/detail/project-15/6475"
        )
    finally:
        if task_id is not None:
            archived = requests.post(
                f"{BASE_URL}/tasks/update",
                headers={**headers, "Content-Type": "application/json"},
                json={"task_id": task_id, "status": "Archive"},
                timeout=30,
            )
            assert archived.status_code == 200


test_move_search_and_label_filter()
