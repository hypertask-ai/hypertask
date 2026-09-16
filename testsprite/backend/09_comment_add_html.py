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


def test_comment_add_html() -> None:
    headers = {**__AUTH_HEADERS__}
    task = find_task(headers)
    response = requests.post(
        f"{BASE_URL}/comments",
        headers={**headers, "Content-Type": "application/json"},
        json={"task_id": task["id"], "text": COMMENT_HTML, "content_type": "html"},
        timeout=30,
    )
    assert response.status_code == 201, f"POST /comments expected 201, got {response.status_code}"
    body = response.json()
    assert body.get("success") is True
    assert isinstance(body.get("url"), str) and body["url"].startswith("https://app.hypertask.ai/")
    comment = body.get("comment")
    assert isinstance(comment, dict) and isinstance(comment.get("id"), int)
    assert comment.get("text") == COMMENT_HTML, "HTML comment must be stored as a <p> block"


test_comment_add_html()
