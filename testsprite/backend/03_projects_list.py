import requests

BASE_URL = "https://app.hypertask.ai/api/mcp"


def test_projects_list() -> None:
    response = requests.get(
        f"{BASE_URL}/projects",
        headers={**__AUTH_HEADERS__},
        params={"status": "Normal", "search": "TestSprite QA"},
        timeout=30,
    )
    assert response.status_code == 200, f"GET /projects expected 200, got {response.status_code}"
    body = response.json()
    assert body.get("success") is True
    assert isinstance(body.get("projects"), list)
    assert isinstance(body.get("total"), int)
    board = next((p for p in body["projects"] if p.get("title") == "TestSprite QA"), None)
    assert board is not None
    assert isinstance(board.get("id"), int)
    assert isinstance(board.get("sections"), list)
    assert any(label.get("name") == "testsprite" for label in board.get("labels", []))


test_projects_list()
