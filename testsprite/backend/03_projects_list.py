import requests

BASE_URL = "https://app.hypertask.ai/api/mcp"
BOARD_ID = 5592


def test_projects_list() -> None:
    response = requests.get(
        f"{BASE_URL}/projects",
        headers={**__AUTH_HEADERS__},
        params={"status": "Normal", "limit": 100},
        timeout=30,
    )
    assert response.status_code == 200, f"GET /projects expected 200, got {response.status_code}"
    body = response.json()
    assert body.get("success") is True
    assert isinstance(body.get("projects"), list)
    assert isinstance(body.get("total"), int)
    board = next((item for item in body["projects"] if item.get("id") == BOARD_ID), None)
    assert board is not None
    assert board.get("title") == "TestSprite QA"
    assert board.get("ownerId") == 985
    assert isinstance(board.get("sections"), list)
    assert any(label.get("name") == "testsprite" for label in board.get("labels", []))


test_projects_list()
