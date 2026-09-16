import requests

BASE_URL = "https://app.hypertask.ai/api/mcp"
TASK_PREFIX = "TestSprite lifecycle"


def project(headers):
    response = requests.get(f"{BASE_URL}/projects", headers=headers, params={"search": "TestSprite QA"}, timeout=30)
    assert response.status_code == 200
    board = next((p for p in response.json().get("projects", []) if p.get("title") == "TestSprite QA"), None)
    assert board is not None
    return board


def test_task_create() -> None:
    headers = {**__AUTH_HEADERS__}
    board = project(headers)
    project_id = board["id"]
    sections = requests.get(f"{BASE_URL}/projects/{project_id}/sections", headers=headers, timeout=30)
    assert sections.status_code == 200
    backlog = next((s for s in sections.json().get("sections", []) if s.get("section_title") == "Backlog"), None)
    assert backlog is not None

    existing = requests.get(
        f"{BASE_URL}/tasks",
        headers=headers,
        params={"project_id": project_id, "search": TASK_PREFIX, "status": "Normal", "limit": 100},
        timeout=30,
    )
    assert existing.status_code == 200
    for task in existing.json().get("tasks", []):
        if task.get("title", "").startswith(TASK_PREFIX):
            archived = requests.post(
                f"{BASE_URL}/tasks/update",
                headers={**headers, "Content-Type": "application/json"},
                json={"task_id": task["id"], "status": "Archive"},
                timeout=30,
            )
            assert archived.status_code == 200
            assert archived.json().get("success") is True

    response = requests.post(
        f"{BASE_URL}/tasks/create",
        headers={**headers, "Content-Type": "application/json"},
        json={
            "project_id": project_id,
            "section_id": backlog["id"],
            "title": f"{TASK_PREFIX} initial",
            "description": "Created only for the TestSprite QA API lifecycle.",
        },
        timeout=30,
    )
    assert response.status_code == 200, f"POST /tasks/create expected 200, got {response.status_code}"
    body = response.json()
    assert body.get("success") is True
    task = body.get("task")
    assert isinstance(task, dict)
    assert isinstance(task.get("id"), int)
    assert task.get("title") == f"{TASK_PREFIX} initial"
    assert task.get("projectId") == project_id
    assert task.get("status") == "Normal"


test_task_create()
