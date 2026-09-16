import requests

BASE_URL = "https://app.hypertask.ai/api/mcp"
TASK_PREFIX = "TestSprite lifecycle"
UPDATED_TITLE = f"{TASK_PREFIX} updated"


def find_task(headers):
    projects = requests.get(f"{BASE_URL}/projects", headers=headers, params={"search": "TestSprite QA"}, timeout=30).json()
    board = next(p for p in projects["projects"] if p.get("title") == "TestSprite QA")
    response = requests.get(f"{BASE_URL}/tasks", headers=headers, params={"project_id": board["id"], "search": TASK_PREFIX}, timeout=30)
    assert response.status_code == 200
    task = next((t for t in response.json().get("tasks", []) if t.get("title", "").startswith(TASK_PREFIX)), None)
    assert task is not None
    return task


def test_task_update_title() -> None:
    headers = {**__AUTH_HEADERS__}
    task = find_task(headers)
    response = requests.post(
        f"{BASE_URL}/tasks/update",
        headers={**headers, "Content-Type": "application/json"},
        json={"task_id": task["id"], "title": UPDATED_TITLE},
        timeout=30,
    )
    assert response.status_code == 200, f"POST /tasks/update title expected 200, got {response.status_code}"
    body = response.json()
    assert body.get("success") is True
    assert isinstance(body.get("tasks"), list) and len(body["tasks"]) == 1
    assert body.get("task", {}).get("title") == UPDATED_TITLE
    assert body["tasks"][0].get("id") == task["id"]


test_task_update_title()
