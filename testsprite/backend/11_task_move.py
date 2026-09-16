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


def test_task_move() -> None:
    headers = {**__AUTH_HEADERS__}
    board, task = board_and_task(headers)
    sections = requests.get(f"{BASE_URL}/projects/{board['id']}/sections", headers=headers, timeout=30)
    assert sections.status_code == 200
    done = next((section for section in sections.json().get("sections", []) if section.get("section_title") == "Done"), None)
    assert done is not None
    response = requests.post(
        f"{BASE_URL}/tasks/move",
        headers={**headers, "Content-Type": "application/json"},
        json={"task_id": task["id"], "target_project_id": board["id"], "target_section_id": done["id"]},
        timeout=30,
    )
    assert response.status_code == 200, f"POST /tasks/move expected 200, got {response.status_code}"
    body = response.json()
    assert body.get("success") is True
    assert body.get("task", {}).get("id") == task["id"]
    assert body.get("task", {}).get("section") == "Done"
    assert body.get("task", {}).get("sectionId") == done["id"]


test_task_move()
