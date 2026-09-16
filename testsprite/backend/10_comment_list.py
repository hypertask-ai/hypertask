import requests

BASE_URL = "https://app.hypertask.ai/api/mcp"
TASK_TITLE = "TestSprite lifecycle updated"
COMMENT_HTML = "<p>TestSprite HTML comment</p>"


def find_task(headers):
    projects = requests.get(f"{BASE_URL}/projects", headers=headers, params={"search": "TestSprite QA"}, timeout=30).json()
    board = next(p for p in projects["projects"] if p.get("title") == "TestSprite QA")
    tasks = requests.get(f"{BASE_URL}/tasks", headers=headers, params={"project_id": board["id"], "search": TASK_TITLE}, timeout=30)
    assert tasks.status_code == 200
    task = next((t for t in tasks.json().get("tasks", []) if t.get("title") == TASK_TITLE), None)
    assert task is not None
    return task


def test_comment_list() -> None:
    headers = {**__AUTH_HEADERS__}
    task = find_task(headers)
    response = requests.get(f"{BASE_URL}/comments", headers=headers, params={"task_id": task["id"], "sort_order": "asc"}, timeout=30)
    assert response.status_code == 200, f"GET /comments expected 200, got {response.status_code}"
    body = response.json()
    assert body.get("success") is True
    assert isinstance(body.get("comments"), list)
    assert isinstance(body.get("total"), int) and body["total"] >= 1
    comment = next((item for item in body["comments"] if item.get("text") == COMMENT_HTML), None)
    assert comment is not None
    assert isinstance(comment.get("commentText"), str)
    assert isinstance(comment.get("createdAt"), str)


test_comment_list()
