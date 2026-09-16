import requests

BASE_URL = "https://app.hypertask.ai/api/mcp"
TASK_PREFIX = "TestSprite lifecycle"


def find_task(headers):
    projects = requests.get(f"{BASE_URL}/projects", headers=headers, params={"search": "TestSprite QA"}, timeout=30)
    assert projects.status_code == 200
    board = next(p for p in projects.json()["projects"] if p.get("title") == "TestSprite QA")
    tasks = requests.get(f"{BASE_URL}/tasks", headers=headers, params={"project_id": board["id"], "search": TASK_PREFIX}, timeout=30)
    assert tasks.status_code == 200
    task = next((t for t in tasks.json().get("tasks", []) if t.get("title", "").startswith(TASK_PREFIX)), None)
    assert task is not None
    return board["id"], task


def test_task_get() -> None:
    headers = {**__AUTH_HEADERS__}
    project_id, listed = find_task(headers)
    response = requests.get(
        f"{BASE_URL}/tasks",
        headers=headers,
        params={"task_id": listed["id"], "project_id": project_id},
        timeout=30,
    )
    assert response.status_code == 200, f"GET /tasks?task_id expected 200, got {response.status_code}"
    body = response.json()
    assert body.get("success") is True
    assert isinstance(body.get("tasks"), list) and len(body["tasks"]) == 1
    task = body["tasks"][0]
    assert task.get("id") == listed["id"]
    assert task.get("projectId") == project_id
    assert isinstance(task.get("labels"), list)
    assert isinstance(task.get("totalComments"), int)


test_task_get()
