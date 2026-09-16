import requests

BASE_URL = "https://app.hypertask.ai/api/mcp"
TASK_TITLE = "TestSprite lifecycle updated"


def board_and_task(headers):
    projects = requests.get(f"{BASE_URL}/projects", headers=headers, params={"search": "TestSprite QA"}, timeout=30).json()
    board = next(p for p in projects["projects"] if p.get("title") == "TestSprite QA")
    tasks = requests.get(f"{BASE_URL}/tasks", headers=headers, params={"project_id": board["id"], "search": TASK_TITLE}, timeout=30)
    assert tasks.status_code == 200
    task = next((t for t in tasks.json().get("tasks", []) if t.get("title") == TASK_TITLE), None)
    assert task is not None
    return board, task


def test_task_update_labels() -> None:
    headers = {**__AUTH_HEADERS__}
    board, task = board_and_task(headers)
    label = next((label for label in board.get("labels", []) if label.get("name") == "testsprite"), None)
    assert label is not None and isinstance(label.get("id"), str)
    response = requests.post(
        f"{BASE_URL}/tasks/update",
        headers={**headers, "Content-Type": "application/json"},
        json={"task_id": task["id"], "labels": [label["id"]]},
        timeout=30,
    )
    assert response.status_code == 200, f"POST /tasks/update labels expected 200, got {response.status_code}"
    body = response.json()
    assert body.get("success") is True
    updated = body.get("task")
    assert isinstance(updated, dict)
    assert any(item.get("id") == label["id"] and item.get("name") == "testsprite" for item in updated.get("labels", []))


test_task_update_labels()
