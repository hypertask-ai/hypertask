import uuid

import requests

BASE_URL = "https://app.hypertask.ai/api/mcp"
BOARD_ID = 5592
COMMENT_HTML = "<p>TestSprite HTML comment</p>"


def test_comment_add_and_list() -> None:
    headers = {**__AUTH_HEADERS__}
    projects = requests.get(f"{BASE_URL}/projects", headers=headers, params={"limit": 100}, timeout=30)
    assert projects.status_code == 200
    board = next((item for item in projects.json().get("projects", []) if item.get("id") == BOARD_ID), None)
    assert board is not None and board.get("title") == "TestSprite QA" and board.get("ownerId") == 985
    sections = requests.get(f"{BASE_URL}/projects/{BOARD_ID}/sections", headers=headers, timeout=30).json()["sections"]
    backlog = next(item for item in sections if item.get("section_title") == "Backlog")
    task_id = None
    try:
        created = requests.post(
            f"{BASE_URL}/tasks/create",
            headers={**headers, "Content-Type": "application/json"},
            json={"project_id": BOARD_ID, "section_id": backlog["id"], "title": f"TestSprite comment {uuid.uuid4()}"},
            timeout=30,
        )
        assert created.status_code == 200
        task_id = created.json()["task"]["id"]
        added = requests.post(
            f"{BASE_URL}/comments",
            headers={**headers, "Content-Type": "application/json"},
            json={"task_id": task_id, "text": COMMENT_HTML, "content_type": "html"},
            timeout=30,
        )
        assert added.status_code == 201
        comment_id = added.json().get("comment", {}).get("id")
        assert isinstance(comment_id, int) and added.json()["comment"].get("text") == COMMENT_HTML
        listed = requests.get(f"{BASE_URL}/comments", headers=headers, params={"task_id": task_id}, timeout=30)
        assert listed.status_code == 200
        assert any(item.get("id") == comment_id for item in listed.json().get("comments", []))
    finally:
        if task_id is not None:
            archived = requests.post(
                f"{BASE_URL}/tasks/update",
                headers={**headers, "Content-Type": "application/json"},
                json={"task_id": task_id, "status": "Archive"},
                timeout=30,
            )
            assert archived.status_code == 200


test_comment_add_and_list()
