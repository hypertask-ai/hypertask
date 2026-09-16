import requests

BASE_URL = "https://app.hypertask.ai/api/mcp"
TASK_PREFIX = "TestSprite lifecycle"


def test_task_archive_cleanup() -> None:
    headers = {**__AUTH_HEADERS__}
    projects = requests.get(f"{BASE_URL}/projects", headers=headers, params={"search": "TestSprite QA"}, timeout=30)
    assert projects.status_code == 200
    board = next(p for p in projects.json()["projects"] if p.get("title") == "TestSprite QA")
    tasks = requests.get(
        f"{BASE_URL}/tasks",
        headers=headers,
        params={"project_id": board["id"], "search": TASK_PREFIX, "status": "Normal", "limit": 100},
        timeout=30,
    )
    assert tasks.status_code == 200
    matching = [task for task in tasks.json().get("tasks", []) if task.get("title", "").startswith(TASK_PREFIX)]
    assert matching, "no TestSprite-created task was available to archive"
    for task in matching:
        response = requests.post(
            f"{BASE_URL}/tasks/update",
            headers={**headers, "Content-Type": "application/json"},
            json={"task_id": task["id"], "status": "Archive"},
            timeout=30,
        )
        assert response.status_code == 200, f"POST /tasks/update archive expected 200, got {response.status_code}"
        body = response.json()
        assert body.get("success") is True
        assert body.get("task", {}).get("status") == "Archive"


test_task_archive_cleanup()
